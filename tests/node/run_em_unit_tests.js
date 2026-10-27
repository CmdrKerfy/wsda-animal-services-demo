#!/usr/bin/env node
'use strict';
// Emergency Response unit tests (Node >= 22, no packages): the rules (site/emergency/rules.js) against the R
// reference (tests/oracle/em_oracle.R, local-test-artifacts/em/oracle_em.json), the emergency types (types.js, the HPAI
// type and the made-up third type in tests/synthetic/em_made_up_type.js), the dataset list (site/emergency/datasets.js)
// and its recognition through the shared recognize.js (positives by their marker columns, the collision cases, the
// zone kind and the shapefile reason), the Emergency sample, bundle.json's shared entries, the guide's Emergency
// part and the chart (site/emergency/chart.js, its copied text widths and axis breaks against CVI's chartsvg.js). The
// page's own files run unchanged in Node.
// Usage (repository root): node tests/node/run_em_unit_tests.js   (also writes the fixtures, make_em_fixtures.js)
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const SITE = path.join(ROOT, 'site');
for (const f of ['cvi/app/csv.js', 'cvi/app/master.js', 'cvi/app/scaling.js', 'cvi/app/summary.js', 'cvi/app/lookup.js',
  'shared/zip.js', 'shared/load.js', 'shared/recognize.js', 'shared/bundle.js', 'shared/checklist.js',
  'shared/sample.js', 'shared/guide.js', 'shared/zones.js', 'shared/proximity.js', 'shared/facility-datasets.js',
  'cvi/datasets.js', 'infrastructure/datasets.js', 'emergency/datasets.js', 'emergency/sample.js', 'emergency/types.js',
  'emergency/types/hpai.js', 'emergency/types/nws.js', 'emergency/rules.js', 'emergency/chart.js']) {
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
  check(T.list().map(t => t.id).join() === 'hpai,nws', 'types: the page loads HPAI (the default) and New World screwworm');
  // The page writes each ring's distance after its label ("Control zone (10 km)"), so a label never holds its own.
  const ringLabels = T.list().flatMap(t => t.zones.rings.map(r => r.label));
  check(ringLabels.every(l => !/\d\s*(km|mi)\b/.test(l)),
    'types: no ring label holds a distance (the page adds it, in km or miles)', ringLabels);
  check(hpai.name === 'Highly pathogenic avian influenza (HPAI)' && same(hpai.diseaseWords, ['hpai', 'avian influenza', 'h5n1', 'h5']),
    'HPAI: name and disease words', hpai.diseaseWords);
  check(same(hpai.statuses.map(s => s.label), ['Confirmed', 'Presumptive', 'Suspect']) && hpai.statuses.every(s => /^#[0-9a-f]{6}$/.test(s.color)),
    'HPAI: three statuses, each with a color', hpai.statuses);
  check(same(hpai.closed.column, ['Status', 'Surveillance Closed']) && same(hpai.closed.values, ['closed', 'yes', 'y', 'true', '1'])
    && same(hpai.closed.dateColumn, ['Close Date']),
  'HPAI: closed by the agreed table\'s Status (Closed), else E1a\'s Surveillance Closed; surveillance ends on Close Date', hpai.closed);
  check(same(hpai.columns, { id: ['Case ID', 'AnimalDiseaseReportId'], detected: ['Confirmed Diagnosis', 'Date Reported', 'Detection Date'],
    disease: ['Subtype', 'Disease Name'], status: ['Case Status'], quarantine: ['Quarantine Release'],
    flockType: ['Flock/Herd Type'], inventory: ['Flock/Herd Inventory'], shown: ['Production Type'] }),
  'HPAI: the agreed table\'s column names first, E1a\'s after them; the flock type and inventory by their roles', hpai.columns);
  check(hpai.inventoryWord === 'birds', 'HPAI: the numbers line counts birds', hpai.inventoryWord);
  check(same(hpai.countedApart.map(a => a.word), ['cattle', 'other animals']) && same(hpai.countedApart[0].species, hpai.layers.bySpecies[1].words)
    && ['goat', 'sheep', 'swine', 'horse', 'alpaca', 'mink', 'cat', 'dog'].every(w => hpai.countedApart[1].species.includes(w))
    && !hpai.countedApart[1].species.includes('pig'),
  'HPAI: cattle counted apart from the birds (by the same words as its cattle layers), then other mammals ("pig" left out: it would catch "pigeon")', hpai.countedApart);
  check(hpai.title === 'HPAI RESPONSE MAP' && T.get('nws').title === 'NEW WORLD SCREWWORM RESPONSE MAP', 'types: the map picture\'s title from the type', hpai.title);
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
  check(T.isClosed(hpai, 'Closed') && T.isClosed(hpai, 'Yes') && T.isClosed(hpai, ' y ') && T.isClosed(hpai, 'TRUE')
    && !T.isClosed(hpai, 'Active') && !T.isClosed(hpai, 'No') && !T.isClosed(hpai, ''), 'types: closed by the type\'s values, any case');
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
  bad(t => { delete t.closed.column; }, /"closed\.column" should be a column name, or a list of names/, 'no closed column');
  bad(t => { t.closed.column = ['Status', 'Premises']; }, /"closed\.column" should be column names the page may read \("Premises"/, 'a closed column naming premises');
  bad(t => { t.closed.dateColumn = 'Close Date'; }, /"closed\.dateColumn" should be a list of one or more words/, 'a closed date that is not a list');
  bad(t => { t.closed.dateColumn = ['Street Closed On']; }, /"closed\.dateColumn" should be column names the page may read/, 'a closed date naming a street');
  bad(t => { t.columns = ['Case ID']; }, /"columns" should be the column names for each role, in \{ \}/, 'columns as a list');
  bad(t => { t.columns.place = ['City']; }, /"columns" should be roles among id, detected, disease, status, quarantine, flockType, inventory, shown \(not "place"\)/, 'an unknown column role');
  bad(t => { t.columns.inventory = ['Premises Inventory']; }, /"columns\.inventory" should be column names the page may read \("Premises Inventory" names/, 'an inventory column naming premises');
  bad(t => { t.columns.flockType = 'Flock/Herd Type'; }, /"columns\.flockType" should be a list of one or more words/, 'a flock type column that is not a list');
  bad(t => { t.inventoryWord = ''; }, /"inventoryWord" should be a text/, 'an empty inventory word');
  bad(t => { t.countedApart = { species: ['cattle'], word: 'cattle' }; }, /"countedApart" should be a list of species words and the word they are counted under/, 'countedApart not a list');
  bad(t => { t.countedApart[0].species = 'cattle'; }, /"countedApart\[0\]\.species" should be a list of one or more words/, 'countedApart species that are not a list');
  bad(t => { t.countedApart[0].word = ' '; }, /"countedApart\[0\]\.word" should be a text/, 'countedApart with an empty word');
  bad(t => { t.title = ''; }, /"title" should be a text/, 'an empty title');
  bad(t => { t.columns.id = 'Case ID'; }, /"columns\.id" should be a list of one or more words/, 'a column role that is not a list');
  bad(t => { t.columns.shown = ['Production Type', 'Address']; }, /"columns\.shown" should be column names the page may read \("Address" names an address/, 'a shown column naming an address');
  bad(t => { t.columns.id = ['Premise Location']; }, /"columns\.id" should be column names the page may read/, 'an ID column naming a location');
  bad(t => { t.zones.source = 'circles'; }, /"zones\.source" should be one of "rings", "file"/, 'an unknown zone source');
  bad(t => { t.zones.applyTo = 'closed'; }, /"zones\.applyTo" should be one of "open", "confirmed"/, 'an unknown applyTo');
  bad(t => { t.zones.applyTo = 'all'; }, /"zones\.applyTo" should be "open" or "confirmed" \("all" is no longer used: past positives never get zones\)/, 'applyTo "all" (dropped in v2.1)');
  bad(t => { t.zones.unit = 'miles'; }, /"zones\.unit" should be one of "km", "mi"/, 'a unit written out');
  bad(t => { t.zones.unit = 'mi'; t.zones.rings[1].distance = 501; }, /"zones\.rings\[1\]\.distance" should be a number above 0, at most 500 \(in mi\)/, 'a ring over 500 miles');
  bad(t => { t.zones.rings = []; }, /"zones\.rings" should be a list of one or more rings when zones\.source is "rings"/, 'rings with no ring');
  bad(t => { t.zones.rings[0].distance = 0; }, /"zones\.rings\[0\]\.distance"/, 'a ring of 0 km');
  bad(t => { t.layers.default = ['bad key!']; }, /"layers\.default"/, 'a layer key with spaces');
  bad(t => { t.links[0].url = 'http://example.org'; }, /"links\[0\]\.url" should be an https:\/\/ address/, 'a link without https');
  throws(() => T.add(good()), /"hpai" is added twice/, 'types: the same id twice is refused');
  {   // A type that names no columns takes E1a's names; the unit "mi" is accepted.
    const t = good();
    t.id = 'test-defaults'; delete t.columns; delete t.closed.dateColumn; delete t.inventoryWord; delete t.countedApart; delete t.title;
    t.closed.column = 'Surveillance Closed'; t.zones.unit = 'mi';
    const c = T.check(t);
    check(same(c.columns, { id: ['AnimalDiseaseReportId'], detected: ['Detection Date'], disease: ['Disease Name'], status: [],
      quarantine: [], flockType: [], inventory: [], shown: [] }) && same(c.closed.column, ['Surveillance Closed'])
      && same(c.closed.dateColumn, []) && c.zones.unit === 'mi' && c.inventoryWord === 'animals' && same(c.countedApart, []) && c.title === 'HIGHLY PATHOGENIC AVIAN INFLUENZA (HPAI) RESPONSE MAP',
    'types: no columns field: E1a\'s names, no flock type or inventory; one closed column as text; no closed date; miles; "animals", none apart', c.columns);
  }

  // The second type: New World screwworm (site/emergency/types/nws.js).
  const nws = T.get('nws');
  check(nws.name === 'New World screwworm (NWS)' && same(nws.diseaseWords, ['screwworm', 'nws', 'cochliomyia', 'hominivorax', 'myiasis']),
    'NWS: name and disease words', nws.diseaseWords);
  check(same(nws.statuses.map(s => s.label), ['Confirmed', 'Presumptive']) && same(nws.columns, hpai.columns)
    && same(nws.closed, hpai.closed), 'NWS: two statuses (no suspect group); HPAI\'s column names until its own are known', nws.statuses);
  check(nws.inventoryWord === 'animals' && same(nws.countedApart, []), 'NWS: the numbers line counts animals, none apart', nws.inventoryWord);
  check(nws.zones.source === 'file' && nws.zones.applyTo === 'open' && nws.zones.unit === 'km'
    && same(nws.zones.rings.map(r => [r.distance, r.label]), [[20, 'Example area']]),
  'NWS: zones from a file, with one example ring of 20 km until one is loaded', nws.zones);
  check(same(nws.layers.default, ['premises', 'milkproducer', 'markets', 'feedlots', 'fairgrounds', 'disposal'])
    && same(nws.layers.bySpecies[0].keys, nws.layers.default) && !nws.layers.bySpecies[1].keys.includes('milkproducer'),
  'NWS: layer keys from CVI\'s manifest and the built-in layers; dairies only for cattle', nws.layers);
  check(same(nws.links.map(l => l.url), ['https://www.aphis.usda.gov/livestock-poultry-disease/cattle/ticks/screwworm',
    'https://www.aphis.usda.gov/livestock-poultry-disease/stop-screwworm']), 'NWS: the two USDA reference links', nws.links);
  check(T.pick(['New World screwworm', 'NWS myiasis']).type === nws && T.pick(['H5N1 2.3.4.4b', 'H52.3.4b']).type === hpai
    && T.pick(['Cochliomyia hominivorax', 'HPAI']).counts.nws === 1, 'pick: screwworm and HPAI by their words (the agreed Subtype values)');

  // The third-type test: a made-up type file, loaded as a new type would be, with a different value in every field.
  require(path.join(ROOT, 'tests', 'synthetic', 'em_made_up_type.js'));
  const made = T.get('made-up-pox');
  check(T.list().map(t => t.id).join() === 'hpai,nws,made-up-pox', 'third type: added after the two, by its file alone');
  check(T.pick(['Made-up pox', 'MUP outbreak', 'HPAI']).type === made && T.pick(['HPAI', 'HPAI', 'mup']).type === hpai
    && T.pick(['nothing known']).type === hpai, 'third type: picked by its own words; most values win; none known: HPAI');
  check(label(made, 'Open case') === 'Active' && label(made, 'monitor') === 'Watch'
    && T.statusOf(made, 'Confirmed') === null && T.statusOf(hpai, 'Active') === null,
    'third type: its own statuses; HPAI\'s spellings do not leak into it, nor its into HPAI');
  check(same(made.closed.column, ['Released']) && same(made.closed.dateColumn, ['Released On']) && T.isClosed(made, 'DONE')
    && !T.isClosed(made, 'yes'), 'third type: its own closed column, values and date');
  check(made.zones.source === 'file' && made.zones.rings.length === 0 && made.zones.applyTo === 'confirmed' && made.zones.unit === 'mi',
    'third type: zones from a file around its first status, with no rings, in miles');
  check(same(made.layers.default, ['feedlots']) && same(made.layers.bySpecies[0].keys, ['restricted', 'slaughterhouses'])
    && made.links[0].url === 'https://example.org/made-up-pox', 'third type: its own layer keys and link');
  check(made.inventoryWord === 'head' && same(made.columns.flockType, ['Herd Kind']) && same(made.columns.inventory, ['Herd Size']),
    'third type: its own flock type and inventory columns, and its own word', made.columns);

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
    const agreed = item('hpai_table.csv', F['em_positives_agreed.csv']);
    let ra = await rec([agreed]);
    check(ds(ra, 'positives').status === 'found' && fileOf(ra, agreed).via === 'columns',
      'recognition: the agreed HPAI table is the positives file, by its columns (v2.0 took it for a facility layer)', fileOf(ra, agreed));
    let rr = await rec([item('header_only.csv', F['em_positives_agreed_header.csv'])]);
    check(ds(rr, 'positives').status === 'found', 'recognition: the agreed table\'s header alone is recognized as positives');
    for (const m of ['Case ID', 'Confirmed Diagnosis', 'Close Date', 'Subtype']) {
      rr = await rec([item('one_' + m.length + '.csv', 'Latitude,Longitude,' + m + '\n46.5,-120.4,x\n')]);
      check(ds(rr, 'positives').status === 'found', 'recognition: "' + m + '" alone is a marker');
    }
    rr = await rec([item('status_only.csv', 'name,lat,long,Status\nSynthetic Feedlot,46.5,-120.4,Open\n')]);
    check(ds(rr, 'positives').status === 'missing', 'recognition: a facility file with a "Status" column is not positives (Status is not a marker)');
    rr = await rec([item('nws.csv', F['em_positives_nws.csv'])]);
    check(ds(rr, 'positives').status === 'found', 'recognition: a screwworm file in the agreed columns is positives');
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
    const rows = R.parseCsv(sampleText['emergency_case_sites.csv']).filter(r => !(r.length === 1 && r[0] === ''));
    check(same(rows[0], FX.AGREED_HEAD) && rows.slice(1).every(r => r.length === 20),
      'sample: the positives in the agreed HPAI table\'s 20 columns, in its order', rows[0]);
    const prem = rows[0].indexOf('Premises'), addr = rows[0].indexOf('Address');
    check(rows.slice(1).every(row => row[prem].startsWith('(synthetic) ') && row[addr].startsWith('(synthetic) ')),
      'sample: every Premises and Address value is marked "(synthetic)"');
    const sr = E.readPositives(rows[0], rows.slice(1), null);
    check(sr.type === hpai && sr.positives.length === 7 && sr.positives.every(p => p.status && p.status.label === 'Confirmed')
      && same(sr.positives.map(p => p.closed), [false, false, false, false, true, false, false])
      && sr.positives[3].detected === '2026-09-28' && !/\(synthetic\)/.test(JSON.stringify(sr)),
    'sample: read as HPAI, all confirmed, one closed, a Date Reported used when there is no Confirmed Diagnosis, no Premises or Address read', sr.positives.map(p => p.detected));
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
    check(p.required && p.columns.length === 3 && /at least one of Case ID, Confirmed Diagnosis, Close Date or Subtype \(or the earlier Surveillance Closed/.test(p.columns[2]),
      'guide: the positives\' columns, the agreed table\'s markers first', p.columns);
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
    check(same(read.dropped.map(d => [d.line, d.name, d.reason, d.index, d.lat, E.groupOf(d, null)]),
      [[7, 'R-006', 'coordinates not readable', null, null, 'Not mapped']]),
    'rules: a row without usable coordinates is not mapped, with its line, name and reason', read.dropped);
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
    check(same(ticks, { statuses: ['Confirmed', 'Presumptive', 'Suspect', 'none'], pastShown: false }), 'rules: by default every status, past positives hidden', ticks);
    read.targets = E.targets(read.positives, ticks);
    check(same(read.targets.map(p => p.name), ['R-001', 'Positive 2 (Yakima)', 'Positive 4', 'R-005', 'R-007']), 'rules: five positives get zones (not the closed one)');
    check(same(E.targets(read.positives, { statuses: ['Confirmed'] }).map(p => p.name), ['R-001', 'R-005'])
      && same(E.targets(read.positives, { statuses: ['Suspect'], pastShown: true }).map(p => p.name), ['R-007']),
    'rules: unticking statuses changes which get zones; a past positive never gets zones, even shown');
    check(same(E.targets(read.positives, ticks, { start: '2026-09-01', end: '2026-09-30' }).map(p => p.name),
      ['R-001', 'Positive 2 (Yakima)', 'Positive 4', 'R-007']),
    'rules: only positives detected inside the window get zones (and those without a readable date)');
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
    // Without a window the closed positive is not counted as current (the map does not draw it either).
    check(boxes.positives.value === 5 && boxes.positives.note === null && boxes.last.value === '2026-10-05'
      && same(boxes.positives.lines, ['1 not mapped: coordinates not readable', '1 date not readable'])
      && boxes.inside.value === res.total && res.total > 0, 'rules: the value boxes (without a window, the closed positive left out of the current count; the not-mapped and unreadable-dates lines)', boxes);
    const noDate = E.readPositives(['Lat', 'Long', 'Surveillance Closed'], [['46.5', '-120.4', 'No']], hpai);
    const nb = E.valueBoxes(noDate, null);
    check(nb.last.value === null && nb.last.reason === 'Not available: needs Confirmed Diagnosis' && nb.inside.value === null
      && nb.inside.reason === 'Not available: needs a facility layer', 'rules: missing columns give "Not available: needs ...", never zero', nb);
    const ex = E.exportRows(read, read.targets, res, 'km');
    check(same(ex.positives.columns, ['Positive', 'Group', 'Status', 'Closed', 'Close Date', 'Quarantine Release', 'Detection Date',
      'County', 'Latitude', 'Longitude', 'Zones', 'Note'])
      && ex.positives.rows.length === 7 && ex.inside.rows.length === res.rows.length && ex.leftOut.rows.length === 7
      && same(ex.layers.columns.slice(2, 4), ['Infection zone', 'Control zone']), 'rules: the export rows', ex.positives.columns);
    check(same(ex.positives.rows.map(r => r[1]), ['Current', 'Current', 'Past', 'Current', 'Current', 'Current', 'Not mapped'])
      && same(ex.positives.rows[6].slice(-4), ['', '', 'No', 'Not mapped: coordinates not readable']),
    'rules: positives.csv: each positive\'s group, and the row not mapped with its reason', ex.positives.rows.map(r => r.slice(0, 2)));
    check(!/MARKED-ADDRESS/.test(JSON.stringify(ex)) && !/MARKED-ADDRESS/.test(JSON.stringify(res)),
      'rules: the address in "Premise Location" reaches no export and no result');
    check(same(E.suggestedLayers(hpai, read.positives, ['milkproducer', 'markets', 'feedlots']), ['milkproducer', 'markets', 'feedlots'])
      && same(E.suggestedLayers(hpai, [{ species: 'Backyard poultry' }], ['milkproducer', 'markets', 'poultry']), ['poultry', 'markets'])
      && same(E.suggestedLayers(hpai, [{ species: 'Dairy cattle' }], ['milkproducer', 'poultry', 'feedlots']), ['milkproducer', 'feedlots']),
    'rules: the suggested layers by species, else the default list; only loaded layers');
  }
  {   // The agency's agreed HPAI table (20 columns): read by the HPAI type's names, with no address read.
    const rows = csvOf('em_positives_agreed.csv');
    const ar = E.readPositives(rows[0], rows.slice(1), null);
    check(ar.type === hpai && same(ar.positives.map(p => p.name), ['SYN-A-01', 'SYN-A-02', 'SYN-A-03', 'SYN-A-04']),
      'agreed table: the Subtype "H5N1 2.3.4.4b" picks HPAI; each positive named by its Case ID', ar.positives.map(p => p.name));
    check(same(ar.columns, { lat: 'Latitude', lon: 'Longitude', county: 'County', species: 'Species', id: 'Case ID', status: null,
      disease: 'Subtype', quarantine: 'Quarantine Release', closed: 'Status', closedDate: 'Close Date', flockType: 'Flock/Herd Type',
      inventory: 'Flock/Herd Inventory', detected: 'Confirmed Diagnosis', shown: ['Production Type'] }), 'agreed table: the columns read', ar.columns);
    check(ar.positives.every(p => p.status && p.status.label === 'Confirmed' && p.statusText === null)
      && same(E.statusChoices(hpai, ar.positives).map(c => c.key + ':' + c.count), ['Confirmed:4', 'Presumptive:0', 'Suspect:0']),
    'agreed table: no testing-status column, so every positive is Confirmed and none is without a status', E.statusChoices(hpai, ar.positives));
    check(same(ar.positives.map(p => p.detected), ['2026-09-03', '2026-09-12', '2026-07-06', '2026-09-22']) && ar.badDates === 0,
      'agreed table: the detection date is Confirmed Diagnosis, else Date Reported (M/D/YYYY)', ar.positives.map(p => p.detected));
    check(same(ar.positives.map(p => p.closed), [false, false, true, false])
      && same(ar.positives.map(p => p.closedDate), [null, null, '2026-08-14', null])
      && same(ar.positives.map(p => p.quarantine), [null, null, '2026-08-30', null]),
    'agreed table: Status Closed marks the closed positive; its Close Date and Quarantine Release are read');
    check(same(E.details(ar, ar.positives[0]), [['Flock/Herd Type', 'Commercial'], ['Production Type', 'Commercial Table Egg Layer'],
      ['Flock/Herd Inventory', '1,250,000'], ['Flock size', 'Large']]) && same(E.details(ar, ar.positives[3]).slice(2), [['Flock/Herd Inventory', ''], ['Flock size', '']])
      && ar.positives[0].inventory === 1250000 && ar.positives[3].inventory === null,
    'agreed table: the details shown, as written (thousands commas kept; a blank stays blank, never zero), with the flock size', E.details(ar, ar.positives[0]));
    check(!/MARKED-ADDRESS|Synthetic Town|Landfill|Depop/.test(JSON.stringify(ar)),
      'agreed table: Premises, Address, City, Depop Inventory, Structures and Disposal Method are never read');
    const box = E.valueBoxes(ar, null);
    check(box.last.value === '2026-09-22' && box.positives.value === 3,
      'agreed table: the "Last positive" box; without a window the positive past by its Close Date is not current', box);
    const hr = E.readPositives(FX.AGREED_HEAD, [], null);
    check(hr.type === hpai && hr.positives.length === 0 && hr.dropped.length === 0, 'agreed table: the header alone reads as no positives');
    const nr = csvOf('em_positives_nws.csv'), nw = E.readPositives(nr[0], nr.slice(1), null);
    check(nw.type === nws && same(nw.positives.map(p => p.name), ['SYN-NWS-01', 'SYN-NWS-02'])
      && nw.positives.every(p => p.status && p.status.label === 'Confirmed') && !/MARKED-ADDRESS/.test(JSON.stringify(nw)),
    'screwworm: its Subtype values pick the NWS type; read by the same column names', nw.positives.map(p => p.name));
    check(same(E.suggestedLayers(nws, nw.positives, ['premises', 'milkproducer', 'markets', 'feedlots', 'fairgrounds', 'disposal', 'poultry']),
      ['premises', 'milkproducer', 'markets', 'feedlots', 'fairgrounds', 'disposal']), 'screwworm: cattle and horses suggest its layers, never poultry');
  }
  // ---- 8b. The agreed-table scenario (E1b): groups, the window, the play, the numbers, miles, days since, GeoJSON --
  const AG = FX.RULES.agreed;
  const agRows = csvOf(AG.positives);
  const ag = E.readPositives(agRows[0], agRows.slice(1), null);
  const agByLine = ag.positives.concat(ag.dropped).sort((a, b) => a.line - b.line);
  const agWin = E.windowOf(ag.positives);
  const agGroups = E.groups(ag, agWin);
  const names = list => list.map(p => p.name);
  {
    check(ag.type === hpai && same(names(agByLine), ['Yakima 01', 'Yakima 02', 'Franklin 01', 'Positive 4 (Kittitas)', 'Umatilla 01',
      'Lewis 01', 'Lewis 02', 'Lewis 03', 'Yakima 03', 'Skagit 01', 'Whatcom 01', 'Benton 01']),
    'agreed scenario: twelve rows, named by Case ID, else "Positive n (County)"', names(agByLine));
    check(same(ag.dropped.map(d => [d.name, d.reason]), [['Lewis 03', 'no coordinates'], ['Yakima 03', 'latitude and longitude look swapped']]),
      'not mapped: a row without coordinates, and one whose pair falls in Washington swapped (never swapped by the page)', ag.dropped);
    const reasonOf = (latText, lonText) => E.readPositives(['Latitude', 'Longitude', 'Case ID'], [[latText, lonText, 'X']], hpai).dropped.map(d => d.reason)[0];
    check(reasonOf('', '-120.5') === 'no latitude' && reasonOf('46.5', '') === 'no longitude' && reasonOf('north', '-120.5') === 'coordinates not readable'
      && reasonOf('-120.5', '-73.9') === 'coordinates not readable' && reasonOf('-120.5', '46.5') === 'latitude and longitude look swapped',
    'not mapped: each reason (a swapped pair outside Washington is only "not readable")');
    check(ag.badDates === 0 && ag.badCloseDates === 1 && agByLine[4].closedDate === null && !agByLine[4].closed,
      'closed dates: written M/D/YYYY, YYYY-MM-DD and YYYY/MM/DD read; "pending" counted as unreadable (the positive falls back on Status)');
    check(same(agByLine.slice(0, 3).map(p => p.closedDate), ['2024-12-20', '2026-02-10', '2026-05-01']), 'closed dates: the three forms', agByLine.slice(0, 3).map(p => p.closedDate));
    check(same(agWin, { start: '2024-11-05', end: '2026-10-05' }), 'window: from the earliest to the latest readable detection', agWin);
    check(same(names(agGroups.current), ['Positive 4 (Kittitas)', 'Umatilla 01', 'Lewis 02', 'Skagit 01', 'Whatcom 01'])
      && same(names(agGroups.past), ['Yakima 01', 'Yakima 02', 'Franklin 01', 'Lewis 01', 'Benton 01'])
      && same(names(agGroups.stillQuarantined), ['Yakima 02', 'Benton 01']) && same(names(agGroups.undated), ['Positive 4 (Kittitas)'])
      && agGroups.outside.length === 0 && agGroups.notMapped === ag.dropped,
    'groups on the latest detection: past by Close Date, else Status Closed; still under quarantine when the release is blank', agGroups);
    const early = E.groups(ag, { start: agWin.start, end: AG.earlierEnd });
    check(same(names(early.current), ['Franklin 01', 'Positive 4 (Kittitas)']) && same(names(early.past), ['Yakima 01', 'Yakima 02', 'Lewis 01', 'Benton 01'])
      && same(names(early.outside), ['Umatilla 01', 'Lewis 02', 'Skagit 01', 'Whatcom 01']),
    'groups on an earlier end: Franklin 01 is current (its Close Date comes later, whatever its Status); later detections are outside', early);
    const franklin = agByLine[2];
    check(E.isPast(franklin, '2026-05-01') && !E.isPast(franklin, '2026-04-30') && E.stillQuarantined(ag, franklin, '2026-05-01')
      && !E.stillQuarantined(ag, franklin, '2026-06-30') && E.stillQuarantined(ag, franklin, '2026-06-29'),
    'past on its Close Date (on or before the end counts); still under quarantine until its Quarantine Release');
    const e1aRead = E.readPositives(posRows[0], posRows.slice(1), hpai);
    check(!e1aRead.positives.some(p => E.stillQuarantined(e1aRead, p, null)), 'a file without a quarantine column never says "still under quarantine"');
    check(same(agByLine.map(p => p.size), ['Large', 'Small', 'Medium', 'Medium', 'Large', 'Small', null, 'Small', 'Large', 'Large', 'Small', 'Small']),
      'flock size classes from the inventories (99 Small, 100 and 1,000 Medium, 1,001 Large; blank none)', agByLine.map(p => p.size));
    check(E.inventoryOf('1,250,000') === 1250000 && E.inventoryOf(' 2,400 ') === 2400 && E.inventoryOf('35') === 35 && E.inventoryOf('0') === 0
      && E.inventoryOf('') === null && E.inventoryOf('1,25') === null && E.inventoryOf('12,3456') === null && E.inventoryOf('-5') === null
      && E.inventoryOf('about 40') === null, 'inventories: thousands commas read; a blank or unreadable one is none, never zero');
    check(E.sizeClass(99) === 'Small' && E.sizeClass(100) === 'Medium' && E.sizeClass(1000) === 'Medium' && E.sizeClass(1001) === 'Large'
      && E.sizeClass(0) === 'Small' && E.sizeClass(null) === null, 'size classes at their edges');
    check(E.bigNumber(4133418) === '4.1M' && E.bigNumber(1000000) === '1M' && E.bigNumber(999999) === '999,999' && E.bigNumber(18535) === '18,535'
      && E.bigNumber(35) === '35', 'big numbers: "4.1M" from a million, thousands commas below', E.bigNumber(4133418));
    check(E.numbersLine(ag, agGroups.current) === '2 commercial, 3 backyard, 1.3M birds, 35 cattle; 1 without an inventory',
      'the numbers line: the current positives by flock type (most animals first), their birds, the cattle apart, the blank inventory named', E.numbersLine(ag, agGroups.current));
    const agAt = id => ag.positives.find(p => p.name === id) || ag.dropped.find(p => p.name === id);
    check(E.inventoryWordOf(hpai, agAt('Whatcom 01')) === 'cattle' && E.inventoryWordOf(hpai, agAt('Yakima 03')) === 'cattle'
      && E.inventoryWordOf(hpai, agAt('Skagit 01')) === 'birds' && E.inventoryWordOf(hpai, agAt('Lewis 02')) === 'birds'
      && E.inventoryWordOf(hpai, { species: 'Dairy Cow' }) === 'cattle' && E.inventoryWordOf(hpai, { species: 'Scow duck' }) === 'birds'
      && E.inventoryWordOf(hpai, { species: null }) === 'birds' && E.inventoryWordOf(nws, { species: 'Cattle' }) === 'animals',
    'the word a positive\'s animals count under: cattle by its species (any case, at the start of a word), else birds; screwworm\'s animals');
    check(E.numbersLine(ag, [agAt('Whatcom 01')]) === '1 backyard, 35 cattle' && E.numbersLine(ag, [agAt('Skagit 01'), agAt('Lewis 02')])
      === '1 commercial, 1 backyard, 1.3M birds; 1 without an inventory',
    'the numbers line with cattle only (no "0 birds"), and with birds only (no "0 cattle")');
    check(E.inventoryWordOf(hpai, { species: 'Meat Goat' }) === 'other animals' && E.inventoryWordOf(hpai, { species: 'Dog' }) === 'other animals'
      && E.inventoryWordOf(hpai, { species: 'Racing Pigeon' }) === 'birds' && E.inventoryWordOf(hpai, { species: 'Cattle' }) === 'cattle'
      && E.numbersLine({ columns: ag.columns, type: hpai }, [{ flockType: 'Backyard', inventory: 12, species: 'Goat' },
        { flockType: 'Backyard', inventory: 30, species: 'Chicken' }, { flockType: 'Commercial', inventory: 400, species: 'Dairy' }])
        === '1 commercial, 2 backyard, 30 birds, 400 cattle, 12 other animals',
    'HPAI: other mammals counted apart from birds and cattle ("Racing Pigeon" stays a bird)');
    check(E.numbersLine(ag, early.current) === '1 commercial, 1 backyard, 1,100 birds' && E.numbersLine(ag, []) === null
      && E.numbersLine(read, read.positives) === null, 'the numbers line on an earlier end; none for no positives or a file without the columns');
    const nr = csvOf('em_positives_nws.csv'), nw = E.readPositives(nr[0], nr.slice(1), null);
    check(E.numbersLine(nw, nw.positives) === '1 commercial, 1 backyard, 243 animals', 'the numbers line in screwworm\'s word', E.numbersLine(nw, nw.positives));
    check(E.notMappedLine(ag.dropped) === '2 not mapped: 1 no coordinates, 1 latitude and longitude look swapped'
      && E.notMappedLine([{ reason: 'no coordinates' }, { reason: 'no coordinates' }]) === '2 not mapped: no coordinates' && E.notMappedLine([]) === null,
    'the not-mapped line, by reason', E.notMappedLine(ag.dropped));
    const vb = E.valueBoxes(Object.assign({}, ag, { targets: E.targets(ag.positives, { statuses: ['Confirmed'] }, agWin) }), null, agWin);
    check(vb.positives.value === 5 && vb.positives.note === null && same(vb.positives.lines, [
      '2 not mapped: 1 no coordinates, 1 latitude and longitude look swapped', '1 date not readable', '1 without a date',
      'Animals at the current positives: 2 commercial, 3 backyard, 1.3M birds, 35 cattle; 1 without an inventory'])
      && vb.past.value === 5 && vb.past.quarantined === 2 && vb.past.note === '2 still under quarantine'
      && vb.last.value === '2026-10-05' && vb.last.note === 'As of Oct 5, 2026',
    'the boxes with a window (each count once): the current positives (never the past; "with zones" only when it differs), the past ones with those still under quarantine, the warnings and the animals, the as-of date', vb);
    // Dates as Excel and ArcGIS export them, with a time; the dates still unreadable counted in one line.
    check(E.dateOf('10/15/2026 0:00') === '2026-10-15' && E.dateOf('10/15/2026 12:00:00 AM') === '2026-10-15'
      && E.dateOf('2026-10-15T00:00:00') === '2026-10-15' && E.dateOf('13/1/2026 0:00') === null && E.dateOf('Oct 15, 2026') === null
      && E.dateOf('10/15/2026x') === null,
    'dates: M/D/YYYY with a time read as the date; an impossible or written-out date unreadable');
    const tmHead = ['Case ID', 'Confirmed Diagnosis', 'Close Date', 'Quarantine Release', 'Latitude', 'Longitude', 'Status', 'Subtype'];
    const tm = E.readPositives(tmHead, [
      ['T1', '9/20/2026 0:00', '10/20/2026 0:00', '', '46.5', '-120.5', 'Active', 'HPAI H5N1'],
      ['T2', '9/22/2026 12:00:00 AM', '', 'soon', '46.6', '-120.6', 'Active', 'HPAI H5N1'],
      ['T3', 'someday', '', '', '46.7', '-120.7', 'Closed', 'HPAI H5N1']], null);
    const tmWin = E.windowOf(tm.positives);
    const tmBox = E.valueBoxes(tm, null, tmWin);
    check(same(tm.positives.map(p => [p.detected, p.closedDate]), [['2026-09-20', '2026-10-20'], ['2026-09-22', null], [null, null]])
      && tm.badDates === 1 && tm.badCloseDates === 0 && tm.badReleaseDates === 1
      && tmBox.positives.lines.includes('2 dates not readable'),
    'dates with a time: detection and close dates read; an unreadable detection and release date counted, "2 dates not readable"',
      { tm: tm.positives.map(p => [p.detected, p.closedDate]), lines: tmBox.positives.lines });
    const noDates = E.readPositives(tmHead, [
      ['N1', 'soon', '', '', '46.5', '-120.5', 'Closed', 'HPAI H5N1'],
      ['N2', 'later', '', '', '46.6', '-120.6', 'Closed', 'HPAI H5N1'],
      ['N3', '', '', '', '46.7', '-120.7', 'Active', 'HPAI H5N1']], null);
    const ndBox = E.valueBoxes(noDates, null, E.windowOf(noDates.positives));
    check(ndBox.positives.value === 1 && same(ndBox.positives.lines, ['2 dates not readable']) && ndBox.past.value === null,
    'no readable dates: the current positives leave out the closed ones (as the map does), and the unreadable dates are said', ndBox);
    const vbFew = E.valueBoxes(Object.assign({}, ag, { targets: E.targets(ag.positives, { statuses: ['Confirmed'] }, agWin).slice(0, 3) }), null, agWin);
    check(vbFew.positives.note === '3 with zones', 'the boxes: "3 with zones" when fewer positives have zones than are current', vbFew.positives);
    const vbEarly = E.valueBoxes(ag, null, { start: agWin.start, end: AG.earlierEnd });
    check(vbEarly.positives.value === 2 && vbEarly.last.value === '2026-03-15' && vbEarly.last.note === 'As of Apr 30, 2026'
      && vbEarly.past.value === 4 && vbEarly.past.quarantined === 2,
      'the boxes on an earlier end: the last positive is the latest inside the window; the past ones as of that end', vbEarly);
    check(E.valueBoxes(ag, null).past.value === null && E.valueBoxes(null, null).past.reason === 'Not available: needs the positives file',
      'the boxes: without a window or a file, the past box is not available (never zero)');
  }
  {   // The play: epi weeks (Sunday to Saturday) or calendar months over 26 weeks, worked out in UTC.
    check(E.weekOf('2026-10-04') === '2026-10-04' && E.weekOf('2026-10-10') === '2026-10-04' && E.weekOf('2026-01-01') === '2025-12-28'
      && E.dayLabel('2026-10-04') === 'Oct 4, 2026', 'weeks: a date\'s Sunday; the label');
    const full = E.playSteps(agWin);
    check(full.by === 'month' && full.steps.length === 24 && same(full.steps[0], { start: '2024-11-01', end: '2024-11-30', label: 'Month of Nov 2024' })
      && same(full.steps[23], { start: '2026-10-01', end: '2026-10-05', label: 'Month of Oct 2026' })
      && same(full.steps[1], { start: '2024-12-01', end: '2024-12-31', label: 'Month of Dec 2024' }),
    'play: the agreed scenario spans about 100 weeks, so it steps by month; the last step stops on the latest detection', full.steps.slice(0, 2));
    const short = E.playSteps({ start: '2025-12-01', end: '2026-02-15' });
    check(short.by === 'week' && short.steps.length === 12 && same(short.steps[0], { start: '2025-11-30', end: '2025-12-06', label: 'Week of Nov 30, 2025' })
      && short.steps.some(st => same(st, { start: '2025-12-28', end: '2026-01-03', label: 'Week of Dec 28, 2025' }))
      && same(short.steps[11], { start: '2026-02-15', end: '2026-02-15', label: 'Week of Feb 15, 2026' }),
    'play: a shorter window steps by week, one week crossing the year end, the last on the window\'s end', short.steps);
    check(E.playSteps({ start: '2026-01-04', end: '2026-07-04' }).by === 'week' && E.playSteps({ start: '2026-01-04', end: '2026-07-04' }).steps.length === 26
      && E.playSteps({ start: '2026-01-04', end: '2026-07-05' }).by === 'month', 'play: 26 weeks step by week, 27 by month');
    check(same(E.playSteps(null), { by: null, steps: [] }) && same(E.playSteps({ start: '2026-02-01', end: '2026-01-01' }), { by: null, steps: [] }),
      'play: no steps without a window, or with its start after its end');
    // The same in a time zone west of UTC (and across a daylight-saving change): the rules never use local time.
    const script = "for (const f of ['shared/proximity.js','shared/zones.js','emergency/types.js','emergency/rules.js']) require(" +
      JSON.stringify(SITE) + " + '/' + f); const E = globalThis.WSDA.emergencyRules; console.log(JSON.stringify([E.playSteps({ start: '2025-12-01', end: '2026-02-15' })," +
      " E.playSteps({ start: '2026-03-01', end: '2026-03-20' }), E.playSteps(" + JSON.stringify(agWin) + "), E.weekOf('2026-01-01'), E.weekOf('2026-03-09')]));";
    const local = JSON.stringify([short, E.playSteps({ start: '2026-03-01', end: '2026-03-20' }), full, E.weekOf('2026-01-01'), E.weekOf('2026-03-09')]);
    for (const tz of ['America/Los_Angeles', 'Pacific/Honolulu']) {
      const out = execFileSync(process.execPath, ['-e', script], { env: Object.assign({}, process.env, { TZ: tz }) }).toString().trim();
      check(out === local, 'play: the same weeks and months under ' + tz, out.slice(0, 200));
    }
    check(same(E.playSteps({ start: '2026-03-01', end: '2026-03-20' }).steps.map(st => st.start), ['2026-03-01', '2026-03-08', '2026-03-15']),
      'play: weeks across the daylight-saving change');
  }
  {   // Positives over time (rules.js overTime): the chart's counts, one column per step of the file's play.
    const steps = E.playSteps(agWin), full = E.overTime(ag, agWin, steps);
    const counted = cols => cols.filter(c => c.current + c.past + c.outside).map(c => [c.label.replace('Month of ', ''), c.current, c.past, c.outside]);
    check(full.by === 'month' && same(full.columns.map(c => [c.start, c.end, c.label]), steps.steps.map(st => [st.start, st.end, st.label]))
      && full.notMapped === 2 && full.undated === 1,
    'chart counts: one column per month of the file\'s play; the two rows not mapped and the positive without a date not counted', full.columns.length);
    check(same(counted(full.columns), [['Nov 2024', 0, 1, 0], ['Jun 2025', 0, 1, 0], ['Dec 2025', 0, 1, 0], ['Feb 2026', 0, 1, 0],
      ['Mar 2026', 0, 1, 0], ['Jul 2026', 1, 0, 0], ['Sep 2026', 2, 0, 0], ['Oct 2026', 1, 0, 0]]),
    'chart counts: each dated positive in the month it was detected in, current or past on the window\'s end (Oct 5, 2026)', counted(full.columns));
    const early = E.overTime(ag, { start: agWin.start, end: AG.earlierEnd }, steps);
    check(AG.earlierEnd === '2026-04-30' && same(counted(early.columns), [['Nov 2024', 0, 1, 0], ['Jun 2025', 0, 1, 0], ['Dec 2025', 0, 1, 0],
      ['Feb 2026', 0, 1, 0], ['Mar 2026', 1, 0, 0], ['Jul 2026', 0, 0, 1], ['Sep 2026', 0, 0, 2], ['Oct 2026', 0, 0, 1]]),
    'chart counts: with the window ending Apr 30, 2026, Franklin 01 (closed May 1) is current and the later positives are outside the window', counted(early.columns));
    const late = E.overTime(ag, { start: '2026-01-01', end: agWin.end }, steps);
    check(same(counted(late.columns).slice(0, 3), [['Nov 2024', 0, 0, 1], ['Jun 2025', 0, 0, 1], ['Dec 2025', 0, 0, 1]])
      && same(counted(late.columns).slice(3), counted(full.columns).slice(3)),
    'chart counts: positives detected before the window\'s start are outside it too', counted(late.columns));
    // A Saturday and the Sunday after it fall in two weeks; a step that is not the file's leaves its positive out.
    const two = { positives: [{ detected: '2026-01-03', closedDate: null, closed: false }, { detected: '2026-01-04', closedDate: null, closed: false },
      { detected: null, closedDate: null, closed: false }], dropped: [] };
    const weekly = E.overTime(two, { start: '2026-01-03', end: '2026-01-04' }, E.playSteps({ start: '2026-01-03', end: '2026-01-04' }));
    check(weekly.by === 'week' && same(weekly.columns.map(c => [c.label, c.current]), [['Week of Dec 28, 2025', 1], ['Week of Jan 4, 2026', 1]])
      && weekly.undated === 1 && weekly.notMapped === 0, 'chart counts: Saturday Jan 3 and Sunday Jan 4 in two epi weeks', weekly.columns);
    check(same(E.overTime(null, null, { by: null, steps: [] }), { by: null, columns: [], notMapped: 0, undated: 0 }), 'chart counts: nothing loaded');
  }
  {   // The chart (site/emergency/chart.js): stacked columns drawn as SVG.
    require(path.join(SITE, 'cvi/app/chartsvg.js'));
    const CH = globalThis.WSDA.emergencyChart, CS = globalThis.CVIWA.chartsvg;
    const texts = ['Week of Oct 4, 2026', 'Sep 2026', '0', '1,234', 'Mañana →'];
    check(texts.every(s => CH.textWidth(s, 11) === CS.textWidth(s, 11) && CH.textWidth(s, 9, true) === CS.textWidth(s, 9, true)),
      'chart: the text widths are CVI\'s (copied from chartsvg.js)');
    const ranges = [[0, 1.05], [0, 3.15], [0, 7.35], [0, 12.6], [-0.5, 0.5], [0, 105], [0, 2310]];
    check(ranges.every(([a, b]) => same(CH.extended(a, b, 5), CS.extended(a, b, 5))), 'chart: the axis breaks are CVI\'s (labeling::extended, copied)');
    check(same(CH.valueAxis(0, 3, 0, 0.05).breaks, [0, 1, 2, 3]) && same(CH.valueAxis(0, 1, 0, 0.05).breaks, [0, 1])
      && same(CH.valueAxis(0, 2310, 0, 0.05).labels, ['0', '500', '1,000', '1,500', '2,000']) && CH.valueAxis(0, 3, 0, 0.05).to === 3.15,
    'chart: the count axis keeps whole-number breaks only (no 0.5 positive), labeled with thousands commas', CH.valueAxis(0, 1, 0, 0.05));
    const series = [{ key: 'current', label: 'current', name: 'Current', fill: '#a50f15' },
      { key: 'past', label: 'past', name: 'Past', outline: true, stroke: '#a50f15', opacity: 0.55 },
      { key: 'outside', label: 'outside the window', name: 'Outside the window', fill: '#d9d9d9' }];
    const cols = [{ label: 'Week <A>', tick: 'A', values: { current: 2, past: 1, outside: 0 }, click: 'Click to show A' },
      { label: 'Week B', tick: 'B', values: { current: 0, past: 0, outside: 0 } },
      { label: 'Week C', tick: 'C', values: { current: 0, past: 0, outside: 3 } },
      { label: 'Week D', tick: 'D', values: { current: 1, past: 0, outside: 0 }, picked: true }];
    const svg = CH.columns({ title: 'Positives over time', none: 'no positives', series, columns: cols }, { width: 400, height: 170 });
    const rects = [...svg.matchAll(/<rect([^>]*)\/>/g)].map(m => Object.fromEntries([...m[1].matchAll(/ ([\w-]+)="([^"]*)"/g)].map(a => [a[1], a[2]])));
    const targets = rects.filter(r => r.class === 'chart-col'), num = (r, k) => Number(r[k]);
    check(same(targets.map(r => r['data-hover']), ['Week &lt;A&gt;: 2 current, 1 past', 'Week B: no positives', 'Week C: 3 outside the window', 'Week D: 1 current'])
      && targets[0]['aria-label'] === 'Week &lt;A&gt;: 2 current, 1 past. Click to show A' && targets[0]['data-click'] === 'Click to show A',
    'chart: each column\'s hover and screen-reader label: its nonzero counts in the series\' order (escaped), "no positives" when empty', targets.map(r => r['aria-label']));
    check(same(targets.map(r => r.tabindex), ['-1', '-1', '-1', '0']) && same(targets.map(r => r['aria-current'] || ''), ['', '', '', 'true'])
      && targets.every(r => r.role === 'button') && /^<svg[^>]* role="group" aria-label="Positives over time"/.test(svg),
    'chart: one keyboard stop, the picked column, marked current; each column a button; the chart labeled', targets.map(r => r.tabindex));
    const picked = rects.find(r => r.class === 'chart-picked');
    check(picked && picked.x === targets[3].x && picked.width === targets[3].width, 'chart: the bar under the picked column', picked);
    const bars = rects.filter(r => !r.class && num(r, 'y') > 25);
    const cur = bars.filter(r => r.fill === '#a50f15'), past = bars.filter(r => r.stroke), out = bars.filter(r => r.fill === '#d9d9d9');
    const base = num(cur[0], 'y') + num(cur[0], 'height');
    check(cur.length === 2 && past.length === 1 && out.length === 1 && past[0].fill === '#ffffff' && past[0].opacity === '0.55'
      && Math.abs(num(past[0], 'y') + num(past[0], 'height') + 0.75 + 1 - num(cur[0], 'y')) < 0.02
      && Math.abs(num(out[0], 'height') / num(cur[0], 'height') - 1.5) < 0.02 && Math.abs(num(out[0], 'y') + num(out[0], 'height') - base) < 0.02,
    'chart: the past stacked hollow on the current with a 1-pixel gap; heights in proportion to the counts, on one baseline', bars);
    check(num(targets[0], 'height') > num(out[0], 'height') && same(targets.map(r => num(r, 'width')), targets.map(() => num(targets[0], 'width')))
      && bars.every(r => num(r, 'width') <= 24) && num(targets[0], 'width') > 80,
    'chart: each column\'s target is its whole slot, taller than its tallest column; a wide slot\'s column at most 24 pixels wide', bars.map(r => r.width));
    check(['Current', 'Past', 'Outside the window'].every(k => svg.includes('>' + k + '</text>')) && !/>(0\.5|1\.5)</.test(svg)
      && ['0', '1', '2', '3'].every(k => svg.includes('>' + k + '</text>')), 'chart: the key and the count labels 0 to 3', svg.length);
    const one = CH.columns({ title: 't', series, columns: [cols[3]] }, { width: 320, height: 170 });
    check(one.includes('>Current</text>') && !one.includes('>Past</text>') && !one.includes('>Outside the window</text>'),
      'chart: the key shows only the series counted somewhere');
  }
  // Miles: rings of 2 and 6 miles around the current positives, the layer placed for them.
  const agTargets = E.targets(ag.positives, { statuses: ['Confirmed'] }, agWin);
  const agLayer = layerOf(AG.layer);
  const agSites = E.ringSites(agTargets, AG.rings, 'mi');
  const agRes = E.inside(agSites, [agLayer], { mode: 'rings', rings: AG.rings, unit: 'mi', positives: agTargets });
  {
    check(E.toKm(6, 'mi') === 6 * 1.609344 && E.toKm(6, 'km') === 6 && E.toKm(3) === 3 && E.fromKm(E.toKm(6, 'mi'), 'mi') === 6
      && E.fromKm(9.656064, 'km') === 9.656064, 'miles: one conversion, 1 mile = 1.609344 km');
    check(agSites.every(st => same(st.radii, [2 * 1.609344, 6 * 1.609344])), 'miles: each positive\'s rings in km from the miles', agSites.map(st => st.radii));
    const row = n => agRes.rows.filter(r => r.name === n);
    const edge = row('Agreed Poultry Edge 6 mi');
    check(edge.length === 1 && edge[0].zone === 'Control zone' && edge[0].exactKm <= E.toKm(6, 'mi') && E.round2(E.fromKm(edge[0].exactKm, 'mi')) === 6,
      'miles: a site exactly on the 6-mile ring is inside (the edge counts)', edge);
    check(!row('Agreed Poultry Outside 6 mi').length && !row('Agreed Poultry By Past').length
      && same(row('Agreed Poultry Lewis').map(r => [r.siteName, r.zone]), [['Lewis 02', 'Control zone']]),
    'miles: just outside 6 miles is out; near a past positive only is out; at one spot, only the current positive\'s rings count');
    const agEx = E.exportRows(ag, agTargets, agRes, 'mi', agWin);
    check(agEx.inside.columns[3] === 'Distance (mi)' && agEx.layers.columns.includes('Nearest distance (mi)')
      && (agEx.inside.rows.find(r => r[2] === 'Agreed Poultry Edge 6 mi') || [])[3] === 6, 'miles: the export\'s distance columns in miles', agEx.inside.rows);
    check(E.countLine({ label: 'Disposal sites', inside: 0, usable: 1, nearest: { name: 'A', exactKm: E.toKm(14.2, 'mi'), from: 'B' } }, 'mi')
      === 'Disposal sites: none inside. Nearest: A, 14.2 mi from B', 'miles: the "nearest" line in miles');
    check(same(agEx.positives.columns, ['Positive', 'Group', 'Status', 'Closed', 'Close Date', 'Quarantine Release', 'Detection Date', 'County',
      'Latitude', 'Longitude', 'Zones', 'Flock/Herd Type', 'Production Type', 'Flock/Herd Inventory', 'Flock size', 'Note']),
    'positives.csv: the agreed table\'s columns, the flock size and the note', agEx.positives.columns);
    const exRow = n => agEx.positives.rows.find(r => r[0] === n);
    check(same(exRow('Yakima 02').slice(1, 6), ['Past', 'Confirmed', 'Yes', '2026-02-10', '']) && exRow('Yakima 02')[15] === 'Still under quarantine'
      && same(exRow('Lewis 03').slice(1, 2).concat(exRow('Lewis 03').slice(-1)), ['Not mapped', 'Not mapped: no coordinates'])
      && same(exRow('Skagit 01').slice(11, 15), ['Commercial', 'Commercial Table Egg Layer', '1,250,000', 'Large']) && exRow('Skagit 01')[10] === 'Yes'
      && agEx.positives.rows.length === 12, 'positives.csv: the groups, the quarantine note, the rows not mapped and the details', exRow('Yakima 02'));
    check(!/MARKED-ADDRESS|Synthetic Town|Landfill/.test(JSON.stringify([ag, agEx])), 'agreed scenario: no Premises, Address, City or Disposal Method reaches a result or export');
  }
  // Days since the last positive: each positive's rings and the zone file's zone, counted to the window's end.
  const agZone = Z.readGeoJson(fs.readFileSync(path.join(FXD, AG.zoneFile), 'utf8'), AG.zoneFile);
  const agCounted = agGroups.current.concat(agGroups.past);
  const agDays = E.daysSince(agSites, agCounted, agWin.end);
  const agZoneDays = E.daysSince(E.zoneSites(agZone.zones), agCounted, agWin.end);
  {
    check(same(agDays.map(d => [d.name, d.days]), [['Positive 4 (Kittitas)', null], ['Umatilla 01', 33], ['Lewis 02', 5], ['Skagit 01', 0], ['Whatcom 01', 77]]),
      'days since: per positive\'s outer ring (Lewis 02 counts its own later detection over Lewis 01\'s; none dated: no figure)', agDays.map(d => [d.name, d.days]));
    check(agDays.filter(d => agTargets[agSites.findIndex(st => st.id === d.site)].detected).every(d =>
      d.rings.every(r => r.latest >= agTargets[d.positive === null ? 0 : agTargets.findIndex(p => p.index === d.positive)].detected)),
    'days since: a ring always holds its own positive');
    check(same(agZoneDays.map(d => [d.name, d.latest, d.days, d.positive]), [['Synthetic area with two positives', '2025-12-30', 279, null]]),
      'days since: a zone file\'s zone holding two past positives counts the later one', agZoneDays);
    check(same(E.byQuiet(agDays.concat(agZoneDays)).map(d => d.name), ['Skagit 01', 'Lewis 02', 'Umatilla 01', 'Whatcom 01',
      'Synthetic area with two positives', 'Positive 4 (Kittitas)']), 'days since: the "Zones" list\'s order, the longest-quiet last');
    const earlier = n => (E.daysSince(agSites, agCounted, '2026-09-30').find(d => d.name === n) || {}).days;
    check(earlier('Lewis 02') === 0 && earlier('Skagit 01') === null,
    'days since: a detection after the as-of date does not count');
  }
  // The zones as GeoJSON: the fixture holds the page's own output, which the R reference reads with sf.
  const agPast = E.ringSites(agGroups.past, AG.rings, 'mi');
  const agGeo = E.zonesGeoJson({ rings: [{ sites: agSites, group: 'Current' }, { sites: agPast, group: 'Past' }],
    zones: E.zoneSites(agZone.zones) }, { rings: AG.rings, unit: 'mi', asOf: agWin.end, positives: agCounted });
  {
    check(JSON.stringify(agGeo) + '\n' === fs.readFileSync(path.join(FXD, AG.geojson), 'utf8'),
      'GeoJSON: the page writes the same zones.geojson the R reference read');
    const feats = agGeo.features, circles = feats.filter(f => f.properties.positive !== null);
    check(agGeo.type === 'FeatureCollection' && !('crs' in agGeo) && feats.length === 21 && circles.length === 20,
      'GeoJSON: one feature per ring per positive (current and past) and one for the zone; no crs member', feats.length);
    check(circles.every(f => f.geometry.type === 'Polygon' && f.geometry.coordinates.length === 1 && f.geometry.coordinates[0].length === 361),
      'GeoJSON: each ring a whole circle of 361 points (360 steps, closed)');
    const rings = feats.flatMap(f => f.geometry.coordinates);
    check(rings.every(r => same(r[0], r[r.length - 1])) && rings.every(r => Z.signedArea(r) > 0),
      'GeoJSON: every ring closed, every exterior counterclockwise (the zone file\'s clockwise outline reversed)');
    check(feats.every(f => JSON.stringify(f.geometry.coordinates).match(/-?\d+\.?\d*/g).every(n => !/\.\d{7,}/.test(n))),
      'GeoJSON: coordinates to six decimals');
    check(feats.length === 21 && same(Object.keys(feats[0].properties), ['name', 'zone', 'positive', 'group', 'distance', 'unit', 'days_since_last_positive', 'as_of'])
      && same(feats[0].properties, { name: 'Infection zone (2 mi) around Positive 4 (Kittitas)', zone: 'Infection zone', positive: 'Positive 4 (Kittitas)', group: 'Current', distance: 2, unit: 'mi',
        days_since_last_positive: null, as_of: '2026-10-05' })
      && same(feats[20].properties, { name: 'Synthetic area with two positives', zone: 'Synthetic area with two positives', positive: null, group: null, distance: null, unit: null,
        days_since_last_positive: 279, as_of: '2026-10-05' }), 'GeoJSON: the properties', feats.slice(0, 1).concat(feats.slice(20, 21)).map(f => f.properties));
    check(feats.filter(f => f.properties.group === 'Past').length === 10 && (feats.find(f => f.properties.positive === 'Lewis 02'
      && f.properties.zone === 'Control zone') || { properties: {} }).properties.days_since_last_positive === 5, 'GeoJSON: past rings marked Past; days since per feature');
    check(!/MARKED-ADDRESS|Synthetic Town/.test(JSON.stringify(agGeo)) && feats.every(f => Object.keys(f.properties).every(k => !E.PRIVATE.test(k))),
      'GeoJSON: no address, location, street or premise');
    const hole = Z.readGeoJson(fs.readFileSync(path.join(FXD, 'em_zone_hole.geojson'), 'utf8'), 'em_zone_hole.geojson');
    const hg = E.zonesGeoJson({ zones: E.zoneSites(hole.zones) }, { asOf: '2026-10-05', positives: [] }).features[0].geometry.coordinates;
    check(hg.length === 2 && Z.signedArea(hg[0]) > 0 && Z.signedArea(hg[1]) < 0, 'GeoJSON: a zone\'s hole written clockwise, its outline counterclockwise');
  }

  {   // zones.csv and the "Zones" list: one row per positive's outer ring, or per zone-file zone, the longest-quiet last.
    const zr = E.zoneRows(agDays, { zonesMode: false, rings: AG.rings, unit: 'mi', asOf: agWin.end });
    check(same(zr.columns, ['Zone', 'Positive', 'Ring', 'Distance', 'Unit', 'Last positive', 'Days since the last positive', 'As of'])
      && same(zr.rows[0], ['Control zone (6 mi) around Skagit 01', 'Skagit 01', 'Control zone', 6, 'mi', '2026-10-05', 0, '2026-10-05'])
      && same(zr.rows.map(r => r[1]), ['Skagit 01', 'Lewis 02', 'Umatilla 01', 'Whatcom 01', 'Positive 4 (Kittitas)'])
      && same(zr.rows[4].slice(5), ['', '', '2026-10-05']),
    'zones.csv: each positive\'s outer ring in the unit shown, the longest-quiet last, a zone with no dated positive blank', zr.rows);
    const zz = E.zoneRows(agZoneDays, { zonesMode: true, rings: AG.rings, unit: 'mi', asOf: agWin.end });
    check(same(zz.rows, [['Synthetic area with two positives', '', '', '', '', '2025-12-30', 279, '2026-10-05']]),
      'zones.csv: a zone file\'s zone by its name, with no positive, ring, distance or unit', zz.rows);
  }

  {   // The map picture (site/emergency/branded.js): the page's model, from the agreed scenario. The branded files need
    // a window, so they load in their own context, as in the S11 suite; the inputs come from the rules above.
    const vm = require('vm');
    const ctx = { window: {}, console, TextEncoder, TextDecoder };
    ctx.window.window = ctx.window;
    vm.createContext(ctx);
    for (const f of ['cvi/app/csv.js', 'cvi/app/scaling.js', 'shared/proximity.js', 'shared/zones.js', 'geo/wa-counties.js',
      'shared/facilities.js', 'shared/brand.js', 'shared/branded.js', 'shared/tiles.js', 'shared/labels.js',
      'cvi/app/brandedmaps.js', 'emergency/types.js', 'emergency/types/hpai.js', 'emergency/types/nws.js', 'emergency/rules.js',
      'emergency/branded.js']) {
      vm.runInContext(fs.readFileSync(path.join(SITE, f), 'utf8'), ctx, { filename: f });
    }
    const EB = ctx.window.WSDA.emergencyBranded, BRW = ctx.window.WSDA.branded;
    const COUNTIES = ctx.window.CVIWA_GEO.counties.features;
    const DAY = new Date(2026, 9, 22);
    // A positive without a status (a file without a status column) has no color or label of its own.
    const shownOf = list => list.map(p => ({ name: p.name, lat: p.lat, lon: p.lon,
      color: p.status ? p.status.color : null, status: p.status ? p.status.label : null, past: agGroups.past.includes(p) }));
    // The scenario's rings in miles, in the type's colors (the page's rings take theirs from the type).
    const agRings = AG.rings.map((r, i) => Object.assign({}, r, { color: hpai.zones.rings[i].color }));
    const base = over => Object.assign({ type: hpai, positives: shownOf(agGroups.current), added: [], sites: agSites, pastSites: [],
      zonesMode: false, rings: agRings, unit: 'mi', result: agRes,
      layers: { poultry: { label: 'Commercial poultry', pngLabel: 'Commercial Poultry', color: '#1f77b4', shape: 'circle' } },
      days: agDays, window: agWin, current: agGroups.current.length, cvi: null, counties: COUNTIES, date: DAY,
      background: 'standard', synthetic: true }, over || {});
    const built = EB.page(base()), m = built.model;
    const svg = BRW.svg(built.parts, BRW.pixelSize(200));
    check(m.title === 'HPAI RESPONSE MAP' && EB.title(nws) === 'NEW WORLD SCREWWORM RESPONSE MAP'
      && m.fileName === 'emergency_hpai_2026-10-22.png' && EB.fileName(nws, DAY) === 'emergency_nws_2026-10-22.png',
    'map picture: the title from the type; the file name emergency_<type>_<date>.png', [m.title, m.fileName]);
    check(m.meta.left === 'Zones: Infection zone 2 mi (3.2 km), Control zone 6 mi (9.7 km)' && m.meta.right === 'As of Oct 5, 2026 · Last Updated: 10/22/2026'
      && same(m.stats.left, [{ prefix: 'Detected between', value: 'Nov 5, 2024 and Oct 5, 2026' }]),
    'map picture: the zones in both units (the unit shown first), "As of" the window\'s end, the period line "Detected between"', [m.meta, m.stats]);
    const periodEnd = BRW.px(0.01) + BRW.textWidth('Detected between', 13, true) + BRW.px(0.006) + BRW.textWidth(m.stats.left[0].value, 13);
    check(periodEnd < BRW.px(0.46), 'map picture: the period line ends before the value boxes', [periodEnd, BRW.px(0.46)]);
    const insideKeys = new Set(agRes.rows.map(r => r.lat + ',' + r.lon + ',' + r.name));
    check(same(m.boxes.map(b => [b.label, b.value]), [['Current positives', '5'], ['Sites inside', String(agRes.total)]])
      && agRes.total === insideKeys.size && agRes.total > 0,
    'map picture: the boxes: the current positives (never the past) and the sites inside (the layers are in the key)', m.boxes);
    const withSites = agSites.filter(st => agRes.rows.some(r => r.site === st.id)).length;
    check(same(m.footer, [['Positives with a site inside', withSites + ' of 5']]) && withSites > 0 && withSites < 5,
      'map picture: the panel\'s one footer row: how many positives have a site inside, of how many', m.footer);
    check(same(m.keyItems.map(i => i.label), ['MAP KEY', 'Confirmed positive', 'Infection zone (2 mi / 3.2 km)', 'Control zone (6 mi / 9.7 km)',
      'SITES INSIDE', 'Commercial Poultry']) && same(m.keyItems[3].lines, ['Control zone', '6 mi / 9.7 km'])
      && m.keyItems[5].count === String(insideKeys.size) && built.parts[6].indexOf('>' + insideKeys.size + '</text>') > 0,
    'map picture: the key: the status, the rings on two lines with both units, the layer under "SITES INSIDE" with its count on the right', m.keyItems);
    check(m.rings.length === agSites.length * 2 && m.rings.filter(r => r.color === '#cb181d').length === agSites.length
      && m.rings.filter(r => r.color === '#fd8d3c').length === agSites.length && m.positives.every(q => q.color === '#a50f15' && !q.past),
    'map picture: each positive\'s two rings in the type\'s colors; the positives in their status color', m.rings.map(r => r.color));
    const perSite = st => new Set(agRes.rows.filter(r => r.site === st.id).map(r => r.name)).size;
    const panelNames = m.panel.rows.map(r => r.name), counts = m.panel.rows.map(r => Number(r.count));
    check(same(counts, counts.slice().sort((a, b) => b - a)) && m.panel.rows.every(r => Number(r.count) === perSite(agSites[r.site]))
      && panelNames.length === 5 && !m.panel.more,
    'map picture: the POSITIVES panel: one row per positive with zones, the most sites inside first, its count of sites inside', m.panel.rows);
    const prow = n => m.panel.rows.find(r => r.name === n) || {};
    check(prow('Lewis 02').days === '5 days since last positive' && prow('Lewis 02').subLeft === 'Lewis' && prow('Skagit 01').days === '0 days since last positive'
      && prow('Positive 4 (Kittitas)').days === null, 'map picture: each row\'s county and days since the last positive (none without a dated positive)', m.panel.rows);
    check(m.facilities.length === 1 && m.facilities[0].points.length === insideKeys.size && m.unit === 'mi',
      'map picture: the sites inside drawn once each, in their layer');
    check(svg.indexOf(BRW.esc(EB.SENSITIVE)) > 0 && svg.indexOf('Synthetic sample data') > 0 && svg.indexOf('POSITIVES') > 0
      && !/MARKED-ADDRESS|Synthetic Town|Example Road|Landfill/.test(svg),
    'map picture: the sensitive-data line, the synthetic marker, the panel; no address or other unread column');
    // Past positives shown, with their rings.
    const past = EB.page(base({ positives: shownOf(agGroups.current.concat(agGroups.past)), pastSites: agPast })).model;
    check(same(past.keyItems.map(i => i.label).slice(1, 3), ['Confirmed positive', 'Past positive'])
      && past.keyItems.some(i => i.label === 'Past positives\' rings') && past.pastRings.length === agPast.length * 2 && past.pastRings.every(r => r.color === EB.PAST)
      && past.positives.filter(q => q.past).length === agGroups.past.length && same(past.boxes[0], m.boxes[0]),
    'map picture: past positives shown: faded in the key, their rings drawn gray; the boxes unchanged', past.keyItems.map(i => i.label));
    // The key with past positives, both rings and six layers (one name on two lines), at every height from roomy to
    // cramped: neighboring rows' lines never meet (the picture with a master and past positives shown).
    const crowded = EB.keyItems({ statuses: [{ label: 'Confirmed', color: '#a50f15' }], pastColors: ['#a50f15'], added: false,
      zonesMode: false, rings: hpai.zones.rings, unit: 'km', pastRings: true,
      facilities: [['Commercial Poultry', 8], ['Milk Producers (Dairies)', 4], ['Premise PINs by Species', 3], ['Livestock Markets', 1],
        ['Fairgrounds', 1], ['Feedlots', 1]].map(([label, n]) => ({ label, n, color: '#1f77b4', shape: 'circle' })) });
    const meets = [], modes = new Set();
    for (let h = 0.15; h <= 0.6; h += 0.01) {
      const key = EB.keyColumn(crowded, 0.15, 0, h);
      modes.add(key.mode + (key.textScale < 1 ? ' smaller' : ''));
      if (key.mode === 'top' && key.textScale === 1) meets.push([h.toFixed(2), 'fewer layers before smaller text']);
      key.rows.forEach((r, i) => {
        const a = key.rows[i - 1];
        if (a && r.y - a.y < ((a.lines + r.lines - 2) / 2 * 1.15 + 1) * r.pt) meets.push([h.toFixed(2), a.label, r.label]);
      });
    }
    check(!meets.length && modes.has('one') && modes.has('one smaller') && modes.has('top smaller'),
      'map picture: the key\'s rows drawn closer never run into each other; when they would, its layers in smaller text, then fewer layers', [meets.slice(0, 3), [...modes]]);
    // A zone file's zones, and a point added on the map.
    const zf = EB.page(base({ sites: E.zoneSites(agZone.zones), zonesMode: true, zoneName: AG.zoneFile, days: agZoneDays, result: null,
      added: [{ name: 'Added point 1', lat: 46.9, lon: -120.4 }] })).model;
    check(zf.meta.left === 'Zones: em_rules_zone_two.geojson' && zf.rings.length === 1 && zf.rings[0].zone && zf.rings[0].color === EB.ZONE_COLOR
      && zf.keyItems.some(i => i.label === 'Zone (from file)') && zf.keyItems.some(i => i.label === 'Added point')
      && zf.panel.rows[0].names.join(' ') === 'Synthetic area with two positives'
      && zf.panel.rows[0].subLeft === null && same(zf.footer, [['Zones with a site inside', '0 of 1']]) && zf.panel.rows[0].nameSize === 3.1 * zf.panel.scl
      && zf.positives.some(q => q.name === 'Added point 1' && q.color === EB.PICK) && zf.panel.rows[0].days === '279 days since last positive',
    'map picture: a zone file\'s zones in the zone color, the file named in the meta line; a zone\'s name whole at the row\'s size, no county line; an added point; days since per zone', zf.panel.rows);
    const longName = 'Synthetic positive with a very long name 01';
    const ln = EB.page(base({ sites: agSites.map((st, k) => (k === 0 ? Object.assign({}, st, { name: longName }) : st)) })).model;
    const lr = ln.panel.rows.find(r => r.site === 0);
    check(lr && lr.name === longName && lr.names.length === 1 && lr.nameSize < 3.1 * ln.panel.scl && lr.subLeft,
      'map picture: a positive\'s long name drawn smaller, not cut, with its county line kept', lr);
    // With a CVI master: its CVIs and animals in the boxes and the source line; the CVI premises drawn hollow, each
    // spot once, and named in the key with the CVI tab's years.
    const matched = [{ hitOrigin: true, hitDest: false, 'Origin.Lat': '46.6', 'Origin.Long': '-120.5' },
      { hitOrigin: true, hitDest: false, 'Origin.Lat': '46.6', 'Origin.Long': '-120.5' },
      { hitOrigin: false, hitDest: true, 'Dest.Lat': '46.2', 'Dest.Long': '-119.1' },
      { hitOrigin: true, hitDest: false, 'Origin.Lat': 'unknown', 'Origin.Long': '-120.5' }];
    const cvBuilt = EB.page(base({ cvi: { cvis: 12, animals: 3400, matched, years: '2025–2026' } })), cv = cvBuilt.model;
    const cvSvg = BRW.svg(cvBuilt.parts, BRW.pixelSize(200));
    check(same(cv.boxes.map(b => [b.label, b.value]), [['Current positives', '5'], ['Sites inside', String(agRes.total)], ['CVIs in or out', '12'], ['Animals moved', '3,400']])
      && /CVI records/.test(cv.source) && !/CVI records/.test(m.source), 'map picture: with a CVI master, the CVIs to or from the zones and the animals moved in the boxes', cv.boxes);
    const cvKey = cv.keyItems.map(i => i.label + (i.count ? ' ' + i.count : ''));
    check(same(cv.cviPremises.map(q => [q.end, q.lat, q.lon]), [['origin', 46.6, -120.5], ['destination', 46.2, -119.1]])
      && cvKey.includes('CVI PREMISES, 2025–2026') && cvKey.includes('Origin in a zone 1') && cvKey.includes('Destination in a zone 1')
      && cvKey.indexOf('CVI PREMISES, 2025–2026') < cvKey.indexOf('SITES INSIDE') && !m.cviPremises.length && !m.keyItems.some(i => /CVI/.test(i.label))
      && cvSvg.includes('stroke="' + EB.CVI_ORIGIN + '"') && cvSvg.includes('stroke="' + EB.CVI_DEST + '"'),
    'map picture: the CVI premises with an origin or a destination in a zone drawn hollow, each spot once, under "CVI PREMISES" with the years; none without a master', [cv.cviPremises, cvKey]);
    // The backgrounds: Default draws the land; a tile background asks for its picture under the map.
    const sat = EB.page(base({ background: 'raster:esri_satellite' })).model;
    check(m.underlay === null && m.background === 'standard' && sat.underlay && sat.underlay.key === 'raster:esri_satellite'
      && sat.background === 'raster:esri_satellite' && sat.basemap, 'map picture: Default needs no tiles; Satellite asks for its tiles under the map', sat.underlay && sat.underlay.key);
    check(same(BRW.pixelSize(200), { width: 2200, height: 1700 }) && same(BRW.pixelSize(300), { width: 3300, height: 2550 }),
      'map picture: 11 x 8.5 in at 200 dpi (2200 x 1700) and 300 dpi (3300 x 2550)');
    // km: the rings and the key in km.
    const km = EB.page(base({ rings: hpai.zones.rings, unit: 'km', sites: E.ringSites(agTargets, hpai.zones.rings, 'km') })).model;
    check(km.meta.left === 'Zones: Infection zone 3 km (1.9 mi), Control zone 10 km (6.2 mi)' && km.keyItems.some(i => i.label === 'Control zone (10 km / 6.2 mi)'),
      'map picture: in km first, HPAI\'s 3 and 10 km rings with their miles', km.meta.left);
  }

  {   // Zones from a file (the polygon with a hole): inside its outline, not in its hole.
    const zf = Z.readGeoJson(fs.readFileSync(path.join(FXD, 'em_zone_hole.geojson'), 'utf8'), 'em_zone_hole.geojson');
    const zr = E.inside(E.zoneSites(zf.zones), layers, { mode: 'zones', positives: read.targets });
    check(zr.rows.length > 0 && zr.rows.every(r => r.exactKm === 0 && r.zone === 'Synthetic zone with a hole')
      && !zr.rows.some(r => r.name === 'Rules Market Between'), 'rules: zones from a file: inside the outline, a point in the hole left out', zr.rows.map(r => r.name));
    check(/^Dairies: \d+ in Synthetic zone with a hole$/.test(E.countLine(zr.layers[0])), 'rules: the count line names the zone', E.countLine(zr.layers[0]));
  }
  {   // The third-type test, continued: the made-up type's fields reach the rules' results.
    const head = ['Case Lat', 'Case Long', 'Pox Ref', 'Pox Kind', 'Pox Status', 'Released', 'Released On', 'Seen On', 'Logged On',
      'Freed On', 'Herd Size', 'Species', 'Disease Name', 'Case Status', 'Detection Date', 'Herd Kind', 'Pen', 'Flock/Herd Type'];
    const rows = [['46.5', '-120.4', 'MUP-1', 'Made-up pox', 'Open case', 'no', '', '10/2/2026', '10/1/2026', '', '40', 'Goat', '', 'Confirmed', '2020-01-01', 'Range', 'P1', 'Commercial'],
      ['46.6', '-120.5', 'MUP-2', 'Made-up pox', 'Monitor', 'DONE', '10/9/2026', '', '10/3/2026', '10/20/2026', '12', 'Sheep', '', '', '', 'Pen', 'P2', 'Backyard'],
      ['46.7', '-120.6', '', 'Made-up pox', 'Confirmed', '', '', 'soon', '', '', '', 'Goat', '', '', '', 'Range', '', '']];
    const mr = E.readPositives(head, rows, null);
    check(mr.type === made && same(mr.positives.map(p => p.status && p.status.label), ['Active', 'Watch', null])
      && same(mr.positives.map(p => p.status && p.status.color), ['#1b7837', '#762a83', null]),
    'third type: picked by its own disease column; its statuses and colors reach the positives ("Confirmed" is not one of them)', mr.positives);
    check(same(mr.positives.map(p => p.closed), [false, true, false]) && same(mr.positives.map(p => p.closedDate), [null, '2026-10-09', null]),
      'third type: its closed column "Released", value "done" and date "Released On" reach the positives');
    check(same(mr.positives.map(p => p.name), ['MUP-1', 'MUP-2', 'Positive 3']) && same(mr.positives.map(p => p.detected), ['2026-10-02', '2026-10-03', null])
      && mr.badDates === 1 && same(mr.positives.map(p => p.quarantine), [null, '2026-10-20', null])
      && same(mr.positives.map(p => p.shown), [[['Pen', 'P1']], [['Pen', 'P2']], [['Pen', '']]])
      && same(mr.positives.map(p => [p.flockType, p.inventory]), [['Range', 40], ['Pen', 12], ['Range', null]]),
    'third type: its own ID, detection dates (the second when the first is blank), quarantine and shown columns; E1a\'s columns in the file are not read',
    mr.positives.map(p => [p.name, p.detected, p.quarantine]));
    check(same(mr.columns, { lat: 'Case Lat', lon: 'Case Long', county: null, species: 'Species', id: 'Pox Ref', status: 'Pox Status',
      disease: 'Pox Kind', quarantine: 'Freed On', closed: 'Released', closedDate: 'Released On', flockType: 'Herd Kind',
      inventory: 'Herd Size', detected: 'Seen On', shown: ['Pen'] }),
    'third type: the columns read, by its own names (HPAI\'s Flock/Herd Type in the file is not read)', mr.columns);
    check(E.numbersLine(mr, mr.positives) === '2 range, 1 pen, 52 head; 1 without an inventory',
      'third type: the numbers line by its own flock type, inventory and word', E.numbersLine(mr, mr.positives));
    const mt = E.defaultTicks(made, mr.positives);
    check(same(mt, { statuses: ['Active'], pastShown: false }) && same(E.targets(mr.positives, mt).map(p => p.name), ['MUP-1']),
      'third type: zones.applyTo "confirmed": zones around its first status only, never a past positive', mt);
    const ho = E.defaultTicks(hpai, read.positives);
    check(ho.pastShown === false && E.targets(read.positives, ho).every(p => !p.closed), 'types: applyTo "open": a past positive gets no zones');
    check(same(E.suggestedLayers(made, mr.positives, ['restricted', 'slaughterhouses', 'feedlots', 'dairies']), ['restricted', 'slaughterhouses'])
      && same(E.suggestedLayers(made, [{ species: 'Cattle' }], ['feedlots', 'dairies']), ['feedlots']),
    'third type: its own layer keys by species, and its default list');
    const conf = E.defaultTicks({ statuses: [{ label: 'A' }, { label: 'B' }], zones: { applyTo: 'confirmed' } }, []);
    check(same(conf, { statuses: ['A'], pastShown: false }), 'types: applyTo "confirmed" ticks the first status only', conf);
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
    {   // The agreed-table scenario against R.
      const a = o.agreed;
      check(a && same(a.names, names(agByLine)) && same(a.mapped, agByLine.map(p => p.index !== null))
        && same(a.reason, agByLine.map(p => p.reason || null)), 'R reference: agreed scenario: the same names, rows mapped and reasons', a && a.reason);
      check(same(a.detected, agByLine.map(p => p.detected)) && same(a.closed_date, agByLine.map(p => p.closedDate))
        && same(a.size, agByLine.map(p => p.size)) && same(a.inventory, agByLine.map(p => p.inventory)),
      'R reference: agreed scenario: the same detection and closed dates, inventories and size classes');
      const groupRow = (g, end) => agByLine.map(p => p.index === null ? 'Not mapped' : g.outside.includes(p) ? 'Outside' : E.groupOf(p, end));
      const early = E.groups(ag, { start: agWin.start, end: AG.earlierEnd });
      const stillRow = (g, end) => agByLine.map(p => p.index !== null && !g.outside.includes(p) && E.stillQuarantined(ag, p, end));
      check(same(a.groups.asOf.group, groupRow(agGroups, agWin.end)) && same(a.groups.earlier.group, groupRow(early, AG.earlierEnd))
        && same(a.groups.asOf.still, stillRow(agGroups, agWin.end)) && same(a.groups.earlier.still, stillRow(early, AG.earlierEnd)),
      'R reference: agreed scenario: each row\'s group and quarantine on both end dates', a.groups);
      const kinds = list => { const k = {}; list.forEach(p => { const t = p.flockType.toLowerCase(); k[t] = k[t] || { count: 0, animals: 0 };
        k[t].count++; k[t].animals += p.inventory || 0; }); return k; };
      const sameKinds = (r, list) => same(Object.keys(r).sort(), Object.keys(kinds(list)).sort()) && Object.entries(kinds(list)).every(([t, v]) => same(r[t], v));
      check(sameKinds(a.groups.asOf.kinds, agGroups.current) && sameKinds(a.groups.earlier.kinds, early.current)
        && a.groups.asOf.animals === 1251101 && a.groups.asOf.cattle === 35 && a.groups.asOf.missing === 1
        && a.groups.earlier.animals === 1100 && a.groups.earlier.cattle === 0,
      'R reference: agreed scenario: the current positives by flock type, their birds, their cattle and the blank inventory (the numbers line)', a.groups.asOf);
      const mine = agRes.rows.map(r => r.siteName + '|' + r.name + '|' + r.zone), theirs = a.mile_rows.map(r => r.site + '|' + r.name + '|' + r.zone);
      const worstMi = Math.max(...a.mile_rows.map((r, k) => agRes.rows[k] ? Math.abs(E.fromKm(agRes.rows[k].exactKm, 'mi') - r.mi) : Infinity));
      check(same(mine, theirs) && worstMi < 1e-6, 'R reference: agreed scenario: the same inside rows in miles, in the same order, within 1e-6 mi', { mine, theirs, worstMi });
      check(same(a.ring_days.map(d => [d.name, d.rings.map(r => [r.latest, r.days])]), agDays.map(d => [d.name, d.rings.map(r => [r.latest, r.days])]))
        && a.ring_days.every((d, k) => d.rings.every((r, i) => Math.abs(r.km - agDays[k].rings[i].km) < 1e-12)),
      'R reference: agreed scenario: days since the last positive for each ring of each positive', a.ring_days);
      check(a.zone_days.days === agZoneDays[0].days && a.zone_days.latest === agZoneDays[0].latest && same(a.zone_days.inside, ['Yakima 01', 'Yakima 02']),
        'R reference: agreed scenario: days since for the zone file\'s zone (sf and GEOS)', a.zone_days);
      const gc = a.geojson.check;
      check(a.geojson.features === agGeo.features.length && gc.every(c => c.valid && c.closed && c.ccw)
        && gc.filter(c => c.positive !== null).every(c => c.points === 361) && same(a.geojson.properties, Object.keys(agGeo.features[0].properties))
        && gc.every((c, k) => same(c.days, agGeo.features[k].properties.days_since_last_positive)),
      'R reference: zones.geojson read with sf: every polygon valid, closed and counterclockwise, every circle 361 points, the same properties', gc.filter(c => !(c.valid && c.closed && c.ccw)));
      // Six decimals hold a position to about 0.1 m, so each vertex is within 1e-4 km of its ring's distance.
      const worstVertex = Math.max(...gc.filter(c => c.positive !== null).map(c => c.vertex_error_km));
      check(worstVertex < 1e-4, 'R reference: zones.geojson: every circle\'s vertices at the ring\'s distance from the positive, within 1e-4 km (six decimals)', worstVertex);
    }
  }

  {   // The synthetic screwworm outbreak (test-tables/, for trying the switch between outbreaks): the type, the groups,
    // the dispersal areas and the bundle.
    const nr = csvOf('em_nws_synthetic_positives.csv'), nw = E.readPositives(nr[0], nr.slice(1), null);
    const nwWin = E.windowOf(nw.positives), ng = E.groups(nw, nwWin);
    check(nw.type.id === 'nws' && nw.positives.length === 10 && same(nw.dropped.map(d => d.name + ': ' + d.reason), ['SYN-NWS-011: no coordinates']),
      'screwworm outbreak: picked as New World screwworm; ten positives mapped, one row without coordinates', nw.dropped);
    check(same(nwWin, { start: '2026-08-05', end: '2026-10-09' }) && E.playSteps(nwWin).by === 'week' && E.playSteps(nwWin).steps.length === 10,
      'screwworm outbreak: Aug 5 to Oct 9, 2026: ten epi weeks, so the play steps by week', nwWin);
    check(same(ng.past.map(p => p.name), ['SYN-NWS-001', 'SYN-NWS-002']) && same(ng.stillQuarantined.map(p => p.name), ['SYN-NWS-002'])
      && ng.current.length === 8, 'screwworm outbreak: two past (one released, one still under quarantine), eight current', ng.past.map(p => p.name));
    const nz = Z.readGeoJson(fs.readFileSync(path.join(FXD, 'em_nws_synthetic_dispersal_area.geojson'), 'utf8'), 'dispersal.geojson');
    const inside = nz.zones.map(z => nw.positives.filter(p => PX.inZone(p.lon, p.lat, z.geometry)).map(p => p.name));
    check(same(inside, [['SYN-NWS-001', 'SYN-NWS-002', 'SYN-NWS-003'], ['SYN-NWS-004', 'SYN-NWS-005', 'SYN-NWS-006', 'SYN-NWS-007', 'SYN-NWS-009']])
      && /made up/.test(nz.zones[0].name), 'screwworm outbreak: the two made-up dispersal areas hold the positives they were drawn around; Walla Walla outside both', inside);
    const nd = E.byQuiet(E.daysSince(E.zoneSites(nz.zones), ng.current.concat(ng.past), nwWin.end));
    check(same(nd.map(d => [d.latest, d.days]), [['2026-10-02', 7], ['2026-08-26', 44]]), 'screwworm outbreak: days since the last positive per dispersal area', nd);
    const bj = JSON.parse(FX.NWS_FILES['bundle.json']);
    check(bj.synthetic === true && same(bj.profiles, ['emergency']) && fs.existsSync(path.join(ROOT, 'test-tables', 'em_nws_synthetic.zip'))
      && !Object.values(FX.NWS_FILES).some(t => /(?<!\(synthetic\) )MARKED-ADDRESS/.test(t)),
    'screwworm outbreak: the bundle is marked synthetic for Emergency; its ZIP is in test-tables/; every address is marked "(synthetic)"', bj);
  }

  console.log(`Emergency unit tests: ${pass} passed, ${fail} failed`);
  for (const f of failures) console.log('  FAIL ' + f);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
