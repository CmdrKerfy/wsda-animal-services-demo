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
  speed: speedSet()
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

// The Emergency sample ZIP itself, as the page's download button makes it, for trying the page by hand from
// test-tables/ (the shared ZIP writer, site/shared/sample.js).
function sampleZip() {
  require('vm').runInContext(fs.readFileSync(path.join(ROOT, 'site', 'shared', 'zip.js'), 'utf8'), sampleBox);
  require('vm').runInContext(fs.readFileSync(path.join(ROOT, 'site', 'shared', 'sample.js'), 'utf8'), sampleBox);
  return Buffer.from(sampleBox.WSDA.sample.zip(sampleBox.WSDA.samples.emergency.entries()));
}

function write() {
  const all = Object.assign({}, FILES, BUNDLE, RULES_FILES);
  fs.mkdirSync(TABLES, { recursive: true });
  fs.writeFileSync(path.join(TABLES, 'emergency_synthetic.zip'), sampleZip());
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

module.exports = { FILES, BUNDLE, RULES_FILES, RULES, OUT, address };

if (require.main === module) {
  const n = write();
  console.log(`Emergency fixtures: ${n} files in ${path.relative(ROOT, OUT)}/ and test-tables/, and rules.json`);
}
