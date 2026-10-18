#!/usr/bin/env node
'use strict';
// S5 explicit synthetic inputs for bounded sizing, membership, module-route/facility injection, premises/subset and popup/species checks. No real data.
// Outputs are ignored under local-test-artifacts/s5/. The full module/facility matrix is not built here.
// Usage: node tests/synthetic/make_cvi_focus_fixtures.js --scaling-gate (or another mode listed at the end)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'local-test-artifacts/s5/gate');
const HEADER = ['Species.Group', 'Reporting.Year', 'Reporting.Quarter', 'Movement', 'Total.Animals',
  'Origin.State', 'Dest.State', 'Origin.County', 'Origin.County.Lat', 'Origin.County.Long',
  'Dest.County', 'Dest.County.Lat', 'Dest.County.Long', 'Origin.Lat', 'Origin.Long', 'Dest.Lat', 'Dest.Long',
  'Origin.City', 'Dest.City', 'farm_entity_id_origin', 'farm_entity_id_dest', 'CVI', 'Species'];
function values(n) { return Array.from({ length: n }, (_, i) => 1 + ((i * 7919) % 100003)); }
function generate() {
  fs.mkdirSync(OUT, { recursive: true });
  const cases = [];
  // n is the TOTAL number of grouped premises, including both directions in the combined case.
  for (const n of [3000, 3001, 10000]) for (const direction of ['inbound', 'combined']) {
    const name = `${n}_${direction}`, vv = values(n);
    const rows = vv.map((animals, i) => {
      const inbound = direction === 'inbound' || i % 2 === 0;
      // Two ids can share a coordinate without merging. Coordinates are within King County;
      // premises membership follows county metadata, by design, not the coordinate alone.
      const lon = -121.9 + (i % 100) * 0.0001, lat = 47.4 + Math.floor(i / 100) * 0.0001;
      return ['Cattle', 2025, 'Q1', inbound ? 'Import' : 'Export', animals,
        inbound ? 'OR' : 'WA', inbound ? 'WA' : 'OR', inbound ? 'N/A' : 'King', 47.4, -121.9,
        inbound ? 'King' : 'N/A', 47.4, -121.9, lat, lon, lat, lon,
        'Synthetic origin', 'Synthetic destination', `E${String(i).padStart(5, '0')}`,
        `E${String(i).padStart(5, '0')}`, `SYN${String(i).padStart(5, '0')}`, 'Dairy cattle'];
    });
    const csv = [HEADER, ...rows].map(r => r.join(',')).join('\n') + '\n';
    const file = `master_${name}.csv`;
    fs.writeFileSync(path.join(OUT, file), csv);
    cases.push({ name, n, direction, file, sha256: crypto.createHash('sha256').update(csv).digest('hex'),
      expectedAnimals: vv.reduce((sum, x) => sum + x, 0) });
  }
  fs.writeFileSync(path.join(OUT, 'cases.json'), JSON.stringify({ synthetic: true, cases }, null, 2) + '\n');
  console.log(`S5 scaling gate fixtures: ${cases.length} cases; total premises per case 3,000 / 3,001 / 10,000; ${OUT}`);
  return cases;
}
// Membership inputs are built from the bundled geometry, never from the JS membership implementation.
function generateMembership() {
  const vm = require('vm'), box = { window: {} };
  const geoPath = path.join(ROOT, 'site/geo/wa-counties.js');
  vm.runInNewContext(fs.readFileSync(geoPath, 'utf8'), box);
  const geo = box.window.CVIWA_GEO;
  const points = [];
  const add = (name, lon, lat) => points.push({ name, lon, lat });
  for (const l of geo.labels) add(`label ${l.name}`, l.lon, l.lat);
  // Every outer/hole ring: a vertex, a middle vertex, and both sides of its first nonzero edge.
  for (const f of geo.counties.features) {
    const ps = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    ps.forEach((p, pi) => p.forEach((r, ri) => {
      const tag = `${f.properties.name}/${pi}/${ri}`;
      add(`vertex ${tag}`, ...r[0]); add(`vertex-middle ${tag}`, ...r[Math.floor(r.length / 2)]);
      const b = r.find(v => v[0] !== r[0][0] || v[1] !== r[0][1]);
      const a = r[0], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      for (const sign of [-1, 1]) add(`edge-side ${tag}/${sign}`,
        (a[0] + b[0]) / 2 - sign * dy / len * 1e-7, (a[1] + b[1]) / 2 + sign * dx / len * 1e-7);
    }));
  }
  // Broad deterministic grid includes coast, waters, bbox-only false positives and neighboring states.
  for (let x = 0; x <= 30; x++) for (let y = 0; y <= 20; y++)
    add(`grid ${x}/${y}`, -125 + x * 0.3, 45 + y * 0.22);
  add('Whidbey outside Snohomish bbox false positive', -122.4, 48.1);
  add('Everett in Snohomish', -122.2, 47.98);
  add('San Juan island', -123.02, 48.54);
  const feature = (name, type, coordinates) => ({ type: 'Feature', properties: { name }, geometry: { type, coordinates } });
  // Artificial local polygons guarantee a hole and separated islands even if the Census file changes.
  const square = (x, y, size) => [[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]];
  const synthetic = { type: 'FeatureCollection', features: [
    feature('Hole', 'Polygon', [square(-120, 46, 2), square(-119.5, 46.5, 1)]),
    feature('Islands', 'MultiPolygon', [[square(-123, 46, 0.5)], [square(-123, 48, 0.5)]]),
    feature('Adjacent', 'Polygon', [square(-118, 46, 1)])] };
  const special = [
    ['outer interior', -119.8, 46.2, ['Hole']], ['hole interior', -119, 47, []],
    ['hole edge', -119.5, 47, ['Hole']], ['hole vertex', -119.5, 46.5, ['Hole']],
    ['outer edge', -120, 47, ['Hole']], ['outer vertex', -120, 46, ['Hole']],
    ['shared edge', -118, 46.5, ['Hole', 'Adjacent']], ['shared vertex', -118, 46, ['Hole', 'Adjacent']],
    ['island one', -122.75, 46.25, ['Islands']], ['island two', -122.75, 48.25, ['Islands']],
    ['between islands', -122.75, 47, []], ['island edge', -123, 46.25, ['Islands']],
    ['just outside', -120.0000001, 47, []], ['just inside', -119.9999999, 47, ['Hole']],
    ['just inside hole', -119.4999999, 47, []], ['just outside hole', -119.5000001, 47, ['Hole']]
  ].map(([name, lon, lat, expected]) => ({ name, lon, lat, expected }));
  const sha = crypto.createHash('sha256').update(fs.readFileSync(geoPath)).digest('hex');
  const out = path.join(ROOT, 'local-test-artifacts/s5/membership'); fs.mkdirSync(out, { recursive: true });
  const input = { synthetic: true, geometrySha256: sha, groups: [
    { name: 'bundled WA', counties: geo.counties, points },
    { name: 'synthetic holes/islands/boundaries', counties: synthetic, points: special }] };
  fs.writeFileSync(path.join(out, 'inputs.json'), JSON.stringify(input) + '\n');
  console.log(`S5 membership fixtures: ${points.length} bundled points; ${special.length} explicit hole/island/boundary cases`);
}
// Small route fixture: hand-computable module totals, not the full premises edge matrix.
function generateModuleRoute(facilities = false) {
  const out = path.join(ROOT, 'local-test-artifacts/s5', facilities ? 'module-facilities' : 'module-route');
  fs.mkdirSync(out, { recursive: true });
  const rows = [
    ['Import', 10, 'OR', 'WA', 'N/A', 'King', 2025, 'Q1', true],
    ['Export', 20, 'WA', 'OR', 'King', 'N/A', 2025, 'Q1', true],
    ['Intrastate', 30, 'WA', 'WA', 'King', 'King', 2025, 'Q1', true],
    ['Import', 40, 'OR', 'WA', 'N/A', 'King', 2025, 'Q1', false],
    ['Import', 50, 'OR', 'WA', 'N/A', 'Pierce', 2026, 'Q2', true]
  ].map(([movement, animals, originState, destState, originCounty, destCounty, year, quarter, coords], i) =>
    ['Cattle', year, quarter, movement, animals, originState, destState, originCounty, 47.4, -121.9,
      destCounty, 47.4, -121.9, 47.4 + i * 0.01, -121.9, coords ? 47.4 + i * 0.01 : '',
      coords ? -121.9 : '', 'Synthetic origin', 'Synthetic destination', `O${i}`, `D${i}`, `SYN${i}`, 'Dairy cattle']);
  const csv = [HEADER, ...rows].map(r => r.join(',')).join('\n') + '\n';
  fs.writeFileSync(path.join(out, 'master.csv'), csv);
  if (facilities) {
    const points = [
      { ref_name: 'King inside', lon: -121.9, lat: 47.4 },
      { ref_name: 'Outside WA', lon: -120, lat: 45 },
      { ref_name: 'Everett inside Snohomish', lon: -122.2, lat: 47.98 },
      { ref_name: 'Whidbey bbox false positive', lon: -122.4, lat: 48.1 }
    ];
    fs.writeFileSync(path.join(out, 'facilities.json'), JSON.stringify({ synthetic: true,
      layers: ['slaughterhouses', 'fairgrounds', 'markets', 'feedlots', 'restricted'].map(key => ({ key,
        points: points.map(p => ({ ...p, ref_name: `${key}: ${p.ref_name}`, synthetic_private_note: 'must be stripped' })) })) }, null, 2) + '\n');
  }
  console.log(`S5 ${facilities ? 'module facility' : 'module route'} fixture: 5 physical rows; King box animals 100, drawn activity 90, 4 premises`);
}
// Small grouping fixture; variants remove columns rather than fabricating access tiers.
function generatePremises(payloads = false) {
  const out = path.join(ROOT, 'local-test-artifacts/s5', payloads ? 'payloads' : 'premises'); fs.mkdirSync(out, { recursive: true });
  const base = Object.fromEntries(HEADER.map(k => [k, '']));
  Object.assign(base, { 'Species.Group': 'Cattle', 'Reporting.Year': 2025, 'Reporting.Quarter': 'Q1',
    Movement: 'Import', 'Total.Animals': 10, 'Origin.State': 'OR', 'Dest.State': 'WA',
    'Origin.County': 'N/A', 'Dest.County': 'King County', 'Origin.County.Lat': 47.4, 'Origin.County.Long': -121.9,
    'Dest.County.Lat': 47.4, 'Dest.County.Long': -121.9, 'Origin.Lat': 46.2, 'Origin.Long': -122.1,
    'Dest.Lat': 47.4, 'Dest.Long': -121.9, 'Origin.City': 'Synthetic origin', 'Dest.City': 'Alpha',
    farm_entity_id_origin: 'O1', farm_entity_id_dest: 'D1', CVI: 'SYN01', Species: 'Dairy cattle' });
  const rows = [], add = change => rows.push(Object.assign({}, base, change));
  add({}); add({ 'Dest.Lat': 48, 'Dest.Long': -120, 'Dest.City': 'Later city', 'Dest.County': 'Pierce',
    farm_entity_id_dest: ' D1 ', 'Total.Animals': 20, CVI: 'SYN02' });
  add({ farm_entity_id_dest: 'D2', 'Total.Animals': 30, CVI: 'SYN03' });
  add({ farm_entity_id_dest: '', 'Dest.City': 'Beta', 'Total.Animals': 2.5, CVI: '' });
  add({ farm_entity_id_dest: '', 'Dest.City': 'Gamma', 'Total.Animals': -1, CVI: 'SYN04' });
  add({ farm_entity_id_dest: '', 'Dest.City': 'Beta', 'Total.Animals': 'bad', CVI: 'SYN04' });
  add({ farm_entity_id_dest: 'D3', 'Total.Animals': 30, CVI: 'SYN05' });
  add({ farm_entity_id_dest: 'D4', 'Dest.City': '', 'Total.Animals': 0, 'Dest.Long': -122 });
  add({ farm_entity_id_dest: 'D5', 'Dest.Lat': '', 'Total.Animals': 40 });
  add({ farm_entity_id_dest: 'D6', 'Dest.Long': 'bad' });
  add({ farm_entity_id_dest: 'D7', 'Dest.Lat': 91 });
  add({ farm_entity_id_dest: 'D8', 'Dest.Long': 'Inf' });
  add({ farm_entity_id_dest: 'D9', 'Dest.State': 'OR' }); // Same county name; approved WA guard.
  add({ Movement: 'Export', 'Origin.State': 'WA', 'Dest.State': 'OR', 'Origin.County': 'King',
    'Origin.City': 'Alpha', 'Total.Animals': 60 });
  add({ Movement: 'Intrastate', 'Origin.State': 'WA', 'Origin.County': 'King', 'Origin.City': 'Alpha',
    farm_entity_id_dest: 'D10', farm_entity_id_origin: 'O10', 'Total.Animals': 15 });
  add({}); // Distinct identical physical row is retained.
  add({ farm_entity_id_dest: 'D11', 'Species.Group': 'Poultry', Species: 'Chickens', 'Total.Animals': 5,
    'Reporting.Year': 2026, 'Reporting.Quarter': 'Q2', 'Dest.County': 'Pierce' });
  add({ farm_entity_id_dest: 'D12', Species: 'Beef cattle', 'Total.Animals': 7 });
  if (payloads) {
    // Busy premises: reverse input order, duplicate details, three CVIs and missing cells.
    for (let i = 29; i >= 0; i--) add({ farm_entity_id_dest: 'BUSY', CVI: 'SYN' + String(i).padStart(3, '0'),
      'Dest.City': 'Busy', 'Origin.City': i % 2 ? 'Origin A' : 'Origin B', 'Total.Animals': 0.5,
      Species: i % 2 ? 'Beef cattle' : 'Dairy cattle' });
    add({ farm_entity_id_dest: 'BUSY', CVI: 'SYN000', 'Dest.City': 'Busy', 'Origin.City': 'Origin B', 'Total.Animals': 0.5 });
    add({ farm_entity_id_dest: 'MARKUP', CVI: "<img src=x onerror=alert(1)> & 'quoted'",
      'Origin.City': '<b>Origin</b>', 'Dest.City': '<script>city</script> & text',
      Species: ' Cattle quoted ', 'Total.Animals': 2.5 });
    add({ farm_entity_id_dest: 'JSON', Species: 'Line\\break\nnext', 'Total.Animals': -1.5 });
    add({ farm_entity_id_dest: 'JSON', Species: '__proto__', 'Total.Animals': 3.5 });
    add({ farm_entity_id_dest: 'JSON', Species: ' ', 'Total.Animals': 100 });
    add({ farm_entity_id_dest: 'JSON', Species: '', 'Total.Animals': 100 });
    add({ farm_entity_id_dest: 'THREE', CVI: 'SYN-C', 'Total.Animals': 1 });
    add({ farm_entity_id_dest: 'THREE', CVI: 'SYN-A', 'Total.Animals': 1 });
    add({ farm_entity_id_dest: 'THREE', CVI: 'SYN-B', 'Total.Animals': 1 });
    // The real CVI number format (capitals, digits, hyphens), shuffled: mixed lengths, years, states and
    // the -B/A suffix pair that a hyphen-ignoring collation would reverse. Popup sort pins all nine. Own point, so
    // coordinate fallback never merges them with the markup CVI above (symbols sort differently in R's ICU order).
    for (const cvi of ['24-WA-21348233', '24-WA-21348232A', '2024-WA-1', '24-WA-21348232', '25-WA-00012345',
      '24-WA-21348232-B', '23-ID-9', '24-OR-77001234', '24-WA-2134823'])
      add({ farm_entity_id_dest: 'REALFMT', CVI: cvi, 'Dest.City': 'Format', 'Dest.Long': -121.95, 'Dest.Lat': 47.45, 'Total.Animals': 2 });
    // Two CVIs of different lengths: the hover lists both, sorted.
    for (const cvi of ['24-WA-21348232', '24-WA-2134823'])
      add({ farm_entity_id_dest: 'REALPAIR', CVI: cvi, 'Dest.City': 'Format', 'Dest.Long': -121.95, 'Dest.Lat': 47.45, 'Total.Animals': 3 });
  }
  const variants = [ ['full', []], ['no_ids', ['farm_entity_id_origin', 'farm_entity_id_dest']],
    ['no_city', ['Origin.City', 'Dest.City']], ['no_cvi', ['CVI']], ['no_species', ['Species']],
    ['minimal', ['Origin.City', 'Dest.City', 'farm_entity_id_origin', 'farm_entity_id_dest', 'CVI', 'Species']],
    ...['Origin.Lat','Origin.Long','Dest.Lat','Dest.Long'].map(k => ['missing_' + k.replace('.', '_'), [k]]),
    ['required_only', HEADER.filter(k => !['Species.Group','Reporting.Year','Reporting.Quarter','Movement','Total.Animals',
      'Origin.State','Dest.State','Origin.County','Origin.County.Lat','Origin.County.Long','Dest.County','Dest.County.Lat','Dest.County.Long'].includes(k))] ];
  const cell = v => v === '' ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  const cases = variants.map(([name, removed]) => {
    const header = HEADER.filter(k => !removed.includes(k));
    const csv = [header, ...rows.map(r => header.map(k => r[k]))].map(r => r.map(cell).join(',')).join('\n') + '\n';
    fs.writeFileSync(path.join(out, name + '.csv'), csv);
    return { name, file: name + '.csv', removed, sha256: crypto.createHash('sha256').update(csv).digest('hex') };
  });
  if (payloads) {
    const quoted = { ...base, CVI: 'SYN "quoted"', Species: 'Cattle "quoted"' };
    fs.writeFileSync(path.join(out, 'loader_quote_probe.csv'), [HEADER, HEADER.map(k => quoted[k])]
      .map(r => r.map(cell).join(',')).join('\n') + '\n');
  }
  if (payloads) fs.writeFileSync(path.join(out, 'helper_inputs.json'), JSON.stringify([
    { name: 'quote-control-ties', rows: [
      { CVI: '<b>CVI</b> & "quoted"', 'Origin.City': '<origin>', 'Origin.State': 'OR', 'Dest.City': 'dest', 'Dest.State': 'WA', 'Species.Group': 'Cattle', Species: ' Cattle "quoted" ', 'Total.Animals': 2.5 },
      { CVI: null, 'Origin.City': null, 'Origin.State': '', 'Dest.City': 'dest', 'Dest.State': 'WA', 'Species.Group': 'Cattle', Species: 'Line\\break\nnext', 'Total.Animals': -1.5 },
      { CVI: '', 'Origin.City': '', 'Origin.State': null, 'Dest.City': 'dest', 'Dest.State': 'WA', 'Species.Group': 'Cattle', Species: '__proto__', 'Total.Animals': 3.5 },
      { CVI: 'SYN-A', 'Origin.City': 'origin', 'Origin.State': 'OR', 'Dest.City': 'dest', 'Dest.State': 'WA', 'Species.Group': 'Cattle', Species: 'Tie A', 'Total.Animals': 2.5 },
      { CVI: 'SYN-B', 'Origin.City': 'origin', 'Origin.State': 'OR', 'Dest.City': 'dest', 'Dest.State': 'WA', 'Species.Group': 'Cattle', Species: 'Tie B', 'Total.Animals': 2.5 }
    ] },
    { name: 'no-usable-species', rows: [ { Species: null, 'Total.Animals': 10 }, { Species: ' ', 'Total.Animals': null } ] }
  ], null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'cases.json'), JSON.stringify({ synthetic: true, cases }, null, 2) + '\n');
  console.log(`S5 ${payloads ? "payload" : "premises"} fixtures: ${rows.length} physical rows, ${cases.length} column variants; full module matrix NOT RUN`);
}
// Copy the actual established tier contents byte-for-byte; no reconstructed access tiers.
function generateModuleTiers() {
  const tiers = require('./make_bundles.js').tierContents();
  const out = path.join(ROOT, 'local-test-artifacts/s5/module-tiers');
  const cases = [];
  for (const [tier, { files }] of Object.entries(tiers)) {
    fs.mkdirSync(path.join(out, tier), { recursive: true });
    for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(out, tier, name), bytes);
    cases.push({ tier, files: Object.fromEntries(Object.entries(files).map(([name, bytes]) =>
      [name, crypto.createHash('sha256').update(bytes).digest('hex')])) });
  }
  fs.writeFileSync(path.join(out, 'cases.json'), JSON.stringify({ synthetic: true, cases }, null, 2) + '\n');
  console.log('S5 module tier fixtures: actual Full/Partner/Public contents copied; full matrix NOT RUN');
}
// Cluster fixture: premises of Yakima County in tight groups whose sizes sit on CVI's cluster steps
// (9/10, 49/50, 199/200) plus 1,234 (MapLibre's "1.2k"), far enough apart to stay separate clusters at zoom 9. Two
// exporter groups share importer centers (their counts collide), and one group sits on Yakima's county name. groups.json
// lists each group's premises and the sums its cluster hover must show, computed here from the rows written: animals as
// summed, species per premises rounded half to even (R's round, CVI's species JSON), then summed per group.
const CLUSTER_GROUPS = [
  { id: 'I9', dir: 'Inbound', size: 9, center: [-121.25, 46.65] },
  { id: 'I10', dir: 'Inbound', size: 10, center: [-120.73755, 46.4568] },   // on the county name "Yakima"
  { id: 'I49', dir: 'Inbound', size: 49, center: [-121.0, 46.65] },
  { id: 'I50', dir: 'Inbound', size: 50, center: [-120.75, 46.65] },
  { id: 'I199', dir: 'Inbound', size: 199, center: [-120.5, 46.65] },
  { id: 'I200', dir: 'Inbound', size: 200, center: [-120.25, 46.65] },
  { id: 'I1234', dir: 'Inbound', size: 1234, center: [-120.0, 46.85] },
  { id: 'E3', dir: 'Outbound', size: 3, center: [-121.25, 46.65] },      // over I9
  { id: 'E12', dir: 'Outbound', size: 12, center: [-120.5, 46.65] }       // over I199
];
function generateClusters() {
  const out = path.join(ROOT, 'local-test-artifacts/s5/clusters'); fs.mkdirSync(out, { recursive: true });
  const halfEven = x => { const f = Math.floor(x); return x - f === 0.5 ? (f % 2 === 0 ? f : f + 1) : Math.round(x); };
  const rows = [], groups = [];
  CLUSTER_GROUPS.forEach((g, gi) => {
    const cols = Math.ceil(Math.sqrt(g.size)), nrows = Math.ceil(g.size / cols), inbound = g.dir === 'Inbound';
    const entry = { id: g.id, dir: g.dir, size: g.size, center: g.center, members: [], animals: 0, species: {} };
    for (let k = 0; k < g.size; k++) {
      const lon = +(g.center[0] + (k % cols - (cols - 1) / 2) * 0.0005).toFixed(6);
      const lat = +(g.center[1] + (Math.floor(k / cols) - (nrows - 1) / 2) * 0.0005).toFixed(6);
      const city = (inbound ? 'G' : 'X') + gi + 'P' + String(k).padStart(4, '0');
      const shipments = [['Cattle', 'Beef cattle', 1 + ((k * 37 + gi * 11) % 97) + (k === 0 ? 0.5 : 0)]];
      if (k % 3 === 0) shipments.push(['Poultry', 'Chickens', 2 + ((k * 13 + gi) % 41)]);
      shipments.forEach(([group, species, animals], r) => {
        rows.push([group, 2025, 'Q1', inbound ? 'Import' : 'Export', animals, inbound ? 'OR' : 'WA', inbound ? 'WA' : 'ID',
          inbound ? 'N/A' : 'Yakima', 46.5, -120.7, inbound ? 'Yakima' : 'N/A', 46.5, -120.7,
          inbound ? 45.5 : lat, inbound ? -122.6 : lon, inbound ? lat : 46.4, inbound ? lon : -117.0,
          inbound ? 'Synthetic origin' : city, inbound ? city : 'Synthetic destination',
          inbound ? 'O-synthetic' : 'X-' + gi + '-' + k, inbound ? 'D-' + gi + '-' + k : 'D-synthetic',
          'SYN-C-' + gi + '-' + k + '-' + r, species]);
        entry.animals += animals;
        entry.species[group] = (entry.species[group] || 0) + halfEven(animals);
      });
      entry.members.push(city);
    }
    entry.abbreviated = g.size >= 10000 ? Math.round(g.size / 1000) + 'k' : g.size >= 1000 ? Math.round(g.size / 100) / 10 + 'k' : String(g.size);
    groups.push(entry);
  });
  const csv = [HEADER, ...rows].map(r => r.join(',')).join('\n') + '\n';
  fs.writeFileSync(path.join(out, 'clusters.csv'), csv);
  fs.writeFileSync(path.join(out, 'groups.json'), JSON.stringify({ synthetic: true, county: 'Yakima', camera: { center: [-120.6, 46.65], zoom: 9 },
    sha256: crypto.createHash('sha256').update(csv).digest('hex'), groups }, null, 2) + '\n');
  console.log(`S5 cluster fixture: ${rows.length} rows, ${groups.reduce((t, g) => t + g.size, 0)} premises in ${groups.length} groups; ${out}`);
}

// S5 facility layers: synthetic reference folders for CVI's load_overlay_csv / .read_overlay_manifest /
// .overlay_groups, run unchanged by `Rscript tests/oracle/cvi_r_oracle.R s5-facilities`. Each case folder is a CVI
// "reference" folder. Edge cases: read.csv header names (spaces, BOM, duplicates), coordinate spellings and their
// priority, nonnumeric/blank/NA/hex coordinates, name-column fallbacks, markup in names, absent files, no coordinate
// column, no usable row; manifest overrides, extras, explicit and automatic colors (past the six-color pool), disabled,
// commented and blank rows, a repeated key, group order, a reserved key, a malformed manifest. Out-of-range points
// (approved difference: left out and counted by the page) are in their own file. All synthetic.
function generateFacilities() {
  const out = path.join(ROOT, 'local-test-artifacts/s5/facilities');
  fs.rmSync(out, { recursive: true, force: true });
  const files = {
    'usda_wa_slaughter_facilities.csv': '﻿USDA Slaughter Facility,City,Lat,Long\n' +
      'Synthetic Packer King,Kent,47.38,-122.23\n"Packer, Yakima",Yakima,46.6, -120.5\n' +
      'No lat,Seattle,,-122.3\nBad lat,Seattle,abc,-122.3\nNA lat,Seattle,NA,-122.3\nHex lon,Tacoma,47.2,0x1A\n' +
      '"<b>Bold</b> & Co",Renton, 47.48 ,-122.2\n',
    'wa_state_fairs.csv': 'fair name,LATITUDE,LONGITUDE,County\nSynthetic King Fair,47.4,-122.1,King\n' +
      'Synthetic Whidbey Fair,48.02,-122.4,Island\n,47.6,-122.0,King\n',
    'wa_state_public_livestock_markets.csv': 'Name,Y,Latitude,lat,x,lon\nMarket A,1,10,46.55,2,-120.45\nMarket B,1,10,47.3,2,-122.0\n',
    'wa_state_restricted_holding_facilities.csv': 'NAME,lat,long\nNo coordinates,,\nText coordinates,north,west\n',
    'markets_override.csv': 'Market Name,Market Name,latitude,longitude\nOverride Market,dup,46.7,-120.6\nSecond,dup2,47.5,-122.3\n',
    'extra_points.csv': 'id,Lat,Long\n1,47.45,-122.15\n2,46.65,-120.55\n',
    'extra_named.csv': 'Facility Name,Owner Name,lat,lng\nNamed One,Owner,47.42,-122.18\n',
    'out_of_range.csv': 'name,lat,long\nIn range,47.4,-122.2\nLat 95,95,-122.2\nLon 200,47.4,200\n'
  };
  const autos = Array.from({ length: 9 }, (_, i) => `auto${i + 1},extra_points.csv,,,,Retail,,`);
  const manifest = 'key,file,name_col,label,Live_Label,group,color,enabled\n' +
    'markets,markets_override.csv,Market Name,Mkts,Livestock Markets (override),Markets & Sales,,\n' +
    'claimed,extra_points.csv,,Claimed,,disposal,#4a8b2c,\n' +
    'named,extra_named.csv,Facility Name,,,Disposal,#123456,TRUE\n' +
    'fallback,extra_named.csv,Wrong Column,Fallback,,,,\n' +
    'noname,extra_points.csv,,,,Other,,\n' +
    'off,extra_points.csv,,,,Other,,no\n' +
    '#commented,extra_points.csv,,,,Other,,\n' +
    'blankfile,,,,,Other,,\n' +
    'absent,not_supplied.csv,,Absent layer,,Other,,\n' +
    'ranges,out_of_range.csv,,,,Other,#777777,\n' +
    'master,extra_points.csv,,,,Other,,\n' +
    autos.join('\n') + '\n' +
    'noname,extra_named.csv,,Repeated,,Other,,\n';
  const cases = {
    builtin: { files: Object.keys(files).filter(f => !['markets_override.csv', 'extra_points.csv', 'extra_named.csv', 'out_of_range.csv'].includes(f)), manifest: null },
    manifest: { files: Object.keys(files), manifest },
    malformed: { files: ['usda_wa_slaughter_facilities.csv'], manifest: 'key,path\nmarkets,markets_override.csv\n' }
  };
  const meta = { synthetic: true, cases: {} };
  for (const [name, c] of Object.entries(cases)) {
    const dir = path.join(out, name);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of c.files) fs.writeFileSync(path.join(dir, f), files[f]);
    if (c.manifest) fs.writeFileSync(path.join(dir, 'facility_overlays_manifest.csv'), c.manifest);
    meta.cases[name] = { files: c.files.concat(c.manifest ? ['facility_overlays_manifest.csv'] : []).map(f => ({ file: f,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex') })) };
  }
  fs.writeFileSync(path.join(out, 'cases.json'), JSON.stringify(meta, null, 2) + '\n');
  console.log(`S5 facility fixture: ${Object.keys(cases).length} reference folders; ${out}`);
}
if (require.main === module) {
  const mode = process.argv.slice(2).join(' ');
  if (mode === '--clusters') generateClusters();
  else if (mode === '--facilities') generateFacilities();
  else if (mode === '--scaling-gate') generate();
  else if (mode === '--membership') generateMembership();
  else if (mode === '--premises') generatePremises();
  else if (mode === '--payloads') generatePremises(true);
  else if (mode === '--module-route') generateModuleRoute();
  else if (mode === '--module-facilities') generateModuleRoute(true);
  else if (mode === '--module-tiers') generateModuleTiers();
  else throw new Error('Use --scaling-gate, --membership, --module-route, --module-facilities, --module-tiers, --premises, --payloads --clusters or --facilities; full S5 fixtures are not built yet.');
}
module.exports = { generate, generateClusters, generateFacilities, CLUSTER_GROUPS, generateMembership, generateModuleRoute, generateModuleTiers, values, HEADER };
