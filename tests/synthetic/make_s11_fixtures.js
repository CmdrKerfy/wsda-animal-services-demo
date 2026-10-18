#!/usr/bin/env node
'use strict';
// S11 fixtures: the Premise Lookup scenarios that the R reference
// (tests/oracle/s11_proximity_oracle.R, CVI's run_proximity_query) and the Node suite
// (tests/node/run_s11_unit_tests.js) both run. Every value is synthetic.
//
// Masters: the F1 Full tier (premises coordinates), the Partner tier's county totals (no premises coordinates, so CVI's
// engine stops with "missing coordinate columns"), and three made here from the Full tier:
//   s11_no_cvi.csv       the Full tier without its CVI column (CVI's engine then numbers the movement records);
//   s11_bad_coords.csv   the Full tier with coordinates CVI cannot check: latitude and longitude swapped, a latitude
//                        of 95, a longitude of -200, blanks; on the origin, the destination or both;
//   s11_dup_rows.csv     the Full tier with some rows repeated exactly (CVI's intrastate collapse keys on every
//                        column but Movement, so a repeated within-state row counts its animals once).
// The bad values stay numeric, so CVI's file reader keeps the coordinate columns as numbers.
//
// Sites come from the Full tier's own premises (a site on a premises point, one 2 km from one, one in Oregon), plus a
// point on a county line (the county-outline vertex in site/geo/wa-counties.js nearest a premises), one at sea, a
// grid over the state and bad rows. Each scenario names its master, sites, buffer style (single or bands), default
// buffer, endpoint and filters, as CVI's Premise Lookup tab passes them to run_proximity_query.
// Deterministic: no clock, no random numbers.
//
// Also the tab's own steps, which the R reference runs through CVI's module (shiny::testServer): pasted rows, CSV
// files to upload (written to fixtures/uploads/), sites added one by one, cell edits, band radii, and Run query cases
// with the tab's inputs (scenarios.json "module"). It also writes a few files into test-tables/, the folder of
// synthetic tables handy for trying the pages by hand (s11_sites.csv, s11_sites_no_long.csv, s11_paste.txt,
// s11_no_cvi_master.csv, s11_zones.geojson, .kml, _shp.zip and .kmz, s11_facility_sites.txt, s11_geocode_cache.csv and
// s11_geocode_wrong_columns.csv), leaving the folder's other files alone.
// Also the branded PNG cases (scenarios.json "pngs") and the address lookups ("geocode": cache files in
// fixtures/geocode/ and the addresses typed).
//
// Usage (repository root, after node tests/node/run_f1_unit_tests.js, which writes the tiers):
//   node tests/synthetic/make_s11_fixtures.js
// Output (git-ignored): local-test-artifacts/s11/fixtures/ (the three masters, uploads/ and scenarios.json) and the
// test-tables/ files above.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 's11', 'fixtures');
const FULL = 'local-test-artifacts/f1/tiers/full/CVI_Consolidated_Master.csv';
const PARTNER = 'local-test-artifacts/f1/tiers/partner/partner_county_totals.csv';
const rel = f => path.relative(ROOT, path.join(OUT, f));

// The site's CSV reader and county outlines (read only).
const sandbox = { window: {}, TextEncoder, TextDecoder };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'site', 'cvi', 'app', 'csv.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'site', 'geo', 'wa-counties.js'), 'utf8'), sandbox);
const CSV = sandbox.window.CVIWA.csv;

if (!fs.existsSync(path.join(ROOT, FULL))) {
  throw new Error('The Full tier is missing: run node tests/node/run_f1_unit_tests.js first.');
}
const full = CSV.parse(fs.readFileSync(path.join(ROOT, FULL), 'utf8'));
const H = full.header;
const col = name => H.indexOf(name);

// ── Writing a master ───────────────────────────────────────────────────────────────────────────────────────────
// A cell is quoted when it holds a comma, a quote or a line break; a missing value is written empty.
const cell = v => (v === null ? '' : /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
function writeMaster(file, header, rows) {
  const text = [header].concat(rows).map(r => r.map(cell).join(',')).join('\n') + '\n';
  fs.writeFileSync(path.join(OUT, file), text);
  return rel(file);
}

// ── Sites from the Full tier's premises ────────────────────────────────────────────────────────────────────────
const num = v => (v === null ? null : Number(v));
const rowsOf = (state, side) => full.rows.filter(r => r[col(side + '.State')] === state &&
  r[col(side + '.Lat')] !== null && r[col(side + '.Long')] !== null);
const pointOf = (r, side) => [num(r[col(side + '.Lat')]), num(r[col(side + '.Long')])];
const waOrigin = pointOf(rowsOf('WA', 'Origin')[0], 'Origin');
const waDest = pointOf(rowsOf('WA', 'Dest')[7], 'Dest');
const orOrigin = pointOf(rowsOf('OR', 'Origin')[0], 'Origin');
// 2 km due north of a destination premises (1 degree of latitude is about 111.2 km on CVI's sphere).
const KM_PER_DEG = 6378.137 * Math.PI / 180;
const round6 = x => Math.round(x * 1e6) / 1e6;
const north2 = [round6(waDest[0] + 2 / KM_PER_DEG), waDest[1]];
// A point on a county line: the vertex of a county outline nearest one Washington origin premises (the 41st), so
// the buffer around it holds premises on both sides of the line.
const target = pointOf(rowsOf('WA', 'Origin')[40], 'Origin');
let countyLine = null, best = Infinity;
for (const f of sandbox.window.CVIWA_GEO.counties.features) {
  const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const ring of polygons.map(p => p[0])) {
    for (const v of ring) {
      const d = Math.hypot(v[1] - target[0], (v[0] - target[1]) * Math.cos(target[0] * Math.PI / 180));
      if (d < best) { best = d; countyLine = [v[1], v[0]]; }
    }
  }
}

const site = (name, p, extra) => Object.assign({ name, lat: p[0], long: p[1] }, extra || {});
const A = site('Farm A (on a premises)', waOrigin);
const B = site('Farm B (2 km from a premises)', north2);
const C = site('Yakima Valley', [46.6, -120.5]);
const OOS = site('Oregon premises', orOrigin);
const LINE = site('On a county line', countyLine);
const SEA = site('Offshore', [47.0, -126.0]);
// A grid of 60 sites over Washington (10 across, 6 down).
const GRID = [];
for (let i = 0; i < 6; i++) {
  for (let j = 0; j < 10; j++) {
    GRID.push(site('Grid ' + (i * 10 + j + 1), [round6(45.7 + i * 0.6), round6(-124.4 + j * 0.85)]));
  }
}

// ── The derived masters ────────────────────────────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT, { recursive: true });
const noCvi = writeMaster('s11_no_cvi.csv', H.filter(h => h !== 'CVI'),
  full.rows.map(r => r.filter((v, k) => H[k] !== 'CVI')));

// Bad coordinates, one kind per row in turn, on rows spread through the table.
const BAD = [
  ['Origin swapped', r => {
    const a = r[col('Origin.Lat')]; r[col('Origin.Lat')] = r[col('Origin.Long')]; r[col('Origin.Long')] = a;
  }],
  ['Dest latitude 95', r => { r[col('Dest.Lat')] = '95'; }],
  ['Origin longitude -200', r => { r[col('Origin.Long')] = '-200'; }],
  ['Dest longitude blank', r => { r[col('Dest.Long')] = null; }],
  ['both blank', r => { r[col('Origin.Lat')] = null; r[col('Dest.Lat')] = null; }],
  ['both swapped', r => {
    let a = r[col('Origin.Lat')]; r[col('Origin.Lat')] = r[col('Origin.Long')]; r[col('Origin.Long')] = a;
    a = r[col('Dest.Lat')]; r[col('Dest.Lat')] = r[col('Dest.Long')]; r[col('Dest.Long')] = a;
  }]];
const badRows = full.rows.map(r => r.slice());
const badLog = [];
for (let k = 0, i = 3; i < badRows.length; i += 37, k++) {
  const [kind, change] = BAD[k % BAD.length];
  change(badRows[i]);
  badLog.push({ row: i + 1, kind });
}
const badCoords = writeMaster('s11_bad_coords.csv', H, badRows);

// Exact repeats: three within-state rows and two interstate rows, each written twice in a row.
const intra = full.rows.map((r, i) => i).filter(i => /intrastate/i.test(full.rows[i][col('Movement')])).slice(0, 3);
const inter = full.rows.map((r, i) => i).filter(i => !/intrastate/i.test(full.rows[i][col('Movement')])).slice(0, 2);
const repeat = new Set(intra.concat(inter));
const dupRows = [];
full.rows.forEach((r, i) => {
  dupRows.push(r);
  if (repeat.has(i)) dupRows.push(r.slice());
});
const dup = writeMaster('s11_dup_rows.csv', H, dupRows);

// ── The scenarios ──────────────────────────────────────────────────────────────────────────────────────────────
// mode 'single': CVI's Single buffer (per-site buffer_km; any per-site band list is dropped, as the module does);
// mode 'bands': CVI's Concentric bands (the global radii, validated by the module; per-site band lists override).
// filters: year (integers), quarter, species, as the Premise Lookup tab's filters.
const scenario = (name, o) => Object.assign({ name, master: FULL, mode: 'single', default_buffer_km: 3,
  endpoint: 'either', filters: { year: [], quarter: [], species: [] }, bands: null }, o);
const groups = [...new Set(full.rows.map(r => r[col('Species.Group')]).filter(g => g !== null))].sort();
const SCENARIOS = [
  scenario('single_either_3km', { sites: [A, B, C] }),
  scenario('single_origin_10km', { sites: [A, B, C, OOS], default_buffer_km: 10, endpoint: 'origin' }),
  scenario('single_dest_20km', { sites: [A, B, C, OOS], default_buffer_km: 20, endpoint: 'dest' }),
  scenario('single_overrides', { default_buffer_km: 10, sites: [
    Object.assign({}, A, { buffer_km: 0 }), Object.assign({}, B, { buffer_km: -5 }),
    Object.assign({}, C, { buffer_km: 40 }), Object.assign({}, OOS, { buffer_km: 7.5 })] }),
  // A per-site band list in Single mode is dropped (the module strips it), so B uses its buffer.
  scenario('single_ignores_site_bands', { default_buffer_km: 5, sites: [
    Object.assign({}, A, { bands_csv: '1, 2' }), Object.assign({}, B, { buffer_km: 12, bands_csv: '3,4' })] }),
  scenario('bands_global', { mode: 'bands', bands: [3, 10, 20], sites: [A, B, C] }),
  scenario('bands_site_override', { mode: 'bands', bands: [5, 10, 20], sites: [
    Object.assign({}, A, { bands_csv: '1, 5' }), Object.assign({}, B, { bands_csv: '2;4 8' }), C,
    Object.assign({}, OOS, { bands_csv: 'x, -3' })] }),
  scenario('bands_with_buffers_ignored', { mode: 'bands', bands: [5, 15], sites: [
    Object.assign({}, A, { buffer_km: 50 }), Object.assign({}, C, { buffer_km: 1 })] }),
  scenario('filters', { default_buffer_km: 40, sites: [A, B, C, LINE],
    filters: { year: [2025], quarter: ['Q1', 'Q2'], species: [groups[0]] } }),
  scenario('filters_two_species', { default_buffer_km: 60, endpoint: 'origin', sites: [A, C, OOS],
    filters: { year: [2024, 2025], quarter: [], species: groups.slice(0, 2) } }),
  scenario('bad_sites', { default_buffer_km: 10, sites: [A, { name: 'Latitude 95', lat: 95, long: -120 },
    { name: 'Longitude -200', lat: 47, long: -200 }, { name: 'No latitude', lat: null, long: -120 },
    { name: 'Text latitude', lat: 'abc', long: -120 }, Object.assign({}, B, { buffer_km: 'x' })] }),
  scenario('county_line', { default_buffer_km: 15, sites: [LINE, C] }),
  scenario('no_match', { sites: [SEA] }),
  scenario('empty_sites', { sites: [{ name: 'Latitude 95', lat: 95, long: -120 },
    { name: 'No longitude', lat: 47, long: null }] }),
  scenario('no_filter_match', { sites: [A], filters: { year: [1990], quarter: [], species: [] } }),
  scenario('no_cvi_column', { master: noCvi, default_buffer_km: 20, sites: [A, B, C] }),
  scenario('bad_coords_either', { master: badCoords, default_buffer_km: 60, sites: [A, C, OOS] }),
  scenario('bad_coords_origin', { master: badCoords, default_buffer_km: 60, endpoint: 'origin', sites: [A, C, OOS] }),
  scenario('bad_coords_dest', { master: badCoords, default_buffer_km: 60, endpoint: 'dest', sites: [A, C, OOS] }),
  scenario('dup_rows', { master: dup, default_buffer_km: 400, sites: [C] }),
  scenario('missing_coord_cols', { master: PARTNER, sites: [A] }),
  scenario('grid_60_sites', { default_buffer_km: 25, sites: GRID }),
  scenario('grid_60_bands', { mode: 'bands', bands: [5, 10, 20], sites: GRID, filters: { year: [], quarter: [],
    species: groups.slice(1, 3) } })
];
// ── The tab's own steps (CVI's mod_premise_lookup.R, run by the R reference through shiny::testServer) ──────────
// pastes: the "Paste rows" box (CVI's bulk_apply); uploads: files for "Upload CSV" (upload_csv); adds: "Add a site"
// one after another (site_add); edits: cell edits on a sites table, in Single and Bands mode (sites_table_cell_edit);
// bands: the global "Band radii" box (.validate_band_radii); runs: "Run query" (run_query) with the tab's inputs.
const UP = path.join(OUT, 'uploads');
fs.mkdirSync(UP, { recursive: true });
const upload = (name, text) => {
  fs.writeFileSync(path.join(UP, name + '.csv'), text);
  return { name, file: rel(path.join('uploads', name + '.csv')) };
};
const line = (s, extra) => [s.name, s.lat, s.long].concat(extra || []).join(', ');
const PASTES = [
  { name: 'empty', text: '' },
  { name: 'blank lines', text: '  \n\t\n' },
  { name: 'three sites', text: [line(A), line(B, [10]), line(C, [1, 3, 5])].join('\n') },
  { name: 'tabs and CRLF', text: 'Tab farm\t46.9\t-120.1\t7\r\nNext farm,47.1,-119.9\r\n' },
  { name: 'bad and short lines', text: ['Farm X, abc, -120', 'only two, 47', 'Farm Y, 47.2, -120.3',
    'Trailing comma, 47,', 'Empty long, 47.3, ', 'NaN lat, NaN, -120'].join('\n') },
  { name: 'odd values', text: [', 47.4, -120.4', 'Buffer text, 47.5, -120.5, abc', 'Inf lat, Inf, -120',
    'Spaces,   47.6 ,  -120.6  ,  2.5  ', 'Empty extras, 47.7, -120.7, , ,', 'Hex, 0x2F, -120'].join('\n') },
  { name: 'all bad', text: 'Farm Z, north, west\nFarm W, , ' }
];
const UPLOADS = [
  upload('good', 'name,lat,long,buffer_km\n"Farm A",' + A.lat + ',' + A.long + ',3\n"Farm, with comma",' + B.lat + ',' +
    B.long + ',\nYakima Valley,46.6,-120.5,NA\n'),
  upload('upper case and lng', 'Name,LAT,Lng,Buffer\nOne,47.1,-120.2,5\nTwo,47.2,-120.3,\n'),
  upload('long before lon', 'name,lat,lon,long\nOne,47.1,-1,-120.2\n'),
  upload('buffer before buffer_km', 'name,lat,long,buffer,buffer_km\nOne,47.1,-120.2,9,4\n'),
  upload('no long', 'name,lat,longitude\nOne,47.1,-120.2\n'),
  upload('header only', 'name,lat,long\n'),
  upload('empty', ''),
  upload('no valid rows', 'name,lat,long\nOne,abc,-120\nTwo,,-120.1\n'),
  upload('text in a number column', 'name,lat,long,buffer_km\nOne,47.1,-120.2,x\nTwo,north,-120.3,2\n' +
    'Three,47.3,-120.4,4\n'),
  upload('spaced and odd headers', 'name, lat,long,buffer km\nOne,47.1,-120.2,3\n'),
  upload('repeated name column', 'name,name,lat,long\nFirst,Second,47.1,-120.2\n'),
  upload('bom and crlf', '\ufeffname,lat,long\r\nBom farm,47.1,-120.2\r\n')
];
const ADDS = [
  { name: 'Named', lat: 47.1, long: -120.2, buffer: null },
  { name: '', lat: 47.2, long: -120.3, buffer: 7.5 },
  { name: '   ', lat: 47.25, long: -120.35, buffer: null },
  { name: 'No latitude', lat: null, long: -120.4, buffer: null },
  { name: 'Latitude 91', lat: 91, long: -120.4, buffer: null },
  { name: 'Longitude 181', lat: 47, long: 181, buffer: null },
  { name: 'Edge', lat: -90, long: 180, buffer: 0 }
];
const EDITS = [
  { mode: 'single', sites: [A, B], edits: [{ row: 1, col: 1, value: 'Renamed' }, { row: 2, col: 2, value: '46.75' },
    { row: 2, col: 3, value: 'west' }, { row: 1, col: 4, value: '12' }, { row: 1, col: 4, value: '' }] },
  { mode: 'bands', sites: [A, C], edits: [{ row: 2, col: 4, value: '2, 4' }, { row: 1, col: 4, value: '' },
    { row: 1, col: 2, value: ' 47.0 ' }] }
];
const BANDS = ['3, 10, 20', '20, 3, 10', '5;10 20', '', '  ', '3, x', '3, -1', '3, 0', '3, 3', '1, 2, 3, 4', '2.5',
  '10,5', 'Inf', ' 3 ,  10 '];
const allYears = [...new Set(full.rows.map(r => r[col('Reporting.Year')]).filter(y => y !== null))].sort();
const RUN = (name, o) => Object.assign({ name, master: FULL, mode: 'single', default_buffer_km: 3,
  band_radii: '3, 10, 20', endpoint: 'either', years: allYears, quarters: ['Q1', 'Q2', 'Q3', 'Q4'],
  species: groups }, o);
const RUNS = [
  RUN('no sites', { sites: [] }),
  RUN('sites without coordinates', { sites: [{ name: 'Blank', lat: null, long: null }] }),
  RUN('single, three sites', { sites: [A, B, C] }),
  RUN('single, pasted bands left out', { sites: [Object.assign({}, A, { bands_csv: '1,2' }), C] }),
  RUN('bands, global', { mode: 'bands', sites: [A, C] }),
  RUN('bands, sorted', { mode: 'bands', band_radii: '20, 3, 10', sites: [A, C] }),
  RUN('bands, not numbers', { mode: 'bands', band_radii: '3, x', sites: [A] }),
  RUN('bands, four radii', { mode: 'bands', band_radii: '1, 2, 3, 4', sites: [A] }),
  RUN('bands, site override', { mode: 'bands', sites: [Object.assign({}, A, { bands_csv: '1, 2' }), C] }),
  RUN('origin endpoint, filters', { endpoint: 'origin', default_buffer_km: 40, years: allYears.slice(-1),
    quarters: ['Q1', 'Q2'], species: groups.slice(0, 1), sites: [A, C] }),
  RUN('nothing ticked means all', { years: [], quarters: [], species: [], sites: [A, C] }),
  RUN('skipped sites', { sites: [A, { name: 'Latitude 95', lat: 95, long: -120 }] }),
  RUN('only out-of-range sites', { sites: [{ name: 'Latitude 95', lat: 95, long: -120 }] }),
  RUN('no CVI column', { master: noCvi, default_buffer_km: 20, sites: [A, B, C] }),
  RUN('no filter match', { years: [1990], sites: [A] }),
  RUN('no match', { sites: [SEA] }),
  RUN('bad coordinates', { master: badCoords, default_buffer_km: 60, sites: [A, C] }),
  RUN('repeated rows', { master: dup, default_buffer_km: 400, sites: [C] }),
  RUN('missing coordinate columns', { master: PARTNER, sites: [A] }),
  RUN('empty default buffer', { default_buffer_km: null, sites: [A, Object.assign({}, C, { buffer_km: 40 })] }),
  RUN('more than 200 sites', { default_buffer_km: 2, sites: GRID.concat(GRID, GRID, GRID).map((g, i) =>
    Object.assign({}, g, { name: 'Site ' + (i + 1) })).slice(0, 201) })
];
const MODULE = { pastes: PASTES, uploads: UPLOADS, adds: ADDS, edits: EDITS, bands: BANDS, runs: RUNS };

// ── The branded proximity PNG ─────────────────────────────────────────────────────────────────────────────────────
// Run query cases (as RUNS) after which the R reference presses CVI's "Download branded PNG" (its downloadHandler,
// through testServer) with the module's "Branded map options": basemap ('flat', CVI's "Flat WSDA", or
// 'vector:streets'), facility layers (CVI's registry keys) and "Show facility labels". The facility sites sit on the
// Full tier's synthetic facilities (its facility files, copied into the reference's sandbox under CVI's names).
const FEEDLOT1 = site('Feedlot site', [46.5643, -118.3283]);
const MARKET1 = site('Market site', [46.4738, -119.3719]);
const PLANT3 = site('Plant site', [47.5211, -119.7018]);
const LONG_NAME = 'Synthetic dairy with a very long premises name for the panel';
const PNG = (name, run, o) => Object.assign({ name, run, basemap: 'flat', overlays: [], labels: false }, o || {});
const PNGS = [
  PNG('single, three sites', RUN('single, three sites', { sites: [A, B, C] })),
  PNG('single, own buffer', RUN('single, own buffer', { default_buffer_km: 10,
    sites: [A, Object.assign({}, C, { buffer_km: 25 })] })),
  PNG('bands, global', RUN('bands, global', { mode: 'bands', sites: [A, C] })),
  PNG('bands, site override', RUN('bands, site override', { mode: 'bands',
    sites: [Object.assign({}, A, { bands_csv: '1, 2' }), C] })),
  // Different bands per site whose radii are those drawn: CVI's "Inner / Middle / Outer zone" rows match the rings.
  PNG('bands, nested site bands', RUN('bands, nested site bands', { mode: 'bands',
    sites: [Object.assign({}, A, { bands_csv: '3, 10' }), C] })),
  PNG('origin endpoint, filters', RUN('origin endpoint, filters', { endpoint: 'origin', default_buffer_km: 40,
    years: allYears.slice(-1), quarters: ['Q1', 'Q2'], species: groups.slice(0, 1), sites: [A, C] })),
  PNG('destination endpoint', RUN('destination endpoint', { endpoint: 'dest', default_buffer_km: 20, sites: [A, B, C] })),
  PNG('nothing ticked means all', RUN('nothing ticked means all', { years: [], quarters: [], species: [],
    sites: [A, C] })),
  PNG('no match', RUN('no match', { sites: [SEA] })),
  PNG('fourteen sites, long names', RUN('fourteen sites, long names', { default_buffer_km: 5,
    sites: GRID.slice(20, 34).map((g, i) => Object.assign({}, g, { name: i === 0 ? LONG_NAME : g.name })) })),
  PNG('facilities and labels', RUN('facilities and labels', { default_buffer_km: 20,
    sites: [FEEDLOT1, MARKET1, PLANT3] }), { overlays: ['slaughterhouses', 'fairgrounds', 'markets', 'feedlots',
    'restricted'], labels: true }),
  PNG('streets', RUN('streets', { sites: [A, C] }), { basemap: 'vector:streets' })
];

// ── Zone files ─────────────────────────────────────────────────────────────────────────────────────────────────
// Four zones near the Full tier's premises, written as GeoJSON, KML and zipped shapefiles (WGS 84 and NAD 83), and
// files the page must refuse. The R reference reads the same files with sf and tests the points below with GEOS,
// independently of the page's reader (site/shared/zones.js) and its polygon test (proximity.js inZone).
//   A "Control area A": a U shape whose left arm holds an origin premises (its centroid lies in the notch, outside);
//   B "Two pastures": two parts, a square around a destination premises and a triangle around another;
//   C "Ring with a hole": a square whose hole is centered on an origin premises (so that premises is outside);
//   D: a small triangle with no name ("Zone 4" on the page).
// In the GeoJSON, A's outline runs clockwise and C's as RFC 7946 says (outline counterclockwise, hole clockwise),
// so the winding cannot matter there; the shapefiles follow their own rule (outlines clockwise, holes
// counterclockwise).
const ZDIR = path.join(OUT, 'zones');
fs.mkdirSync(ZDIR, { recursive: true });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'site', 'shared', 'zip.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'site', 'shared', 'sample.js'), 'utf8'), sandbox);
const ZIP = sandbox.window.WSDA.sample.zip;
const r6 = x => Math.round(x * 1e6) / 1e6;
const shift = (pts, x0, y0) => pts.map(([x, y]) => [r6(x0 + x), r6(y0 + y)]);
const closed = ring => ring.concat([ring[0]]);
const ccw = ring => {   // the ring counterclockwise (y up), closed; the shoelace sum below is positive when it is
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return closed(a > 0 ? ring : ring.slice().reverse());
};
const cw = ring => ccw(ring).reverse();
const oA = pointOf(rowsOf('WA', 'Origin')[0], 'Origin');
const dB1 = pointOf(rowsOf('WA', 'Dest')[7], 'Dest');
const dB2 = pointOf(rowsOf('WA', 'Dest')[20], 'Dest');
const oC = pointOf(rowsOf('WA', 'Origin')[10], 'Origin');
const oD = pointOf(rowsOf('WA', 'Origin')[30], 'Origin');
const U = [[0, 0], [0.09, 0], [0.09, 0.06], [0.06, 0.06], [0.06, 0.02], [0.03, 0.02], [0.03, 0.06], [0, 0.06]];
const ZONES = [
  { name: 'Control area A', key: 'NAME', polygons: [[shift(U, oA[1] - 0.015, oA[0] - 0.04)]] },
  { name: 'Two pastures', key: 'Name', polygons: [
    [shift([[-0.02, -0.02], [0.02, -0.02], [0.02, 0.02], [-0.02, 0.02]], dB1[1], dB1[0])],
    [shift([[-0.03, -0.02], [0.03, -0.02], [0, 0.03]], dB2[1], dB2[0])]] },
  { name: 'Ring with a hole', key: 'zone_name', polygons: [[
    shift([[-0.06, -0.06], [0.06, -0.06], [0.06, 0.06], [-0.06, 0.06]], oC[1], oC[0]),
    shift([[-0.015, -0.015], [0.015, -0.015], [0.015, 0.015], [-0.015, 0.015]], oC[1], oC[0])]] },
  { name: null, key: null, polygons: [[shift([[-0.01, -0.008], [0.012, -0.006], [0.001, 0.011]], oD[1], oD[0])]] }
];
// GeoJSON: A clockwise, the others as RFC 7946; a point, a line and a feature without a shape are left out (3).
const gjPolygon = (z, outline, hole) => z.polygons.map(p => [outline(p[0])].concat(p.slice(1).map(hole)));
const geo = (z, i) => {
  const rings = i === 0 ? gjPolygon(z, cw, cw) : gjPolygon(z, ccw, cw);
  return rings.length === 1 ? { type: 'Polygon', coordinates: rings[0] } : { type: 'MultiPolygon', coordinates: rings };
};
const props = z => (z.key ? { [z.key]: z.name, id: 7 } : { id: 9 });
const gj = { type: 'FeatureCollection', features: ZONES.map((z, i) => ({ type: 'Feature', properties: props(z), geometry: geo(z, i) }))
  .concat([
    { type: 'Feature', properties: { name: 'A well' }, geometry: { type: 'Point', coordinates: [oA[1], oA[0]] } },
    { type: 'Feature', properties: { name: 'A fence' }, geometry: { type: 'LineString', coordinates: [[oA[1], oA[0]], [oC[1], oC[0]]] } },
    { type: 'Feature', properties: { name: 'Nothing' }, geometry: null }]) };
fs.writeFileSync(path.join(ZDIR, 'zones.geojson'), JSON.stringify(gj, null, 1) + '\n');
// KML: the same zones; B as a MultiGeometry, C with an inner boundary; a point placemark left out.
const kmlRing = ring => '<LinearRing><coordinates>' + ring.map(p => p[0] + ',' + p[1] + ',0').join(' ') +
  '</coordinates></LinearRing>';
const kmlPolygon = p => '<Polygon><outerBoundaryIs>' + kmlRing(ccw(p[0])) + '</outerBoundaryIs>' +
  p.slice(1).map(h => '<innerBoundaryIs>' + kmlRing(cw(h)) + '</innerBoundaryIs>').join('') + '</Polygon>';
const kml = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>\n' +
  ZONES.map(z => '<Placemark>' + (z.name ? '<name>' + z.name + '</name>' : '') +
    (z.polygons.length > 1 ? '<MultiGeometry>' + z.polygons.map(kmlPolygon).join('') + '</MultiGeometry>'
      : kmlPolygon(z.polygons[0])) + '</Placemark>\n').join('') +
  '<Placemark><name>A well</name><Point><coordinates>' + oA[1] + ',' + oA[0] + ',0</coordinates></Point></Placemark>\n' +
  '</Document></kml>\n';
fs.writeFileSync(path.join(ZDIR, 'zones.kml'), kml);
fs.writeFileSync(path.join(ZDIR, 'broken.kml'), kml.slice(0, kml.indexOf('</Placemark>') + 4));
fs.writeFileSync(path.join(ZDIR, 'broken.geojson'), JSON.stringify(gj).slice(0, 300));
fs.writeFileSync(path.join(ZDIR, 'points_only.geojson'), JSON.stringify({ type: 'FeatureCollection',
  features: gj.features.slice(4, 6) }) + '\n');
fs.writeFileSync(path.join(ZDIR, 'zones_epsg2927.geojson'), JSON.stringify(Object.assign({ crs: { type: 'name',
  properties: { name: 'urn:ogc:def:crs:EPSG::2927' } } }, gj)) + '\n');
fs.writeFileSync(path.join(ZDIR, 'zones_meters.geojson'), JSON.stringify({ type: 'Feature', properties: {},
  geometry: { type: 'Polygon', coordinates: [[[500000, 100000], [501000, 100000], [501000, 101000], [500000, 100000]]] } }) + '\n');
fs.writeFileSync(path.join(ZDIR, 'not_a_zone.txt'), 'name,lat,long\n');

// Shapefiles: .shp, .shx, .dbf (ID and NAME) and .prj, zipped as the page's own writer stores them. One record
// without a shape (type 0) is left out by the page.
const PRJ = {
  wgs84: 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],' +
    'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',
  nad83: 'GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,' +
    '298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',
  nad27: 'GEOGCS["GCS_North_American_1927",DATUM["D_North_American_1927",SPHEROID["Clarke_1866",6378206.4,' +
    '294.9786982]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',
  projected: 'PROJCS["NAD_1983_HARN_StatePlane_Washington_South_FIPS_4602_Feet",GEOGCS["GCS_North_American_1983_HARN",' +
    'DATUM["D_North_American_1983_HARN",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],' +
    'UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Conformal_Conic"],PARAMETER["False_Easting",1640416.667],' +
    'PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-120.5],PARAMETER["Standard_Parallel_1",45.83333333333334],' +
    'PARAMETER["Standard_Parallel_2",47.33333333333334],PARAMETER["Latitude_Of_Origin",45.33333333333334],UNIT["Foot_US",0.3048006096012192]]'
};
function shapefile(records, type) {   // records: [rings] (a ring a list of [x, y]) or null for no shape
  const contents = records.map(rings => {
    if (!rings) { const b = new DataView(new ArrayBuffer(4)); b.setInt32(0, 0, true); return new Uint8Array(b.buffer); }
    if (type === 1) {
      const b = new DataView(new ArrayBuffer(20));
      b.setInt32(0, 1, true); b.setFloat64(4, rings[0][0][0], true); b.setFloat64(12, rings[0][0][1], true);
      return new Uint8Array(b.buffer);
    }
    const pts = [].concat(...rings);
    const b = new DataView(new ArrayBuffer(44 + 4 * rings.length + 16 * pts.length));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    b.setInt32(0, 5, true);
    [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].forEach((v, k) => b.setFloat64(4 + 8 * k, v, true));
    b.setInt32(36, rings.length, true); b.setInt32(40, pts.length, true);
    let start = 0;
    rings.forEach((r, k) => { b.setInt32(44 + 4 * k, start, true); start += r.length; });
    pts.forEach((p, i) => { b.setFloat64(44 + 4 * rings.length + 16 * i, p[0], true); b.setFloat64(52 + 4 * rings.length + 16 * i, p[1], true); });
    return new Uint8Array(b.buffer);
  });
  const all = [].concat(...records.filter(Boolean).map(r => [].concat(...r)));
  const header = (words) => {
    const h = new DataView(new ArrayBuffer(100));
    h.setInt32(0, 9994, false); h.setInt32(24, words, false); h.setInt32(28, 1000, true); h.setInt32(32, type, true);
    const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].forEach((v, k) => h.setFloat64(36 + 8 * k, v, true));
    return new Uint8Array(h.buffer);
  };
  const shpLen = 100 + contents.reduce((t, c) => t + 8 + c.length, 0);
  const shp = new Uint8Array(shpLen), shx = new Uint8Array(100 + 8 * contents.length);
  shp.set(header(shpLen / 2)); shx.set(header(shx.length / 2));
  let at = 100;
  contents.forEach((c, i) => {
    const rh = new DataView(shp.buffer, at, 8);
    rh.setInt32(0, i + 1, false); rh.setInt32(4, c.length / 2, false);
    const xh = new DataView(shx.buffer, 100 + 8 * i, 8);
    xh.setInt32(0, at / 2, false); xh.setInt32(4, c.length / 2, false);
    shp.set(c, at + 8);
    at += 8 + c.length;
  });
  return { shp, shx };
}
function dbf(rows) {   // rows: [{ ID, NAME }]
  const fields = [['ID', 'N', 5], ['NAME', 'C', 40]];
  const recordLength = 1 + fields.reduce((t, f) => t + f[2], 0), headerLength = 32 + 32 * fields.length + 1;
  const b = new Uint8Array(headerLength + recordLength * rows.length + 1);
  const v = new DataView(b.buffer);
  b[0] = 0x03; b[1] = 126; b[2] = 10; b[3] = 14;   // dBASE III, last updated 2026-10-14
  v.setUint32(4, rows.length, true); v.setUint16(8, headerLength, true); v.setUint16(10, recordLength, true);
  fields.forEach(([n, t, len], k) => {
    for (let i = 0; i < n.length; i++) b[32 + 32 * k + i] = n.charCodeAt(i);
    b[32 + 32 * k + 11] = t.charCodeAt(0); b[32 + 32 * k + 16] = len;
  });
  b[headerLength - 1] = 0x0d;
  const enc = new TextEncoder();
  rows.forEach((r, i) => {
    const at = headerLength + recordLength * i;
    b.fill(0x20, at, at + recordLength);
    const id = String(r.ID).padStart(5, ' '), name = enc.encode(r.NAME || '');
    for (let k = 0; k < 5; k++) b[at + 1 + k] = id.charCodeAt(k);
    b.set(name.subarray(0, 40), at + 6);
  });
  b[b.length - 1] = 0x1a;
  return b;
}
const shpRecords = ZONES.map(z => [].concat(...z.polygons.map(p => [cw(p[0])].concat(p.slice(1).map(ccw)))));
function zipShapefile(file, prj, opts) {
  const o = opts || {};
  const recs = o.points ? ZONES.map(z => [[z.polygons[0][0][0]]]) : shpRecords.concat([null]);
  const s = shapefile(recs, o.points ? 1 : 5);
  const names = ZONES.map(z => ({ NAME: z.name || '' })).concat(o.points ? [] : [{ NAME: 'Empty record' }])
    .map((r, i) => Object.assign({ ID: i + 1 }, r));
  const entries = [{ name: 'zones/zones.shp', data: s.shp }, { name: 'zones/zones.shx', data: s.shx },
    { name: 'zones/zones.dbf', data: dbf(names) }];
  if (prj) entries.push({ name: 'zones/zones.prj', data: prj });
  fs.writeFileSync(path.join(ZDIR, file), ZIP(entries));
}
zipShapefile('zones_shp.zip', PRJ.wgs84);
zipShapefile('zones_nad83_shp.zip', PRJ.nad83);
zipShapefile('zones_nad27_shp.zip', PRJ.nad27);
zipShapefile('zones_projected_shp.zip', PRJ.projected);
zipShapefile('zones_no_prj_shp.zip', null);
zipShapefile('zones_points_shp.zip', PRJ.wgs84, { points: true });
fs.copyFileSync(path.join(ZDIR, 'zones_shp.zip'), path.join(ZDIR, 'zones.kmz'));

// ── More zone files: ring orientation, first points and other edge cases ───────────────────────────────────────────
// Rings written with their orientation and first point as given (not through ccw() and cw(), which may move the
// first point): squares counterclockwise or clockwise, closed here.
const sq = (x0, y0, x1, y1, clockwise) => (clockwise
  ? [[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]] : [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]);
const at = (ring, p) => ring.map(([x, y]) => [r6(p[1] + x), r6(p[0] + y)]);
const oE = pointOf(rowsOf('WA', 'Origin')[50], 'Origin'), oF = pointOf(rowsOf('WA', 'Origin')[60], 'Origin');
const oG = pointOf(rowsOf('WA', 'Origin')[70], 'Origin');
// A hole whose first vertex touches the outline (on its top edge, then on its right edge), and nested rings: an
// outline, a hole in it, an island in the hole, a hole in the island.
const HOLES = [
  { name: 'Touching hole (top)', rings: [at(sq(0, 0, 0.04, 0.04, true), oE),
    at([[0.02, 0.04], [0.01, 0.02], [0.03, 0.02], [0.02, 0.04]], oE)] },
  { name: 'Touching hole (right)', rings: [at(sq(0, 0, 0.04, 0.04, true), oF),
    at([[0.04, 0.02], [0.02, 0.03], [0.02, 0.01], [0.04, 0.02]], oF)] },
  { name: 'Nested island', rings: [at(sq(0, 0, 0.1, 0.1, true), oG), at(sq(0.02, 0.02, 0.08, 0.08, false), oG),
    at(sq(0.03, 0.03, 0.07, 0.07, true), oG), at(sq(0.04, 0.04, 0.06, 0.06, false), oG)] }
];
function zipRecords(file, prj, records, names) {
  const s = shapefile(records, 5);
  const entries = [{ name: 'zones/zones.shp', data: s.shp }, { name: 'zones/zones.shx', data: s.shx },
    { name: 'zones/zones.dbf', data: dbf(names.map((nm, i) => ({ ID: i + 1, NAME: nm }))) }];
  if (prj) entries.push({ name: 'zones/zones.prj', data: prj });
  fs.writeFileSync(path.join(ZDIR, file), ZIP(entries));
  return entries;
}
zipRecords('zones_holes_shp.zip', PRJ.wgs84, HOLES.map(h => h.rings), HOLES.map(h => h.name));
// Footprints a few meters across (an L-shaped barn 20 m by 12 m, a 60 m pen, a 10 m star, a 3 m triangle), in
// meters converted at their latitude: the page's point must still lie inside each one.
const M_LAT = 1 / (6378137 * Math.PI / 180);
const meters = (p, pts) => pts.map(([x, y]) => [p[1] + x * M_LAT / Math.cos(p[0] * Math.PI / 180), p[0] + y * M_LAT]);
const star = [];
for (let k = 0; k < 10; k++) {
  const a = Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? 2 : 5;
  star.push([rr * Math.cos(a), rr * Math.sin(a)]);
}
const FOOT = [
  { name: 'L-shaped barn', ring: meters(oE, [[0, 0], [20, 0], [20, 4], [4, 4], [4, 12], [0, 12]]) },
  { name: 'Pen', ring: meters(oF, [[0, 0], [60, 0], [60, 40], [0, 40]]) },
  { name: 'Star shed', ring: meters(oG, star) },
  { name: 'Small triangle', ring: meters(oA, [[0, 0], [3, 0], [1.5, 2.5]]) }
];
fs.writeFileSync(path.join(ZDIR, 'zones_footprints.geojson'), JSON.stringify({ type: 'FeatureCollection',
  features: FOOT.map(f => ({ type: 'Feature', properties: { name: f.name },
    geometry: { type: 'Polygon', coordinates: [ccw(f.ring)] } })) }) + '\n');
// .prj texts the page accepts beyond ESRI WKT1 (NAD 83 2011; WKT2 with a datum, and with a datum ensemble): the same
// four zones as zones_shp.zip.
const PRJ_MORE = {
  nad83_2011: 'GEOGCS["GCS_NAD_1983_2011",DATUM["D_NAD_1983_2011",SPHEROID["GRS_1980",6378137.0,298.257222101]],' +
    'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',
  wkt2: 'GEOGCRS["WGS 84",DATUM["World Geodetic System 1984",ELLIPSOID["WGS 84",6378137,298.257223563,' +
    'LENGTHUNIT["metre",1]]],PRIMEM["Greenwich",0,ANGLEUNIT["degree",0.0174532925199433]],CS[ellipsoidal,2],' +
    'AXIS["geodetic latitude (Lat)",north],AXIS["geodetic longitude (Lon)",east],ANGLEUNIT["degree",0.0174532925199433]]',
  wkt2_ensemble: 'GEOGCRS["WGS 84",ENSEMBLE["World Geodetic System 1984 ensemble",MEMBER["World Geodetic System 1984 ' +
    '(G2139)"],ELLIPSOID["WGS 84",6378137,298.257223563,LENGTHUNIT["metre",1]],ENSEMBLEACCURACY[2.0]],' +
    'PRIMEM["Greenwich",0,ANGLEUNIT["degree",0.0174532925199433]],CS[ellipsoidal,2],AXIS["geodetic latitude (Lat)",north],' +
    'AXIS["geodetic longitude (Lon)",east],ANGLEUNIT["degree",0.0174532925199433]]'
};
Object.keys(PRJ_MORE).forEach(k => zipShapefile('zones_' + k + '_shp.zip', PRJ_MORE[k]));
// Damaged and misleading files: a .shp cut in the middle of a record, a .dbf whose record length is 0 with four
// billion records declared, part starts out of order, a ZIP that is not one, a KMZ renamed .zip, and GeoJSON with an
// unusable polygon, a broken hole, and an outline with no area.
{
  const good = zipRecords('zones_cut_shp.zip', PRJ.wgs84, shpRecords, ZONES.map(z => z.name || ''));
  const shp = good[0].data;
  zipRecords('zones_cut_shp.zip', PRJ.wgs84, shpRecords, ZONES.map(z => z.name || ''));
  const cut = shp.slice(0, 100 + Math.floor((shp.length - 100) / 2));
  fs.writeFileSync(path.join(ZDIR, 'zones_cut_shp.zip'), ZIP([{ name: 'zones/zones.shp', data: cut },
    good[1], good[2], good[3]]));
  const d = good[2].data.slice();
  new DataView(d.buffer).setUint32(4, 4000000000, true);
  new DataView(d.buffer).setUint16(10, 0, true);
  fs.writeFileSync(path.join(ZDIR, 'zones_bad_dbf_shp.zip'), ZIP([good[0], good[1], { name: 'zones/zones.dbf', data: d },
    good[3]]));
  const d2 = good[2].data.slice();   // a record length of 3, shorter than its fields (46 bytes), the count as written
  new DataView(d2.buffer).setUint16(10, 3, true);
  fs.writeFileSync(path.join(ZDIR, 'zones_short_dbf_shp.zip'), ZIP([good[0], good[1], { name: 'zones/zones.dbf', data: d2 },
    good[3]]));
  const one = shapefile([shpRecords[2]], 5);   // the ring with a hole: two parts, the second start set to 0
  new DataView(one.shp.buffer).setInt32(100 + 8 + 44 + 4, 0, true);
  fs.writeFileSync(path.join(ZDIR, 'zones_bad_parts_shp.zip'), ZIP([{ name: 'zones/zones.shp', data: one.shp },
    { name: 'zones/zones.shx', data: one.shx }, { name: 'zones/zones.prj', data: PRJ.wgs84 }]));
}
fs.writeFileSync(path.join(ZDIR, 'zones_not_a_zip.zip'), Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]),
  Buffer.from('this is not a ZIP archive, only its first four bytes are')]));
fs.writeFileSync(path.join(ZDIR, 'kmz_renamed.zip'), ZIP([{ name: 'doc.kml', data: kml }]));
const unusable = [
  { type: 'Feature', properties: { name: 'Text coordinates' }, geometry: { type: 'Polygon',
    coordinates: [[['-120', '47'], ['-120.1', '47'], ['-120.1', '47.1'], ['-120', '47']]] } },
  { type: 'Feature', properties: { name: 'Broken hole' }, geometry: { type: 'Polygon',
    coordinates: [ccw([[-120, 47], [-120.1, 47], [-120.1, 47.1], [-120, 47.1]]), [[-120.05, 47.05], [-120.06, 47.05]]] } },
  { type: 'Feature', properties: { name: 'No area' }, geometry: { type: 'Polygon',
    coordinates: [[[-120, 47], [-120.1, 47.1], [-120.2, 47.2], [-120, 47]]] } }];
fs.writeFileSync(path.join(ZDIR, 'zones_unusable.geojson'), JSON.stringify({ type: 'FeatureCollection',
  features: unusable }) + '\n');
fs.writeFileSync(path.join(ZDIR, 'zones_one_unusable.geojson'), JSON.stringify({ type: 'FeatureCollection',
  features: unusable.concat([{ type: 'Feature', properties: { name: 'Good square' },
    geometry: { type: 'Polygon', coordinates: [ccw([[-119, 47], [-118.9, 47], [-118.9, 47.1], [-119, 47.1]])] } }]) }) + '\n');

// The points to test: a 21 by 21 grid over each zone's box (10% wider on each side, offset so no point falls on an
// edge), then every origin and destination of the Full tier.
const ZPOINTS = [];
// (the original four zones, the hole cases and the footprints)
ZONES.concat(HOLES.map(h => ({ polygons: [[h.rings[0]]] })), FOOT.map(f => ({ polygons: [[f.ring]] }))).forEach(z => {
  const pts = [].concat(...z.polygons.map(p => p[0]));
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  for (let i = 0; i <= 20; i++) {
    for (let j = 0; j <= 20; j++) {
      ZPOINTS.push([r6(Math.min(...xs) - 0.1 * w + 1.2 * w * j / 20 + 0.0000137), r6(Math.min(...ys) - 0.1 * h + 1.2 * h * i / 20 + 0.0000211)]);
    }
  }
});
// read: the R reference reads these with sf; sameAs: read by the page only, their zones the same as zones_shp.zip's
// (.prj texts GDAL may word differently); pageOnly: read by the page only, with no R reading; refused: each has its
// message in the unit suite.
const ZONE_FILES = {
  read: ['zones.geojson', 'zones.kml', 'zones_shp.zip', 'zones_nad83_shp.zip', 'zones_holes_shp.zip',
    'zones_footprints.geojson'],
  sameAs: ['zones_nad83_2011_shp.zip', 'zones_wkt2_shp.zip', 'zones_wkt2_ensemble_shp.zip'],
  pageOnly: ['zones_one_unusable.geojson'],   // its broken polygons might stop GDAL, so only the page reads it
  refused: ['broken.geojson', 'broken.kml', 'points_only.geojson', 'zones_epsg2927.geojson', 'zones_meters.geojson',
    'zones_nad27_shp.zip', 'zones_projected_shp.zip', 'zones_no_prj_shp.zip', 'zones_points_shp.zip', 'zones.kmz',
    'not_a_zone.txt', 'zones_cut_shp.zip', 'zones_bad_dbf_shp.zip', 'zones_short_dbf_shp.zip', 'zones_bad_parts_shp.zip',
    'zones_not_a_zip.zip',
    'kmz_renamed.zip', 'zones_unusable.geojson']
};
// What the page should read from each file of "read" and "pageOnly": the names and, left out, the shapes that are not polygons
// (skipped) and the polygons with unusable coordinates (broken).
const NAMES4 = ZONES.map((z, i) => z.name || 'Zone ' + (i + 1));
const ZONE_EXPECT = {
  'zones.geojson': { names: NAMES4, skipped: 3, broken: 0 },
  'zones.kml': { names: NAMES4, skipped: 1, broken: 0 },
  'zones_shp.zip': { names: NAMES4, skipped: 1, broken: 0 },
  'zones_nad83_shp.zip': { names: NAMES4, skipped: 1, broken: 0 },
  'zones_holes_shp.zip': { names: HOLES.map(h => h.name), skipped: 0, broken: 0 },
  'zones_footprints.geojson': { names: FOOT.map(f => f.name), skipped: 0, broken: 0 },
  'zones_one_unusable.geojson': { names: ['Good square'], skipped: 0, broken: 3 }
};
// Numbers for the matched-rows CSV's writer (CVI's write.csv): the R reference writes each one as write.table does.
const CSV_NUMBERS = [0.1, 0.1 + 0.2, 1 / 3, 2 / 3, 1e5, 123456, 1e15, 1e16, 123456789012345680, 1234567890123456, -0.5,
  0.0001, 0.00012, 1e-5, 2.5e20, 12345678.9, 0.000123456789, 46.12345678901234, -114.613, 6378.137, 2.675, 99999.99,
  999999999999999.9, 5e-324, 1.7976931348623157e308, -1e-300, 3, 0];
{
  let seed = 11;
  const next = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = -8; k <= 18; k++) {
    for (let j = 0; j < 3; j++) CSV_NUMBERS.push((next() - 0.5) * Math.pow(10, k) * (j === 2 ? 1 : Math.round(next() * 1e6) / 1e6));
  }
}
const ZONES_OUT = { dir: rel('zones'), files: ZONE_FILES, expect: ZONE_EXPECT, names: ZONES.map(z => z.name), points: ZPOINTS,
  premises: { origin: oA, dest: [dB1, dB2], holeCenter: oC, small: oD } };

// ── The address lookup: geocode cache files and the addresses typed into "Find coordinates" ─────────
// CVI looks a typed address up in its cache file (shiny/R/geocode_site.R, .geocode_from_cache), then over the network;
// the page only in a cache file the user loads. The R reference runs CVI's module with its two network steps replaced
// by stubs that find nothing, so CVI's answer here is its cache answer, and it records where CVI would have gone online.
// cache_main.csv covers CVI's rules: case and spacing, surrounding quotes, a row with missing coordinates before a
// usable one, coordinates out of range or not numbers, a missing address, an extra column, rounding to 6 decimals
// (also a half at the seventh decimal).
const GDIR = path.join(OUT, 'geocode');
fs.mkdirSync(GDIR, { recursive: true });
const GEOCACHE_MAIN = [
  '"address","lat","long","source"',
  '"123 Main St, Yakima, WA 98901",46.602071,-120.505899,"synthetic"',
  '"  456 Elm Rd,   Ellensburg, WA 98926 ",46.996,-120.547,"synthetic"',
  '"789 Failed Way, Moses Lake, WA",NA,NA,"synthetic"',
  '"789 Failed Way, Moses Lake, WA",47.130123,-119.278,"synthetic"',
  '"12 Out Of Range Rd, Omak, WA",95,-119.5,"synthetic"',
  'NA,47,-120,"synthetic"',
  '"\'Quoted\' Farm Lane, Pasco, WA",46.2396,-119.1006,"synthetic"',
  '"1 Precise Pl, Spokane, WA",47.65878912,-117.42604987,"synthetic"',
  '"TAB\tSEPARATED  Rd, Walla Walla, WA",46.0646,-118.343,"synthetic"',
  '"Bad Lat Text Rd, Wenatchee, WA",abc,-120.31,"synthetic"',
  // A half at the seventh decimal: the page's rounding to 6 decimals pinned against CVI's round(x, 6).
  '"5 Half Way, Ritzville, WA",47.1234565,-118.3792125,"synthetic"'].join('\n') + '\n';
fs.writeFileSync(path.join(GDIR, 'cache_main.csv'), GEOCACHE_MAIN);
fs.writeFileSync(path.join(GDIR, 'cache_wrong_cols.csv'), '"Address","Lat","Long"\n"123 Main St, Yakima, WA 98901",46.6,-120.5\n');
fs.writeFileSync(path.join(GDIR, 'cache_header_only.csv'), 'address,lat,long\n');
fs.writeFileSync(path.join(GDIR, 'cache_empty.csv'), '');
// cache: a file in geocode/, or null for no file loaded (CVI: no cache file in its registry folder).
const GEOCODE_CASES = [
  ['', 'cache_main.csv'], ['   ', 'cache_main.csv'],
  ['123 Main St, Yakima, WA 98901', 'cache_main.csv'], ['  123  MAIN st,  yakima, wa 98901 ', 'cache_main.csv'],
  ['"123 Main St, Yakima, WA 98901"', 'cache_main.csv'], ['456 Elm Rd, Ellensburg, WA 98926', 'cache_main.csv'],
  ['789 Failed Way, Moses Lake, WA', 'cache_main.csv'], ['12 Out Of Range Rd, Omak, WA', 'cache_main.csv'],
  ['NA', 'cache_main.csv'], ["Quoted' Farm Lane, Pasco, WA", 'cache_main.csv'],
  ['1 Precise Pl, Spokane, WA', 'cache_main.csv'], ['tab separated rd, walla walla, wa', 'cache_main.csv'],
  ['Bad Lat Text Rd, Wenatchee, WA', 'cache_main.csv'], ['999 Not Listed Ave, Tacoma, WA', 'cache_main.csv'],
  ['""', 'cache_main.csv'], ['5 Half Way, Ritzville, WA', 'cache_main.csv'],
  ['123 Main St, Yakima, WA 98901', 'cache_wrong_cols.csv'], ['123 Main St, Yakima, WA 98901', 'cache_header_only.csv'],
  ['123 Main St, Yakima, WA 98901', 'cache_empty.csv'], ['123 Main St, Yakima, WA 98901', null]
].map(([address, cache]) => ({ address, cache }));
const GEOCODE_OUT = { dir: rel('geocode'), cases: GEOCODE_CASES,
  // What the page does with each file when it is loaded: usable (its row count and rows passed over) or refused.
  files: { 'cache_main.csv': { rows: 11, passed: 4 }, 'cache_wrong_cols.csv': { refused: true },
    'cache_header_only.csv': { refused: true }, 'cache_empty.csv': { refused: true } } };

const out = { generated: 'tests/synthetic/make_s11_fixtures.js', full: FULL, badRows: badLog,
  repeatedRows: [...repeat].map(i => i + 1), scenarios: SCENARIOS, module: MODULE, zones: ZONES_OUT,
  csvNumbers: CSV_NUMBERS, pngs: PNGS, geocode: GEOCODE_OUT };
fs.writeFileSync(path.join(OUT, 'scenarios.json'), JSON.stringify(out, null, 1) + '\n');

// ── Files for trying the page by hand, in test-tables/ (the folder's other files are left alone) ────────────────
const TT = path.join(ROOT, 'test-tables');
fs.mkdirSync(TT, { recursive: true });
fs.writeFileSync(path.join(TT, 's11_sites.csv'), 'name,lat,long,buffer_km\n' + [A, B, C, OOS, LINE].map((x, i) =>
  ['"' + x.name + '"', x.lat, x.long, i === 2 ? 10 : ''].join(',')).join('\n') + '\n');
fs.writeFileSync(path.join(TT, 's11_sites_no_long.csv'), 'name,lat,longitude\n"Farm A",' + A.lat + ',' + A.long + '\n');
fs.writeFileSync(path.join(TT, 's11_paste.txt'), [line(A), line(B, [10]), line(C, [1, 3, 5]), 'Farm X, abc, -120']
  .join('\n') + '\n');
fs.copyFileSync(path.join(ROOT, noCvi), path.join(TT, 's11_no_cvi_master.csv'));
// Zone files, and sites on the Full tier's facilities to paste.
for (const [from, to] of [['zones.geojson', 's11_zones.geojson'], ['zones.kml', 's11_zones.kml'],
  ['zones_shp.zip', 's11_zones_shp.zip'], ['zones.kmz', 's11_zones.kmz']]) {
  fs.copyFileSync(path.join(OUT, 'zones', from), path.join(TT, to));
}
fs.writeFileSync(path.join(TT, 's11_facility_sites.txt'), [FEEDLOT1, MARKET1, PLANT3].map(x => line(x)).join('\n') + '\n');
// A geocode cache with addresses on two of the synthetic sites, and a file
// with CVI's column names capitalized, which the page refuses.
fs.writeFileSync(path.join(TT, 's11_geocode_cache.csv'), '"address","lat","long"\n' +
  '"100 Synthetic Farm Rd, Farm A, WA",' + A.lat + ',' + A.long + '\n' +
  '"200 Synthetic Ranch Rd, Farm B, WA",' + B.lat + ',' + B.long + '\n');
fs.writeFileSync(path.join(TT, 's11_geocode_wrong_columns.csv'), '"Address","Lat","Long"\n' +
  '"100 Synthetic Farm Rd, Farm A, WA",' + A.lat + ',' + A.long + '\n');

console.log('S11 fixtures: ' + SCENARIOS.length + ' scenarios, 3 masters, ' + badLog.length + ' rows with bad ' +
  'coordinates, ' + repeat.size + ' rows repeated; module steps: ' + PASTES.length + ' pastes, ' + UPLOADS.length +
  ' uploads, ' + ADDS.length + ' adds, ' + EDITS.length + ' edit lists, ' + BANDS.length + ' band texts, ' +
  RUNS.length + ' runs, ' + PNGS.length + ' branded PNGs, ' + GEOCODE_CASES.length + ' address lookups; written to ' +
  path.relative(ROOT, OUT) + ' and 11 files to test-tables/');
