# -*- coding: utf-8 -*-
"""
The zones tool's rules (zone_rules.py) on made-up tables only: test-tables/em_*.csv (the Emergency dashboard's own
synthetic tables) and small tables written here. Each rule is checked against the dashboard's own answer where it has
one (dashboard_rules.js runs site/emergency/rules.js and report.js with Node), so the tool and the dashboard agree.
Run from the repository's root:  python3 -m unittest discover -s tools/arcgis-zones/tests -v
"""

import json
import math
import os
import subprocess
import sys
import unittest
from datetime import date, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
TABLES = os.path.join(ROOT, 'test-tables')
sys.path.insert(0, os.path.dirname(HERE))
import zone_rules as Z  # noqa: E402

# The public dashboard's counting rules (its Arcade file, kept with the ArcGIS build directions, not in the release):
# checked when HPAI_ARCADE_FILE names it, skipped otherwise.
ARCADE = os.environ.get('HPAI_ARCADE_FILE', '')
# Species as staff may type them: marks, spaces of every kind, placeholders, clashes, the new words.
SPECIES_TYPED = ['', ' ', 'Chicken', 'CHICKEN', 'Racing pigeon', 'Pigs', 'Cattle, Chicken', 'Cattle\tChicken',
                 'Cattle\u00a0Chicken', 'Cattle\u2013Chicken', 'Cattle/Chicken', '[Duck]', '*Turkey', '#chicken',
                 '"Chicken"', '\u201cChicken\u201d', 'Backyard_Chicken', 'Chiken', 'Opossum', 'Bobcat', 'sea\u00a0lion',
                 'Sea lions', 'Unknown', 'unknown?', 'N/A', 'n.a.', 'TBD', '-', '?', '\u2014', 'Unknown cattle', 'None', '0',
                 'Muscovy duck', 'Cowbird', 'Catbird', 'Holstein heifers', 'Hereford', 'Sample Eagle Dairy',
                 'Multiple Poultry Species', 'Mixed backyard flock', 'Dairy goat', 'Pe\u00e1cock', 'Goose\r\nCattle',
                 'Harbor seal', 'Pigeon', 'Cattle egret', 'Goat, Duck, Cow', 'Sea lion, Chicken', 'Sea  lions',
                 'Sheep flock', 'Goat flock', 'Flock of sheep', 'Backyard flock', 'Flocks', 'Chicken flock and sheep',
                 'Unknown species', 'Species unknown', 'Not known', 'Unk', 'UNK.', 'Goslings', 'Ducklings', 'Turkey poults',
                 'Guinea fowl', 'Pea fowl', 'Guinea pig']
TODAY = date(2026, 10, 30)   # the dashboard's fixtures' "today" (make_em_fixtures.js)
DATES = [date(2022, 6, 1), date(2024, 1, 15), date(2025, 6, 30), date(2026, 8, 1), date(2026, 9, 1), TODAY]
HEAD = ('Case ID,Date Reported,Close Date,Confirmed Diagnosis,Quarantine Release,Quarantine Status,Premises,Address,'
        'City,County,State,Latitude,Longitude,Status,Subtype,Flock/Herd Type,Production Type,Species,'
        'Flock/Herd Inventory,Depop Inventory,Structures,Disposal Method')


def read(path):
    with open(path, 'rb') as f:
        return Z.read_table(f.read())


def dashboard(path, on, today=TODAY):
    out = subprocess.run(['node', os.path.join(HERE, 'dashboard_rules.js'), path, on.isoformat(), today.isoformat()],
                         check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def table_of(*rows):
    """A made-up table in the agreed columns (2.9.1's) from rows of (id, detected, close, release, county, lat, lon,
    status, type, species, inventory); Quarantine Status from the status, State WA; Premises, Address and City hold
    marked words that must never come out."""
    lines = [HEAD]
    for r in rows:
        cid, det, close, rel, county, lat, lon, status, ftype, species, inv = r
        quarantine = 'Under quarantine' if status == 'Active' else 'Released'
        lines.append(','.join([cid, det, close, det, rel, quarantine, 'MARKED-PREMISES', 'MARKED-ADDRESS', 'MARKED-CITY',
                               county, 'WA', lat, lon, status, 'H5N1', ftype, 'X', species, inv, inv, '1', 'Landfill']))
    return Z.read_table(('\r\n'.join(lines) + '\r\n').encode('utf-8'))


def agreed_tables():
    """Every synthetic table in test-tables/ that the tool reads (the agreed columns or near them)."""
    out = []
    for name in sorted(os.listdir(TABLES)):
        if not (name.startswith('em_') and name.endswith('.csv')):
            continue
        path = os.path.join(TABLES, name)
        try:
            read(path)
        except Z.TableError:
            continue
        out.append(path)
    return out


class AgainstTheDashboard(unittest.TestCase):
    """Row by row and figure by figure, the dashboard's answers on its own synthetic tables, at six dates."""

    def test_every_row_on_every_date(self):
        tables = agreed_tables()
        self.assertGreaterEqual(len(tables), 10, 'the synthetic tables the tool reads')
        compared = 0
        for path in tables:
            t = read(path)
            for on in DATES:
                d = dashboard(path, on)
                with self.subTest(table=os.path.basename(path), on=on.isoformat()):
                    self.assertEqual([r['line'] for r in d['rows']], [c.line for c in t.cases], 'the rows read')
                    for r, c in zip(d['rows'], t.cases):
                        self.assertEqual(r['detected'], c.detected.isoformat() if c.detected else None, c.name())
                        self.assertEqual(r['mapped'], c.lat is not None, c.name())
                        self.assertEqual(r['key'], c.key() if c.lat is not None else None, c.name())
                        self.assertEqual(r['closed'], Z.is_closed(c, on, TODAY), c.name() + ' active or closed')
                        if not r['mapped']:
                            self.assertEqual(r['reason'], c.point_problem, c.name())
                    res = Z.build(t, on, TODAY)
                    f = d['figures']
                    self.assertEqual(f['cases'], len(res.rows))
                    self.assertEqual(f['later'], len(res.later))
                    self.assertEqual(f['undated'], len(res.undated))
                    self.assertEqual(f['noPoint'], len(res.no_point))
                    self.assertEqual(f['active'], len(res.active))
                    self.assertEqual(f['zones']['active'], len(res.zoned_active), 'active surveillance areas')
                    self.assertEqual(f['twice']['premises'], len(res.shared), 'map points with more than one case')
                    self.assertEqual(f['twice']['rows'], sum(len(s) for s in res.shared))
                    # The counties differ only where a mapped row has no County (the dashboard then takes the county
                    # its point falls in; the tool, like the public dashboard's Arcade, says "county not given").
                    if not any(c.county is None and c.lat is not None for c in res.rows):
                        self.assertEqual(f['countiesAffected'], len(res.counties), 'counties affected')
                        self.assertEqual(f['zones']['counties'], len(res.area_counties))
                compared += 1
        self.assertGreaterEqual(compared, 60)

    def test_the_report_scenario_on_september_1(self):
        """em_rules_report.csv on Sep 1, 2026: the Report view's own figures (worked out by hand in its unit tests)."""
        t = read(os.path.join(TABLES, 'em_rules_report.csv'))
        res = Z.build(t, date(2026, 9, 1), TODAY)
        self.assertEqual((len(res.rows), len(res.later), len(res.active), len(res.counties)), (16, 1, 3, 9))
        self.assertEqual(res.area_counties, ['Franklin', 'Yakima'])
        self.assertEqual(res.active_by_kind, [2, 1, 0], '2 flocks, 1 dairy herd')
        self.assertEqual([[c.case_id for c in s] for s in res.shared], [['Yakima 11', 'Yakima 12']])
        self.assertEqual(len(res.zones), 26)

    def test_the_circle_is_the_dashboards(self):
        d = dashboard(os.path.join(TABLES, 'em_rules_report.csv'), TODAY)
        ours = Z.circle(47.25, -121.5, 10)
        self.assertEqual(len(ours), len(d['circle']))
        self.assertLess(max(abs(a[0] - b[0]) + abs(a[1] - b[1]) for a, b in zip(ours, d['circle'])), 1e-9)

    def test_the_kinds_are_the_dashboards(self):
        d = dashboard(os.path.join(TABLES, 'em_rules_report.csv'), TODAY)
        self.assertEqual([(k['key'], k['words']) for k in d['kinds']], [(k, w) for k, _, w in Z.KINDS],
                         'zone_rules.KINDS is a copy of site/emergency/types/hpai.js kinds: change both together')
        self.assertEqual([d['caseWords'][k] for k, _, _ in Z.KINDS], [c for _, c, _ in Z.KINDS])
        self.assertEqual(dict((k['key'], k['weak']) for k in d['kinds'] if k['weak']),
                         dict((k, list(w)) for k, w in Z.WEAK_WORDS.items()), 'zone_rules.WEAK_WORDS is hpai.js "weak"')

    def test_each_species_is_the_dashboards(self):
        """Species as staff may type them, read by the tool and by the dashboard (rules.js kindOf): the same kinds."""
        species = SPECIES_TYPED
        out = subprocess.run(['node', os.path.join(HERE, 'dashboard_rules.js'), '--kinds', json.dumps(species)],
                             check=True, capture_output=True, text=True).stdout
        theirs = json.loads(out)
        ours = [[Z.KINDS[k][0] for k in Z.kinds_of(sp)] for sp in species]
        self.assertEqual(dict(zip(species, ours)), dict(zip(species, theirs)))

    @unittest.skipUnless(os.path.isfile(ARCADE), 'HPAI_ARCADE_FILE does not name the Arcade file (it is not in the release)')
    def test_the_public_dashboards_counting_rules_read_species_as_the_tool(self):
        """The Arcade's kindsOf (the public dashboard), run with stand-ins for its functions: the same kinds and the
        same word lists as the tool, the same placeholders; a case of two kinds mixed (its animals in neither total)."""
        species = SPECIES_TYPED + [None]
        out = json.loads(subprocess.run(['node', os.path.join(HERE, 'arcade_kinds.js'), ARCADE, json.dumps(species)],
                                        check=True, capture_output=True, text=True).stdout)
        ours = [[Z.KINDS[k][0] for k in Z.kinds_of(sp)] for sp in species]
        self.assertEqual(dict(zip(map(repr, species), ours)), dict(zip(map(repr, species), [r['kinds'] for r in out['read']])))
        self.assertEqual([r['mixed'] for r in out['read']], [len(k) > 1 for k in ours])
        words = dict((k, [w.replace('sea lion', 'sealion') for w in ws]) for k, _, ws in Z.KINDS)
        self.assertEqual(out['kinds'], words, 'the Arcade\'s KINDS is a copy of hpai.js and zone_rules.KINDS')
        self.assertEqual(out['blank'], list(Z.BLANK_SPECIES))
        self.assertEqual({'birds': out['weak']}, dict((k, list(w)) for k, w in Z.WEAK_WORDS.items()))
        with open(ARCADE, encoding='utf-8') as f:
            text = f.read()
        self.assertIn('if (animal.birds && !animal.mixed) { birdsAffected = inv; }', text)
        self.assertIn('if (animal.cattle && !animal.mixed) { cattleAffected = inv; }', text)
        self.assertIn('if (animal.birds && Includes(WA_COUNTIES, county) && !HasKey(seenBird, county))', text,
                      'new_bird_county counts the counties with a bird case')

    def test_the_quarantine_words_are_the_dashboards(self):
        path = os.path.join(TABLES, 'em_rules_new_format.csv')
        d = dashboard(path, TODAY)
        self.assertEqual(sorted(d['quarantineWords']), sorted(Z.QUARANTINE_WORDS),
                         'zone_rules.QUARANTINE_WORDS is a copy of site/emergency/types.js QUARANTINE_VALUES')
        listed = [c.line for c in read(path).bad.get('quarantine_status', [])]
        self.assertEqual(listed, [r['line'] for r in d['rows'] if r['quarantineStatus'] is None], 'the same rows not read')


class NeverRead(unittest.TestCase):
    def test_premises_address_and_city_never_come_out(self):
        t = table_of(('King 01', '10/1/2026', '', '', 'King', '47.5', '-122.0', 'Active', 'Backyard', 'Chicken', '20'),
                     ('King 02', '10/2/2026', '', '', 'King', '', '', 'Active', 'Backyard', 'Chicken', '20'))
        res = Z.build(t, TODAY, TODAY)
        said = '\n'.join(x for _, x in Z.check_lines(t, res, False) if x)
        everything = [said, Z.cases_csv(t, TODAY), repr([z['attributes'] for z in res.zones]), repr(Z.case_rows(t, TODAY)),
                      repr([c.values for c in t.cases])]
        for text in everything:
            self.assertNotIn('MARKED', text)
        self.assertEqual(t.never_read, ['Premises', 'Address', 'City'])
        self.assertIn('Never read: Premises, Address, City.', said)
        self.assertFalse(any(k in c.values for c in t.cases for k in ('premises', 'address', 'city')))

    def test_a_location_column_is_never_read(self):
        """A column with a location in its name ("Location County") is not the County column and is never kept."""
        raw = 'Case ID,Location County,Latitude,Longitude,Status\r\nA 01,MARKED,47.5,-122,Active\r\n'.encode()
        t = Z.read_table(raw)
        self.assertNotIn('county', t.columns)
        self.assertIsNone(t.cases[0].county)
        self.assertNotIn('MARKED', repr(t.cases[0].values))
        self.assertEqual(t.never_read, ['Location County'])


class Reading(unittest.TestCase):
    def test_dates(self):
        self.assertEqual(Z.date_of('10/4/2026'), date(2026, 10, 4))
        self.assertEqual(Z.date_of('2026-10-04'), date(2026, 10, 4))
        self.assertEqual(Z.date_of('10/15/2026 0:00'), date(2026, 10, 15))
        self.assertEqual(Z.date_of('2026-10-15 00:00:00'), date(2026, 10, 15))
        self.assertEqual(Z.date_of('2026-10-15T00:00'), date(2026, 10, 15))
        self.assertEqual(Z.date_of('2026/1/9'), date(2026, 1, 9))
        for bad in ('31/10/2026', 'Oct 2026', '10/45/2026', '2/30/2026', ''):
            self.assertIsNone(Z.date_of(bad), bad)

    def test_counties(self):
        self.assertEqual(Z.county_of('king county'), 'King')
        self.assertEqual(Z.county_of('  WALLA   walla '), 'Walla Walla')
        self.assertEqual(Z.county_of('Kings'), 'Kings')
        self.assertIsNone(Z.county_of(' '))

    def test_kinds(self):
        self.assertEqual(Z.kinds_of(''), [0])
        self.assertEqual(Z.kinds_of('Racing pigeon'), [0], 'pigeon is a bird, not a pig')
        self.assertEqual(Z.kinds_of('Cattle, Chicken'), [0, 1])
        self.assertEqual(Z.kinds_of('Bobcat'), [2], 'cat does not start a word of bobcat: unlisted, other animals')
        self.assertEqual(Z.kinds_of('Dairy cow'), [1])

    def test_a_species_no_word_names(self):
        self.assertEqual(Z.kinds_named('Chiken'), [], 'a typing slip names no kind')
        self.assertEqual(Z.kinds_of('Chiken'), [2], 'counted as other animals')
        self.assertEqual(Z.kinds_named('Multiple Poultry Species'), [0])
        self.assertEqual(Z.kinds_named(''), [], 'blank names no kind')
        self.assertEqual(Z.kinds_of('  '), [0], 'but counts as birds')

    def test_same_point_rounding_is_javascripts(self):
        """toFixed(5) rounds an exact half away from zero; Python's own format would round it to even."""
        self.assertEqual(Z.round5(46.015625), '46.01563')
        self.assertEqual(Z.round5(-120.015625), '-120.01563')
        self.assertEqual(Z.round5(47.0), '47.00000')

    def test_a_table_from_excel(self):
        """Excel's byte order mark, and a file saved in Windows' own encoding."""
        t = Z.read_table(('﻿' + HEAD + '\r\nA 01,,,10/1/2026,,,,,,King,WA,47.5,-122,Active,,,,Chicken,5,,,\r\n').encode('utf-8'))
        self.assertEqual(t.columns['case_id'], 'Case ID')
        self.assertEqual((t.cases[0].county, t.cases[0].lat), ('King', 47.5))
        t = Z.read_table((HEAD + '\r\nA 01,,,10/1/2026,,,Caf\xe9,,,King,WA,47.5,-122,Active,,,,Chicken,5,,,\r\n').encode('cp1252'))
        self.assertEqual(len(t.cases), 1)

    def test_files_saved_other_ways(self):
        """Line ends of an old Mac (CR alone) and Excel's "Unicode Text" (UTF-16) are read; a file in an encoding
        the tool does not know stops with how to save it, never a Python error."""
        cr = b'Case ID,Latitude,Longitude,Status\rA,47.5,-122,Active\rB,47.6,-122,Active\r'
        self.assertEqual(len(Z.read_table(cr).cases), 2)
        utf16 = 'Case ID,Latitude,Longitude,Status,County\r\nA,47.5,-122,Active,Kíng\r\n'.encode('utf-16')
        self.assertEqual(Z.read_table(utf16).cases[0].values['county'], 'Kíng')
        with self.assertRaises(Z.TableError) as e:
            Z.read_table(b'Case ID,Latitude,Longitude,Status,County\r\nA,47.5,-122,Active,\xc3\x81\xff\r\n')
        self.assertIn('CSV UTF-8 (Comma delimited)', str(e.exception))

    def test_tables_that_are_not_csv(self):
        """A tab-separated file (Excel's "Unicode Text") and a cell longer than the reader takes (a quote mark left
        open in a very long table) stop with how to save the file, never a Python error."""
        tabs = 'Case ID\tLatitude\tLongitude\tStatus\r\nA\t47.5\t-122\tActive\r\n'.encode('utf-16')
        with self.assertRaises(Z.TableError) as e:
            Z.read_table(tabs)
        self.assertIn('separated by tabs', str(e.exception))
        huge = ('Case ID,Latitude,Longitude,Status\r\nA,47.5,-122,"' + 'x' * 140000 + '\r\n').encode('utf-8')
        with self.assertRaises(Z.TableError) as e:
            Z.read_table(huge)
        self.assertIn('could not be read as a CSV file', str(e.exception))

    def test_a_stray_quote_in_a_column_never_read(self):
        """Premises is never read, but a quote left open there takes the next rows in: the row is still named."""
        raw = (HEAD + '\r\nA 01,10/1/2026,,10/1/2026,,,"Sample Farm,A,C,King,WA,47.51234,-122.31234,Active,H5N1,Backyard,X,'
               'Duck,5,5,1,L\r\nA 02,10/1/2026,,10/1/2026,,,P,A,C,King,WA,47.61234,-122.31234,Active,H5N1,Backyard,X,Duck,5,'
               '5,1,L\r\n')
        t = Z.read_table(raw.encode('utf-8'))
        self.assertEqual([c.case_id for c in t.bad['quotes']], ['A 01'])
        self.assertNotIn('Sample Farm', repr(t.cases[0].values), 'never kept')
        alt_enter = table_of(('A 03', '10/1/2026', '', '', 'King', '47.51234', '-122.31234', 'Active', 'Backyard',
                              'Chicken', '5'))
        self.assertNotIn('quotes', alt_enter.bad)

    def test_long_public_words_are_named(self):
        t = table_of(('W 01', '10/1/2026', '', '', 'King', '47.51234', '-122.31234', 'Active', 'Backyard',
                      'Chickens at the Sample place on 123 Example Street', '5'))
        self.assertEqual([c.case_id for c in t.bad['long_text']], ['W 01'])
        self.assertIn('A long Species, Status or Flock/Herd Type (public as written): row 2 (W 01).', Z.point_warnings(t))

    def test_a_stray_quote_is_named(self):
        """A quote mark left open takes the rows after it into one cell: the row is listed to fix."""
        raw = (HEAD + '\r\nA 01,10/1/2026,,10/1/2026,,,P,A,C,King,WA,47.51234,-122.31234,Active,H5N1,Backyard,X,"Duck,5,5,1,L'
               '\r\nA 02,10/1/2026,,10/1/2026,,,P,A,C,King,WA,47.61234,-122.31234,Active,H5N1,Backyard,X,Duck,5,5,1,L\r\n')
        t = Z.read_table(raw.encode('utf-8'))
        self.assertEqual([c.case_id for c in t.bad['quotes']], ['A 01'])
        self.assertIn('A cell holding several lines (a stray quote mark?): row 2 (A 01).', Z.point_warnings(t))

    def test_tables_the_tool_refuses(self):
        for raw, words in ((b'', 'empty'), ((HEAD + '\r\n').encode(), 'no rows'),
                           (b'Case ID,County,Status\r\nA,King,Active\r\n', 'no Latitude or Longitude'),
                           (b'Case ID,Latitude,Longitude\r\nA,47,-122\r\n', 'every case would be active')):
            with self.assertRaises(Z.TableError) as e:
                Z.read_table(raw)
            self.assertIn(words, str(e.exception))


class Coordinates(unittest.TestCase):
    def setUp(self):
        self.t = table_of(('A 01', '10/1/2026', '', '', 'King', '-122.1', '47.5', 'Active', 'Backyard', 'Chicken', '5'),
                          ('A 02', '10/1/2026', '', '', 'King', '47.2.1', '-122', 'Active', 'Backyard', 'Chicken', '5'),
                          ('A 03', '10/1/2026', '', '', 'King', '47.5', '', 'Active', 'Backyard', 'Chicken', '5'),
                          ('A 04', '10/1/2026', '', '', 'King', '', '', 'Active', 'Backyard', 'Chicken', '5'),
                          ('A 05', '10/1/2026', '', '', 'Kings', '40.1', '-122', 'Active', 'Backyard', 'Chicken', '5'),
                          ('A 06', '10/1/2026', '', '', 'King', '47.5', '-122.0', 'Active', 'Backyard', 'Chicken', '5'))
        self.res = Z.build(self.t, TODAY, TODAY)

    def test_each_problem_named(self):
        why = [c.point_problem for c in self.t.cases]
        self.assertEqual(why, ['latitude and longitude look swapped', 'coordinates not readable', 'no longitude',
                               'no coordinates', None, None])
        self.assertEqual([c.case_id for c in self.t.bad['point']], ['A 01', 'A 02', 'A 03'],
                         'missing both is no point, not a typo; one missing or unreadable is to fix')
        self.assertEqual([c.case_id for c in self.t.bad['outside']], ['A 05'], 'outside Washington: drawn, checked')

    def test_the_window_warns_before_the_run(self):
        """Every coordinate problem, each with why; no coordinates at all (A 04) is not one."""
        self.assertEqual(Z.point_warnings(self.t),
                         'No zones, latitude and longitude look swapped: row 2 (A 01). '
                         'No zones, coordinates not readable: row 3 (A 02). No zones, no longitude: row 4 (A 03). '
                         'Zones drawn, outside Washington: row 6 (A 05). Zones drawn, coordinates with fewer than 4 '
                         'decimals (Excel may have rounded them): row 6 (A 05), row 7 (A 06).')

    def test_blank_and_unknown_species_are_listed(self):
        t = table_of(('B 01', '10/1/2026', '', '', 'King', '47.51234', '-122.31234', 'Active', 'Backyard', '', '5'),
                     ('B 02', '10/1/2026', '', '', 'King', '47.61234', '-122.31234', 'Active', 'Backyard', 'Chiken', '5'),
                     ('B 03', '10/1/2026', '', '', 'King', '47.71234', '-122.31234', 'Active', 'Dairy', 'Cattle', '5'),
                     ('B 04', '10/1/2026', '', '', 'King', '47.81234', '-122.31234', 'Active', 'Backyard', 'Goat', '5'))
        self.assertEqual([c.case_id for c in t.bad['species_blank']], ['B 01'])
        self.assertEqual([c.case_id for c in t.bad['species_unknown']], ['B 02'], 'a word on the list (Goat) is not listed')
        self.assertEqual(Z.point_warnings(t), 'A Species the tool does not recognize (counted as other animals, not '
                         'birds): row 3 (B 02) "Chiken". Species blank or Unknown (counted as birds, on the public '
                         'map): row 2 (B 01).')
        res = Z.build(t, TODAY, TODAY)
        lines = [x for lv, x in Z.check_lines(t, res, True) if lv != 'steps']
        fix = [x for lv, x in Z.check_lines(t, res, True) if lv == 'warning']
        self.assertIn('  A Species the tool does not recognize (counted as other animals, so not on the public map; a '
                      'typing slip? README.txt, "Species"): row 3 (B 02) "Chiken".', fix)
        self.assertIn('  Species blank, or Unknown, N/A, TBD, - or ? (counted as birds, so on the public map; if this '
                      'case is not birds, fill in Species): row 2 (B 01).', fix)
        self.assertIn('      By animal (the Animal field): Birds 1 case, Cattle 1 case, Other animals 2 cases.', lines)
        self.assertIn('                                     by animal: Birds 1 area, Cattle 1 area, Other animals 2 areas'
                      '; on the public map: 1 set of zones', lines)

    def test_placeholders_count_as_blank(self):
        """Unknown, N/A, TBD, - and ? (any capitals, any marks) are a blank Species: birds, listed with the blanks
        (2.9.1); a word with more to it is not."""
        for typed in ('Unknown', 'UNKNOWN?', 'N/A', 'n.a.', 'NA', 'TBD', 't.b.d.', '-', '--', '?', ' ', '\u2014',
                      'Unknown species', 'Species unknown', 'Not known', 'Unk', 'UNK.'):
            self.assertTrue(Z.species_blank(typed), typed)
            self.assertEqual(Z.kinds_of(typed), [0], typed)
        for typed in ('Unknown bird', 'Unknown cattle', 'Nana', '0', 'None', 'Unknown goat species', 'Skunk'):
            self.assertFalse(Z.species_blank(typed), typed)
        self.assertEqual(Z.kinds_of('Unknown cattle'), [1])
        t = table_of(('U 01', '10/1/2026', '', '', 'King', '47.51234', '-122.31234', 'Active', 'Backyard', 'N/A', '5'),
                     ('U 02', '10/1/2026', '', '', 'King', '47.61234', '-122.31234', 'Active', 'Backyard', '?', '5'))
        self.assertEqual([c.case_id for c in t.bad['species_blank']], ['U 01', 'U 02'])
        self.assertNotIn('species_unknown', t.bad)
        self.assertIn('row 2 (U 01) "N/A", row 3 (U 02) "?"', Z.point_warnings(t), 'what was typed, shown')

    def test_a_species_naming_two_kinds_is_listed(self):
        """A farm's name in Species ("Sample Eagle Dairy") reads as birds and cattle: listed to check."""
        t = table_of(('M 01', '10/1/2026', '', '', 'King', '47.51234', '-122.31234', 'Active', 'Dairy', 'Sample Eagle Dairy', '5'),
                     ('M 02', '10/1/2026', '', '', 'King', '47.61234', '-122.31234', 'Active', 'Dairy', 'Hawkview Sample Holsteins', '5'),
                     ('M 03', '10/1/2026', '', '', 'King', '47.71234', '-122.31234', 'Active', 'Backyard', 'Chicken', '5'))
        self.assertEqual([c.case_id for c in t.bad['species_mixed']], ['M 01', 'M 02'])
        self.assertIn('A Species naming more than one kind (counted as each; a farm\'s name?): row 2 (M 01) "Sample Eagle '
                      'Dairy", row 3 (M 02) "Hawkview Sample Holsteins".', Z.point_warnings(t))
        fix = [x for lv, x in Z.check_lines(t, Z.build(t, TODAY, TODAY), True) if lv == 'warning']
        self.assertTrue(any(x.startswith('  A Species naming more than one kind of animal') for x in fix), fix)

    def test_the_by_animal_counts(self):
        """Zoned cases by animal count every case with a map point, active or closed; the areas only active ones with
        a point; a case of two kinds counts in both, and the line says so."""
        t = table_of(('K 01', '10/1/2026', '', '', 'King', '47.51234', '-122.31234', 'Active', 'Backyard', 'Chicken', '5'),
                     ('K 02', '1/1/2024', '2/1/2024', '', 'King', '47.61234', '-122.31234', 'Closed', 'Dairy', 'Cattle', '5'),
                     ('K 03', '10/1/2026', '', '', 'King', '', '', 'Active', 'Dairy', 'Cattle', '5'),
                     ('K 04', '10/1/2026', '', '', 'King', '47.71234', '-122.31234', 'Active', 'Dairy', '"Cattle, Goose"', '5'))
        res = Z.build(t, TODAY, TODAY)
        self.assertEqual(res.zoned_by_kind, [2, 2, 0], 'K 02 closed counts; K 03 without a point does not')
        self.assertEqual(res.areas_by_kind, [2, 1, 0], 'active with a point only')
        lines = [x for lv, x in Z.check_lines(t, res, True) if lv != 'steps']
        self.assertIn('      By animal (the Animal field; a case naming two kinds counts in both): Birds 2 cases, Cattle 2 '
                      'cases.', lines)
        self.assertEqual(Z.by_kind([0, 0, 0], 'case', 'cases'), 'none')
        closed = table_of(('K 05', '1/1/2024', '2/1/2024', '', 'King', '47.5', '-122.3', 'Closed', 'Backyard', 'Duck', '5'))
        lines = [x for lv, x in Z.check_lines(closed, Z.build(closed, TODAY, TODAY), True) if lv != 'steps']
        self.assertFalse([x for x in lines if 'by animal:' in x], 'no active area: no by-animal areas line')

    def test_spaces_of_any_kind_between_words(self):
        """A tab, a no-break space or several spaces inside "sea lion" still name it (rules.js folds them too)."""
        for typed in ('Sea lion', 'sea\tlion', 'sea\u00a0lion', 'sea   lion'):
            self.assertEqual(Z.kinds_named(typed), [2], repr(typed))
        self.assertEqual(Z.kinds_named('sealion'), [2], 'seal starts it')
        self.assertEqual(Z.kinds_named('Cattle\tChicken'), [0, 1])

    def test_the_new_words(self):
        """Words added in 2.9.1: bird and cattle words a flock or herd may be
        written as; a longer word of another kind still wins (a cowbird is a bird, not a cow)."""
        for typed in ('Chicks', 'Rooster', 'Pullets', 'Bantam', 'Peacock', 'Peahen', 'Guineafowl', 'Mallard',
                      'Muscovy duck', 'Squab', 'Ratite', 'Bobwhite', 'Backyard flock', 'Seagull', 'Blackbird',
                      'Waterbird', 'Goshawk', 'Cowbird', 'Catbird', 'Goslings', 'Ducklings', 'Turkey poults'):
            self.assertEqual(Z.kinds_named(typed), [0], typed)
        for typed in ('Holstein', 'Angus', 'Hereford'):
            self.assertEqual(Z.kinds_named(typed), [1], typed)

    def test_flock_names_birds_only_when_nothing_else_does(self):
        """"Flock" is a weak word: a sheep or goat flock is other animals only (off the public map), a flock with no
        other animal named is birds, and a flock naming birds and another kind is both."""
        for typed in ('Sheep flock', 'Goat flock', 'Flock of sheep', 'Goats (flock)'):
            self.assertEqual(Z.kinds_named(typed), [2], typed)
            self.assertFalse(any(Z.is_public_kind(k) for k in Z.kinds_of(typed)), typed)
        for typed in ('Backyard flock', 'Flock', 'Flocks', 'Mixed backyard flock'):
            self.assertEqual(Z.kinds_named(typed), [0], typed)
        self.assertEqual(Z.kinds_named('Chicken flock and sheep'), [0, 2])
        self.assertEqual(Z.kinds_named('Dairy flock'), [1])

    def test_a_table_without_species_lists_no_blanks(self):
        lines = [HEAD.replace(',Species,', ',Kind,'),
                 'C 01,10/1/2026,,10/1/2026,,Under quarantine,P,A,C,King,WA,47.51234,-122.31234,Active,H5N1,Backyard,X,'
                 ',5,5,1,Landfill']
        t = Z.read_table(('\r\n'.join(lines) + '\r\n').encode('utf-8'))
        self.assertNotIn('species_blank', t.bad, 'a missing column is said once as "Not found", not row by row')
        self.assertNotIn('species_unknown', t.bad)
        self.assertEqual(t.cases[0].kinds, [0])
        self.assertEqual(Z.blockers(t), [Z.NO_SPECIES], 'every case would be birds: a real run stops')
        self.assertTrue(Z.point_warnings(t).startswith(Z.NO_SPECIES + ' A real run stops until it is fixed.'))
        said = [x for lv, x in Z.check_lines(t, Z.build(t, TODAY, TODAY), True) if lv == 'warning']
        self.assertTrue(any(x.startswith('      Not found: Species. Every case would count as birds') for x in said), said)

    def test_typing_slips_get_no_zones(self):
        """A minus sign missing or extra (the point falls in Washington with it fixed) and 0, 0 are slips, not places:
        no zones, named with why. A real point in Oregon is still drawn."""
        t = table_of(('S 01', '10/1/2026', '', '', 'King', '47.51234', '122.31234', 'Active', 'Backyard', 'Chicken', '5'),
                     ('S 02', '10/1/2026', '', '', 'King', '-47.51234', '-122.31234', 'Active', 'Backyard', 'Chicken', '5'),
                     ('S 03', '10/1/2026', '', '', 'King', '0', '0', 'Active', 'Backyard', 'Chicken', '5'),
                     ('S 04', '10/1/2026', '', '', 'Umatilla', '45.67123', '-118.78812', 'Active', 'Backyard', 'Chicken', '5'))
        self.assertEqual([c.point_problem for c in t.cases], [Z.SIGN_SLIP, Z.SIGN_SLIP, Z.ZERO_POINT, None])
        res = Z.build(t, TODAY, TODAY)
        self.assertEqual(sorted(set(z['case'].case_id for z in res.zones)), ['S 04'])
        fix = [x for lv, x in Z.check_lines(t, res, False) if lv == 'warning']
        self.assertIn('  Coordinates: a minus sign missing or extra (122.3 for -122.3?), no zones until fixed: '
                      'row 2 (S 01), row 3 (S 02).', fix)
        self.assertIn('  Coordinates: a coordinate of 0 (a blank filled with zero?), no zones until fixed: row 4 (S 03).', fix)
        self.assertIn('No zones, a coordinate of 0 (a blank filled with zero?): row 4 (S 03).', Z.point_warnings(t))
        one = table_of(('Z 01', '10/1/2026', '', '', 'King', '0', '-122.31234', 'Active', 'Backyard', 'Chicken', '5'),
                       ('Z 02', '10/1/2026', '', '', 'King', '47.51234', '0', 'Active', 'Backyard', 'Chicken', '5'),
                       ('Z 03', '10/1/2026', '', '', 'King', '4.751234e1', '-122.31234', 'Active', 'Backyard', 'Chicken', '5'))
        self.assertEqual([c.point_problem for c in one.cases], [Z.ZERO_POINT, Z.ZERO_POINT, None], 'one zero is a slip too')
        self.assertNotIn('decimals', Z.point_warnings(one), 'a number written with an exponent is not counted short')
        self.assertNotIn('decimals', Z.point_warnings(t), '5 decimals are enough')

    def test_no_zones_without_a_usable_point(self):
        self.assertEqual(sorted(set(z['case'].case_id for z in self.res.zones)), ['A 05', 'A 06'])

    def test_the_check_lists_them_to_fix(self):
        said = [(lv, x) for lv, x in Z.check_lines(self.t, self.res, False) if lv != 'steps']
        fix = [x for lv, x in said if lv == 'warning']
        self.assertTrue(fix[0].startswith('TO FIX IN THE TABLE'))
        self.assertIn('  Coordinates: latitude and longitude look swapped, no zones until fixed: row 2 (A 01).', fix)
        self.assertIn('  Coordinates outside Washington (zones drawn; check them): row 6 (A 05).', fix)
        self.assertTrue(any('not one of Washington\'s 39' in x and 'row 6 (A 05)' in x for x in fix))


class Zones(unittest.TestCase):
    def test_two_zones_per_case_and_the_notices(self):
        t = table_of(('A 01', '10/1/2026', '', '', 'King', '47.5', '-122', 'Active', 'Backyard', 'Chicken', '5'),
                     ('A 02', '1/1/2025', '3/1/2025', '3/15/2025', 'King', '47.6', '-122', 'Closed', 'Backyard', 'Duck', '5'))
        res = Z.build(t, TODAY, TODAY, '  Extra words  ')
        a = [z['attributes'] for z in res.zones]
        self.assertEqual([(x['Zone_Type'], x['Closed_Site'], x['Online_Live']) for x in a],
                         [('Infection Zone', 'No', 'Yes'), ('Control Zone', 'No', 'Yes'),
                          ('Infection Zone', 'Yes', 'Yes'), ('Control Zone', 'Yes', 'Yes')])
        self.assertEqual(len(a[0]['Statement1']), 302)
        self.assertTrue(a[0]['Statement1'].endswith('or call 1-866-414-0552 to speak to one of our veterinarians.'))
        self.assertEqual(a[2]['Statement1'], 'This site is closed and is no longer under surveillance')
        self.assertIsNone(a[2]['Statement2'])
        self.assertEqual(a[0]['StmtOther'], 'Extra words')
        self.assertEqual(sorted(a[0]), sorted(n for n, _, _ in Z.ZONE_FIELDS), 'every zone field, no other')

    def test_the_shapes(self):
        t = table_of(('A 01', '10/1/2026', '', '', 'King', '47.5', '-122', 'Active', 'Backyard', 'Chicken', '5'))
        inf, ctl = Z.build(t, TODAY, TODAY).zones

        def signed_area(ring):   # negative: clockwise (x is longitude, y latitude)
            return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:])) / 2

        def km_from_center(ring):
            return [Z.EARTH_RADIUS_M / 1000 * 2 * math.asin(math.sqrt(
                math.sin(math.radians(p[1] - 47.5) / 2) ** 2 + math.cos(math.radians(47.5)) * math.cos(math.radians(p[1]))
                * math.sin(math.radians(p[0] + 122) / 2) ** 2)) for p in ring]

        self.assertEqual(len(inf['rings']), 1)
        self.assertEqual(len(ctl['rings']), 2)
        self.assertEqual(len(inf['rings'][0]), 361)
        self.assertEqual(inf['rings'][0][0], inf['rings'][0][-1], 'closed exactly')
        self.assertLess(signed_area(inf['rings'][0]), 0, 'the outer ring clockwise')
        self.assertGreater(signed_area(ctl['rings'][1]), 0, 'the hole counterclockwise')
        for ring, km in ((inf['rings'][0], 3), (ctl['rings'][0], 10), (ctl['rings'][1], 3)):
            self.assertLess(max(abs(d - km) for d in km_from_center(ring)), 1e-6)

    def test_one_public_set_per_map_point(self):
        """Every case's zones written; the public sees the latest active case's, or with
        none active the latest closed case's."""
        P = ('47.5', '-122')
        t = table_of(
            ('Old', '1/12/2023', '2/26/2023', '3/1/2023', 'King') + P + ('Closed', 'Backyard', 'Chicken', '5'),
            ('Older', '1/12/2022', '2/26/2022', '3/1/2022', 'King') + P + ('Closed', 'Backyard', 'Chicken', '5'),
            ('New', '11/5/2026', '', '', 'King') + P + ('Active', 'Backyard', 'Chicken', '5'),
            ('Two1', '10/18/2026', '', '', 'King', '47.6', '-122') + ('Active', 'Commercial', 'Turkey', '82000'),
            ('Two2', '10/24/2026', '', '', 'King', '47.6', '-122') + ('Active', 'Commercial', 'Turkey', '61000'),
            ('Shut1', '1/1/2024', '2/1/2024', '2/15/2024', 'King', '47.7', '-122') + ('Closed', 'Backyard', 'Duck', '5'),
            ('Shut2', '1/1/2025', '2/1/2025', '2/15/2025', 'King', '47.7', '-122') + ('Closed', 'Backyard', 'Duck', '5'),
            ('Near', '10/25/2026', '', '', 'King', '47.7036', '-122') + ('Active', 'Backyard', 'Duck', '5'))
        res = Z.build(t, date(2026, 11, 12), date(2026, 11, 12))
        live = sorted(set((z['case'].case_id, z['attributes']['Online_Live']) for z in res.zones))
        self.assertEqual(live, [('Near', 'Yes'), ('New', 'Yes'), ('Old', 'No'), ('Older', 'No'), ('Shut1', 'No'),
                                ('Shut2', 'Yes'), ('Two1', 'No'), ('Two2', 'Yes')])
        self.assertEqual(len(res.zones), 16, 'every case\'s two zones written')
        self.assertEqual(len(res.shared), 3, '400 m away is not the same point')

    def test_the_animal_field(self):
        """Every zone says its case's kinds of animal, from Species by the shared word list (2.9.1)."""
        species = ['Poultry', 'Goose', 'Multiple Poultry Species', '', 'Cattle', '"Cattle, Chicken"', 'Goat', 'Chiken']
        t = table_of(*[('S%d' % i, '10/1/2026', '', '', 'King', '47.%d' % (i + 1), '-122', 'Active', 'Backyard', sp, '5')
                       for i, sp in enumerate(species)])
        res = Z.build(t, TODAY, TODAY)
        animal = [z['attributes']['Animal'] for z in res.zones if z['attributes']['Zone_Type'] == Z.ZONE_INFECTION]
        self.assertEqual(animal, ['Birds', 'Birds', 'Birds', 'Birds', 'Cattle', 'Birds, Cattle', 'Other animals',
                                  'Other animals'])
        self.assertEqual(len(', '.join(Z.ANIMAL_NAMES)), 28, 'the longest Animal fits its 100 characters')
        self.assertEqual(dict((n, ln) for n, _, ln in Z.ZONE_FIELDS)['Animal'], 100)

    def test_the_public_sees_birds_only(self):
        """PUBLIC_ANIMALS (birds): at each map point one set, among the point's cases of birds (the latest active
        one's, else the latest closed one's); a point with no bird case shows nothing; every case's zones written."""
        P, Q = ('47.5', '-122'), ('47.6', '-122')
        t = table_of(
            ('Flock', '9/1/2026', '', '', 'King') + P + ('Active', 'Backyard', 'Chicken', '5'),
            ('Herd', '10/1/2026', '', '', 'King') + P + ('Active', 'Dairy', 'Cattle', '500'),
            ('OldFlock', '1/12/2023', '2/26/2023', '3/1/2023', 'King') + Q + ('Closed', 'Backyard', 'Duck', '5'),
            ('NewHerd', '10/5/2026', '', '', 'King') + Q + ('Active', 'Dairy', 'Cattle', '500'),
            ('Herd2', '10/5/2026', '', '', 'King', '47.8', '-122') + ('Active', 'Dairy', 'Cattle', '500'))
        res = Z.build(t, TODAY, TODAY)
        live = sorted(set((z['case'].case_id, z['attributes']['Online_Live']) for z in res.zones))
        self.assertEqual(live, [('Flock', 'Yes'), ('Herd', 'No'), ('Herd2', 'No'), ('NewHerd', 'No'),
                                ('OldFlock', 'Yes')],
                         'the flock at a herd\'s point shown; a closed flock beside an active herd shows closed; a '
                         'herd alone shows nothing')
        self.assertEqual(len(res.zones), 10, 'every case\'s zones written, for staff')
        self.assertEqual(res.public_points, 2)

    def test_one_bird_set_at_a_point_whatever_the_order(self):
        """Three orderings that could give a point two sets of zones: a case of two kinds and a later bird case; a closed
        one of two kinds under an active bird case; goats, then goats and ducks, then ducks. One set each."""
        A, B, C = ('47.5', '-122'), ('47.6', '-122'), ('47.7', '-122')
        t = table_of(
            ('Mixed1', '9/1/2026', '', '', 'King') + A + ('Active', 'Dairy', '"Cattle, Chicken"', '5'),
            ('Bird1', '10/1/2026', '', '', 'King') + A + ('Active', 'Backyard', 'Chicken', '5'),
            ('Mixed2', '1/1/2024', '2/1/2024', '', 'King') + B + ('Closed', 'Dairy', '"Cattle, Chicken"', '5'),
            ('Bird2', '10/1/2026', '', '', 'King') + B + ('Active', 'Backyard', 'Chicken', '5'),
            ('Goat', '8/1/2026', '', '', 'King') + C + ('Active', 'Backyard', 'Goat', '5'),
            ('GoatDuck', '9/1/2026', '', '', 'King') + C + ('Active', 'Backyard', '"Goat, Duck"', '5'),
            ('Duck', '10/1/2026', '', '', 'King') + C + ('Active', 'Backyard', 'Duck', '5'))
        res = Z.build(t, TODAY, TODAY)
        live = sorted(set(z['case'].case_id for z in res.zones if z['attributes']['Online_Live'] == 'Yes'))
        self.assertEqual(live, ['Bird1', 'Bird2', 'Duck'])
        per_point = {}
        for z in res.zones:
            if z['attributes']['Online_Live'] == 'Yes':
                per_point.setdefault(z['case'].key(), []).append(z['attributes']['Zone_Type'])
        self.assertEqual(sorted(len(v) for v in per_point.values()), [2, 2, 2], 'one infection zone and one ring each')
        later_mixed = table_of(('Bird', '9/1/2026', '', '', 'King') + A + ('Active', 'Backyard', 'Chicken', '5'),
                               ('Mixed', '10/1/2026', '', '', 'King') + A + ('Active', 'Dairy', '"Cattle, Chicken"', '5'))
        res = Z.build(later_mixed, TODAY, TODAY)
        self.assertEqual(sorted(set(z['case'].case_id for z in res.zones if z['attributes']['Online_Live'] == 'Yes')),
                         ['Mixed'], 'a later case of birds and cattle is a bird case: it is the one shown')

    def test_an_active_case_is_shown_over_a_later_closed_one(self):
        """At a point, an active case is shown even when a closed one there was detected later (probe 3)."""
        P = ('47.5', '-122')
        t = table_of(('Open', '9/1/2026', '', '', 'King') + P + ('Active', 'Backyard', 'Chicken', '5'),
                     ('Shut', '10/1/2026', '10/10/2026', '', 'King') + P + ('Closed', 'Backyard', 'Chicken', '5'))
        res = Z.build(t, TODAY, TODAY)
        self.assertEqual(sorted(set(z['case'].case_id for z in res.zones if z['attributes']['Online_Live'] == 'Yes')),
                         ['Open'])

    def test_the_cases_table_holds_birds_only(self):
        """The cases table and hpai-cases-public.csv hold the rows of an animal the public sees; a case of birds and
        cattle is one; the check says how many were left out, and which."""
        t = table_of(('C 01', '10/1/2026', '', '', 'King', '47.51234', '-122.31234', 'Active', 'Backyard', 'Chicken', '5'),
                     ('C 02', '10/1/2026', '', '', 'Grant', '47.61234', '-122.31234', 'Active', 'Dairy', 'Cattle', '500'),
                     ('C 03', '10/1/2026', '', '', 'King', '', '', 'Active', 'Backyard', 'Goat', '3'),
                     ('C 04', '10/1/2026', '', '', 'King', '47.71234', '-122.31234', 'Active', 'Dairy', '"Cattle, Duck"', '9'))
        self.assertEqual([r[-1] for r in Z.case_rows(t, TODAY)], ['Chicken', 'Cattle, Duck'])
        text = Z.cases_csv(t, TODAY)
        self.assertNotIn('Grant', text)
        self.assertNotIn('Goat', text)
        res = Z.build(t, TODAY, TODAY)
        said = [x for lv, x in Z.check_lines(t, res, True) if lv != 'steps']
        self.assertIn('      The public sees birds only (README.txt, "Birds only"): 2 map points shown. 2 cases of '
                      'other kinds (Cattle 1 case, Other animals 1 case): zones written but not shown, and left out of '
                      'the cases table: row 3 (C 02), row 4 (C 03).', said)
        self.assertIn('  Cases ............................ 4   (the public dashboard\'s, birds: 2)', said)
        self.assertIn('  Counties affected ................ 2   (Washington\'s; the public dashboard\'s, birds: 1)', said)

    def test_lifting_birds_only(self):
        """With every kind in PUBLIC_ANIMALS, every point shows its latest case and every row is in the cases table;
        the check has no birds-only lines."""
        saved = Z.PUBLIC_ANIMALS
        try:
            Z.PUBLIC_ANIMALS = tuple(k for k, _, _ in Z.KINDS)
            t = table_of(('H 01', '10/1/2026', '', '', 'King', '47.5', '-122', 'Active', 'Dairy', 'Cattle', '5'),
                         ('H 02', '10/1/2026', '', '', 'King', '', '', 'Active', 'Backyard', 'Goat', '5'))
            res = Z.build(t, TODAY, TODAY)
            self.assertEqual(set(z['attributes']['Online_Live'] for z in res.zones), {'Yes'})
            self.assertEqual(len(Z.case_rows(t, TODAY)), 2)
            said = [x for lv, x in Z.check_lines(t, res, True) if lv != 'steps']
            self.assertFalse([x for x in said if 'The public sees' in x and 'only' in x])
            self.assertIn('  Cases ............................ 2', said)
        finally:
            Z.PUBLIC_ANIMALS = saved

    def test_a_setting_the_tool_cannot_use_stops_a_real_run(self):
        """A typing slip in PUBLIC_ANIMALS ('bird', 'Birds'), a word alone, or none at all would empty the public
        map: a real run stops, the window and the check say so."""
        t = table_of(('S 01', '10/1/2026', '', '', 'King', '47.5', '-122', 'Active', 'Backyard', 'Chicken', '5'))
        saved = Z.PUBLIC_ANIMALS
        try:
            for bad in (('bird',), ('Birds',), (), 'birds', None):
                Z.PUBLIC_ANIMALS = bad
                problem = Z.public_setting_problem()
                self.assertTrue(problem and problem.startswith('The tool\'s setting PUBLIC_ANIMALS'), repr(bad))
                self.assertIn(problem, Z.blockers(t))
                self.assertIn(problem, Z.point_warnings(t))
                said = [x for lv, x in Z.check_lines(t, Z.build(t, TODAY, TODAY), True) if lv == 'warning']
                self.assertIn('      ' + problem, said)
            for good in (('birds',), ('birds', 'cattle'), ['cattle']):
                Z.PUBLIC_ANIMALS = good
                self.assertIsNone(Z.public_setting_problem(), repr(good))
        finally:
            Z.PUBLIC_ANIMALS = saved

    def test_a_species_column_blank_in_every_row_stops_a_real_run(self):
        """The column there but empty (or only placeholders) puts every case on the public map as birds, as a
        missing column would: a real run stops; one row filled in is enough."""
        t = table_of(('E 01', '10/1/2026', '', '', 'King', '47.5', '-122', 'Active', 'Backyard', '', '5'),
                     ('E 02', '10/1/2026', '', '', 'King', '47.6', '-122', 'Active', 'Backyard', 'N/A', '5'))
        self.assertEqual(Z.blockers(t), [Z.EMPTY_SPECIES])
        self.assertTrue(Z.point_warnings(t).startswith(Z.EMPTY_SPECIES + ' A real run stops until it is fixed.'))
        t = table_of(('E 01', '10/1/2026', '', '', 'King', '47.5', '-122', 'Active', 'Backyard', '', '5'),
                     ('E 02', '10/1/2026', '', '', 'King', '47.6', '-122', 'Active', 'Backyard', 'Chicken', '5'))
        self.assertEqual(Z.blockers(t), [])

    def test_a_blank_species_on_a_dairy_stops_a_real_run(self):
        """Species blank (or a placeholder) where Flock/Herd Type or Production Type names another animal and no bird
        (2.9.1; it would go on the public map as birds): a real run stops, the row named with the type as typed.
        A blank Species on a flock, or a type naming birds too, is only listed as before."""
        def row(cid, ftype, production, species):
            r = ['2026-10-01', '', '2026-10-01', '', 'Under quarantine', 'P', 'A', 'C', 'King', 'WA', '47.51234',
                 '-122.31234', 'Active', 'H5N1', ftype, production, species, '5', '5', '1', 'Landfill']
            return cid + ',' + ','.join(r)
        lines = [HEAD, row('D 01', 'Commercial', 'Commercial Dairy', ''), row('D 02', 'Dairy', '', 'N/A'),
                 row('D 03', 'Backyard', 'WOAH Non-Poultry', ''), row('D 04', 'Commercial', 'Commercial Dairy', 'Cattle'),
                 row('D 05', 'Commercial', 'Dairy and Poultry', '')]
        t = Z.read_table(('\r\n'.join(lines) + '\r\n').encode('utf-8'))
        self.assertEqual([c.case_id for c in t.bad['species_blank_other']], ['D 01', 'D 02'])
        self.assertEqual([c.case_id for c in t.bad['species_blank']], ['D 03', 'D 05'], 'a flock, a type naming birds too')
        self.assertEqual(Z.blockers(t), ['Species blank where the type names another animal: row 2 (D 01) "Commercial '
                                         'Dairy", row 3 (D 02) "Dairy". Fill in Species.'])
        self.assertIn('a real run stops until Species is filled in', Z.point_warnings(t))
        fix = [x for lv, x in Z.check_lines(t, Z.build(t, TODAY, TODAY), True) if lv == 'warning']
        self.assertIn('  ' + Z.SPECIES_BLANK_OTHER + ': row 2 (D 01) "Commercial Dairy", row 3 (D 02) "Dairy".', fix)
        self.assertNotIn('Commercial Dairy', Z.cases_csv(t, TODAY), 'Production Type is never written')
        raw = 'Case ID,Latitude,Longitude,Status,Species\r\nX,47.5,-122,Active,Chicken\r\n'.encode()
        t = Z.read_table(raw)
        said = [x for lv, x in Z.check_lines(t, Z.build(t, TODAY, TODAY), True) if lv != 'steps']
        self.assertFalse([x for x in said if 'Production' in x], 'a table without Production Type is not told so')

    def test_a_digit_in_species_or_type_stops_a_real_run(self):
        """An address or a phone number in Species or Flock/Herd Type would go public as written: a real run
        stops, the row named with what was typed. Status may hold a 1 (closed)."""
        t = table_of(('N 01', '10/1/2026', '', '', 'King', '47.5', '-122', 'Active', 'Backyard', 'Chicken - 1234 Oak Rd', '5'),
                     ('N 02', '10/1/2026', '', '', 'King', '47.6', '-122', 'Active', 'Backyard 360-555-0100', 'Duck', '5'),
                     ('N 03', '10/1/2026', '2/1/2026', '', 'King', '47.7', '-122', '1', 'Backyard', 'Duck', '5'))
        self.assertEqual([c.case_id for c in t.bad['digits']], ['N 01', 'N 02'])
        self.assertEqual(Z.blockers(t), ['A digit in Species or Flock/Herd Type: row 2 (N 01) "Chicken - 1234 Oak Rd", '
                                         'row 3 (N 02) "Backyard 360-555-0100". Take it out.'])
        fix = [x for lv, x in Z.check_lines(t, Z.build(t, TODAY, TODAY), True) if lv == 'warning']
        self.assertTrue(any(x.startswith('  ' + Z.DIGITS) for x in fix), fix)

    def test_a_word_that_is_not_an_animal_is_listed(self):
        """A farm's name or a place in Species (listed, not a stop); animal words with a plural ending and
        the fillers are not; today's real values none."""
        for typed in ('Poultry', 'Goose', 'Chicken', 'Duck', 'Multiple Poultry Species', 'Cattle', 'Chickens',
                      'Turkeys', 'Geese', 'Calves', 'Mixed backyard flock', 'Dairy cattle', 'Meat Goat', 'Wild Mallard Duck',
                      'Racing pigeons', 'Sea lions', 'Holstein heifers', 'Cattle, Chicken', 'Live bird market',
                      'Guinea fowl', 'Pea fowl', 'Water fowl', 'Ducklings', 'Goslings', 'Turkey poults'):
            self.assertEqual(Z.odd_species_words(typed), [], typed)
        self.assertEqual(Z.odd_species_words('Swanson Farms'), ['swanson', 'farms'])
        self.assertEqual(Z.odd_species_words('Crowley Ranch hens'), ['crowley', 'ranch'])
        self.assertEqual(Z.odd_species_words('No birds'), ['no'])
        t = table_of(('W 01', '10/1/2026', '', '', 'King', '47.5', '-122', 'Active', 'Backyard', 'Swanson Farms', '5'),
                     ('W 02', '10/1/2026', '', '', 'King', '47.6', '-122', 'Active', 'Backyard', 'Chickens', '5'),
                     ('W 03', '10/1/2026', '', '', 'King', '47.7', '-122', 'Active', 'Backyard', 'Chiken', '5'))
        self.assertEqual([c.case_id for c in t.bad['species_words']], ['W 01'], 'an unrecognized one is listed apart')
        self.assertEqual(Z.blockers(t), [], 'listed, not a stop')
        self.assertIn('A Species with a word that is not an animal (public as written): row 2 (W 01) "Swanson Farms".',
                      Z.point_warnings(t))

    def test_a_dated_case_is_later_than_an_undated_one_and_a_tie_goes_by_row(self):
        """At a point, a case with no readable detection date is the earliest; two on the same date, the later row
        is the later case."""
        P, Q = ('47.5', '-122'), ('47.6', '-122')
        t = table_of(('Dated', '9/1/2026', '', '', 'King') + P + ('Active', 'Backyard', 'Chicken', '5'),
                     ('Undated', '', '', '', 'King') + P + ('Active', 'Backyard', 'Chicken', '5'),
                     ('First', '9/1/2026', '', '', 'King') + Q + ('Active', 'Backyard', 'Chicken', '5'),
                     ('Second', '9/1/2026', '', '', 'King') + Q + ('Active', 'Backyard', 'Chicken', '5'))
        res = Z.build(t, TODAY, TODAY)
        self.assertEqual(sorted(set(z['case'].case_id for z in res.zones if z['attributes']['Online_Live'] == 'Yes')),
                         ['Dated', 'Second'])
        self.assertEqual(res.public_open_sets, 2, 'one set of zones at each point, though four cases are active')

    def test_a_case_detected_after_the_date_gets_no_zones(self):
        t = table_of(('A 01', '9/15/2026', '', '', 'King', '47.5', '-122', 'Active', 'Backyard', 'Chicken', '5'),
                     ('A 02', '9/1/2026', '', '', 'King', '47.6', '-122', 'Active', 'Backyard', 'Chicken', '5'))
        res = Z.build(t, date(2026, 9, 1), TODAY)
        self.assertEqual([c.case_id for c in res.rows], ['A 02'], 'detected on the date: counted')
        self.assertEqual((len(res.later), len(res.zones)), (1, 2))
        self.assertEqual(len(Z.case_rows(t, TODAY)), 2, 'both still in the cases table (the dashboard counts by date)')

    def test_a_case_detected_after_today_stays_out_of_the_cases_table(self):
        """A date typed wrongly (after today) is listed to fix and left out of the cases table and its file."""
        t = table_of(('A 01', '1/15/2027', '', '', 'King', '47.5', '-122', 'Active', 'Backyard', 'Chicken', '5'),
                     ('A 02', '9/1/2026', '', '', 'King', '47.6', '-122', 'Active', 'Backyard', 'Chicken', '5'))
        res = Z.build(t, TODAY, TODAY)
        self.assertEqual([c.case_id for c in res.after_today], ['A 01'])
        self.assertEqual(len(Z.case_rows(t, TODAY)), 1, 'only the case detected by today')
        self.assertEqual(Z.cases_csv(t, TODAY).count('\r\n'), 2, 'the header and one row')

    def test_a_cell_that_would_be_a_formula_is_written_as_words(self):
        """A table cell starting with =, +, - or @ gets a single quote in the cases file."""
        t = table_of(('A 02', '9/1/2026', '', '', 'King', '47.6', '-122', '=1+1', 'Backyard', '@Chicken', '5'))
        text = Z.cases_csv(t, TODAY)
        self.assertIn("'=1+1", text)
        self.assertIn("'@Chicken", text)
        self.assertEqual([Z.safe_cell(v) for v in ('+5', '-3', 'Chicken', '', '-', '+')],
                         ["'+5", "'-3", 'Chicken', '', '-', '+'], 'a lone dash is a blank, written as it is')


class ActiveOrClosed(unittest.TestCase):
    def case(self, close='', release='', status='Closed'):
        return table_of(('A 01', '1/1/2026', close, release, 'King', '47.5', '-122', status, 'Backyard', 'Chicken', '5')).cases[0]

    def test_the_three_rules(self):
        c = self.case(close='3/1/2026')
        self.assertFalse(Z.is_closed(c, date(2026, 2, 28), TODAY))
        self.assertTrue(Z.is_closed(c, date(2026, 3, 1), TODAY), 'closed on its Close Date')
        c = self.case(release='4/1/2026')
        self.assertFalse(Z.is_closed(c, date(2026, 3, 31), TODAY))
        self.assertTrue(Z.is_closed(c, date(2026, 4, 1), TODAY), 'no Close Date: the release date')
        c = self.case(release='12/1/2026')
        self.assertTrue(Z.is_closed(c, date(2026, 2, 1), TODAY), 'a release after today is not the day closed')
        c = self.case()
        self.assertTrue(Z.is_closed(c, date(2026, 1, 2), TODAY), 'closed by Status alone, on any date')
        c = self.case(status='Active', release='4/1/2026')
        self.assertFalse(Z.is_closed(c, TODAY, TODAY), 'a release date without Status closed does not close')


class TheLayers(unittest.TestCase):
    STARTER = [(n, 'String', ln) for n, _, ln in Z.ZONE_FIELDS]

    def test_the_new_layer_is_accepted(self):
        self.assertEqual(Z.check_zone_fields([('OBJECTID', 'OID', 4), ('Shape', 'Geometry', 0),
                                              ('Shape__Area', 'Double', 8)] + self.STARTER), [])

    def test_a_zones_layer_from_before_2_9_1(self):
        old = [f for f in self.STARTER if f[0] != 'Animal']
        said = Z.check_zone_fields(old)
        self.assertEqual(len(said), 1)
        self.assertTrue(said[0].startswith('The zones layer has no Animal field. A zones layer made before 2.9.1'), said)
        short = [f if f[0] != 'Animal' else ('Animal', 'String', 20) for f in self.STARTER]
        self.assertEqual(Z.check_zone_fields(short), ['The zones layer\'s Animal field holds 20 characters; it needs 28 '
                                                      '("Birds, Cattle, Other animals"): make it a String field of 100 '
                                                      'characters.'])
        self.assertIn('add it to WSDA HPAI Zones (source) as a String field of 100 characters', said[0])
        number = [f if f[0] != 'Animal' else ('Animal', 'Integer', 4) for f in self.STARTER]
        self.assertIn('The zones layer\'s Animal field is not a text field.', Z.check_zone_fields(number))

    def test_todays_layer_is_refused(self):
        todays = [('OBJECTID', 'OID', 4), ('County', 'String', 255), ('Latitude', 'Double', 8),
                  ('Longitude', 'Double', 8), ('PremiseLoc', 'String', 255), ('Zone_Type', 'String', 255),
                  ('Online_Live', 'String', 255), ('Closed_Site', 'String', 255), ('Statement1', 'String', 999),
                  ('Statement2', 'String', 999), ('StmtOther', 'String', 999)]
        out = Z.check_zone_fields(todays)
        self.assertEqual(len(out), 1)
        self.assertTrue(out[0].startswith('This looks like today\'s public zones layer'))

    def test_other_layers_are_refused(self):
        short = [(n, t, 254 if n == 'Statement1' else ln) for n, t, ln in self.STARTER]
        self.assertIn('The zones layer\'s Statement1 field holds 254 characters; the notice is 302.',
                      Z.check_zone_fields(short))
        self.assertIn('The zones layer has no Statement2 field.',
                      Z.check_zone_fields([f for f in self.STARTER if f[0] != 'Statement2']))
        self.assertIn('The zones layer has fields the new zones layer does not: Notes.',
                      Z.check_zone_fields(self.STARTER + [('Notes', 'String', 50)]))

    def test_the_cases_table(self):
        eleven = [('ObjectId', 'OID', 4)] + [(a, 'Date' if k == 'DATE' else 'Integer' if k == 'LONG' else 'String', 255)
                                             for _, a, k in Z.CASE_FIELDS]
        problems, target = Z.check_case_fields(eleven)
        self.assertEqual(problems, [])
        self.assertEqual(target, [a for _, a, _ in Z.CASE_FIELDS])
        text_date = [(n, 'String' if n == 'Close_Date' else t, ln) for n, t, ln in eleven]
        self.assertTrue(any('Close_Date field is a String field' in p for p in Z.check_case_fields(text_date)[0]))
        problems = Z.check_case_fields([(n, 'Integer' if n == 'State' else t, ln) for n, t, ln in eleven])[0]
        self.assertEqual(problems, ['The cases table\'s State field is a Integer field; it must be a String (text) field.'])
        problems = Z.check_case_fields(eleven + [('Address', 'String', 255)])[0]
        self.assertTrue(any('beyond the eleven: Address' in p for p in problems))
        # A cases table published before 2.9.1 (nine fields): the two new fields named, with how to add them.
        nine = [f for f in eleven if f[0] not in ('Quarantine_Status', 'State')]
        problems = Z.check_case_fields(nine)[0]
        self.assertEqual(len(problems), 2)
        self.assertTrue(problems[0].startswith('The cases table has no field for Quarantine Status (looked for '
                                               'Quarantine_Status). A cases table made before 2.9.1 lacks it'), problems[0])
        self.assertIn('no field for State (looked for State)', problems[1])
        self.assertIn('then tick it in the public view\'s fields', problems[0])
        # A Date only field (no time) is refused: the dashboard's counting rules read date and time.
        problems = Z.check_case_fields([(n, 'DateOnly' if n == 'Close_Date' else t, ln) for n, t, ln in eleven])[0]
        self.assertEqual(len(problems), 1)
        self.assertIn('Close_Date field is a "Date only" field; it must be a "Date" field', problems[0])

    def test_where_the_layer_is_and_its_system(self):
        self.assertEqual(Z.check_online('https://services.arcgis.com/x/arcgis/rest/services/z/FeatureServer/0', 'zones layer'), [])
        self.assertEqual(Z.check_online('HTTP://portal.example/z/FeatureServer/0', 'zones layer'), [])
        out = Z.check_online('R:\\HPAI zones\\hpai_zones_starter.gdb\\HPAI_Zones', 'zones layer')
        self.assertTrue(out[0].startswith('The zones layer picked is a file (R:'), out)
        self.assertEqual(Z.check_online(None, 'cases table')[0][:30], 'The cases table picked is a fi')
        self.assertEqual([Z.check_system(c) for c in (3857, 102100, 4326)], [[], [], []])
        self.assertIn('map projection (code 2927)', Z.check_system(2927)[0])


class WhatAWriteWouldFailOn(unittest.TestCase):
    """Values too long or too large for their field are found before anything is written (a write fails on them
    each time); an unreadable Close Date stops a real run."""

    def setUp(self):
        self.t = table_of(('L 01', '10/1/2026', '', '', 'K' * 60, '47.51234', '-122.31234', 'Active', 'Backyard', 'Chicken', '5'),
                          ('L 02', '10/1/2026', '', '', 'King', '47.61234', '-122.31234', 'Active', 'Backyard', 'Duck' * 75, '3000000000'))
        self.res = Z.build(self.t, TODAY, TODAY)
        self.zones = [(n, 'String', ln) for n, _, ln in Z.ZONE_FIELDS]
        self.cases = [(a, 'Date' if k == 'DATE' else 'Integer' if k == 'LONG' else 'String', 255) for _, a, k in Z.CASE_FIELDS]

    def test_each_named(self):
        out = Z.value_problems(self.t, self.res, self.zones, self.cases, 'x' * 1001)
        self.assertEqual(out[0], 'Additional information has 1001 characters; the zones layer\'s StmtOther field holds 1000.')
        self.assertEqual(out[1], 'A County longer than the zones layer\'s County field (50 characters): row 2 (L 01).')
        self.assertIn('Species in row 3 (L 02) has 300 characters; the cases table\'s Species field holds 255.', out)
        self.assertIn('Flock/Herd Inventory in row 3 (L 02) is 3000000000, larger than the cases table\'s '
                      'Flock_Herd_Inventory field holds.', out)
        self.assertEqual(len(out), 4, 'the 60-letter County fits the cases table\'s 255')

    def test_none_when_they_fit(self):
        t = table_of(('A 01', '10/1/2026', '', '', 'King', '47.51234', '-122.31234', 'Active', 'Backyard', 'Chicken', '5'))
        self.assertEqual(Z.value_problems(t, Z.build(t, TODAY, TODAY), self.zones, self.cases, 'Short'), [])
        self.assertEqual(Z.value_problems(self.t, self.res, self.zones, None)[1:], [], 'no cases table: only the zones')

    def test_an_unreadable_close_date_stops_a_real_run(self):
        t = table_of(('D 01', '10/1/2026', '10-Mar-22', '', 'King', '47.51234', '-122.31234', 'Closed', 'Backyard', 'Chicken', '5'),
                     ('D 02', '10/1/2026', '', '3/32/2026', 'King', '47.61234', '-122.31234', 'Closed', 'Backyard', 'Chicken', '5'))
        self.assertEqual(Z.blockers(t), ['A Close Date that could not be read: row 2 (D 01). ' + Z.DATE_HELP])
        w = Z.point_warnings(t)
        self.assertIn('A date not read in Close Date (a real run stops until it is fixed): row 2 (D 01).', w)
        self.assertIn('A date not read in Quarantine Release: row 3 (D 02).', w)
        self.assertTrue(w.endswith(Z.DATE_HELP), 'the formats the tool reads, once')
        fix = [x for lv, x in Z.check_lines(t, Z.build(t, TODAY, TODAY), True) if lv == 'warning']
        self.assertTrue(any('could not be read in Close Date' in x and 'A real run stops until it is fixed.' in x for x in fix), fix)
        self.assertFalse(any('could not be read in Quarantine Release' in x and 'real run stops' in x for x in fix))


class TheCasesTable(unittest.TestCase):
    HEADER = ('Confirmed Diagnosis,Date Reported,Close Date,Quarantine Release,Quarantine Status,Status,County,State,'
              'Flock/Herd Type,Flock/Herd Inventory,Species\r\n')

    def test_every_row_eleven_fields_dates_at_midday(self):
        t = read(os.path.join(TABLES, 'em_rules_report.csv'))
        rows = Z.case_rows(t, TODAY)
        self.assertEqual(len(rows), 15, 'every bird row, with or without a point, whatever its date (Franklin 12\'s '
                         'dairy cattle and Whatcom 11\'s goats left out)')
        self.assertTrue(all(len(r) == 11 for r in rows))
        first = rows[0]
        self.assertEqual(first[0], datetime(2022, 3, 10, 12))
        self.assertEqual(first[6], 'King')
        self.assertEqual(first[9], 1250000)
        csv_text = Z.cases_csv(t, TODAY)
        self.assertTrue(csv_text.startswith(self.HEADER))
        # A table before the new format: Quarantine Status and State left blank, and the check says so.
        said = [x for lv, x in Z.check_lines(t, Z.build(t, TODAY, TODAY), True) if lv == 'warning']
        self.assertIn('      Not found: Quarantine Status. The cases table\'s Quarantine Status is left blank. If the table '
                      'has it, check the heading\'s spelling (README.txt, "The table").', said)
        self.assertIn('      Not found: State. The cases table\'s State is left blank. If the table has it, check the '
                      'heading\'s spelling (README.txt, "The table").', said)
        self.assertIn('\r\n3/10/2022,3/9/2022,6/1/2022,6/15/2022,,Closed,King,,Commercial,1250000,Chicken\r\n', csv_text)
        self.assertEqual(csv_text.count('\r\n'), 16)

    def test_the_new_format(self):
        """em_rules_new_format.csv: em_rules_report.csv in the table's 2.9.1 columns (Quarantine Status after Quarantine
        Release, State after County): the same figures, the two columns written, a State or a Quarantine Status not
        understood listed to fix."""
        t = read(os.path.join(TABLES, 'em_rules_new_format.csv'))
        self.assertEqual(t.missing, [])
        self.assertEqual(t.columns['quarantine_status'], 'Quarantine Status')
        self.assertEqual(t.columns['state'], 'State')
        res = Z.build(t, date(2026, 9, 1), TODAY)
        self.assertEqual((len(res.rows), len(res.later), len(res.active), len(res.counties)), (16, 1, 3, 9))
        csv_text = Z.cases_csv(t, TODAY)
        self.assertTrue(csv_text.startswith(self.HEADER))
        self.assertIn('\r\n3/10/2022,3/9/2022,6/1/2022,6/15/2022,Released,Closed,King,WA,Commercial,1250000,Chicken\r\n',
                      csv_text)
        self.assertNotIn('Dairy cattle', csv_text, 'birds only')
        fixes = dict((what, [c.name() for c in cases]) for what, cases, _ in Z.to_fix(t, res))
        # "Washington" and "Washington  State" (two spaces) are Washington; OR is not; a blank State is not listed.
        self.assertEqual(fixes['A State that is not Washington (written as given; check it)'], ['row 17 (Multnomah 11)'])
        # As the dashboard: "Under  quarantine" (two spaces) is not one of its words, nor "Pending release".
        self.assertEqual(fixes['A Quarantine Status that is not "Under quarantine" or "Released" (written as given)'],
                         ['row 10 (Yakima 12)', 'row 16 (Pierce 12)'])
        said = [x for lv, x in Z.check_lines(t, res, True) if lv != 'steps']
        self.assertFalse([x for x in said if 'Not found' in x])
        self.assertTrue(any('Quarantine Status' in x and 'State' in x for x in said if x.strip().startswith('17 rows')))


class TheCheck(unittest.TestCase):
    def test_long_lists_are_cut(self):
        rows = [('A %02d' % i, '10/1/2026', '', '', 'King', '', '', 'Active', 'Backyard', 'Chicken', '5') for i in range(13)]
        t = table_of(*rows)
        said = [x for lv, x in Z.check_lines(t, Z.build(t, TODAY, TODAY), True) if lv != 'steps']
        line = [x for x in said if 'no map point' in x][0]
        self.assertTrue(line.endswith('row 10 (A 08), row 11 (A 09), and 3 more.'), line)
        full = [x for lv, x in Z.check_lines(t, Z.build(t, TODAY, TODAY), True, limit=None) if lv != 'steps']
        line = [x for x in full if 'no map point' in x][0]
        self.assertTrue(line.endswith('row 13 (A 11), row 14 (A 12).'), 'the check file names every row')
        pairs = []
        for i in range(12):
            for j in (1, 2):
                pairs.append(('P %02d-%d' % (i, j), '10/%d/2026' % j, '', '', 'King', '47.%02d' % (i + 10), '-122', 'Active',
                              'Backyard', 'Chicken', '5'))
        t = table_of(*pairs)
        short = [x for lv, x in Z.check_lines(t, Z.build(t, TODAY, TODAY), True) if lv != 'steps']
        full = [x for lv, x in Z.check_lines(t, Z.build(t, TODAY, TODAY), True, limit=None) if lv != 'steps']
        self.assertIn('        and 2 more', short)
        self.assertNotIn('        and 2 more', full)
        self.assertIn('        row 24 (P 11-1), row 25 (P 11-2)', full, 'every shared map point in the check file')

    def test_the_report_scenario_check(self):
        t = read(os.path.join(TABLES, 'em_rules_report.csv'))
        said =[x for lv, x in Z.check_lines(t, Z.build(t, date(2026, 9, 1), TODAY), True) if lv != 'steps']
        for expected in ('  Cases ............................ 16   (the public dashboard\'s, birds: 14)',
                         '  Active ........................... 3   (2 flocks, 1 dairy herd; the public dashboard\'s, '
                         'birds: 2)',
                         '  Counties affected ................ 9   (Washington\'s; the public dashboard\'s, birds: 8)',
                         '  Active surveillance areas ........ 2 (active cases with a map point), in 2 counties '
                         '(Franklin, Yakima)'):
            self.assertIn(expected, said)


if __name__ == '__main__':
    unittest.main()
