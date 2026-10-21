#!/usr/bin/env node
'use strict';
// Emergency Response unit tests (Node >= 22, no packages): the rules (site/emergency/rules.js) against the R
// reference (tests/oracle/em_oracle.R, local-test-artifacts/em/oracle_em.json), the emergency types (types.js, the HPAI
// type and the made-up third type in tests/synthetic/em_made_up_type.js), the dataset list (site/emergency/datasets.js)
// and its recognition through the shared recognize.js (positives by their marker columns, the collision cases, the
// zone kind and the shapefile reason), the Emergency sample, bundle.json's shared entries and the guide's Emergency
// part. The page's own files run unchanged in Node.
// Usage (repository root): node tests/node/run_em_unit_tests.js   (also writes the fixtures, make_em_fixtures.js)
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const SITE = path.join(ROOT, 'site');
for (const f of ['cvi/app/csv.js', 'cvi/app/master.js', 'cvi/app/scaling.js', 'cvi/app/summary.js', 'cvi/app/lookup.js',
  'shared/zip.js', 'shared/load.js', 'shared/recognize.js', 'shared/bundle.js', 'shared/checklist.js',
  'shared/sample.js', 'shared/guide.js', 'shared/zones.js', 'shared/proximity.js', 'shared/facility-datasets.js',
  'cvi/datasets.js', 'infrastructure/datasets.js', 'emergency/datasets.js', 'emergency/sample.js', 'emergency/types.js',
  'emergency/types/hpai.js', 'emergency/rules.js']) {
  require(path.join(SITE, f));
}
const { recognize: R, bundle: B, checklist: C, guide: G, zones: Z, emergencyTypes: T, emergencyRules: E,
  proximity: PX } = globalThis.WSDA;
const EM = globalThis.WSDA.profiles.emergency, CVI = globalThis.WSDA.profiles.cvi;
const INF = globalThis.WSDA.profiles.infrastructure;
const FX = require(path.join(ROOT, 'tests', 'synthetic', 'make_em_fixtures.js'));

let pass = 0, fail = 0; const failures = [];
const check = (ok, name, detail) => {
  if (ok) pass++;
  else { fail++; failures.push(name + (detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 400) : '')); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const throws = (fn, re, name) => {
  try { fn(); check(false, name + ' (expected an error)'); }
  catch (e) { check(e instanceof TypeError && re.test(e.message), name, e.message); }
};

// A loader item (as load.js makes) from a name and its text.
let seq = 0;
function item(name, text, p) {
  const bytes = Buffer.from(text, 'utf8');
  return { id: 'i' + (++seq), path: p || name, name, size: bytes.length, source: 'files',
    read: async () => new Uint8Array(bytes), text: async () => text, head: async n => bytes.subarray(0, n).toString('utf8') };
}
const ds = (res, id) => res.datasets.find(d => d.id === id);
const fileOf = (res, it) => res.files.find(f => f.id === it.id);
const MASTER_HEAD = CVI.datasets[0].columns.join(',');

(async () => {
  // ---- 1. The emergency types ---------------------------------------------------------------------------------
  const hpai = T.get('hpai');
  check(T.list().map(t => t.id).join() === 'hpai', 'types: HPAI is the one type the page loads, and the default');
  check(hpai.name === 'Highly pathogenic avian influenza (HPAI)' && same(hpai.diseaseWords, ['hpai', 'avian influenza', 'h5n1', 'h5']),
    'HPAI: name and disease words', hpai.diseaseWords);
  check(same(hpai.statuses.map(s => s.label), ['Confirmed', 'Presumptive', 'Suspect']) && hpai.statuses.every(s => /^#[0-9a-f]{6}$/.test(s.color)),
    'HPAI: three statuses, each with a color', hpai.statuses);
  check(hpai.closed.column === 'Surveillance Closed' && same(hpai.closed.values, ['yes', 'y', 'true', '1']), 'HPAI: the closed rule');
  check(hpai.zones.source === 'rings' && hpai.zones.applyTo === 'open' && hpai.zones.unit === 'km'
    && same(hpai.zones.rings.map(r => [r.distance, r.label]), [[3, 'Infection zone'], [10, 'Control zone']]),
    'HPAI: rings of 3 km (Infection zone) and 10 km (Control zone) around open positives', hpai.zones);
  // The keys of WSDA's own facility list (CVI_Traceability's reference/facility_overlays_manifest.csv).
  check(same(hpai.layers.bySpecies[0].keys, ['poultry', 'premises', 'markets', 'fairgrounds', 'disposal'])
    && same(hpai.layers.bySpecies[1].keys, ['milkproducer', 'milkprocessing', 'premises', 'markets', 'feedlots', 'fairgrounds', 'disposal']),
    'HPAI: suggested layer keys for poultry and cattle, by WSDA\'s own manifest keys', hpai.layers);
  check(hpai.links.length === 2 && hpai.links.every(l => /^https:\/\//.test(l.url)) && /APHIS/.test(hpai.links[0].label)
    && /CDC/.test(hpai.links[1].label), 'HPAI: the APHIS and CDC reference links', hpai.links);
  check(Object.isFrozen(hpai) && Object.isFrozen(hpai.zones.rings[0]), 'types: a loaded type cannot be changed by the page');
  const label = (t, v) => (T.statusOf(t, v) || {}).label;
  check(label(hpai, ' CONFIRMED ') === 'Confirmed' && label(hpai, 'pending') === 'Suspect'
    && T.statusOf(hpai, 'Unknown') === null && T.statusOf(hpai, '') === null, 'types: a status by its spellings, any case');
  check(T.isClosed(hpai, 'Yes') && T.isClosed(hpai, ' y ') && T.isClosed(hpai, 'TRUE') && !T.isClosed(hpai, 'No')
    && !T.isClosed(hpai, ''), 'types: closed by the type\'s values, any case');
  check(T.pick(null).type === hpai && T.pick([]).type === hpai, 'pick: no Disease Name column: the first type (HPAI)');
  check(T.pick(['HPAI H5N1', 'Avian Influenza', 'h5n1']).type === hpai && T.pick(['HPAI H5N1']).counts.hpai === 1,
    'pick: HPAI by its words, any case');
  check(T.pick(['ah5 strain']).counts.hpai === 0 && T.pick(['H5 clade']).counts.hpai === 1,
    'pick: a word matches at the start of a word only ("ah5" is not "h5")');

  // A type file with a mistake is stopped with a message naming the field.
  const good = () => JSON.parse(JSON.stringify(hpai));
  const bad = (change, re, name) => { const t = good(); t.id = 'test-bad'; change(t); throws(() => T.check(t), re, 'types: ' + name); };
  bad(t => { t.id = 'Bad Id'; }, /"id" should be/, 'an id with capitals and spaces');
  bad(t => { delete t.name; }, /"test-bad": "name" should be a text/, 'no name');
  bad(t => { t.diseaseWords = []; }, /"diseaseWords" should be a list of one or more words/, 'no disease words');
  bad(t => { t.statuses[1].color = 'red'; }, /"statuses\[1\]\.color" should be a color written #rrggbb/, 'a status color by name');
  bad(t => { delete t.closed.column; }, /"closed\.column"/, 'no closed column');
  bad(t => { t.zones.source = 'circles'; }, /"zones\.source" should be one of "rings", "file"/, 'an unknown zone source');
  bad(t => { t.zones.applyTo = 'closed'; }, /"zones\.applyTo"/, 'an unknown applyTo');
  bad(t => { t.zones.unit = 'mi'; }, /"zones\.unit" should be one of "km"/, 'miles (not in E1a)');
  bad(t => { t.zones.rings = []; }, /"zones\.rings" should be a list of one or more rings when zones\.source is "rings"/, 'rings with no ring');
  bad(t => { t.zones.rings[0].distance = 0; }, /"zones\.rings\[0\]\.distance"/, 'a ring of 0 km');
  bad(t => { t.layers.default = ['bad key!']; }, /"layers\.default"/, 'a layer key with spaces');
  bad(t => { t.links[0].url = 'http://example.org'; }, /"links\[0\]\.url" should be an https:\/\/ address/, 'a link without https');
  throws(() => T.add(good()), /"hpai" is added twice/, 'types: the same id twice is refused');

  // The third-type test: a made-up type file, loaded as a new type would be, with a different value in every field.
  require(path.join(ROOT, 'tests', 'synthetic', 'em_made_up_type.js'));
  const made = T.get('made-up-pox');
  check(T.list().map(t => t.id).join() === 'hpai,made-up-pox', 'third type: added after HPAI, by its file alone');
  check(T.pick(['Made-up pox', 'MUP outbreak', 'HPAI']).type === made && T.pick(['HPAI', 'HPAI', 'mup']).type === hpai
    && T.pick(['nothing known']).type === hpai, 'third type: picked by its own words; most values win; none known: HPAI');
  check(label(made, 'Open case') === 'Active' && label(made, 'monitor') === 'Watch'
    && T.statusOf(made, 'Confirmed') === null && T.statusOf(hpai, 'Active') === null,
    'third type: its own statuses; HPAI\'s spellings do not leak into it, nor its into HPAI');
  check(made.closed.column === 'Released' && T.isClosed(made, 'DONE') && !T.isClosed(made, 'yes'),
    'third type: its own closed column and values');
  check(made.zones.source === 'file' && made.zones.rings.length === 0 && made.zones.applyTo === 'all',
    'third type: zones from a file, for every positive, with no rings');
  check(same(made.layers.default, ['feedlots']) && same(made.layers.bySpecies[0].keys, ['restricted', 'slaughterhouses'])
    && made.links[0].url === 'https://example.org/made-up-pox', 'third type: its own layer keys and link');

  // ---- 2. Recognition -----------------------------------------------------------------------------------------
  const rec = (items, profile, opts) => R.recognize(items, profile || EM, opts || {});
  const F = FX.FILES;
  {
    const tool = item('em_positives_tool.csv', F['em_positives_tool.csv']);
    const r = await rec([tool]);
    check(ds(r, 'positives').status === 'found' && fileOf(r, tool).via === 'columns' && same(fileOf(r, tool).layers, []),
      'recognition: the HPAI tool\'s CSV is the positives file, by its columns, and offers no facility layer', fileOf(r, tool));
    const demo = item('cases.csv', F['em_positives_demo.csv']);
    check(ds(await rec([demo]), 'positives').status === 'found', 'recognition: the demo\'s columns (Case Lat, Case Long, ...) are positives');
    const one = item('one.csv', F['em_positives_one_marker.csv']);
    check(ds(await rec([one]), 'positives').status === 'found', 'recognition: Latitude, Longitude and one marker column are enough');
    const lower = item('x.csv', 'case lat,case long,case status\n46.5,-120.4,confirmed\n');
    check(ds(await rec([lower]), 'positives').status === 'found', 'recognition: marker and coordinate columns in any case');
  }
  {   // Collisions: a premises or facility file with Premise Location stays a facility layer; the master is not positives.
    const noMarker = item('em_no_marker.csv', F['em_no_marker.csv']);
    let r = await rec([noMarker]);
    check(ds(r, 'positives').status === 'missing' && fileOf(r, noMarker).candidates && fileOf(r, noMarker).candidates.length > 1,
      'collision: Lat, Long, County and Premise Location without a marker are not positives (an unclear facility layer)', fileOf(r, noMarker));
    const feed = item('wa_state_feedlots.csv', F['em_premises_location.csv']);
    r = await rec([feed]);
    check(ds(r, 'feedlots').status === 'found' && ds(r, 'positives').status === 'missing',
      'collision: a facility file named as a layer, with a Premise Location column, is that layer, not positives');
    const master = item('CVI_Consolidated_Master.csv', fs.readFileSync(path.join(ROOT, 'tests', 'synthetic', 'cvi_master_small.csv'), 'utf8'));
    r = await rec([master]);
    check(ds(r, 'master').status === 'found' && ds(r, 'positives').status === 'missing',
      'collision: the CVI master (Origin.Lat and the like) is the master, not positives');
    const a = item('a.csv', F['em_positives_tool.csv']), b = item('b.csv', F['em_positives_demo.csv']);
    r = await rec([a, b]);
    check(ds(r, 'positives').status === 'conflict' && r.needsChoice.some(c => c.dataset === 'positives'),
      'two positives files: a choice to make, as for any dataset', ds(r, 'positives'));
  }
  {   // The other dashboards see a positives file as before (an unclear facility layer for CVI), and no zone kind.
    const tool = item('em_positives_tool.csv', F['em_positives_tool.csv']);
    const r = await rec([tool], CVI);
    check(!r.datasets.some(d => d.id === 'positives' || d.kind === 'zone') && fileOf(r, tool).candidates,
      'CVI: no positives or zone dataset; the positives file is an unclear facility layer, as before', fileOf(r, tool));
  }
  {   // Zone files
    const gj = item('em_zone.geojson', F['em_zone.geojson']), kml = item('em_zone.kml', F['em_zone.kml']);
    let r = await rec([gj]);
    check(ds(r, 'zones').status === 'found' && ds(r, 'zones').fileId === gj.id && fileOf(r, gj).status === 'used'
      && fileOf(r, gj).dataset === 'zones' && fileOf(r, gj).via === 'file type', 'zones: a GeoJSON file is the zone file, by its extension', fileOf(r, gj));
    r = await rec([kml]);
    check(ds(r, 'zones').status === 'found' && ds(r, 'zones').fileId === kml.id, 'zones: a KML file is the zone file');
    r = await rec([gj, kml]);
    check(ds(r, 'zones').status === 'conflict' && r.needsChoice.some(c => c.dataset === 'zones'),
      'zones: two zone files are a choice to make', ds(r, 'zones'));
    r = await rec([gj, kml], EM, { choices: { zones: kml.id } });
    check(ds(r, 'zones').status === 'found' && ds(r, 'zones').fileId === kml.id, 'zones: the user\'s choice settles it');
    r = await rec([gj, kml], EM, { files: { zones: 'em_zone.kml' } });
    check(ds(r, 'zones').fileId === kml.id && fileOf(r, kml).via === 'bundle.json' && fileOf(r, gj).status === 'not-used'
      && /bundle\.json names "em_zone\.kml" as the Zone file/.test(fileOf(r, gj).reason),
      'zones: bundle.json names which zone file to use', [fileOf(r, kml), fileOf(r, gj)]);
    const pos = item('emergency_case_sites.csv', F['em_positives_tool.csv']);
    r = await rec([pos, gj], EM, { files: { zones: 'emergency_case_sites.csv' } });
    check(ds(r, 'positives').status === 'found' && ds(r, 'zones').fileId === gj.id
      && /bundle\.json names it as the Zone file, but it is not a \.geojson or \.kml file; it was recognized as the Positives instead/.test(fileOf(r, pos).warning),
      'zones: bundle.json naming a CSV as the zone file is reported; the CSV is still recognized', fileOf(r, pos).warning);
    r = await rec([gj], EM, { files: { master: 'em_zone.geojson' } });
    check(ds(r, 'zones').status === 'found' && /bundle\.json names it as "master", but it is a zone file \(\.geojson\)/.test(fileOf(r, gj).warning),
      'zones: bundle.json naming a zone file as another dataset is reported; the file is still the zone file', fileOf(r, gj).warning);
    r = await rec([gj], CVI);
    check(fileOf(r, gj).status === 'not-used' && fileOf(r, gj).reason === 'GeoJSON map layers are not used by the CVI Traceability dashboard',
      'CVI: a GeoJSON file is not used, with the same reason as before', fileOf(r, gj).reason);
    r = await rec([kml], INF);
    check(fileOf(r, kml).reason === 'not a CSV file', 'Infrastructure: a KML file is "not a CSV file", as before', fileOf(r, kml).reason);
    // One load checked for several dashboards (a shared cache, as the landing page's checklist keeps): the reason and
    // the zone kind are worked out for each dashboard, never taken from the first one checked.
    const cache = new Map();
    await rec([gj], CVI, { cache });
    r = await rec([gj], EM, { cache });
    check(ds(r, 'zones').status === 'found', 'cache: a GeoJSON checked for CVI first is still the zone file for Emergency');
    r = await rec([gj], INF, { cache });
    check(fileOf(r, gj).reason === 'GeoJSON map layers are not used by the Infrastructure dashboard',
      'cache: after switching, the reason names the dashboard checked (it named the first one before)', fileOf(r, gj).reason);
  }
  {   // A zipped shapefile arrives unpacked from a bundle: its parts say where to load it.
    const parts = ['zone.shp', 'zone.dbf', 'zone.shx', 'zone.prj'].map(n => item(n, 'x'));
    let r = await rec(parts);
    check(parts.every(p => fileOf(r, p).reason === 'it is part of a shapefile; load the zipped shapefile on the Emergency Response page, under Zones'),
      'shapefile parts: the reason says to load the zipped shapefile under Zones', parts.map(p => fileOf(r, p).reason));
    r = await rec(parts, INF);
    check(parts.every(p => fileOf(r, p).reason === 'not a CSV file'), 'shapefile parts: Infrastructure says "not a CSV file", as before');
  }
  {   // The fixture folder bundle: positives, a feedlots file, a zone file and bundle.json for Emergency
    const items = Object.entries(FX.BUNDLE).map(([p, text]) => item(path.basename(p), text, p));
    const r = await rec(items);
    check(ds(r, 'positives').status === 'found' && ds(r, 'feedlots').status === 'found' && ds(r, 'zones').status === 'found',
      'fixture bundle: positives, a feedlots layer and the zone file', r.datasets.filter(d => d.status === 'found').map(d => d.id));
  }

  // ---- 3. The sample --------------------------------------------------------------------------------------------
  const S = globalThis.WSDA.samples.emergency;
  const e1 = S.entries(), e2 = S.entries();
  const zipA = globalThis.WSDA.sample.zip(e1), zipB = globalThis.WSDA.sample.zip(e2);
  check(Buffer.compare(Buffer.from(zipA), Buffer.from(zipB)) === 0, 'sample: the same bytes every time');
  check(S.fileName === 'emergency_synthetic.zip' && same(e1.map(e => e.name), ['emergency_case_sites.csv',
    'wa_state_public_livestock_markets.csv', 'wa_state_fairs.csv', 'wa_state_feedlots.csv', 'facility_overlays_manifest.csv',
    'synthetic_commercial_poultry.csv', 'synthetic_dairies.csv', 'synthetic_premises.csv', 'synthetic_disposal_sites.csv',
    'synthetic_control_area.geojson', 'bundle.json']), 'sample: its files', e1.map(e => e.name));
  const sampleText = Object.fromEntries(e1.map(e => [e.name, new TextDecoder().decode(e.data)]));
  {
    const items = Object.entries(sampleText).map(([n, t]) => item(n, t));
    const r = await rec(items);
    const found = r.datasets.filter(d => d.status === 'found').map(d => d.id);
    check(same(found, ['positives', 'fairgrounds', 'markets', 'feedlots', 'manifest', 'zones', 'poultry',
      'milkproducer', 'premises', 'disposal']) && r.files.every(f => f.status === 'used' || f.status === 'bundle'),
    'sample: every file used: positives, three built-in layers, the manifest and its four layers, the zone', found);
    check(ds(r, 'master').status === 'missing', 'sample: no CVI master (CVI movements stay off)');
    const gates = C.gate(r, EM);
    check(same(gates.map(g => g.id + ':' + g.on), ['positives:true', 'layers:true', 'cvi-movements:false', 'species-refine:false']),
      'sample: positives and layers on; CVI movements off without a master', gates);
    check(ds(r, 'positives').missingUseful.length === 0, 'sample: the positives carry every useful column');
    const b = await B.read(items);
    check(b.found && same(b.info.profiles, ['emergency']) && b.info.synthetic === true && b.warnings.length === 0,
      'sample: bundle.json for Emergency, marked synthetic', b);
    const rows = R.parseCsv(sampleText['emergency_case_sites.csv']);
    const loc = rows[0].indexOf('Premise Location');
    check(rows.slice(1).every(row => row[loc].startsWith('(synthetic) ')), 'sample: every Premise Location is marked "(synthetic)"');
    const zr = Z.readGeoJson(sampleText['synthetic_control_area.geojson'], 'synthetic_control_area.geojson');
    check(zr.zones.length === 1 && zr.zones[0].name === 'Synthetic control area', 'sample: the zone file reads as one zone', zr.zones.map(z => z.name));
  }

  // ---- 4. Zone fixtures read by shared/zones.js ---------------------------------------------------------------
  {
    const hole = Z.readGeoJson(F['em_zone_hole.geojson'], 'em_zone_hole.geojson');
    check(hole.zones.length === 1 && hole.zones[0].geometry.coordinates.length === 2, 'zone fixtures: the polygon keeps its hole');
    let msg = '';
    try { Z.readGeoJson(F['em_zone_stateplane.geojson'], 'em_zone_stateplane.geojson'); } catch (e) { msg = e.message; }
    check(/longitude and latitude/.test(msg), 'zone fixtures: the State Plane file is refused, saying why', msg);
  }

  // ---- 5. bundle.json: entries shared between dashboards --------------------------------------------------------
  {
    const b = await B.read([item('bundle.json', JSON.stringify({ profiles: ['cvi'],
      files: { feedlots: 'f.csv', master: 'm.csv', positives: 'p.csv' } }))]);
    const ids = new Set([...EM.datasets, ...CVI.datasets].map(d => d.id));
    const files = B.filesFor(b, EM, { reuseShared: true, datasets: EM.datasets });
    check(same(Object.keys(files).sort(), ['feedlots', 'master']) && ids.size > 0,
      'bundle: switching from a CVI bundle to Emergency keeps the shared entries (master, layers) only', files);
    const none = B.filesFor(b, EM, {});
    check(same(Object.keys(none), []), 'bundle: without an explicit switch, a CVI bundle\'s entries are not used for Emergency');
    const own = await B.read([item('bundle.json', JSON.stringify({ profiles: ['emergency'], files: { zones: 'z.kml' } }))]);
    check(B.filesFor(own, EM).zones === 'z.kml', 'bundle: an Emergency bundle\'s entries are used for Emergency');
  }

  // ---- 6. The guide's Emergency part ------------------------------------------------------------------------
  {
    const m = G.model(EM);
    const z = m.datasets.find(d => d.id === 'zones'), p = m.datasets.find(d => d.id === 'positives');
    check(z && same(z.columns, ['No columns: a .geojson or .kml file of polygons, in longitude and latitude']) && same(z.exact, [false]),
      'guide: the zone file is described by its file types, not columns', z);
    check(p.required && p.columns.length === 3 && /at least one of Surveillance Closed/.test(p.columns[2]), 'guide: the positives\' columns', p.columns);
    const h = G.html(EM, {}).replace(/<wbr>/g, '');
    check(/data-guide-part="emergency"/.test(h) && /emergency_case_sites\.csv/.test(h) && /Needs the Positives/.test(h),
      'guide: the Emergency part, with its file names and what it needs');
    const all = G.allInOneHtml();
    check(/emergency\/[\s\S]*emergency_case_sites\.csv[\s\S]*zones\.geojson/.test(all) && !/later, with the Emergency dashboard/.test(all),
      'guide: the folder layout lists the Emergency files');
  }

  // ---- 7. The fixtures on disk ----------------------------------------------------------------------------------
  execFileSync(process.execPath, [path.join(ROOT, 'tests', 'synthetic', 'make_em_fixtures.js')]);
  const digest = () => Object.keys(Object.assign({}, FX.FILES, FX.BUNDLE)).map(n =>
    crypto.createHash('sha256').update(fs.readFileSync(path.join(FX.OUT, n))).digest('hex')).join();
  const d1 = digest();
  execFileSync(process.execPath, [path.join(ROOT, 'tests', 'synthetic', 'make_em_fixtures.js')]);
  check(d1 === digest(), 'fixtures: written, and the same bytes on a second run');

  // ---- 8. The rules ------------------------------------------------------------------------------------------------
  const FXD = FX.OUT;
  const csvOf = name => R.parseCsv(fs.readFileSync(path.join(FXD, name), 'utf8')).filter(r => !(r.length === 1 && r[0] === ''));
  const posRows = csvOf('em_rules_positives.csv');
  const read = E.readPositives(posRows[0], posRows.slice(1), null);
  {
    check(read.type === hpai, 'rules: a Disease Name of "HPAI H5N1" picks the HPAI type');
    check(same(read.positives.map(p => p.name), ['R-001', 'Positive 2 (Yakima)', 'R-003', 'Positive 4', 'R-005', 'R-007']),
      'rules: named by report ID, else "Positive n (County)" in file order, or "Positive n" without a county', read.positives.map(p => p.name));
    check(same(read.dropped, [{ line: 7, reason: 'no usable latitude and longitude' }]), 'rules: a row without usable coordinates is dropped, with its line', read.dropped);
    check(same(read.positives.map(p => p.status && p.status.label), ['Confirmed', 'Presumptive', 'Suspect', null, 'Confirmed', 'Suspect']),
      'rules: statuses by the type\'s spellings ("Pending" is Suspect); a blank status is none', read.positives.map(p => p.statusText));
    check(same(read.positives.map(p => p.closed), [false, false, true, false, false, false]), 'rules: closed by "Surveillance Closed" (Yes); blank is open');
    check(same(read.positives.map(p => p.detected), ['2026-09-02', '2026-09-10', '2026-08-21', null, '2026-10-05', '2026-09-30']) && read.badDates === 1,
      'rules: dates written YYYY-MM-DD, M/D/YYYY and YYYY/MM/DD read; one unreadable counted', read.positives.map(p => p.detected));
    check(read.columns.id === 'AnimalDiseaseReportId' && read.columns.closed === 'Surveillance Closed' && read.columns.lat === 'Lat'
      && Object.values(read.columns).every(c => c === null || !E.PRIVATE.test(c)), 'rules: the columns read; none holds an address', read.columns);
    check(!/MARKED-ADDRESS/.test(JSON.stringify(read)), 'rules: no address reaches the positives read');
    const choices = E.statusChoices(hpai, read.positives);
    check(same(choices.map(c => c.key + ':' + c.count), ['Confirmed:2', 'Presumptive:1', 'Suspect:2', 'none:1']), 'rules: the status tick boxes, with "No status"', choices);
    const ticks = E.defaultTicks(hpai, read.positives);
    check(same(ticks, { statuses: ['Confirmed', 'Presumptive', 'Suspect', 'none'], closed: false }), 'rules: by default every status, closed positives without zones', ticks);
    read.targets = E.targets(read.positives, ticks);
    check(same(read.targets.map(p => p.name), ['R-001', 'Positive 2 (Yakima)', 'Positive 4', 'R-005', 'R-007']), 'rules: five positives get zones (not the closed one)');
    check(same(E.targets(read.positives, { statuses: ['Confirmed'], closed: false }).map(p => p.name), ['R-001', 'R-005'])
      && same(E.targets(read.positives, { statuses: ['Suspect'], closed: true }).map(p => p.name), ['R-003', 'R-007']),
    'rules: unticking statuses, and ticking closed, change which get zones');
  }
  // The layers as the page gives them: each point's name, place, geo_source and precision columns.
  const layerOf = l => {
    const rows = csvOf(l.file), header = rows[0], col = n => header.indexOf(n);
    const prec = E.precisionRows(header, rows.slice(1));
    return { key: l.key, label: l.label, color: '#000000', points: rows.slice(1).map((r, k) => ({ name: r[col('name')],
      lat: PX.number(r[col('lat')]), lon: PX.number(r[col('long')]), county: null, town: null,
      geoSource: col('geo_source') >= 0 ? r[col('geo_source')] : '', precision: prec[k] })) };
  };
  const layers = FX.RULES.layers.map(layerOf);
  const rings = hpai.zones.rings;
  const sites = E.ringSites(read.targets, rings);
  const res = E.inside(sites, layers, { mode: 'rings', rings, positives: read.targets });
  {
    check(same(sites.map(st => st.name), read.targets.map(p => p.name)) && sites.every(st => same(st.radii, [3, 10])),
      'rules: one site per positive with zones, its rings 3 and 10 km');
    check(same(res.leftOut.map(x => x.name + ': ' + x.reason), ['Rules Dairy 3: location precision "city"',
      'Rules Dairy 4: address not matched', 'Rules Dairy 5: not a street address', 'Rules Dairy 9: no location precision',
      'Rules Poultry Town: located only to a town', 'Rules Poultry Unplaced: not placed', 'Rules Premises 2: address not matched']),
    'rules: left out, with their reasons (RAD\'s three columns and the town-level rule)', res.leftOut);
    check(!res.leftOut.some(x => x.name === 'Rules Dairy 6'), 'rules: "ROOFTOP" counts as rooftop (lowercased, as RAD stores it)');
    const row = n => res.rows.filter(r => r.name === n);
    const e3 = row('Rules Poultry Edge 3 km'), e10 = row('Rules Poultry Edge 10 km');
    check(e3.length >= 1 && e3.some(r => r.siteName === 'R-001' && Math.abs(r.exactKm - 3) < 1e-9 && r.zone === (r.exactKm <= 3 ? 'Infection zone' : 'Control zone')),
      'rules: a point 3 km from a positive is inside (its ring by the edge rule)', e3);
    check(e10.some(r => r.siteName === 'Positive 2 (Yakima)' && Math.abs(r.exactKm - 10) < 1e-9 && r.exactKm <= 10),
      'rules: a point 10 km from a positive is inside: the edge counts', e10);
    check(!row('Rules Poultry By Closed').length, 'rules: a point near only the closed positive is not inside');
    const between = row('Rules Market Between');
    const markets = res.layers.find(l => l.key === 'markets');
    check(same(between.map(r => r.siteName), ['R-001', 'Positive 2 (Yakima)']) && markets.inside === 1,
      'rules: a site inside two positives\' zones is listed under each, and counted once', [between, markets]);
    const disposal = res.layers.find(l => l.key === 'disposal');
    check(disposal.inside === 0 && disposal.nearest && disposal.nearest.name === 'Rules Landfill North' && disposal.nearest.from === 'R-001'
      && disposal.nearest.km === 25, 'rules: a layer with nothing inside gets its nearest site and distance', disposal.nearest);
    check(E.countLine(disposal) === 'Disposal sites: none inside. Nearest: Rules Landfill North, 25 km from R-001', 'rules: the "nearest" line', E.countLine(disposal));
    const dairies = res.layers.find(l => l.key === 'dairies');
    check(/^Dairies: \d+ in the Infection zone(, | and )\d+ in the Control zone$/.test(E.countLine(dairies)) && dairies.leftOut === 4,
      'rules: the count line by ring', E.countLine(dairies));
    const order = res.rows.map(r => r.site + '/' + layers.findIndex(l => l.key === r.layer) + '/' + r.exactKm);
    const sorted = res.rows.slice().sort((a, b) => layers.findIndex(l => l.key === a.layer) - layers.findIndex(l => l.key === b.layer) || a.site - b.site || a.exactKm - b.exactKm);
    check(same(order, sorted.map(r => r.site + '/' + layers.findIndex(l => l.key === r.layer) + '/' + r.exactKm)), 'rules: rows layer by layer, then site by site, nearest first');
    const all = E.inside(sites, layers, { mode: 'rings', rings, positives: read.targets, includeCoarse: true });
    check(!all.leftOut.length && all.rows.length > res.rows.length, 'rules: "include coarse locations" leaves nothing out');
    const boxes = E.valueBoxes(read, res);
    check(boxes.positives.value === 6 && boxes.positives.note === '5 with zones' && boxes.last.value === '2026-10-05'
      && boxes.inside.value === res.total && res.total > 0, 'rules: the value boxes', boxes);
    const noDate = E.readPositives(['Lat', 'Long', 'Surveillance Closed'], [['46.5', '-120.4', 'No']], hpai);
    const nb = E.valueBoxes(noDate, null);
    check(nb.last.value === null && nb.last.reason === 'Not available: needs Detection Date' && nb.inside.value === null
      && nb.inside.reason === 'Not available: needs a facility layer', 'rules: missing columns give "Not available: needs ...", never zero', nb);
    const ex = E.exportRows(read, read.targets, res, 'km');
    check(same(ex.positives.columns, ['Positive', 'Status', 'Closed', 'Detection Date', 'County', 'Latitude', 'Longitude', 'Zones'])
      && ex.positives.rows.length === 6 && ex.inside.rows.length === res.rows.length && ex.leftOut.rows.length === 7
      && same(ex.layers.columns.slice(2, 4), ['Infection zone', 'Control zone']), 'rules: the export rows', ex.layers.columns);
    check(!/MARKED-ADDRESS/.test(JSON.stringify(ex)) && !/MARKED-ADDRESS/.test(JSON.stringify(res)),
      'rules: the address in "Premise Location" reaches no export and no result');
    check(same(E.suggestedLayers(hpai, read.positives, ['milkproducer', 'markets', 'feedlots']), ['milkproducer', 'markets', 'feedlots'])
      && same(E.suggestedLayers(hpai, [{ species: 'Backyard poultry' }], ['milkproducer', 'markets', 'poultry']), ['poultry', 'markets'])
      && same(E.suggestedLayers(hpai, [{ species: 'Dairy cattle' }], ['milkproducer', 'poultry', 'feedlots']), ['milkproducer', 'feedlots']),
    'rules: the suggested layers by species, else the default list; only loaded layers');
  }
  {   // Zones from a file (the polygon with a hole): inside its outline, not in its hole.
    const zf = Z.readGeoJson(fs.readFileSync(path.join(FXD, 'em_zone_hole.geojson'), 'utf8'), 'em_zone_hole.geojson');
    const zr = E.inside(E.zoneSites(zf.zones), layers, { mode: 'zones', positives: read.targets });
    check(zr.rows.length > 0 && zr.rows.every(r => r.exactKm === 0 && r.zone === 'Synthetic zone with a hole')
      && !zr.rows.some(r => r.name === 'Rules Market Between'), 'rules: zones from a file: inside the outline, a point in the hole left out', zr.rows.map(r => r.name));
    check(/^Dairies: \d+ in Synthetic zone with a hole$/.test(E.countLine(zr.layers[0])), 'rules: the count line names the zone', E.countLine(zr.layers[0]));
  }
  {   // The third-type test, continued: the made-up type's fields reach the rules' results.
    const head = ['Case Lat', 'Case Long', 'Disease Name', 'Case Status', 'Released', 'Species'];
    const rows = [['46.5', '-120.4', 'Made-up pox', 'Open case', 'no', 'Goat'], ['46.6', '-120.5', 'Made-up pox', 'Monitor', 'DONE', 'Sheep'],
      ['46.7', '-120.6', 'Made-up pox', 'Confirmed', '', 'Goat']];
    const mr = E.readPositives(head, rows, null);
    check(mr.type === made && same(mr.positives.map(p => p.status && p.status.label), ['Active', 'Watch', null])
      && same(mr.positives.map(p => p.status && p.status.color), ['#1b7837', '#762a83', null]),
    'third type: picked by its words; its statuses and colors reach the positives ("Confirmed" is not one of them)', mr.positives);
    check(same(mr.positives.map(p => p.closed), [false, true, false]), 'third type: its closed column "Released" and value "done" reach the positives');
    const mt = E.defaultTicks(made, mr.positives);
    check(mt.closed === true && E.targets(mr.positives, mt).length === 3, 'third type: zones.applyTo "all" gives every positive zones, closed too', mt);
    check(same(E.suggestedLayers(made, mr.positives, ['restricted', 'slaughterhouses', 'feedlots', 'dairies']), ['restricted', 'slaughterhouses'])
      && same(E.suggestedLayers(made, [{ species: 'Cattle' }], ['feedlots', 'dairies']), ['feedlots']),
    'third type: its own layer keys by species, and its default list');
    const conf = E.defaultTicks({ statuses: [{ label: 'A' }, { label: 'B' }], zones: { applyTo: 'confirmed' } }, []);
    check(same(conf, { statuses: ['A'], closed: false }), 'types: applyTo "confirmed" ticks the first status only', conf);
  }

  // ---- 9. The rules against the R reference ------------------------------------------------------------------
  const ORACLE = path.join(ROOT, 'local-test-artifacts', 'em', 'oracle_em.json');
  if (!fs.existsSync(ORACLE)) check(false, 'R reference missing: run Rscript tests/oracle/em_oracle.R first');
  else {
    const o = JSON.parse(fs.readFileSync(ORACLE, 'utf8'));
    const stale = Object.entries(o.inputs).filter(([f, h]) => crypto.createHash('sha256').update(fs.readFileSync(path.join(FXD, f))).digest('hex') !== h);
    check(!stale.length, 'R reference: written from these fixtures (else run Rscript tests/oracle/em_oracle.R again)', stale.map(x => x[0]));
    check(same(o.positives.names, read.positives.map(p => p.name)) && same(o.positives.target, read.positives.map(p => read.targets.includes(p))),
      'R reference: the same positives, names and positives with zones', o.positives);
    for (const l of layers) {
      const mine = l.points.map(p => !E.coarseReason(p)), theirs = o.eligible[l.key];
      check(same(theirs.eligible, mine), 'R reference: ' + l.key + ': left out exactly as RAD\'s premises_zone_eligible() and the town rule say', [theirs, mine]);
    }
    const key = r => r.site + '|' + r.layer + '|' + r.name;
    const mineRows = new Map(res.rows.map(r => [r.siteName + '|' + r.layer + '|' + r.name, r]));
    const theirRows = new Map(o.rings.map(r => [key(r), r]));
    check(same([...mineRows.keys()].sort(), [...theirRows.keys()].sort()), 'R reference: the same inside rows (rings)', { mine: [...mineRows.keys()], r: [...theirRows.keys()] });
    const worst = Math.max(0, ...[...theirRows].map(([k, r]) => mineRows.has(k) ? Math.abs(mineRows.get(k).exactKm - r.km) : Infinity));
    check(worst < 1e-6 && [...theirRows].every(([k, r]) => mineRows.has(k) && mineRows.get(k).zone === r.zone),
      'R reference: every distance within 1e-6 km, and the same ring', worst);
    check(same(o.rings.map(key), res.rows.map(r => r.siteName + '|' + r.layer + '|' + r.name)), 'R reference: the rows in the same order');
    const nearMine = Object.fromEntries(res.layers.filter(l => l.nearest).map(l => [l.key, l.nearest]));
    check(same(Object.keys(o.nearest).sort(), Object.keys(nearMine).sort()) && Object.entries(o.nearest).every(([k, n]) =>
      nearMine[k].name === n.name && nearMine[k].from === n.from && Math.abs(nearMine[k].exactKm - n.km) < 1e-6),
    'R reference: the same "nearest" line for each layer with nothing inside', { mine: nearMine, r: o.nearest });
    for (const f of FX.RULES.zoneFiles) {
      const zf = Z.readGeoJson(fs.readFileSync(path.join(FXD, f), 'utf8'), f);
      const zr = E.inside(E.zoneSites(zf.zones), layers, { mode: 'zones', positives: read.targets });
      const a = zr.rows.map(r => r.zone + '|' + r.layer + '|' + r.name).sort(), b = o.zones[f].rows.map(r => r.zone + '|' + r.layer + '|' + r.name).sort();
      check(same(a, b) && a.length > 0, 'R reference: ' + f + ': the same sites inside (sf and GEOS)', { mine: a, r: b });
    }
    // Speed: dozens of positives against tens of thousands of points.
    const sp = FX.RULES.speed;
    const spSites = E.ringSites(sp.positives.map(([lat, lon], k) => ({ index: k, name: 'S' + (k + 1), lat, lon })), rings);
    const spLayer = [{ key: 'grid', label: 'Grid', color: '#000000', points: sp.points.map(([lat, lon], k) => ({ name: 'P' + k, lat, lon,
      geoSource: '', precision: {} })) }];
    const t0 = Date.now();
    const spRes = E.inside(spSites, spLayer, { mode: 'rings', rings, positives: [] });
    const ms = Date.now() - t0;
    console.log(`  speed: ${sp.positives.length} positives x ${sp.points.length} points: ${spRes.rows.length} rows, ${ms} ms (R: ${o.speed.seconds.toFixed(2)} s)`);
    check(spRes.rows.length === o.speed.pairs && spRes.total === o.speed.distinct, 'R reference: the speed set gives the same pairs and sites inside',
      [spRes.rows.length, o.speed.pairs, spRes.total, o.speed.distinct]);
    check(ms < 5000, 'speed: 40 positives against 30,000 points in under 5 seconds', ms);
    // The CVI movements: the page's sites (its positives with zones, the rings as Premise Lookup's bands) through CVI's
    // query (lookup.js, loaded unchanged), against CVI's run_proximity_query in R.
    const cv = FX.RULES.cvi, spRows = csvOf(cv.positives);
    const sRead = E.readPositives(spRows[0], spRows.slice(1), hpai);
    const sTargets = E.targets(sRead.positives, E.defaultTicks(hpai, sRead.positives));
    const master = globalThis.CVIWA.master.load(fs.readFileSync(path.join(FXD, cv.master), 'utf8'));
    const q = globalThis.CVIWA.lookup.query(master, sTargets.map(p => ({ name: p.name, lat: p.lat, long: p.lon })),
      { defaultKm: Math.max(...cv.bands), bands: cv.bands, endpoint: 'either', filters: {} });
    const mine = [...new Set(q.matched.map(r => r.CVI))].sort();
    check(o.cvi && q.status === o.cvi.status && same(mine, o.cvi.cvis) && q.summary.cvis === o.cvi.summary.n_cvis
      && q.summary.animals === o.cvi.summary.n_animals && q.summary.origins === o.cvi.summary.n_origins
      && q.summary.dests === o.cvi.summary.n_dests && q.matched.every(r => r.matchedSites === o.cvi.matched_sites[r.CVI]),
    'R reference: the CVI movements of the page\'s zones, as CVI\'s run_proximity_query finds them', { mine: [q.status, mine, q.summary], r: o.cvi });
  }

  console.log(`Emergency unit tests: ${pass} passed, ${fail} failed`);
  for (const f of failures) console.log('  FAIL ' + f);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
