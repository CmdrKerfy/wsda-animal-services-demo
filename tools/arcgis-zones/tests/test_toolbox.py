# -*- coding: utf-8 -*-
"""
HPAI_Zones.pyt's own steps, run outside ArcGIS with the stand-in arcpy in fake_arcpy/ (made-up tables only): "Check
only" writes nothing; a run copies what is there, adds the new rows and removes the old; a failure while adding puts
the layer back as it was; today's public zones layer is refused; the window warns before the run; the starter file's
fields are the ones the rebuild accepts. ArcGIS itself is tried on the work PC.
Run from the repository's root:  python3 -m unittest discover -s tools/arcgis-zones/tests -v
"""

import csv
import importlib.machinery
import importlib.util
import os
import shutil
import sys
import tempfile
import unittest
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.dirname(HERE)
TABLE = os.path.join(TOOL, '..', '..', 'test-tables', 'em_rules_report.csv')
NEW_FORMAT = os.path.join(TOOL, '..', '..', 'test-tables', 'em_rules_new_format.csv')   # the table's 2.9.1 columns
sys.path.insert(0, os.path.join(HERE, 'fake_arcpy'))
sys.path.insert(0, TOOL)
import arcpy  # noqa: E402  (the stand-in)
import zone_rules as Z  # noqa: E402

# HPAI_ZONES_PYT: another copy of the toolbox to test (a deliberately broken one, to show these tests catch it).
PYT = os.environ.get('HPAI_ZONES_PYT', os.path.join(TOOL, 'HPAI_Zones.pyt'))
loader = importlib.machinery.SourceFileLoader('HPAI_Zones', PYT)
spec = importlib.util.spec_from_loader('HPAI_Zones', loader)
TB = importlib.util.module_from_spec(spec)
loader.exec_module(TB)

ZONES, CASES = 'https://example.invalid/zones/FeatureServer/0', 'https://example.invalid/cases/FeatureServer/0'
STARTER = [(n, 'String', ln) for n, _, ln in Z.ZONE_FIELDS]
ELEVEN = [(a, 'Date' if k == 'DATE' else 'Integer' if k == 'LONG' else 'String', 255) for _, a, k in Z.CASE_FIELDS]
OLD_ZONE = {'Zone_Type': 'Infection Zone', 'Closed_Site': 'No', 'Online_Live': 'Yes', 'Statement1': 'old'}


class Toolbox(unittest.TestCase):
    def setUp(self):
        arcpy.reset()
        self.folder = tempfile.mkdtemp(prefix='hpai-zones-test-')
        arcpy.add(ZONES, STARTER, [OLD_ZONE, OLD_ZONE])
        arcpy.add(CASES, ELEVEN, [{'County': 'old'}], shape=False)
        arcpy.LAYERS['WSDA HPAI Zones (source)'] = ZONES   # a layer in the map, its data the service

    def tearDown(self):
        shutil.rmtree(self.folder, ignore_errors=True)

    def run_tool(self, check_only, zones='WSDA HPAI Zones (source)', cases=CASES, on=datetime(2026, 9, 1), table=TABLE):
        tool = TB.RebuildZones()
        p = tool.getParameterInfo()
        self.assertTrue(p[6].value, '"Check only" ticked when the tool opens')
        for k, v in enumerate([os.path.abspath(table), zones, cases, on, None, self.folder, check_only]):
            p[k].value = v
        tool.execute(p, None)
        return p

    def said(self, level=None):
        return [t for lv, t in arcpy.MESSAGES if level is None or lv == level]

    def test_check_only_writes_nothing(self):
        self.run_tool(True)
        self.assertEqual(list(arcpy.DATA[ZONES]['rows'].values()), [OLD_ZONE, OLD_ZONE])
        self.assertEqual(list(arcpy.DATA[CASES]['rows'].values()), [{'County': 'old'}])
        self.assertIn('CHECK ONLY. Untick "Check only" and run again to write.', self.said())
        files = sorted(os.listdir(self.folder))
        self.assertEqual(files[0], 'hpai-cases-public.csv')
        self.assertTrue(files[1].startswith('hpai_zones_check_') and files[1].endswith('.txt'))
        self.assertEqual(len(files), 2, 'no copy made: nothing was written')
        self.assertTrue(any(t.endswith('hpai-cases-public.csv (15 rows, 11 columns; a copy for your records, nothing to upload).') for t in self.said()), self.said())
        self.assertIn('[4/5] Check only: the zones layer not written (' + ZONES + ').', self.said(), 'the address shown')
        self.assertIn('[5/5] Check only: the cases table not written (' + CASES + ').', self.said())

    def test_the_folder_must_be_given_and_names_go_to_the_second(self):
        p = TB.RebuildZones().getParameterInfo()
        self.assertEqual(p[5].parameterType, 'Required', 'never the HPAI table\'s own folder by default')
        self.run_tool(False)
        names = sorted(os.listdir(self.folder))
        self.assertRegex(names[1], r'^hpai_zones_before_\d{4}-\d\d-\d\d_\d{6}\.gdb$')
        self.assertRegex(names[2], r'^hpai_zones_check_\d{4}-\d\d-\d\d_\d{6}\.txt$')
        self.assertIn('[4/5] Writing the zones layer (' + ZONES + ')', self.said())
        self.assertIn('[5/5] Writing the cases table (' + CASES + ')', self.said())

    def test_a_file_with_the_right_fields_is_refused(self):
        """The starter file's layer and table, or a copy's, have the right fields; writing to them would leave the
        public map as it was, so only an online layer is taken."""
        local = os.path.join(self.folder, 'hpai_zones_starter.gdb')
        arcpy.add(os.path.join(local, 'HPAI_Zones'), STARTER, [OLD_ZONE])
        arcpy.add(os.path.join(local, 'HPAI_Cases'), ELEVEN, [{'County': 'old'}], shape=False)
        self.run_tool(False, zones=os.path.join(local, 'HPAI_Zones'))
        self.assertEqual(list(arcpy.DATA[os.path.join(local, 'HPAI_Zones')]['rows'].values()), [OLD_ZONE])
        self.assertTrue(self.said('error')[0].startswith('STOPPED: The zones layer picked is a file ('), self.said('error'))
        self.assertTrue(any(f.startswith('hpai_zones_check_') for f in os.listdir(self.folder)), 'a stop saves the check')
        del arcpy.MESSAGES[:]
        self.run_tool(False, cases=os.path.join(local, 'HPAI_Cases'))
        self.assertEqual(list(arcpy.DATA[ZONES]['rows'].values()), [OLD_ZONE, OLD_ZONE], 'nothing written, the zones included')
        self.assertTrue(self.said('error')[0].startswith('STOPPED: The cases table picked is a file ('), self.said('error'))
        tool = TB.RebuildZones()
        p = tool.getParameterInfo()
        p[1].value, p[2].value = os.path.join(local, 'HPAI_Zones'), os.path.join(local, 'HPAI_Cases')
        tool.updateMessages(p)
        self.assertIn('not the online layer', p[1].error)
        self.assertIn('not the online layer', p[2].error)

    def test_a_run_replaces_both(self):
        self.run_tool(False)
        rows = list(arcpy.DATA[ZONES]['rows'].items())
        self.assertEqual(len(rows), 26)
        self.assertEqual(min(oid for oid, _ in rows), 3, 'the two old zones removed, after the new were added')
        live = [r for _, r in rows if r['Online_Live'] == 'Yes']
        self.assertEqual(len(live), 20, 'one public set per map point, birds only: Yakima 11\'s two zones hidden, and '
                         'the dairy herd\'s and the goats\' (Franklin 12, Whatcom 11)')
        shape = rows[1][1]['SHAPE@']
        self.assertEqual((len(shape.rings), shape.sr), (2, 3857), 'the control ring with its hole, in the layer\'s system')
        self.assertTrue(all(len(r['Statement1']) == 302 for _, r in rows if r['Closed_Site'] == 'No'))
        cases = list(arcpy.DATA[CASES]['rows'].values())
        self.assertEqual(len(cases), 15, 'birds only')
        self.assertEqual(cases[0]['Confirmed_Diagnosis'], datetime(2022, 3, 10, 12))
        gdb = [f for f in os.listdir(self.folder) if f.endswith('.gdb')][0]
        self.assertEqual(len(arcpy.DATA[os.path.join(self.folder, gdb, 'zones_before')]['rows']), 2, 'the copy')
        self.assertEqual(len(arcpy.DATA[os.path.join(self.folder, gdb, 'cases_before')]['rows']), 1)
        self.assertIn('DONE. The public map follows by itself.', self.said())
        self.assertTrue(any(t.endswith('old ones removed. 11 fields written, no location.') for t in self.said()))
        log = [f for f in os.listdir(self.folder) if f.endswith('.txt')][0]
        with open(os.path.join(self.folder, log), encoding='utf-8') as f:
            text = f.read()
        self.assertIn('Active ........................... 3   (2 flocks, 1 dairy herd; the public dashboard\'s, birds: 2)', text)
        self.assertNotIn('MARKED', text)

    def test_a_layer_with_a_filter_still_has_everything_replaced(self):
        """The layer picked in the map shows only the open zones (a definition query); the run replaces the data
        behind it, so the old closed zones go too."""
        closed = dict(OLD_ZONE, Closed_Site='Yes')
        arcpy.add(ZONES, STARTER, [OLD_ZONE, closed])
        arcpy.QUERIES['WSDA HPAI Zones (source)'] = lambda row: row.get('Closed_Site') == 'No'
        self.run_tool(False)
        self.assertEqual(len(arcpy.DATA[ZONES]['rows']), 26)
        self.assertNotIn(closed, list(arcpy.DATA[ZONES]['rows'].values()))

    def test_a_failure_while_adding_puts_it_back(self):
        arcpy.DATA[ZONES]['fail_after'] = 5
        with self.assertRaises(RuntimeError):
            self.run_tool(False)
        self.assertEqual(list(arcpy.DATA[ZONES]['rows'].values()), [OLD_ZONE, OLD_ZONE], 'as it was before the run')
        self.assertEqual(list(arcpy.DATA[CASES]['rows'].values()), [{'County': 'old'}], 'the cases not reached')
        self.assertTrue(any(t.startswith('FAILED while adding zones: the 5 added were removed again') for t in self.said('error')))
        self.assertTrue(any(f.startswith('hpai_zones_check_') for f in os.listdir(self.folder)), 'the check saved')

    def test_todays_layer_is_refused(self):
        arcpy.add('todays', [('County', 'String', 255), ('Latitude', 'Double', 8), ('PremiseLoc', 'String', 255),
                             ('Zone_Type', 'String', 255), ('Closed_Site', 'String', 255), ('Online_Live', 'String', 255),
                             ('Statement1', 'String', 999), ('Statement2', 'String', 999), ('StmtOther', 'String', 999)],
                  [OLD_ZONE])
        self.run_tool(False, zones='todays')
        self.assertEqual(list(arcpy.DATA['todays']['rows'].values()), [OLD_ZONE])
        self.assertEqual(list(arcpy.DATA[CASES]['rows'].values()), [{'County': 'old'}])
        self.assertTrue(self.said('error')[0].startswith('STOPPED: This looks like today\'s public zones layer'))

    def test_the_new_columns_reach_their_fields(self):
        self.run_tool(False, table=NEW_FORMAT)
        cases = list(arcpy.DATA[CASES]['rows'].values())
        self.assertEqual(len(cases), 15)
        self.assertEqual((cases[0]['Quarantine_Status'], cases[0]['State'], cases[0]['County']), ('Released', 'WA', 'King'))
        oregon = [c for c in cases if c['State'] == 'OR']
        self.assertEqual([c['County'] for c in oregon], ['Multnomah'])

    def test_a_cases_table_from_before_2_9_1_is_refused(self):
        arcpy.add('nine', [f for f in ELEVEN if f[0] not in ('Quarantine_Status', 'State')], [{'County': 'old'}], shape=False)
        self.run_tool(False, cases='nine', table=NEW_FORMAT)
        self.assertEqual(list(arcpy.DATA[ZONES]['rows'].values()), [OLD_ZONE, OLD_ZONE], 'nothing written, the zones included')
        self.assertEqual(list(arcpy.DATA['nine']['rows'].values()), [{'County': 'old'}])
        errors = ' '.join(self.said('error'))
        self.assertIn('no field for Quarantine Status (looked for Quarantine_Status). A cases table made before 2.9.1', errors)
        self.assertIn('no field for State (looked for State)', errors)

    def test_a_zones_layer_from_before_2_9_1_is_refused(self):
        arcpy.add('seven', [f for f in STARTER if f[0] != 'Animal'], [OLD_ZONE], shape=True)
        arcpy.LAYERS['seven'] = 'seven'
        self.run_tool(False, zones='seven')
        self.assertEqual(list(arcpy.DATA['seven']['rows'].values()), [OLD_ZONE], 'nothing written')
        self.assertEqual(list(arcpy.DATA[CASES]['rows'].values()), [{'County': 'old'}], 'the cases table neither')
        self.assertIn('The zones layer has no Animal field. A zones layer made before 2.9.1', ' '.join(self.said('error')))

    def test_every_zone_written_with_its_animal(self):
        self.run_tool(False)
        rows = list(arcpy.DATA[ZONES]['rows'].values())
        self.assertTrue(rows and all(r.get('Animal') in ('Birds', 'Cattle', 'Birds, Cattle', 'Other animals')
                                     for r in rows), set(r.get('Animal') for r in rows))

    def test_a_cases_table_with_more_fields_is_refused(self):
        arcpy.add('whole', ELEVEN + [('Premises', 'String', 255)], [{'County': 'old'}], shape=False)
        self.run_tool(False, cases='whole')
        self.assertEqual(len(arcpy.DATA[ZONES]['rows']), 2, 'nothing written, the zones included')
        self.assertIn('beyond the eleven: Premises', self.said('error')[0])

    def test_the_window_warns_before_the_run(self):
        bad = os.path.join(self.folder, 'bad.csv')
        with open(bad, 'w', newline='') as f:
            f.write('Case ID,Latitude,Longitude,Status\r\nA 01,-122.1,47.5,Active\r\nA 02,47.5,-122,Active\r\n')
        tool = TB.RebuildZones()
        p = tool.getParameterInfo()
        p[0].value, p[1].value = bad, 'todays-in-window'
        arcpy.add('todays-in-window', [('PremiseLoc', 'String', 255)] + STARTER)
        tool.updateMessages(p)
        self.assertEqual(p[0].warning, Z.NO_SPECIES + ' A real run stops until it is fixed. No zones, latitude and '
                                       'longitude look swapped: row 2 (A 01). Zones drawn, coordinates with fewer than 4 '
                                       'decimals (Excel may have rounded them): row 3 (A 02).')
        self.assertTrue(p[1].error.startswith('This looks like today\'s public zones layer'))

    def test_a_table_that_cannot_be_read_hides_no_other_box(self):
        bad = os.path.join(self.folder, 'bad.csv')
        with open(bad, 'wb') as f:
            f.write(b'Case ID,Latitude,Longitude,Status\r\nA,47.5,-122,\x81\xff\r\n')
        tool = TB.RebuildZones()
        p = tool.getParameterInfo()
        p[0].value, p[1].value = bad, os.path.join(self.folder, 'copy.gdb', 'zones_before')
        arcpy.add(p[1].value, STARTER)
        tool.updateMessages(p)
        self.assertIn('CSV UTF-8 (Comma delimited)', p[0].error)
        self.assertIn('not the online layer', p[1].error)
        # Even when reading the table raises (not a table error), the other boxes are still checked.
        real = TB.read_cached
        TB.read_cached = lambda path: 1 / 0
        try:
            p[1].error = None
            tool.updateMessages(p)
        finally:
            TB.read_cached = real
        self.assertIn('not the online layer', p[1].error)

    def test_an_unreadable_close_date_stops_a_real_run_only(self):
        bad = os.path.join(self.folder, 'close.csv')
        with open(os.path.abspath(TABLE), encoding='utf-8-sig', newline='') as f:
            rows = list(csv.reader(f))
        rows[1][rows[0].index('Close Date')] = '10-Mar-22'
        with open(bad, 'w', encoding='utf-8', newline='') as f:
            csv.writer(f, lineterminator='\r\n').writerows(rows)
        self.run_tool(True, table=bad)
        self.assertTrue(any(t.startswith('A REAL RUN WILL STOP until these are fixed: A Close Date that could not be '
                                         'read: row 2') for t in self.said('warning')), self.said('warning'))
        del arcpy.MESSAGES[:]
        self.run_tool(False, table=bad)
        self.assertEqual(list(arcpy.DATA[ZONES]['rows'].values()), [OLD_ZONE, OLD_ZONE], 'nothing written')
        self.assertEqual(list(arcpy.DATA[CASES]['rows'].values()), [{'County': 'old'}])
        self.assertTrue(self.said('error')[0].startswith('STOPPED: Fix these in the HPAI table'), self.said('error'))
        self.assertIn(Z.DATE_HELP, self.said('error')[0])
        self.assertIn('THE CHECK (compare with the update)', self.said(), 'the check still shown')

    def test_a_table_without_species_stops_a_real_run_only(self):
        """Without a Species column every case would go on the public map as birds: a real run stops."""
        bad = os.path.join(self.folder, 'nospecies.csv')
        with open(os.path.abspath(TABLE), encoding='utf-8-sig', newline='') as f:
            rows = list(csv.reader(f))
        rows[0][rows[0].index('Species')] = 'Animal kind'
        with open(bad, 'w', encoding='utf-8', newline='') as f:
            csv.writer(f, lineterminator='\r\n').writerows(rows)
        self.run_tool(True, table=bad)
        self.assertTrue(any(t.startswith('A REAL RUN WILL STOP until these are fixed: ' + Z.NO_SPECIES)
                            for t in self.said('warning')), self.said('warning'))
        del arcpy.MESSAGES[:]
        self.run_tool(False, table=bad)
        self.assertEqual(list(arcpy.DATA[ZONES]['rows'].values()), [OLD_ZONE, OLD_ZONE], 'nothing written')
        self.assertEqual(list(arcpy.DATA[CASES]['rows'].values()), [{'County': 'old'}])
        self.assertIn(Z.NO_SPECIES, self.said('error')[0])

    def test_no_cases_table_is_said_loudly(self):
        """A run with the Cases table box blank leaves the cases table as it was, which may still hold every animal's
        rows from before 2.9.1: a warning says so."""
        self.run_tool(False, cases=None)
        self.assertTrue(any(t.startswith('No cases table given: it is not changed in this run.') for t in self.said('warning')),
                        self.said('warning'))
        self.assertEqual(list(arcpy.DATA[CASES]['rows'].values()), [{'County': 'old'}])

    def test_no_cases_file_when_the_tool_cannot_tell_birds(self):
        """Check only, a table without Species: hpai-cases-public.csv is not written (it would hold every case)."""
        bad = os.path.join(self.folder, 'nospecies.csv')
        with open(os.path.abspath(TABLE), encoding='utf-8-sig', newline='') as f:
            rows = list(csv.reader(f))
        rows[0][rows[0].index('Species')] = 'Animal kind'
        with open(bad, 'w', encoding='utf-8', newline='') as f:
            csv.writer(f, lineterminator='\r\n').writerows(rows)
        self.run_tool(True, table=bad)
        self.assertFalse(os.path.exists(os.path.join(self.folder, 'hpai-cases-public.csv')))
        self.assertIn('      hpai-cases-public.csv not written: the tool cannot yet tell birds from other animals.', self.said())

    def test_nothing_but_birds_reaches_the_public(self):
        """After a real run, the zones the public view shows (Online_Live Yes) are all of bird cases, one set per map
        point, and the cases table holds no row of another kind."""
        self.run_tool(False)
        live = [r for r in arcpy.DATA[ZONES]['rows'].values() if r['Online_Live'] == 'Yes']
        self.assertTrue(live and all('Birds' in r['Animal'] for r in live), set(r['Animal'] for r in live))
        shapes = [(r['Zone_Type'], r['SHAPE@'].rings[0][0]) for r in live]
        self.assertEqual(len(shapes), len(set(map(repr, shapes))), 'no zone shown twice')
        species = [r['Species'] for r in arcpy.DATA[CASES]['rows'].values()]
        self.assertNotIn('Dairy cattle', species)
        self.assertNotIn('Meat Goat', species)
        self.assertIn('Cattle, Chicken', species, 'a case of birds and cattle is a bird case')

    def test_the_check_file_names_every_row(self):
        """The messages name ten rows in a list, then how many more; the check file names them all."""
        many = os.path.join(self.folder, 'many.csv')
        with open(os.path.abspath(TABLE), encoding='utf-8-sig', newline='') as f:
            rows = list(csv.reader(f))
        sp = rows[0].index('Species')
        for k in range(1, 13):
            rows[k][sp] = 'Chkn %d' % k
        with open(many, 'w', encoding='utf-8', newline='') as f:
            csv.writer(f, lineterminator='\r\n').writerows(rows)
        self.run_tool(True, table=many)
        line = [t for t in self.said('warning') if 'does not recognize' in t][0]
        self.assertIn(', and 2 more.', line)
        check = [f for f in os.listdir(self.folder) if f.startswith('hpai_zones_check_')][0]
        with open(os.path.join(self.folder, check), encoding='utf-8') as f:
            text = f.read()
        full = [t for t in text.splitlines() if 'does not recognize' in t][0]
        self.assertNotIn('more.', full)
        self.assertIn('row 13 (Pierce 11) "Chkn 12"', full)

    def test_a_value_too_long_stops_a_real_run(self):
        tool_text = 'x' * 1001
        tool = TB.RebuildZones()
        p = tool.getParameterInfo()
        for k, v in enumerate([os.path.abspath(TABLE), 'WSDA HPAI Zones (source)', CASES, datetime(2026, 9, 1), tool_text,
                               self.folder, False]):
            p[k].value = v
        arcpy.DATA[ZONES]['fields'] = [(n, t, 1000 if n == 'StmtOther' else ln) for n, t, ln in STARTER]
        tool.execute(p, None)
        self.assertEqual(list(arcpy.DATA[ZONES]['rows'].values()), [OLD_ZONE, OLD_ZONE], 'nothing written')
        self.assertIn('Additional information has 1001 characters', self.said('error')[0])

    def test_a_folder_that_cannot_be_written(self):
        """Neither the public CSV nor the check file can be saved: the run stops plainly, never a Python error."""
        gone = self.folder
        self.folder = os.path.join(gone, 'not there')
        try:
            self.run_tool(False)
        finally:
            self.folder = gone
        self.assertEqual(list(arcpy.DATA[ZONES]['rows'].values()), [OLD_ZONE, OLD_ZONE], 'nothing written')
        self.assertTrue(self.said('error')[0].startswith('STOPPED: hpai-cases-public.csv could not be written ('))
        self.assertTrue(self.said('warning')[-1].startswith('The check file could not be saved in the folder ('))

    def test_the_zones_go_in_map_order(self):
        """The public's zones first, then the others, each south to north: a zone's place in the layer never lines up
        with its case's row in the cases table, and the public view's row numbers have no gaps where hidden zones
        would be."""
        self.run_tool(False)
        rows = [r for _, r in sorted(arcpy.DATA[ZONES]['rows'].items()) if r['Zone_Type'] == 'Infection Zone']
        live = [r['Online_Live'] for r in rows]
        self.assertEqual(live, sorted(live, key=lambda v: v != 'Yes'), 'every Yes before every No')
        for part in ('Yes', 'No'):
            north = [r['SHAPE@'].rings[0][0][1] for r in rows if r['Online_Live'] == part]
            self.assertEqual(north, sorted(north), part)

    def test_the_public_csv_open_in_excel(self):
        """Windows refuses to write a file Excel has open; here a folder of that name stands in for the lock."""
        os.mkdir(os.path.join(self.folder, 'hpai-cases-public.csv'))
        self.run_tool(False)
        self.assertEqual(list(arcpy.DATA[ZONES]['rows'].values()), [OLD_ZONE, OLD_ZONE], 'nothing written')
        self.assertTrue(self.said('error')[0].startswith('STOPPED: hpai-cases-public.csv could not be written ('))
        self.assertIn('If it is open in Excel, close it and run again. Nothing changed.', self.said('error')[0])

    def test_a_zones_layer_in_another_coordinate_system_is_refused(self):
        arcpy.add(ZONES, STARTER, [OLD_ZONE], sr=2927)
        self.run_tool(False)
        self.assertEqual(list(arcpy.DATA[ZONES]['rows'].values()), [OLD_ZONE])
        self.assertIn('map projection (code 2927)', self.said('error')[0])
        tool = TB.RebuildZones()
        p = tool.getParameterInfo()
        p[1].value = 'WSDA HPAI Zones (source)'
        tool.updateMessages(p)
        self.assertIn('map projection (code 2927)', p[1].error, 'shown in the window too')

    def test_a_failure_while_adding_cases_says_the_zones_were_written(self):
        arcpy.DATA[CASES]['fail_after'] = 3
        with self.assertRaises(RuntimeError):
            self.run_tool(False)
        self.assertEqual(len(arcpy.DATA[ZONES]['rows']), 26, 'the zones were rewritten')
        self.assertEqual(list(arcpy.DATA[CASES]['rows'].values()), [{'County': 'old'}], 'the cases as they were')
        errors = self.said('error')
        self.assertTrue(errors[0].startswith('FAILED while adding cases: the 3 added were removed again, so the cases '
                                             'are as they were before the run. The zones layer was already rewritten in '
                                             'this run; the copies from before it are in '), errors)
        self.assertEqual(len(errors), 1, 'one message, no contradiction')
        log = [f for f in os.listdir(self.folder) if f.startswith('hpai_zones_check_')][0]
        with open(os.path.join(self.folder, log), encoding='utf-8') as f:
            self.assertIn('The error: ', f.read(), 'the Python error in the check file')

    def test_a_failure_while_removing_says_so(self):
        real = TB.remove
        calls = []

        def failing(data, ids):
            calls.append(data)
            if data == CASES and len(calls) > 1:
                raise RuntimeError('remove failed')
            return real(data, ids)
        TB.remove = failing
        try:
            with self.assertRaises(RuntimeError):
                self.run_tool(False)
        finally:
            TB.remove = real
        errors = self.said('error')
        self.assertTrue(errors[0].startswith('FAILED while removing the old cases: the new ones are in, some old ones '
                                             'may be left'), errors)
        self.assertNotIn('as they were before the run', errors[0])

    def test_two_copies_of_the_tool_each_run_their_own_rules(self):
        """An old and a new folder added in one ArcGIS Pro session: each toolbox keeps the zone_rules beside it."""
        other = os.path.join(self.folder, 'other copy')
        os.mkdir(other)
        shutil.copy(PYT, os.path.join(other, 'HPAI_Zones.pyt'))
        with open(os.path.join(TOOL, 'zone_rules.py'), encoding='utf-8') as f:
            rules = f.read()
        with open(os.path.join(other, 'zone_rules.py'), 'w', encoding='utf-8') as f:
            f.write(rules.replace("INFECTION_KM = 3\n", "INFECTION_KM = 4\n"))
        loader2 = importlib.machinery.SourceFileLoader('HPAI_Zones_other', os.path.join(other, 'HPAI_Zones.pyt'))
        tb2 = importlib.util.module_from_spec(importlib.util.spec_from_loader('HPAI_Zones_other', loader2))
        loader2.exec_module(tb2)
        self.assertEqual((TB.Z.INFECTION_KM, tb2.Z.INFECTION_KM), (3, 4))

    def test_the_starter_file_is_what_the_rebuild_accepts(self):
        tool = TB.MakeStarter()
        p = tool.getParameterInfo()
        p[0].value = self.folder
        tool.execute(p, None)
        gdb = os.path.join(self.folder, 'hpai_zones_starter.gdb')
        zones, cases = os.path.join(gdb, 'HPAI_Zones'), os.path.join(gdb, 'HPAI_Cases')
        self.assertEqual(Z.check_zone_fields(TB.fields_of(zones)), [])
        self.assertEqual(Z.check_case_fields(TB.fields_of(cases))[0], [])
        self.assertEqual(arcpy.DATA[zones]['sr'], 3857)
        tool.updateMessages(p)
        self.assertIn('already in this folder', p[0].error)


if __name__ == '__main__':
    unittest.main()
