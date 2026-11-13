# -*- coding: utf-8 -*-
"""
HPAI_Zones.pyt's own steps, run outside ArcGIS with the stand-in arcpy in fake_arcpy/ (made-up tables only): "Check
only" writes nothing; a run copies what is there, adds the new rows and removes the old; a failure while adding puts
the layer back as it was; today's public zones layer is refused; the window warns before the run; the starter file's
fields are the ones the rebuild accepts. ArcGIS itself is tried on the work PC.
Run from the repository's root:  python3 -m unittest discover -s tools/arcgis-zones/tests -v
"""

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
sys.path.insert(0, os.path.join(HERE, 'fake_arcpy'))
sys.path.insert(0, TOOL)
import arcpy  # noqa: E402  (the stand-in)
import zone_rules as Z  # noqa: E402

# HPAI_ZONES_PYT: another copy of the toolbox to test (a deliberately broken one, to show these tests catch it).
loader = importlib.machinery.SourceFileLoader('HPAI_Zones', os.environ.get('HPAI_ZONES_PYT', os.path.join(TOOL, 'HPAI_Zones.pyt')))
spec = importlib.util.spec_from_loader('HPAI_Zones', loader)
TB = importlib.util.module_from_spec(spec)
loader.exec_module(TB)

ZONES, CASES = 'https://example.invalid/zones/FeatureServer/0', 'https://example.invalid/cases/FeatureServer/0'
STARTER = [(n, 'String', ln) for n, _, ln in Z.ZONE_FIELDS]
NINE = [(a, 'Date' if k == 'DATE' else 'Integer' if k == 'LONG' else 'String', 255) for _, a, k in Z.CASE_FIELDS]
OLD_ZONE = {'Zone_Type': 'Infection Zone', 'Closed_Site': 'No', 'Online_Live': 'Yes', 'Statement1': 'old'}


class Toolbox(unittest.TestCase):
    def setUp(self):
        arcpy.reset()
        self.folder = tempfile.mkdtemp(prefix='hpai-zones-test-')
        arcpy.add(ZONES, STARTER, [OLD_ZONE, OLD_ZONE])
        arcpy.add(CASES, NINE, [{'County': 'old'}], shape=False)
        arcpy.LAYERS['WSDA HPAI Zones (source)'] = ZONES   # a layer in the map, its data the service

    def tearDown(self):
        shutil.rmtree(self.folder, ignore_errors=True)

    def run_tool(self, check_only, zones='WSDA HPAI Zones (source)', cases=CASES, on=datetime(2026, 9, 1)):
        tool = TB.RebuildZones()
        p = tool.getParameterInfo()
        self.assertTrue(p[6].value, '"Check only" ticked when the tool opens')
        for k, v in enumerate([os.path.abspath(TABLE), zones, cases, on, None, self.folder, check_only]):
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

    def test_a_run_replaces_both(self):
        self.run_tool(False)
        rows = list(arcpy.DATA[ZONES]['rows'].items())
        self.assertEqual(len(rows), 26)
        self.assertEqual(min(oid for oid, _ in rows), 3, 'the two old zones removed, after the new were added')
        live = [r for _, r in rows if r['Online_Live'] == 'Yes']
        self.assertEqual(len(live), 24, 'one public set per map point: Yakima 11\'s two zones hidden')
        shape = rows[1][1]['SHAPE@']
        self.assertEqual((len(shape.rings), shape.sr), (2, 3857), 'the control ring with its hole, in the layer\'s system')
        self.assertTrue(all(len(r['Statement1']) == 302 for _, r in rows if r['Closed_Site'] == 'No'))
        cases = list(arcpy.DATA[CASES]['rows'].values())
        self.assertEqual(len(cases), 17)
        self.assertEqual(cases[0]['Confirmed_Diagnosis'], datetime(2022, 3, 10, 12))
        gdb = [f for f in os.listdir(self.folder) if f.endswith('.gdb')][0]
        self.assertEqual(len(arcpy.DATA[os.path.join(self.folder, gdb, 'zones_before')]['rows']), 2, 'the copy')
        self.assertEqual(len(arcpy.DATA[os.path.join(self.folder, gdb, 'cases_before')]['rows']), 1)
        self.assertIn('DONE. The public map follows by itself.', self.said())
        log = [f for f in os.listdir(self.folder) if f.endswith('.txt')][0]
        with open(os.path.join(self.folder, log), encoding='utf-8') as f:
            text = f.read()
        self.assertIn('Active ........................... 3   (2 flocks, 1 dairy herd)', text)
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

    def test_a_cases_table_with_more_fields_is_refused(self):
        arcpy.add('whole', NINE + [('Premises', 'String', 255)], [{'County': 'old'}], shape=False)
        self.run_tool(False, cases='whole')
        self.assertEqual(len(arcpy.DATA[ZONES]['rows']), 2, 'nothing written, the zones included')
        self.assertIn('beyond the nine: Premises', self.said('error')[0])

    def test_the_window_warns_before_the_run(self):
        bad = os.path.join(self.folder, 'bad.csv')
        with open(bad, 'w', newline='') as f:
            f.write('Case ID,Latitude,Longitude,Status\r\nA 01,-122.1,47.5,Active\r\nA 02,47.5,-122,Active\r\n')
        tool = TB.RebuildZones()
        p = tool.getParameterInfo()
        p[0].value, p[1].value = bad, 'todays-in-window'
        arcpy.add('todays-in-window', [('PremiseLoc', 'String', 255)] + STARTER)
        tool.updateMessages(p)
        self.assertEqual(p[0].warning, '1 row has coordinates to fix: line 2 (A 01).')
        self.assertTrue(p[1].error.startswith('This looks like today\'s public zones layer'))

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
