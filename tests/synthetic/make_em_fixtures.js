#!/usr/bin/env node
'use strict';
// Emergency Response fixtures: the files the Emergency unit suite (tests/node/run_em_unit_tests.js) and the browser
// suite read, also handy for trying the page by hand. Every value is synthetic; the addresses are marked "MARKED-ADDRESS" so a test can
// prove they reach no name, label or export.
//
// Recognition:
//   em_positives_tool.csv     the HPAI mapping tool's form (Lat, Long, County, Premise Location, Surveillance Closed):
//                             open and closed positives (closed written Yes and y), one in Oregon, marked addresses
//   em_positives_demo.csv     the earlier Emergency demo's form (Case Lat, Case Long, Case Status, Detection Date,
//                             AnimalDiseaseReportId, Disease Name): each status, a marked address
//   em_positives_one_marker.csv   Latitude, Longitude and Detection Date only (one marker column is enough)
//   em_positives_agreed.csv   the agency's agreed HPAI table (20 columns, 2026-10-22): Active and Closed rows, a Close
//                             Date and a Quarantine Release, a row with Date Reported only, inventories with
//                             thousands commas, marked Premises and Address values that must reach nothing
//   em_positives_agreed_header.csv  the agreed table's header alone (recognized as positives with no rows)
//   em_positives_times.csv    the agreed table with dates as Excel and ArcGIS export them ("9/3/2026 0:00"): a
//                             premises closed after the latest detection and released later still; a release date
//                             and a detection date that cannot be read; one closed by its Status alone
//   em_positives_nws.csv      New World screwworm rows in the agreed columns (Subtype names the disease)
//   em_no_marker.csv          Lat, Long, County and Premise Location: no marker, so not positives (a facility layer)
//   em_premises_location.csv  a premises file with a Premise Location column: a facility layer, never positives
//   em_zone.geojson           a control area (one polygon)
//   em_zone_hole.geojson      a polygon with a hole
//   em_zone.kml               the same control area as KML
//   em_zone_stateplane.geojson  a polygon in Washington State Plane South (feet, EPSG 2927): refused by zones.js
//   em_cvi_master.csv         a small CVI master for the Emergency sample's positives: movements leaving from and
//                             arriving inside their zones, in two years and two species groups, one far from every
//                             zone, and a marked address column that no export may hold
//   em_positives_no_date.csv  the sample's positives without Detection Date and Case Status (the boxes' "Not available")
//   emergency_synthetic.zip   (test-tables/ only) the Emergency sample, byte for byte as the page's button makes it
//   em_bundle/                a folder bundle: bundle.json for Emergency, the tool-form positives, a feedlots file
//                             and the GeoJSON zone (the landing page's hand-off with a zone file)
// A synthetic New World screwworm outbreak (for trying the switch between outbreaks; every value made up):
//   em_nws_synthetic_positives.csv  ten screwworm positives and one row without coordinates in the agreed 20
//                             columns, Aug to Oct 2026 (the play by week), two past, one still under quarantine
//   em_nws_synthetic_dispersal_area.geojson  two invented dispersal areas (not APHIS or WSDA areas)
//   em_nws_synthetic/         the bundle as a folder: bundle.json (marked synthetic), the positives, the dispersal
//                             areas, feedlots, markets and fairs
//   em_nws_synthetic.zip      (test-tables/ only) the same bundle as a ZIP
// The rules (site/emergency/rules.js), checked by the unit suite and by the R reference (tests/oracle/em_oracle.R):
//   em_rules_positives.csv    seven positives: with and without a report ID or a county, each status (one spelled
//                             "Pending"), one closed, one in Oregon, one without usable coordinates, dates written
//                             three ways and one unreadable, marked addresses
//   em_rules_<layer>.csv      layers placed around the positives with the shared engine's destination(): points
//                             on the 3 km and 10 km edges of a positive's rings, one inside two positives'
//                             zones, each location-precision value (dairies: all three columns; premises:
//                             match_status only; poultry: none, but geo_source: one located only to a town, one
//                             not placed, one by address), a layer with nothing
//                             inside (disposal: the "nearest" line)
//   rules.json                the scenario both sides read: the files above, the rings, the zone files to test, and
//                             a speed set (40 positives and 30,000 points from a fixed-seed generator)
// The agreed-table scenario (E1b), checked by the unit suite and by the R reference in the same way:
//   em_rules_agreed.csv       twelve positives in the agreed 20 columns, detected from Nov 2024 to Oct 2026 (more
//                             than 26 weeks: the month rule), one in the week that crosses a year end; both groups,
//                             past by Close Date (written M/D/YYYY, YYYY-MM-DD and YYYY/MM/DD) and by Status Closed
//                             with no Close Date, one Close Date unreadable; past positives released and still under
//                             quarantine; a positive without a date and one with Date Reported only; two positives
//                             at one spot with different Case IDs; a row without coordinates and one with them
//                             swapped; inventories with thousands commas, one blank, and the size classes' edges
//                             (99, 100, 1,000, 1,001); a current backyard cattle herd (counted apart from the
//                             birds); marked Premises and Address values
//   em_rules_agreed_poultry.csv  a layer for rings in miles (2 and 6 mi): a point on a 6-mile ring (nudged inward as
//                             the km edges are), one just outside it, one near a past positive only
//   em_rules_zone_two.geojson a zone holding two positives, written clockwise (the page writes it counterclockwise)
//   em_rules_zones_out.geojson  the page's own zones.geojson for this scenario (site/emergency/rules.js zonesGeoJson:
//                             the current and past positives' rings in miles, and the zone), read by the R reference
// The made-up third type is tests/synthetic/em_made_up_type.js (not generated).
// Deterministic: no clock, no random numbers (the speed set's generator has a fixed seed).
//
// Usage (repository root): node tests/synthetic/make_em_fixtures.js
// Output (git-ignored): local-test-artifacts/em/fixtures/, and the same files in test-tables/ (the folder of synthetic
// tables for trying the pages by hand), leaving the folder's other files alone.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 'em', 'fixtures');
const TABLES = path.join(ROOT, 'test-tables');

const csv = rows => rows.map(r => r.join(',')).join('\n') + '\n';
// The agency's agreed HPAI table, left to right.
const AGREED_HEAD = ['Case ID', 'Date Reported', 'Close Date', 'Confirmed Diagnosis', 'Quarantine Release', 'Premises',
  'Address', 'City', 'County', 'Latitude', 'Longitude', 'Status', 'Subtype', 'Flock/Herd Type', 'Production Type',
  'Species', 'Flock/Herd Inventory', 'Depop Inventory', 'Structures', 'Disposal Method'];
// A marked address: a test searches every output for "MARKED-ADDRESS" and must find none.
const address = k => `MARKED-ADDRESS-${7700 + k} Example Road`;

const FILES = {
  'em_positives_tool.csv': csv([
    ['Lat', 'Long', 'County', 'Premise Location', 'Surveillance Closed'],
    ['46.5520', '-120.4700', 'Yakima', address(1), 'No'],
    ['46.4010', '-120.3150', 'Yakima', address(2), ''],
    ['46.4000', '-119.0500', 'Franklin', address(3), 'Yes'],
    ['48.4200', '-122.3300', 'Skagit', address(4), 'y'],
    ['45.8400', '-119.2900', 'Umatilla (Oregon)', address(5), 'No'],
    ['46.6600', '-122.9600', 'Lewis', address(6), 'No']
  ]),
  'em_positives_demo.csv': csv([
    ['AnimalDiseaseReportId', 'Disease Name', 'Case Status', 'Detection Date', 'County', 'Premise Location', 'Case Lat', 'Case Long'],
    ['SYN-0001', 'HPAI H5N1', 'Confirmed', '2026-09-02', 'Yakima', address(11), '46.5520', '-120.4700'],
    ['SYN-0002', 'HPAI H5N1', 'Presumptive', '2026-09-10', 'Yakima', address(12), '46.4010', '-120.3150'],
    ['SYN-0003', 'HPAI H5N1', 'Suspect', '2026-09-28', 'Skagit', address(13), '48.4200', '-122.3300']
  ]),
  'em_positives_agreed.csv': csv([AGREED_HEAD,
    ['SYN-A-01', '9/1/2026', '', '9/3/2026', '', address(81), address(82), 'Synthetic Town', 'Yakima', '46.5520',
      '-120.4700', 'Active', 'H5N1 2.3.4.4b', 'Commercial', 'Commercial Table Egg Layer', 'Chicken', '"1,250,000"',
      '"1,250,000"', '6', 'Landfill'],
    ['SYN-A-02', '9/12/2026', '', '', '', address(83), address(84), 'Synthetic Town', 'Skagit', '48.4200', '-122.3300',
      'Active', 'H5N1 2.3.4.4b', 'Backyard', 'WOAH Non-Poultry', 'Multiple Poultry Species', '35', '35', '1',
      'On-Site Burial'],
    ['SYN-A-03', '7/2/2026', '8/14/2026', '7/6/2026', '8/30/2026', address(85), address(86), 'Synthetic Town',
      'Snohomish', '48.0500', '-122.1500', 'Closed', 'H5N1 2.3.4.4b', 'Commercial', 'Commercial Meat Turkey', 'Turkey',
      '"18,500"', '"18,500"', '3', 'Incinerator'],
    ['SYN-A-04', '9/20/2026', '', '9/22/2026', '', address(87), address(88), 'Synthetic Town', 'Franklin', '46.4000',
      '-119.0500', 'Active', 'H5N1 2.3.4.4b', 'Commercial', 'Dairy', 'Cattle', '', '', '4', '']
  ]),
  'em_positives_agreed_header.csv': csv([AGREED_HEAD]),
  'em_positives_times.csv': csv([AGREED_HEAD,
    ['SYN-T-01', '9/1/2026 0:00', '10/20/2026 0:00', '9/3/2026 0:00', '11/30/2026 0:00', address(95), address(96),
      'Synthetic Town', 'Yakima', '46.5520', '-120.4700', 'Active', 'H5N1 2.3.4.4b', 'Commercial',
      'Commercial Table Egg Layer', 'Chicken', '"1,250,000"', '', '', ''],
    ['SYN-T-02', '9/28/2026 12:00:00 AM', '', '10/1/2026 12:00:00 AM', 'pending', address(97), address(98),
      'Synthetic Town', 'Skagit', '48.4200', '-122.3300', 'Active', 'H5N1 2.3.4.4b', 'Backyard', 'WOAH Non-Poultry',
      'Multiple Poultry Species', '35', '', '', ''],
    ['SYN-T-03', 'Sept 2026', '', '', '', address(99), address(100), 'Synthetic Town', 'Franklin', '46.4000',
      '-119.0500', 'Closed', 'H5N1 2.3.4.4b', 'Backyard', 'WOAH Non-Poultry', 'Chicken', '12', '', '', '']
  ]),
  'em_positives_nws.csv': csv([AGREED_HEAD,
    ['SYN-NWS-01', '10/1/2026', '', '10/2/2026', '', address(91), address(92), 'Synthetic Town', 'Klickitat', '45.8200',
      '-120.8200', 'Active', 'New World screwworm', 'Commercial', 'Cow-calf', 'Cattle', '240', '', '', ''],
    ['SYN-NWS-02', '10/4/2026', '', '10/6/2026', '', address(93), address(94), 'Synthetic Town', 'Benton', '46.2400',
      '-119.5000', 'Active', 'NWS myiasis', 'Backyard', 'Equine', 'Horse', '3', '', '', '']
  ]),
  'em_positives_one_marker.csv': csv([
    ['Latitude', 'Longitude', 'Detection Date'],
    ['47.0400', '-122.9000', '2026-10-01']
  ]),
  'em_no_marker.csv': csv([
    ['Lat', 'Long', 'County', 'Premise Location'],
    ['46.5520', '-120.4700', 'Yakima', address(21)]
  ]),
  'em_premises_location.csv': csv([
    ['name', 'lat', 'long', 'Premise Location'],
    ['Synthetic Premises A', '46.5600', '-120.4600', address(31)]
  ]),
  'em_zone.geojson': JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature',
    properties: { name: 'Synthetic control area' },
    geometry: { type: 'Polygon', coordinates: [[[-120.25973, 46.43911], [-120.25973, 46.36289], [-120.37027, 46.36289],
      [-120.37027, 46.43911], [-120.25973, 46.43911]]] } }] }) + '\n',
  'em_zone_hole.geojson': JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature',
    properties: { name: 'Synthetic zone with a hole' },
    geometry: { type: 'Polygon', coordinates: [
      [[-120.60, 46.45], [-120.60, 46.65], [-120.34, 46.65], [-120.34, 46.45], [-120.60, 46.45]],
      [[-120.50, 46.52], [-120.44, 46.52], [-120.44, 46.58], [-120.50, 46.58], [-120.50, 46.52]]] } }] }) + '\n',
  'em_zone.kml': [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Synthetic control area</name>',
    '<Polygon><outerBoundaryIs><LinearRing><coordinates>',
    '-120.25973,46.43911 -120.25973,46.36289 -120.37027,46.36289 -120.37027,46.43911 -120.25973,46.43911',
    '</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>', ''].join('\n'),
  'em_zone_stateplane.geojson': JSON.stringify({ type: 'FeatureCollection',
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::2927' } },
    features: [{ type: 'Feature', properties: { name: 'State Plane zone' },
      geometry: { type: 'Polygon', coordinates: [[[1650000, 380000], [1660000, 380000], [1660000, 390000],
        [1650000, 390000], [1650000, 380000]]] } }] }) + '\n'
};

// ---- The rules' scenario ------------------------------------------------------------------------------------
// The shared engine places the layer points, so a point "3 km from a positive" is 3 km by the page's own distance.
const sandbox = {};
sandbox.window = sandbox;
require('vm').createContext(sandbox);
require('vm').runInContext(fs.readFileSync(path.join(ROOT, 'site', 'shared', 'proximity.js'), 'utf8'), sandbox);
const PX = sandbox.WSDA.proximity;
const RINGS = [{ distance: 3, label: 'Infection zone' }, { distance: 10, label: 'Control zone' }];
// The positives: [id, status, date, county, lat, long, closed]; the address column is marked.
const POSITIVES = [
  ['R-001', 'Confirmed', '2026-09-02', 'Yakima', '46.60', '-120.50', 'No'],
  ['', 'Presumptive', '9/10/2026', 'Yakima', '46.52', '-120.40', ''],
  ['R-003', 'Suspect', '2026/08/21', 'Franklin', '46.40', '-119.05', 'Yes'],
  ['', '', 'not a date', '', '47.20', '-120.00', 'No'],
  ['R-005', 'Confirmed', '2026-10-05', 'Umatilla (Oregon)', '45.84', '-119.29', 'No'],
  ['R-006', 'Confirmed', '2026-10-01', 'Lewis', 'bad', '-122.96', 'No'],
  ['R-007', 'Pending', '2026-09-30', 'Lewis', '46.66', '-122.96', 'No']
];
const POSITIVES_CSV = csv([['AnimalDiseaseReportId', 'Disease Name', 'Case Status', 'Detection Date', 'County',
  'Premise Location', 'Lat', 'Long', 'Surveillance Closed']].concat(POSITIVES.map((r, k) =>
  [r[0], 'HPAI H5N1', r[1], r[2], r[3], address(40 + k)].concat(r.slice(4)))));
// A point km away from positive k (0-based, in the list above) along a bearing, written with every digit.
const near = (k, km, bearing) => {
  const [lon, lat] = PX.destination(Number(POSITIVES[k][4]), Number(POSITIVES[k][5]), km, bearing);
  return [String(lat), String(lon)];
};
// A point on a ring's edge: km away along a bearing, moved inward by the smallest steps until the page's own distance
// is at most km (a point placed at exactly km can measure a hair over it).
const edge = (k, km, bearing) => {
  const lat0 = Number(POSITIVES[k][4]), lon0 = Number(POSITIVES[k][5]);
  for (let step = 0; step < 1000; step++) {
    const [lon, lat] = PX.destination(lat0, lon0, km - step * 1e-12, bearing);
    if (PX.distanceKm(lat, lon, lat0, lon0) <= km) return [String(lat), String(lon)];
  }
  throw new Error('no edge point found');
};
// The same, from any point.
const edgeFrom = (lat0, lon0, km, bearing) => {
  for (let step = 0; step < 1000; step++) {
    const [lon, lat] = PX.destination(lat0, lon0, km - step * 1e-12, bearing);
    if (PX.distanceKm(lat, lon, lat0, lon0) <= km) return [String(lat), String(lon)];
  }
  throw new Error('no edge point found');
};
const midway = (a, b) => [String((Number(POSITIVES[a][4]) + Number(POSITIVES[b][4])) / 2),
  String((Number(POSITIVES[a][5]) + Number(POSITIVES[b][5])) / 2)];
const LAYERS = [
  { key: 'dairies', label: 'Dairies', rows: [
    ['name', 'lat', 'long', 'geocode_precision', 'match_status', 'premises_type'],
    ['Rules Dairy 1', ...near(0, 1.2, 30), 'rooftop', 'Matched', 'Street'],
    ['Rules Dairy 2', ...near(0, 5, 100), 'street', 'Matched', 'Street'],
    ['Rules Dairy 3', ...near(0, 2, 200), 'city', 'Matched', 'Street'],
    ['Rules Dairy 4', ...near(0, 2.5, 300), 'rooftop', 'Unmatched', 'Street'],
    ['Rules Dairy 5', ...near(0, 2, 10), 'rooftop', 'Matched', 'Mailing'],
    ['Rules Dairy 6', ...near(0, 4, 150), 'ROOFTOP', 'Matched', 'Street'],
    ['Rules Dairy 7', ...near(1, 7, 250), 'street', 'Matched', 'Street'],
    ['Rules Dairy 8', ...near(0, 20, 0), 'rooftop', 'Matched', 'Street'],
    ['Rules Dairy 9', ...near(0, 1.5, 45), '', 'Matched', 'Street'],
    // Inside the control area of em_zone.geojson and em_zone.kml, outside every ring.
    ['Rules Dairy 10', '46.40', '-120.31', 'rooftop', 'Matched', 'Street']
  ] },
  { key: 'commercial_poultry', label: 'Commercial poultry', rows: [
    ['name', 'lat', 'long', 'geo_source'],
    ['Rules Poultry Edge 3 km', ...edge(0, 3, 90), 'existing'],
    ['Rules Poultry Edge 10 km', ...edge(1, 10, 0), 'existing'],
    ['Rules Poultry Town', ...near(3, 1, 45), 'google_city'],
    ['Rules Poultry By Closed', ...near(2, 0.5, 0), ''],
    ['Rules Poultry Oregon', ...near(4, 2, 0), 'existing'],
    ['Rules Poultry Unplaced', ...near(0, 1, 180), 'none'],
    ['Rules Poultry Google Address', ...near(0, 2.2, 270), 'google_address']
  ] },
  { key: 'markets', label: 'Livestock markets', rows: [
    ['name', 'lat', 'long'],
    ['Rules Market Between', ...midway(0, 1)],
    ['Rules Market Far', ...near(6, 60, 90)]
  ] },
  { key: 'disposal', label: 'Disposal sites', rows: [
    ['name', 'lat', 'long'],
    ['Rules Landfill North', ...near(0, 25, 0)],
    ['Rules Rendering South', ...near(4, 40, 180)]
  ] },
  { key: 'premises', label: 'Registered premises', rows: [
    ['name', 'lat', 'long', 'match_status'],
    ['Rules Premises 1', ...near(6, 1.5, 90), 'Matched'],
    ['Rules Premises 2', ...near(6, 2, 270), 'Fallback'],
    ['Rules Premises 3', ...near(6, 15, 0), 'Matched']
  ] }
];
// The speed set: a fixed-seed generator (no random numbers), 40 positives and 30,000 points over Washington.
function speedSet() {
  let x = 20261020;
  const next = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
  const at = () => [Number((45.6 + next() * 3.4).toFixed(5)), Number((-124.6 + next() * 7.6).toFixed(5))];
  return { positives: Array.from({ length: 40 }, at), points: Array.from({ length: 30000 }, at) };
}
const RULES_FILES = { 'em_rules_positives.csv': POSITIVES_CSV };
for (const l of LAYERS) RULES_FILES['em_rules_' + l.key + '.csv'] = csv(l.rows);

// ---- The agreed-table scenario (E1b) ------------------------------------------------------------------------
// [Case ID, Date Reported, Close Date, Confirmed Diagnosis, Quarantine Release, County, Latitude, Longitude, Status,
//  Flock/Herd Type, Production Type, Species, Flock/Herd Inventory]; the other columns are filled in below.
const AGREED = [
  ['Yakima 01', '11/3/2024', '2024-12-20', '11/5/2024', '1/10/2025', 'Yakima', '46.60', '-120.50', 'Closed', 'Commercial',
    'Commercial Table Egg Layer', 'Chicken', '18,500'],
  ['Yakima 02', '12/29/2025', '2026/02/10', '12/30/2025', '', 'Yakima', '46.52', '-120.40', 'Closed', 'Backyard',
    'WOAH Non-Poultry', 'Duck', '99'],
  ['Franklin 01', '3/14/2026', '5/1/2026', '3/15/2026', '6/30/2026', 'Franklin', '46.40', '-119.05', 'Closed', 'Commercial',
    'Commercial Meat Turkey', 'Turkey', '1,000'],
  ['', '', '', '', '', 'Kittitas', '47.20', '-120.00', 'Active', 'Backyard', 'WOAH Non-Poultry', 'Chicken', '100'],
  ['Umatilla 01', '9/1/2026', 'pending', '9/2/2026', '', 'Umatilla (Oregon)', '45.84', '-119.29', 'Active', 'Commercial',
    'Commercial Broiler', 'Chicken', '1,001'],
  ['Lewis 01', '6/9/2025', '8/1/2025', '6/10/2025', '8/15/2025', 'Lewis', '46.66', '-122.96', 'Closed', 'Backyard',
    'WOAH Non-Poultry', 'Goose', '12'],
  ['Lewis 02', '9/29/2026', '', '9/30/2026', '', 'Lewis', '46.66', '-122.96', 'Active', 'Backyard', 'WOAH Non-Poultry',
    'Multiple Poultry Species', ''],
  ['Lewis 03', '10/1/2026', '', '10/1/2026', '', 'Lewis', '', '', 'Active', 'Backyard', 'WOAH Non-Poultry', 'Chicken', '7'],
  ['Yakima 03', '9/20/2026', '', '9/20/2026', '', 'Yakima', '-120.47', '46.55', 'Active', 'Commercial', 'Dairy', 'Cattle',
    '2,400'],
  ['Skagit 01', '10/4/2026', '', '10/5/2026', '', 'Skagit', '48.42', '-122.33', 'Active', 'Commercial',
    'Commercial Table Egg Layer', 'Chicken', '1,250,000'],
  ['Whatcom 01', '7/20/2026', '', '', '', 'Whatcom', '48.90', '-122.45', 'Active', 'Backyard', 'Dairy', 'Cattle', '35'],
  ['Benton 01', '2/1/2026', '', '2/2/2026', '', 'Benton', '46.25', '-119.30', 'Closed', 'Backyard', 'WOAH Non-Poultry',
    'Chicken', '40']
];
// A cell holding a comma is quoted, as a spreadsheet writes it.
const quoted = v => (/[",]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
RULES_FILES['em_rules_agreed.csv'] = csv([AGREED_HEAD].concat(AGREED.map((r, k) => [r[0], r[1], r[2], r[3], r[4],
  address(100 + 2 * k), address(101 + 2 * k), 'Synthetic Town', r[5], r[6], r[7], r[8], 'H5N1 2.3.4.4b', r[9], r[10], r[11],
  r[12], r[12], '1', 'Landfill'].map(quoted))));
const AGREED_AT = id => AGREED.find(r => r[0] === id);
const fromAgreed = (id, km, bearing) => {
  const r = AGREED_AT(id), [lon, lat] = PX.destination(Number(r[6]), Number(r[7]), km, bearing);
  return [String(lat), String(lon)];
};
const MI = 1.609344;
RULES_FILES['em_rules_agreed_poultry.csv'] = csv([
  ['name', 'lat', 'long'],
  ['Agreed Poultry 1 mi', ...fromAgreed('Skagit 01', 1 * MI, 0)],
  ['Agreed Poultry Edge 6 mi', ...edgeFrom(48.42, -122.33, 6 * MI, 90)],
  ['Agreed Poultry Outside 6 mi', ...fromAgreed('Skagit 01', 6.05 * MI, 180)],
  ['Agreed Poultry Lewis', ...fromAgreed('Lewis 02', 2.5 * MI, 300)],
  ['Agreed Poultry By Past', ...fromAgreed('Yakima 01', 0.5 * MI, 0)]
]);
RULES_FILES['em_rules_zone_two.geojson'] = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature',
  properties: { name: 'Synthetic area with two positives' },
  geometry: { type: 'Polygon', coordinates: [[[-120.60, 46.45], [-120.60, 46.70], [-120.30, 46.70], [-120.30, 46.45],
    [-120.60, 46.45]]] } }] }) + '\n';
const AGREED_RULES = { positives: 'em_rules_agreed.csv', unit: 'mi',
  rings: [{ distance: 2, label: 'Infection zone' }, { distance: 6, label: 'Control zone' }],
  layer: { key: 'poultry', label: 'Commercial poultry', file: 'em_rules_agreed_poultry.csv' },
  zoneFile: 'em_rules_zone_two.geojson', geojson: 'em_rules_zones_out.geojson',
  // The window's end (the latest detection) and an earlier end that changes the groups.
  asOf: '2026-10-05', earlierEnd: '2026-04-30' };

// The page's zones.geojson for the scenario, as zonesGeoJson writes it, for the R reference to read with sf.
for (const f of ['site/shared/zones.js', 'site/emergency/types.js', 'site/emergency/types/hpai.js',
  'site/emergency/rules.js']) {
  require('vm').runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox);
}
function agreedGeoJson() {
  const E = sandbox.WSDA.emergencyRules, Z = sandbox.WSDA.zones;
  const table = RULES_FILES['em_rules_agreed.csv'].trim().split('\n').map(parseLine);
  const read = E.readPositives(table[0], table.slice(1), sandbox.WSDA.emergencyTypes.get('hpai'));
  const win = E.windowOf(read.positives), g = E.groups(read, win);
  const statuses = { statuses: ['Confirmed'] };
  const current = E.ringSites(E.targets(read.positives, statuses, win), AGREED_RULES.rings, 'mi');
  const past = E.ringSites(g.past, AGREED_RULES.rings, 'mi');
  const zone = Z.readGeoJson(RULES_FILES['em_rules_zone_two.geojson'], 'em_rules_zone_two.geojson');
  const out = E.zonesGeoJson({ rings: [{ sites: current, group: 'Current' }, { sites: past, group: 'Past' }],
    zones: E.zoneSites(zone.zones) }, { rings: AGREED_RULES.rings, unit: 'mi', asOf: win.end,
    positives: g.current.concat(g.past) });
  return JSON.stringify(out) + '\n';
}
// One CSV line split at commas outside quotes (enough for the files written here).
function parseLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q && c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
    else if (c === '"') q = !q;
    else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
RULES_FILES['em_rules_zones_out.geojson'] = agreedGeoJson();
// The Emergency sample's positives, as the page holds them (site/emergency/sample.js), for the CVI movement case.
const sampleBox = { TextEncoder, TextDecoder };
sampleBox.window = sampleBox;
require('vm').createContext(sampleBox);
require('vm').runInContext(fs.readFileSync(path.join(ROOT, 'site', 'emergency', 'sample.js'), 'utf8'), sampleBox);
RULES_FILES['em_sample_positives.csv'] = new TextDecoder().decode(sampleBox.WSDA.samples.emergency.entries()
  .find(e => e.name === 'emergency_case_sites.csv').data);
const RULES = {
  positives: 'em_rules_positives.csv',
  // The CVI movements: the sample's positives with zones by default (not closed), HPAI's rings as the bands, the
  // master em_cvi_master.csv, every endpoint, no filter; run by CVI's run_proximity_query in R.
  cvi: { positives: 'em_sample_positives.csv', master: 'em_cvi_master.csv', bands: [3, 10] },
  rings: RINGS,
  layers: LAYERS.map(l => ({ key: l.key, label: l.label, file: 'em_rules_' + l.key + '.csv' })),
  zoneFiles: ['em_zone_hole.geojson', 'em_zone.geojson'],
  speed: speedSet(),
  agreed: AGREED_RULES
};

// ---- A CVI master for the sample's positives ------------------------------------------------------------------
// Endpoints placed with the engine's destination() from the sample's positives (site/emergency/sample.js).
const SAMPLE_POS = { yakima1: [46.5520, -120.4700], franklin: [46.4000, -119.0500], whatcom: [48.9000, -122.4500] };
const from = (key, km, bearing) => {
  const [lon, lat] = PX.destination(SAMPLE_POS[key][0], SAMPLE_POS[key][1], km, bearing);
  return [lat.toFixed(5), lon.toFixed(5)];
};
const MASTER_HEAD = ['CVI', 'Species.Group', 'Species', 'Reporting.Year', 'Reporting.Quarter', 'Movement', 'Total.Animals',
  'Origin.State', 'Origin.County', 'Origin.County.Lat', 'Origin.County.Long', 'Dest.State', 'Dest.County',
  'Dest.County.Lat', 'Dest.County.Long', 'Origin.City', 'Origin.Lat', 'Origin.Long', 'Dest.City', 'Dest.Lat', 'Dest.Long',
  'Origin.Address'];
const mrow = (cvi, group, species, year, q, movement, n, o, oc, d, dc, k) => [cvi, group, species, year, q, movement, n,
  o[0], oc, '46.5', '-120.5', d[0], dc, '46.4', '-119.0', 'Synthetic Town', o[1][0], o[1][1], 'Synthetic Town', d[1][0], d[1][1],
  address(60 + k)];
FILES['em_cvi_master.csv'] = csv([MASTER_HEAD,
  mrow('EM-0001', 'Poultry', 'Chickens', '2026', 'Q3', 'Outbound', '1200', ['WA', from('yakima1', 2, 45)], 'Yakima', ['OR', ['45.5', '-122.6']], 'Multnomah', 1),
  mrow('EM-0002', 'Cattle', 'Dairy cows', '2026', 'Q3', 'Inbound', '40', ['ID', ['43.6', '-116.2']], 'Ada', ['WA', from('franklin', 6, 200)], 'Franklin', 2),
  mrow('EM-0003', 'Cattle', 'Dairy cows', '2025', 'Q4', 'intrastate', '25', ['WA', from('whatcom', 1.5, 90)], 'Whatcom', ['WA', from('franklin', 4, 0)], 'Franklin', 3),
  mrow('EM-0004', 'Poultry', 'Turkeys', '2025', 'Q2', 'Outbound', '300', ['WA', ['47.6', '-117.4']], 'Spokane', ['MT', ['46.6', '-112.0']], 'Lewis and Clark', 4)
]);
// The sample's positives without Detection Date and Case Status.
FILES['em_positives_no_date.csv'] = csv([['AnimalDiseaseReportId', 'County', 'Lat', 'Long', 'Surveillance Closed'],
  ['SYN-HPAI-001', 'Yakima', '46.5520', '-120.4700', 'No'], ['SYN-HPAI-003', 'Franklin', '46.4000', '-119.0500', 'No']]);

// The folder bundle: what a bundle on the R drive with a control area could hold.
const BUNDLE = {
  'em_bundle/bundle.json': JSON.stringify({ profiles: ['emergency'], label: 'Emergency – synthetic test bundle',
    prepared: '2026-10-20', synthetic: true }, null, 2) + '\n',
  'em_bundle/emergency_case_sites.csv': FILES['em_positives_tool.csv'],
  'em_bundle/wa_state_feedlots.csv': csv([
    ['name', 'lat', 'long'],
    ['Synthetic Feedlot A', '46.4400', '-120.3000'],
    ['Synthetic Feedlot B', '46.9000', '-120.9000']
  ]),
  'em_bundle/zones.geojson': FILES['em_zone.geojson']
};

// ---- A synthetic New World screwworm outbreak ---------------------------------------------------------------
// Made up, for trying the switch between outbreaks before any real screwworm case: ten positives and one row
// without coordinates in the agreed 20 columns, spreading north from Klickitat County over ten weeks (Aug 5 to
// Oct 9, 2026: the play steps by week); two past (one released, one still under quarantine), one with Date Reported
// only, one without an inventory. The dispersal areas are invented shapes, not APHIS or WSDA areas; two Walla
// Walla positives lie outside both. The bundle adds feedlots, markets and fairs, and its bundle.json is marked
// synthetic, so the page's exports say so.
const nwsAddress = k => `MARKED-ADDRESS-${7900 + k} Example Road`;
const nwsRow = (k, reported, close, confirmed, release, county, lat, lon, status, subtype, kind, production, species,
  inventory) => [`SYN-NWS-${String(k).padStart(3, '0')}`, reported, close, confirmed, release,
  '(synthetic) ' + nwsAddress(2 * k - 1), '(synthetic) ' + nwsAddress(2 * k), 'Synthetic Town', county, lat, lon, status,
  subtype, kind, production, species, inventory, '', '', ''];
const NWS_WORM = 'New World screwworm (Cochliomyia hominivorax)';
const NWS_POSITIVES = csv([AGREED_HEAD,
  nwsRow(1, '8/3/2026', '9/16/2026', '8/5/2026', '10/1/2026', 'Klickitat', '45.8210', '-120.8230', 'Closed', NWS_WORM,
    'Commercial', 'Cow-calf', 'Cattle', '320'),
  nwsRow(2, '8/10/2026', '9/23/2026', '8/12/2026', '', 'Klickitat', '45.7480', '-120.6900', 'Closed', NWS_WORM,
    'Backyard', 'Equine', 'Horse', '4'),
  nwsRow(3, '8/24/2026', '', '8/26/2026', '', 'Klickitat', '45.8650', '-120.5200', 'Active', NWS_WORM,
    'Commercial', 'Cow-calf', 'Cattle', '"1,150"'),
  nwsRow(4, '9/1/2026', '', '9/2/2026', '', 'Benton', '46.2050', '-119.7700', 'Active', NWS_WORM,
    'Backyard', 'Companion animal', 'Dog', '2'),
  nwsRow(5, '9/7/2026', '', '9/9/2026', '', 'Benton', '46.2600', '-119.4800', 'Active', NWS_WORM,
    'Commercial', 'Feedlot', 'Cattle', '"6,800"'),
  nwsRow(6, '9/14/2026', '', '9/16/2026', '', 'Yakima', '46.3800', '-120.3100', 'Active', NWS_WORM,
    'Backyard', 'Meat goat', 'Goat', '18'),
  nwsRow(7, '9/21/2026', '', '9/23/2026', '', 'Yakima', '46.2400', '-120.0100', 'Active', NWS_WORM,
    'Commercial', 'Dairy', 'Cattle', '"2,300"'),
  nwsRow(8, '9/28/2026', '', '9/30/2026', '', 'Walla Walla', '46.0700', '-118.3400', 'Active', NWS_WORM,
    'Backyard', 'Sheep', 'Sheep', '25'),
  nwsRow(9, '10/2/2026', '', '', '', 'Benton', '46.1200', '-119.1500', 'Active', NWS_WORM,
    'Backyard', 'Equine', 'Horse', ''),
  nwsRow(10, '10/7/2026', '', '10/9/2026', '', 'Walla Walla', '46.0400', '-118.6500', 'Active', NWS_WORM,
    'Commercial', 'Cow-calf', 'Cattle', '540'),
  nwsRow(11, '10/5/2026', '', '10/8/2026', '', 'Yakima', '', '', 'Active', NWS_WORM,
    'Backyard', 'Equine', 'Horse', '3')
]);
const NWS_ZONES = JSON.stringify({ type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { name: 'Synthetic dispersal area: Klickitat (made up)' },
    geometry: { type: 'Polygon', coordinates: [[[-121.05, 45.66], [-120.40, 45.64], [-120.33, 45.80], [-120.42, 45.97],
      [-120.80, 45.99], [-121.08, 45.86], [-121.05, 45.66]]] } },
  { type: 'Feature', properties: { name: 'Synthetic dispersal area: Yakima and Tri-Cities (made up)' },
    geometry: { type: 'Polygon', coordinates: [[[-120.45, 46.05], [-119.60, 46.00], [-118.95, 46.06], [-118.97, 46.33],
      [-119.55, 46.48], [-120.40, 46.47], [-120.45, 46.05]]] } }
] }) + '\n';
const NWS_FILES = {
  'bundle.json': JSON.stringify({ profiles: ['emergency'], label: 'New World screwworm – synthetic outbreak',
    prepared: '2026-10-22', synthetic: true }, null, 2) + '\n',
  'nws_case_sites_synthetic.csv': NWS_POSITIVES,
  'nws_dispersal_area_synthetic.geojson': NWS_ZONES,
  'wa_state_feedlots.csv': csv([
    ['name', 'lat', 'long', 'Operation.Type'],
    ['Synthetic Feedlot NWS 1', '46.2500', '-119.6000', 'Cattle'],
    ['Synthetic Feedlot NWS 2', '45.9000', '-120.7000', 'Cattle'],
    ['Synthetic Feedlot NWS 3', '46.6000', '-118.9000', 'Cattle']
  ]),
  'wa_state_public_livestock_markets.csv': csv([
    ['name', 'lat', 'long', 'Species'],
    ['Synthetic Toppenish Market', '46.3700', '-120.3100', 'Cattle'],
    ['Synthetic Goldendale Market', '45.8200', '-120.8000', 'Cattle|Horses']
  ]),
  'wa_state_fairs.csv': csv([
    ['Fair.Name', 'lat', 'long', 'Season'],
    ['Synthetic Benton County Fair', '46.2100', '-119.2000', 'Summer'],
    ['Synthetic Klickitat Fair', '45.8300', '-120.8400', 'Summer'],
    ['Synthetic Walla Walla Fair', '46.0500', '-118.3500', 'Summer']
  ])
};
const NWS_SET = { 'em_nws_synthetic_positives.csv': NWS_POSITIVES,
  'em_nws_synthetic_dispersal_area.geojson': NWS_ZONES };
for (const [name, text] of Object.entries(NWS_FILES)) NWS_SET['em_nws_synthetic/' + name] = text;

// The Emergency sample ZIP itself, as the page's download button makes it, for trying the page by hand from
// test-tables/ (the shared ZIP writer, site/shared/sample.js); the screwworm outbreak's ZIP with the same writer.
function zipWriter() {
  if (!(sampleBox.WSDA && sampleBox.WSDA.sample)) {
    require('vm').runInContext(fs.readFileSync(path.join(ROOT, 'site', 'shared', 'zip.js'), 'utf8'), sampleBox);
    require('vm').runInContext(fs.readFileSync(path.join(ROOT, 'site', 'shared', 'sample.js'), 'utf8'), sampleBox);
  }
  return sampleBox.WSDA.sample;
}
function sampleZip() {
  return Buffer.from(zipWriter().zip(sampleBox.WSDA.samples.emergency.entries()));
}
function nwsZip() {
  return Buffer.from(zipWriter().zip(Object.entries(NWS_FILES).map(([name, text]) =>
    ({ name, data: new TextEncoder().encode(text) }))));
}

function write() {
  const all = Object.assign({}, FILES, BUNDLE, RULES_FILES, NWS_SET);
  fs.mkdirSync(TABLES, { recursive: true });
  fs.writeFileSync(path.join(TABLES, 'emergency_synthetic.zip'), sampleZip());
  fs.writeFileSync(path.join(TABLES, 'em_nws_synthetic.zip'), nwsZip());
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'rules.json'), JSON.stringify(RULES) + '\n');
  for (const [name, text] of Object.entries(all)) {
    for (const dir of [OUT, TABLES]) {
      const file = path.join(dir, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
  }
  return Object.keys(all).length;
}

module.exports = { FILES, BUNDLE, RULES_FILES, RULES, OUT, address, AGREED_HEAD, NWS_FILES, NWS_SET };

if (require.main === module) {
  const n = write();
  console.log(`Emergency fixtures: ${n} files in ${path.relative(ROOT, OUT)}/ and test-tables/, and rules.json`);
}
