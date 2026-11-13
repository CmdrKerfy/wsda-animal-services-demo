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

TODAY = date(2026, 10, 30)   # the dashboard's fixtures' "today" (make_em_fixtures.js)
DATES = [date(2022, 6, 1), date(2024, 1, 15), date(2025, 6, 30), date(2026, 8, 1), date(2026, 9, 1), TODAY]
HEAD = ('Case ID,Date Reported,Close Date,Confirmed Diagnosis,Quarantine Release,Premises,Address,City,County,'
        'Latitude,Longitude,Status,Subtype,Flock/Herd Type,Production Type,Species,Flock/Herd Inventory,'
        'Depop Inventory,Structures,Disposal Method')


def read(path):
    with open(path, 'rb') as f:
        return Z.read_table(f.read())


def dashboard(path, on, today=TODAY):
    out = subprocess.run(['node', os.path.join(HERE, 'dashboard_rules.js'), path, on.isoformat(), today.isoformat()],
                         check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def table_of(*rows):
    """A made-up table in the agreed columns from rows of (id, detected, close, release, county, lat, lon, status,
    type, species, inventory); Premises, Address and City hold marked words that must never come out."""
    lines = [HEAD]
    for r in rows:
        cid, det, close, rel, county, lat, lon, status, ftype, species, inv = r
        lines.append(','.join([cid, det, close, det, rel, 'MARKED-PREMISES', 'MARKED-ADDRESS', 'MARKED-CITY', county,
                               lat, lon, status, 'H5N1', ftype, 'X', species, inv, inv, '1', 'Landfill']))
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

    def test_same_point_rounding_is_javascripts(self):
        """toFixed(5) rounds an exact half away from zero; Python's own format would round it to even."""
        self.assertEqual(Z.round5(46.015625), '46.01563')
        self.assertEqual(Z.round5(-120.015625), '-120.01563')
        self.assertEqual(Z.round5(47.0), '47.00000')

    def test_a_table_from_excel(self):
        """Excel's byte order mark, and a file saved in Windows' own encoding."""
        t = Z.read_table(('﻿' + HEAD + '\r\nA 01,,,10/1/2026,,,,,King,47.5,-122,Active,,,,Chicken,5,,,\r\n').encode('utf-8'))
        self.assertEqual(t.columns['case_id'], 'Case ID')
        t = Z.read_table((HEAD + '\r\nA 01,,,10/1/2026,,Caf\xe9,,,King,47.5,-122,Active,,,,Chicken,5,,,\r\n').encode('cp1252'))
        self.assertEqual(len(t.cases), 1)

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
        self.assertEqual(Z.point_warnings(self.t), '3 rows have coordinates to fix: line 2 (A 01), line 3 (A 02), '
                                                   'line 4 (A 03).')

    def test_no_zones_without_a_usable_point(self):
        self.assertEqual(sorted(set(z['case'].case_id for z in self.res.zones)), ['A 05', 'A 06'])

    def test_the_check_lists_them_to_fix(self):
        said = [(lv, x) for lv, x in Z.check_lines(self.t, self.res, False) if lv != 'steps']
        fix = [x for lv, x in said if lv == 'warning']
        self.assertTrue(fix[0].startswith('TO FIX IN THE TABLE'))
        self.assertIn('  Coordinates: latitude and longitude look swapped, no zones until fixed: line 2 (A 01).', fix)
        self.assertIn('  Coordinates outside Washington (zones drawn; check them): line 6 (A 05).', fix)
        self.assertTrue(any('not one of Washington\'s 39' in x and 'line 6 (A 05)' in x for x in fix))


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
        t = table_of(('A 02', '9/1/2026', '', '', 'King', '47.6', '-122', '=1+1', 'Backyard', '@SUM(1)', '5'))
        text = Z.cases_csv(t, TODAY)
        self.assertIn("'=1+1", text)
        self.assertIn("'@SUM(1)", text)
        self.assertEqual([Z.safe_cell(v) for v in ('+5', '-3', 'Chicken', '')], ["'+5", "'-3", 'Chicken', ''])


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
        nine = [('ObjectId', 'OID', 4)] + [(a, 'Date' if k == 'DATE' else 'Integer' if k == 'LONG' else 'String', 255)
                                           for _, a, k in Z.CASE_FIELDS]
        problems, target = Z.check_case_fields(nine)
        self.assertEqual(problems, [])
        self.assertEqual(target, [a for _, a, _ in Z.CASE_FIELDS])
        text_date = [(n, 'String' if n == 'Close_Date' else t, ln) for n, t, ln in nine]
        self.assertTrue(any('Close_Date field is a String field' in p for p in Z.check_case_fields(text_date)[0]))
        problems = Z.check_case_fields(nine + [('Address', 'String', 255)])[0]
        self.assertTrue(any('beyond the nine: Address' in p for p in problems))


class TheCasesTable(unittest.TestCase):
    def test_every_row_nine_fields_dates_at_midday(self):
        t = read(os.path.join(TABLES, 'em_rules_report.csv'))
        rows = Z.case_rows(t, TODAY)
        self.assertEqual(len(rows), 17, 'every row, with or without a point, whatever its date')
        self.assertTrue(all(len(r) == 9 for r in rows))
        first = rows[0]
        self.assertEqual(first[0], datetime(2022, 3, 10, 12))
        self.assertEqual(first[5], 'King')
        self.assertEqual(first[7], 1250000)
        csv_text = Z.cases_csv(t, TODAY)
        self.assertTrue(csv_text.startswith('Confirmed Diagnosis,Date Reported,Close Date,Quarantine Release,Status,'
                                            'County,Flock/Herd Type,Flock/Herd Inventory,Species\r\n'))
        self.assertIn('\r\n3/10/2022,3/9/2022,6/1/2022,6/15/2022,Closed,King,Commercial,1250000,Chicken\r\n', csv_text)
        self.assertEqual(csv_text.count('\r\n'), 18)


class TheCheck(unittest.TestCase):
    def test_long_lists_are_cut(self):
        rows = [('A %02d' % i, '10/1/2026', '', '', 'King', '', '', 'Active', 'Backyard', 'Chicken', '5') for i in range(13)]
        t = table_of(*rows)
        said = [x for lv, x in Z.check_lines(t, Z.build(t, TODAY, TODAY), True) if lv != 'steps']
        line = [x for x in said if 'no map point' in x][0]
        self.assertTrue(line.endswith('line 10 (A 08), line 11 (A 09), and 3 more.'), line)

    def test_the_report_scenario_check(self):
        t = read(os.path.join(TABLES, 'em_rules_report.csv'))
        said =[x for lv, x in Z.check_lines(t, Z.build(t, date(2026, 9, 1), TODAY), True) if lv != 'steps']
        for expected in ('  Cases ............................ 16',
                         '  Active ........................... 3   (2 flocks, 1 dairy herd)',
                         '  Counties affected ................ 9   (Washington\'s)',
                         '  Active surveillance areas ........ 2 (active cases with a map point), in 2 counties '
                         '(Franklin, Yakima)'):
            self.assertIn(expected, said)


if __name__ == '__main__':
    unittest.main()
