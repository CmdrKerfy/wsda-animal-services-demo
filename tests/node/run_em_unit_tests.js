#!/usr/bin/env node
'use strict';
// Emergency Response unit tests (Node >= 22, no packages): the rules (site/emergency/rules.js) against the R
// reference (tests/oracle/em_oracle.R, local-test-artifacts/em/oracle_em.json), the emergency types (types.js, the HPAI
// type and the made-up third type in tests/synthetic/em_made_up_type.js), the dataset list (site/emergency/datasets.js)
// and its recognition through the shared recognize.js (positives by their marker columns, the collision cases, the
// zone kind and the shapefile reason), the Emergency sample, bundle.json's shared entries, the guide's Emergency
// part and the chart (site/emergency/chart.js, its copied text widths and axis breaks against CVI's chartsvg.js), and
// the work-PC table check (tools/work-pc/check_hpai_table.R, run with Rscript) against the page's counts. The page's
// own files run unchanged in Node.
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
// The Overview's map data, as the page loads them: the county shapes and the 2020 Census tracts, decoded by
// population.js (its window globals land on globalThis here).
globalThis.window = globalThis.window || globalThis;
for (const f of ['shared/population.js', 'geo/wa-counties.js', 'geo/tracts-wa.js']) require(path.join(SITE, f));
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
    quarantineStatus: ['Quarantine Status'], flockType: ['Flock/Herd Type'], inventory: ['Flock/Herd Inventory'],
    shown: ['Production Type'] }),
  'HPAI: the agreed table\'s column names first, E1a\'s after them; the flock type and inventory by their roles; the quarantine status column (2.4)', hpai.columns);
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
  bad(t => { t.quarantineValues = { under: ['held'], released: ['released', 'Held'] }; }, /"quarantineValues" should be different words for under quarantine and released \("held" is in both\)/, 'a quarantine value in both lists');
  bad(t => { t.quarantineValues = { under: [], released: ['released'] }; }, /"quarantineValues\.under" should be a list of one or more words/, 'no quarantine values for under quarantine');
  bad(t => { t.columns = ['Case ID']; }, /"columns" should be the column names for each role, in \{ \}/, 'columns as a list');
  bad(t => { t.columns.place = ['City']; }, /"columns" should be roles among id, detected, disease, status, quarantine, quarantineStatus, flockType, inventory, shown \(not "place"\)/, 'an unknown column role');
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
      quarantine: [], quarantineStatus: [], flockType: [], inventory: [], shown: [] }) && same(c.closed.column, ['Surveillance Closed'])
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
    check(same(rows[0], FX.AGREED_HEAD.concat(['Quarantine Status'])) && rows.slice(1).every(r => r.length === 21),
      'sample: the positives in the agreed HPAI table\'s 20 columns, in its order, and the Quarantine Status column last (2.4)', rows[0]);
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
    check(same(ex.positives.rows.map(r => r[1]), ['Active', 'Active', 'Closed', 'Active', 'Active', 'Active', 'Not mapped'])
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
      disease: 'Subtype', quarantine: 'Quarantine Release', quarantineStatus: null, closed: 'Status', closedDate: 'Close Date', flockType: 'Flock/Herd Type',
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
    // The marks' shapes (2.4): the animal the numbers count each positive under.
    check(E.animalShapeOf(hpai, agAt('Skagit 01')) === 'circle' && E.animalShapeOf(hpai, agAt('Whatcom 01')) === 'square'
      && E.animalShapeOf(hpai, { species: 'Meat Goat' }) === 'triangle' && E.animalShapeOf(hpai, { species: 'Racing Pigeon' }) === 'circle'
      && E.animalShapeOf(hpai, { species: null }) === 'circle' && E.animalShapeOf(hpai, { species: 'Dairy Cow' }) === 'square'
      && E.animalShapeOf(nws, { species: 'Cattle' }) === 'circle' && same(E.ANIMAL_SHAPES, ['circle', 'square', 'triangle']),
    'the mark\'s shape: birds (a blank species too) a circle, cattle a square, other animals a triangle; screwworm\'s animals one circle');
    check(same(E.animalKeys(hpai, ag.positives), [{ shape: 'circle', label: 'Birds' }, { shape: 'square', label: 'Cattle' }])
      && same(E.animalKeys(hpai, [{ species: 'Goat' }, { species: 'Chicken' }]), [{ shape: 'circle', label: 'Birds' }, { shape: 'triangle', label: 'Other animals' }])
      && same(E.animalKeys(hpai, [agAt('Whatcom 01')]), [{ shape: 'square', label: 'Cattle' }]) && same(E.animalKeys(hpai, []), [])
      && same(E.animalKeys(nws, [{ species: 'Cattle' }]), [{ shape: 'circle', label: 'Animals' }]),
    'the legend\'s animal rows: one per shape among the positives drawn, in the shapes\' order; none for none', E.animalKeys(hpai, ag.positives));
    // The animal filter (2.7): a kind left out leaves the read, the rows not mapped too; the words say what is shown.
    {
      const mixed = { type: hpai, columns: ag.columns, positives: [{ name: 'B1', species: 'Chicken' }, { name: 'C1', species: 'Dairy Cow' },
        { name: 'B2', species: null }, { name: 'G1', species: 'Goat' }, { name: 'M1', species: 'Cattle, Chicken' }],
      dropped: [{ name: 'Line 9', species: 'Cattle' }, { name: 'Line 10', species: 'Duck' }], badDates: [] };
      const names = r => r.positives.map(p => p.name).join(' ');
      const cattle = E.byAnimals(mixed, ['square']), birdsGoats = E.byAnimals(mixed, ['circle', 'triangle']);
      check(names(cattle) === 'C1 M1' && cattle.dropped.map(p => p.name).join() === 'Line 9' && names(birdsGoats) === 'B1 B2 G1'
        && birdsGoats.dropped.map(p => p.name).join() === 'Line 10' && names(E.byAnimals(mixed, [])) === '' && names(E.byAnimals(mixed, E.ANIMAL_SHAPES)) === 'B1 C1 B2 G1 M1'
        && cattle.columns === mixed.columns && cattle.type === hpai && mixed.positives.length === 5 && mixed.dropped.length === 2,
      'the filter keeps the kinds ticked (positives and rows not mapped), a positive naming cattle and birds as cattle, and leaves the read itself as it was',
      [names(cattle), names(birdsGoats)]);
      check(E.animalsOnly(hpai, mixed.positives, ['square']) === 'Cattle' && E.animalsOnly(hpai, mixed.positives, ['circle', 'square']) === 'Birds and cattle'
        && E.animalsOnly(hpai, mixed.positives, ['circle', 'square', 'triangle']) === null && E.animalsOnly(hpai, mixed.positives, []) === null
        && E.animalsOnly(hpai, [{ species: 'Chicken' }], ['circle']) === null && E.animalsOnly(hpai, mixed.positives, ['triangle']) === 'Other animals'
        && E.animalsOnly(hpai, ag.positives, ['circle']) === 'Birds',
      'the filter in words: the kinds shown, only when some are left out ("Cattle", "Birds and cattle"); null for every kind, one kind in the file, or none ticked');
      const birdsMapped = Object.assign({}, mixed, { positives: [mixed.positives[0], mixed.positives[2]], dropped: [mixed.dropped[0]] });
      const noneMapped = Object.assign({}, mixed, { positives: [], dropped: [mixed.dropped[0]] });
      check(same(E.animalKindsOf(birdsMapped), [{ shape: 'circle', label: 'Birds' }, { shape: 'square', label: 'Cattle' }])
        && same(E.animalKindsOf(noneMapped), [{ shape: 'square', label: 'Cattle' }]) && same(E.animalKindsOf(Object.assign({}, mixed, { positives: [], dropped: [] })), [])
        && E.animalsOnly(hpai, birdsMapped.positives.concat(birdsMapped.dropped), ['circle']) === 'Birds',
      'the file\'s kinds: its positives\' and its rows not mapped, so cattle whose only row has no coordinates still get a tick', E.animalKindsOf(birdsMapped));
    }
    const fourRaw = JSON.parse(JSON.stringify(hpai));
    fourRaw.id = 'test-four-animals';
    fourRaw.countedApart = [{ species: ['cattle'], word: 'cattle' }, { species: ['goat'], word: 'goats' }, { species: ['sheep'], word: 'sheep' }];
    const four = T.check(fourRaw), sheepGoat = [{ species: 'Sheep' }, { species: 'Goat' }];
    check(E.animalShapeOf(four, { species: 'Sheep' }) === 'triangle' && E.animalShapeOf(four, { species: 'Goat' }) === 'triangle'
      && same(E.animalKeys(four, sheepGoat), [{ shape: 'triangle', label: 'Goats, sheep' }]),
    'a type with more animals than shapes: every later word a triangle, its row naming them all', E.animalKeys(four, sheepGoat));
    check(E.numbersLine(ag, early.current) === '1 commercial, 1 backyard, 1,100 birds' && E.numbersLine(ag, []) === null
      && E.numbersLine(read, read.positives) === null, 'the numbers line on an earlier end; none for no positives or a file without the columns');
    const nr = csvOf('em_positives_nws.csv'), nw = E.readPositives(nr[0], nr.slice(1), null);
    check(E.numbersLine(nw, nw.positives) === '1 commercial, 1 backyard, 243 animals', 'the numbers line in screwworm\'s word', E.numbersLine(nw, nw.positives));
    check(E.notMappedLine(ag.dropped) === '2 not mapped: 1 no coordinates, 1 latitude and longitude look swapped'
      && E.notMappedLine([{ reason: 'no coordinates' }, { reason: 'no coordinates' }]) === '2 not mapped: no coordinates' && E.notMappedLine([]) === null,
    'the not-mapped line, by reason', E.notMappedLine(ag.dropped));
    const vb = E.valueBoxes(Object.assign({}, ag, { targets: E.targets(ag.positives, { statuses: ['Confirmed'] }, agWin) }), null, agWin);
    check(vb.positives.value === 5 && vb.positives.note === null && same(vb.positives.lines, [
      '2 not mapped: 1 no coordinates, 1 latitude and longitude look swapped', '1 date not readable', '1 without a date'])
      && vb.past.value === 5 && vb.past.quarantined === 2 && vb.past.note === '2 still under quarantine'
      && vb.last.value === '2026-10-05' && vb.last.note === 'As of Oct 5, 2026',
    'the boxes with a window (each count once): the current positives (never the past; "with zones" only when it differs), the past ones with those still under quarantine, the warnings (the animals are the Overview\'s box since 2.3), the as-of date', vb);
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
    // A view with no dated positive: in its own words, never "no readable" (2.5; 2.4's emptyWindow and its line gone).
    const emptyBox = E.valueBoxes(tm, null, E.rangeView('2026-09-21', '2026-09-21'));
    const beforeBox = E.valueBoxes(tm, null, E.dayView(tmWin, '2026-09-01'));
    check(emptyBox.last.value === null && emptyBox.last.reason === 'None between these dates' && emptyBox.positives.value === 0
      && beforeBox.last.value === null && beforeBox.last.reason === 'None by this day' && beforeBox.positives.value === 0
      && !('emptyWindow' in emptyBox),
    'a view with no dated positive: "None between these dates", or "None by this day" before the first detection; never "no readable"',
      [emptyBox.last, beforeBox.last]);
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
    // The day's line and the dates' band (2.5), in WSDA blue; none without a mark.
    const lineSvg = CH.columns({ title: 't', series, columns: cols, mark: { kind: 'line', col: 2, at: 0.5 } }, { width: 400, height: 170 });
    const bandSvg = CH.columns({ title: 't', series, columns: cols, mark: { kind: 'band', from: 1, to: 2 } }, { width: 400, height: 170 });
    const xOf = (s, re) => Number((s.match(re) || [])[1]);
    const colX = k => xOf(svg, new RegExp('class="chart-col" data-col="' + k + '" x="([\\d.]+)"'));
    const slotW = colX(1) - colX(0);
    check(Math.abs(xOf(lineSvg, /class="chart-line" x1="([\d.]+)"/) - (colX(2) + slotW / 2)) < 0.01 && /chart-line-dot/.test(lineSvg)
      && Math.abs(xOf(bandSvg, /class="chart-band" x="([\d.]+)"/) - colX(1)) < 0.01
      && Math.abs(xOf(bandSvg, /class="chart-band" x="[\d.]+" y="[\d.]+" width="([\d.]+)"/) - 2 * slotW) < 0.01
      && (bandSvg.match(/chart-band-edge/g) || []).length === 2 && !/chart-line|chart-band/.test(svg),
    'chart: the day\'s line inside its column at its share; the band over the dates\' columns, edged; neither without a mark');
    const one = CH.columns({ title: 't', series, columns: [cols[3]] }, { width: 320, height: 170 });
    check(one.includes('>Current</text>') && !one.includes('>Past</text>') && !one.includes('>Outside the window</text>'),
      'chart: the key shows only the series counted somewhere');
    // The Overview's horizontal bars (CVI's hbars, copied): stacked end to end, the past hollow, the total after them.
    const bseries = [{ key: 'current', label: 'current', name: 'Current', fill: '#a50f15' },
      { key: 'past', label: 'past', name: 'Past', outline: true, stroke: '#a50f15' }];
    const brows = [{ label: 'Yakima <x>', values: { current: 2, past: 1 } }, { label: 'Lewis', values: { current: 0, past: 1 } },
      { label: 'Disposal Facilities', values: { current: 0, past: 0 } }];
    const marksOf = m => [...m.matchAll(/<rect([^>]*)\/>/g)].map(x => Object.fromEntries([...x[1].matchAll(/ ([\w-]+)="([^"]*)"/g)].map(a => [a[1], a[2]])))
      .filter(r => r.class === 'chart-mark');
    const wide = CH.bars({ title: 'Positives by county', series: bseries, rows: brows }, { width: 500 }), wm = marksOf(wide);
    check(same(wm.map(r => r['data-hover']), ['Yakima &lt;x&gt;: 2 current', 'Yakima &lt;x&gt;: 1 past', 'Lewis: 1 past'])
      && wm.every(r => r.role === 'img' && r['aria-label'] === r['data-hover']) && /^<svg[^>]* role="group" aria-label="Positives by county"/.test(wide),
    'bars: each bar\'s hover and screen-reader label ("Yakima: 2 current"), escaped; a row of zeros draws no bar; the chart labeled', wm.map(r => r['data-hover']));
    const [c1, p1, p2] = wm.map(r => ({ x: num(r, 'x'), w: num(r, 'width'), fill: r.fill, stroke: r.stroke }));
    check(c1.fill === '#a50f15' && p1.fill === '#ffffff' && p1.stroke === '#a50f15' && Math.abs(p1.x - 0.75 - (c1.x + c1.w)) < 0.02
      && Math.abs(c1.w / 2 - (p1.w + 1.5)) < 0.02 && Math.abs((p2.w + 1.5) - (p1.w + 1.5)) < 0.02,
    'bars: a row\'s past stacked after its current, hollow with its outline inside; lengths in proportion to the counts', [c1, p1, p2]);
    check(['>3</text>', '>1</text>', '>0</text>', '>Current</text>', '>Past</text>', 'text-anchor="end">Yakima &lt;x&gt;</text>'].every(k => wide.includes(k)),
      'bars: each row\'s total after its bars (0 for a row of zeros), the key, the labels at the left', wide.length);
    const tot = CH.bars({ title: 't', series: bseries, rows: [{ label: 'Dairies', values: { current: 2, past: 2 }, total: 3 }] }, { width: 500 });
    const valueLabels = m => [...m.matchAll(/fill="#37474f"[^>]*>([^<]*)<\/text>/g)].map(x => x[1]);
    check(same(valueLabels(tot), ['3']) && same(valueLabels(wide), ['3', '1', '0']),
      'bars: a row\'s own total shown when given (a zone file\'s overlapping zones), else the bars\' sum', valueLabels(tot));
    const solo = CH.bars({ title: 't', series: bseries.slice(0, 1), rows: brows.slice(0, 1) }, { width: 500 });
    const soloKey = CH.bars({ title: 't', series: bseries.slice(0, 1), rows: brows.slice(0, 1), key: true }, { width: 500 });
    check(!solo.includes('>Current</text>') && soloKey.includes('>Current</text>'), 'bars: no key for a single series unless asked (a zone file\'s one zone named)');
    const narrowSvg = CH.bars({ title: 't', series: bseries, rows: brows }, { width: 300 });
    const firstX = Math.min(...marksOf(narrowSvg).map(r => num(r, 'x'))), zero = narrowSvg.match(/<text x="([\d.]+)"[^>]*>0<\/text>/);
    check(narrowSvg.includes('<text x="0" y=') && narrowSvg.includes('>Yakima &lt;x&gt;</text>') && !narrowSvg.includes('text-anchor="end">Yakima')
      && zero && Number(zero[1]) >= CH.textWidth('0', 12.8) / 2 - 0.01 && firstX < 10
      && Number(narrowSvg.match(/height="(\d+)"/)[1]) > Number(wide.match(/height="(\d+)"/)[1]),
    'bars: under 360 pixels each label above its bar at the left edge (none cut), the axis\'s 0 not cut, the rows taller', { firstX, zero: zero && zero[1] });
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
    check(same(exRow('Yakima 02').slice(1, 6), ['Closed', 'Confirmed', 'Yes', '2026-02-10', '']) && exRow('Yakima 02')[15] === 'Still under quarantine'
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
      && same(Object.keys(feats[20].properties).slice(-3), ['area_sq_mi', 'area_acres', 'source'])
      && same(feats[0].properties, { name: 'Infection zone (2 mi) around Positive 4 (Kittitas)', zone: 'Infection zone', positive: 'Positive 4 (Kittitas)', group: 'Current', distance: 2, unit: 'mi',
        days_since_last_positive: null, as_of: '2026-10-05' })
      && same(feats[20].properties, { name: 'Synthetic area with two positives', zone: 'Synthetic area with two positives', positive: null, group: null, distance: null, unit: null,
        days_since_last_positive: 279, as_of: '2026-10-05', area_sq_mi: 246.67, area_acres: 157869, source: 'file' }), 'GeoJSON: the properties (a zone\'s also its area and source, 2.6)', feats.slice(0, 1).concat(feats.slice(20, 21)).map(f => f.properties));
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
    check(same(zr.columns, ['Zone', 'Positive', 'Ring', 'Distance', 'Unit', 'Last positive', 'Days since the last positive', 'As of', 'Area (sq mi)', 'Area (acres)'])
      && same(zr.rows[0], ['Control zone (6 mi) around Skagit 01', 'Skagit 01', 'Control zone', 6, 'mi', '2026-10-05', 0, '2026-10-05', '', ''])
      && same(zr.rows.map(r => r[1]), ['Skagit 01', 'Lewis 02', 'Umatilla 01', 'Whatcom 01', 'Positive 4 (Kittitas)'])
      && same(zr.rows[4].slice(5), ['', '', '2026-10-05', '', '']),
    'zones.csv: each positive\'s outer ring in the unit shown, the longest-quiet last, a zone with no dated positive blank', zr.rows);
    const zz = E.zoneRows(agZoneDays, { zonesMode: true, rings: AG.rings, unit: 'mi', asOf: agWin.end });
    check(same(zz.rows, [['Synthetic area with two positives', '', '', '', '', '2025-12-30', 279, '2026-10-05', 246.67, 157869]]),
      'zones.csv: a zone file\'s zone by its name, with no positive, ring, distance or unit; its area (2.6)', zz.rows);
  }

  // The picture's panel for the rules fixture's rings and every layer (2.7), checked against the R reference in 9.
  let fixturePanel = null;
  {   // The map picture (site/emergency/branded.js): the page's model, from the agreed scenario. The branded files need
    // a window, so they load in their own context, as in the S11 suite; the inputs come from the rules above.
    const vm = require('vm');
    const ctx = { window: {}, console, TextEncoder, TextDecoder };
    ctx.window.window = ctx.window;
    vm.createContext(ctx);
    for (const f of ['cvi/app/csv.js', 'cvi/app/scaling.js', 'shared/proximity.js', 'shared/zones.js', 'geo/wa-counties.js',
      'shared/facilities.js', 'shared/brand.js', 'shared/branded.js', 'shared/tiles.js', 'shared/labels.js',
      'cvi/app/brandedmaps.js', 'emergency/types.js', 'emergency/types/hpai.js', 'emergency/types/nws.js', 'emergency/rules.js',
      'emergency/icons.js', 'emergency/branded.js']) {
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
    // The period line by the view (2.5): the pin and "Active on", or the span, "Detected" and a "Detected" box first.
    const onDay = EB.page(base({ window: E.dayView(agWin, '2026-10-05') })).model;
    const between = EB.page(base({ window: E.rangeView('2026-09-01', '2026-10-05'), detected: 7 })), rangeModel = between.model;
    const iconOf = parts => ([].concat(parts).join("").match(/<path transform="translate\([^"]*\)[^>]*d="([^"]*)" fill="#1c5a83"\/>/) || [])[1];
    check(same(onDay.stats.left.map(x => x.prefix + ' ' + x.value), ['Active on Oct 5, 2026'])
      && same(rangeModel.stats.left.map(x => x.prefix + ' ' + x.value), ['Detected Sep 1, 2026 to Oct 5, 2026'])
      && onDay.stats.left[0].prefix + ' ' + onDay.stats.left[0].value === E.periodLine(E.dayView(agWin, '2026-10-05'))
      && rangeModel.stats.left[0].prefix + ' ' + rangeModel.stats.left[0].value === E.periodLine(E.rangeView('2026-09-01', '2026-10-05'))
      && iconOf(EB.page(base({ window: E.dayView(agWin, '2026-10-05') })).parts) === ctx.window.WSDA.emergencyIcons.path('pin')
      && iconOf(between.parts) === ctx.window.WSDA.emergencyIcons.path('span') && !iconOf(built.parts),
    'map picture: the period line by the view, as rules.js periodLine says it, after the pin or the span in WSDA blue', [onDay.stats, rangeModel.stats]);
    check(same(onDay.boxes.map(b => b.label), ['Active positives', 'Sites inside'])
      && same(rangeModel.boxes.map(b => [b.label, b.value]), [['Detected', '7'], ['Active positives', '5'], ['Sites inside', String(agRes.total)]]),
    'map picture: Between dates a "Detected" box first; On a day "Active positives" and "Sites inside"', rangeModel.boxes);
    const iconEnd = rangeModel.stats.left[0].iconW + BRW.px(0.01) + BRW.textWidth('Detected', 13, true) + BRW.px(0.006) + BRW.textWidth(rangeModel.stats.left[0].value, 13);
    check(iconEnd < rangeModel.boxLayout[0].x0, 'map picture: the boxes start after the period line and its icon', [iconEnd, rangeModel.boxLayout[0].x0]);
    // The widest range line (any two months, the 28th, 2024 to 2026) beside the five boxes a CVI master gives: every
    // label whole, the boxes after the line.
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const widest = [].concat(...MON.map(a => MON.map(b => a + ' 28, 2024 to ' + b + ' 28, 2026')))
      .reduce((w, v) => (BRW.textWidth(v, 13) > BRW.textWidth(w, 13) ? v : w));
    const widePeriod = Object.assign({}, rangeModel.stats.left[0], { value: widest });
    const fiveLabels = ['Detected', 'Active positives', 'Sites inside', 'CVIs in or out', 'Animals moved'];
    const fiveBoxes = EB.valueBoxes(fiveLabels.map(label => ({ label, value: '1,234', color: '#245566' })), widePeriod).boxes;
    const wideEnd = widePeriod.iconW + BRW.px(0.01) + BRW.textWidth('Detected', 13, true) + BRW.px(0.006) + BRW.textWidth(widest, 13);
    check(fiveBoxes.every((b, i) => b.label === fiveLabels[i]) && wideEnd < fiveBoxes[0].x0,
      'map picture: Between dates the widest period line beside five boxes: every label whole, the boxes after the line',
      [widest, Math.round(wideEnd), fiveBoxes.map(b => [b.label, Math.round(b.x0), +b.labelPt.toFixed(1)])]);
    const periodEnd = BRW.px(0.01) + BRW.textWidth('Detected between', 13, true) + BRW.px(0.006) + BRW.textWidth(m.stats.left[0].value, 13);
    check(periodEnd < m.boxLayout[0].x0 && m.boxLayout[0].x0 <= BRW.px(0.46) + 0.01,
    'map picture: the period line ends before the value boxes, which start just after it (at most at 0.46)', [periodEnd, m.boxLayout[0].x0]);
    const insideKeys = new Set(agRes.rows.map(r => r.lat + ',' + r.lon + ',' + r.name));
    check(same(m.boxes.map(b => [b.label, b.value]), [['Active positives', '5'], ['Sites inside', String(agRes.total)]])
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
    // The sites inside by layer (2.7): the rules fixture's rings and every layer, each in its own shape.
    const SHAPES = ['circle', 'square', 'diamond', 'triangle', 'star', 'triangle-down'];
    const COLORS = ['#1f77b4', '#2ca02c', '#9467bd', '#8c564b', '#e377c2', '#17becf'];
    const pngLayers = list => Object.fromEntries(list.map((l, k) => [l.key, { label: l.label, color: COLORS[k % 6], shape: SHAPES[k % 6] }]));
    const shownAll = list => list.map(p => ({ name: p.name, lat: p.lat, lon: p.lon, color: '#a50f15', status: 'Confirmed', past: false }));
    const fxBuilt = EB.page(base({ positives: shownAll(read.targets), sites, rings, unit: 'km', result: res, layers: pngLayers(layers),
      days: [], current: read.targets.length }));
    const fx = fxBuilt.model;
    fixturePanel = fx.panel.rows.map(r => ({ name: sites[r.site].name, layers: r.layers.map(x => [x.key, x.n]) }));
    const insideCsv = E.exportRows(read, read.targets, res, 'km').inside.rows;
    const ofCsv = (pos, label) => new Set(insideCsv.filter(r => r[0] === pos && r[1] === label).map(r => r[2])).size;
    const csvLayers = pos => layers.map(l => [l.key, ofCsv(pos, l.label)]).filter(([, n]) => n);
    check(fx.panel.rows.length === sites.length && fx.panel.rows.some(r => r.layers.length > 1)
      && fx.panel.rows.every(r => same(r.layers.map(x => [x.key, x.n]), csvLayers(sites[r.site].name))
        && r.layers.reduce((t, x) => t + x.n, 0) === Number(r.count.replace(/,/g, ''))),
    'map picture: each panel row\'s sites inside by layer as inside_the_zones.csv gives them, in the layers\' order, the layers with none left out, adding up to its count (2.7)',
    fx.panel.rows.map(r => [sites[r.site].name, r.layers.map(x => x.key + ' ' + x.n).join(', ')]));
    // A layers line's right edge (points from the column's start), as the panel spaces its marks and counts.
    const lineEnd = ln => ln.x + ln.items.reduce((t, it) => t + 0.84 * ln.pt + 0.25 * ln.pt + BRW.textWidth(String(it.n), ln.pt, true) + 0.9 * ln.pt, 0) - 0.9 * ln.pt;
    const column = (0.96 - 0.05) * BRW.px(BRW.LAYOUT.gutterW);
    const drawnCounts = parts => (parts.match(/fill="#3d4852"/g) || []).length;
    const linesOk = rows => rows.every(r => same([].concat(...r.layerLines.map(ln => ln.items)), r.layers)
      && (!r.layers.length || !r.subLeft || r.layerLines[0].y === r.subY || r.layerLines[0].x === 0)
      && r.layerLines.every(ln => ln.items.length && lineEnd(ln) <= column + 1e-6));
    check(linesOk(fx.panel.rows) && fx.panel.rows.some(r => r.layerLines[0] && r.layerLines[0].y === r.subY && r.layerLines[0].x > 0)
      && drawnCounts(fxBuilt.parts[5]) === fx.panel.rows.reduce((t, r) => t + r.layers.length, 0),
    'map picture: each layer\'s mark and count drawn once, starting on the county line after the county and wrapping under it, every line inside the column (2.7)',
    fx.panel.rows.map(r => r.layerLines.map(ln => [+ln.x.toFixed(1), ln.items.length, +lineEnd(ln).toFixed(1)])));
    const sharedFx = res.rows.some(a => res.rows.some(b => b.site !== a.site && b.layer === a.layer && b.name === a.name && b.lat === a.lat && b.lon === a.lon));
    check(same(fx.panel.notes, sharedFx ? ['A shared site counts under each positive'] : []) && same(m.panel.notes, []),
      'map picture: the note "A shared site counts under each positive" only when a site is in two positives\' zones (2.7)', [sharedFx, fx.panel.notes]);
    // The worst case: 12 made-up positives close together, 10 layers of made-up sites, most positives
    // with sites in every layer and days since the last positive: the rows listed never run into the notes, each
    // layers line inside the column, the rows not listed counted, and the shared-site note under that note.
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const spot = mg => ({ lat: 46.28 - mg + rnd() * (0.40 + 2 * mg), lon: -120.80 - mg + rnd() * (0.85 + 2 * mg) });
    const wPos = Array.from({ length: 12 }, (_, i) => Object.assign({ index: i, name: 'Synthetic busy farm ' + (i + 1) }, spot(-0.03)));
    const wLayers = [160, 90, 130, 14, 12, 9, 35, 120, 18, 11].map((n, k) => ({ key: 'w' + k, label: 'Synthetic layer ' + (k + 1),
      color: '#000000', points: Array.from({ length: n }, (_, j) => Object.assign({ name: 'Synthetic site ' + k + '-' + j, county: null,
        town: null, geoSource: '', precision: {} }, spot(0.12))) }));
    const wSites = E.ringSites(wPos, rings);
    const wRes = E.inside(wSites, wLayers, { mode: 'rings', rings, positives: wPos });
    const worstOf = list => EB.page(base({ positives: shownAll(wPos), sites: wSites, rings, unit: 'km', result: list === wLayers ? wRes : E.inside(wSites, list, { mode: 'rings', rings, positives: wPos }),
      layers: pngLayers(list), days: wSites.map((st, i) => ({ site: st.id, days: i })), current: 12 }));
    const clearOfNotes = p => p.rowsTop - p.rows.reduce((t, r) => t + r.height, 0)
      >= p.footTop + (p.notes.length ? 0.045 + 0.03 * (p.notes.length - 1) : 0) / p.u - 1e-9;
    const worst = worstOf(wLayers), wp = worst.model.panel;
    check(wp.rows.length >= 1 && wp.rows.length <= 8 && clearOfNotes(wp) && linesOk(wp.rows)
      && same(wp.notes, [(12 - wp.rows.length) + ' more positives not listed (ranked by sites inside)', 'A shared site counts under each positive'])
      && wp.more === wp.notes[0] && drawnCounts(worst.parts[5]) === wp.rows.reduce((t, r) => t + r.layers.length, 0),
    'map picture: the worst case (12 positives close together, 10 layers): the rows clear of the notes, every layers line inside the column, the two notes (2.7)',
    [wp.rows.length, +wp.scl.toFixed(2), wp.notes, wp.rows.map(r => r.layerLines.length)]);
    const withAdded = EB.page(base({ positives: shownAll(wPos), sites: wSites, rings, unit: 'km', result: wRes, layers: pngLayers(wLayers),
      days: [], current: 12, added: [{ name: 'Added point 1', lat: 46.5, lon: -120.4 }] })).model.panel;
    check(withAdded.notes[withAdded.notes.length - 1] === 'A shared site counts under each row',
    'map picture: with an added point among the rows, the shared-site note says "each row" (2.7)', withAdded.notes);
    // The key names every layer whose mark the panel draws (2.7): here 2.6's room would list 6 layers and "and N more",
    // so the key takes the least room from the panel that names them all (its text smaller first), and the panel lists
    // fewer rows, more than the one row the most room would leave it; the rows still clear of the notes.
    const w7 = worstOf(wLayers.slice(0, 7)).model, wk = worst.model;
    check([[w7, 7], [wk, 10]].every(([x, k]) => x.keyMode === 'one' && same(x.keyShown, wLayers.slice(0, k).map(l => l.label)) && clearOfNotes(x.panel)
      && x.panel.rows.length > 1 && x.panel.more === (12 - x.panel.rows.length) + ' more positives not listed (ranked by sites inside)')
      && wk.keyTextScale < 1,
    'map picture: the worst case: the key names all 7 or 10 layers, taking the least room from the panel (with 10, its text smaller; the panel keeping more than one row), the rows clear of the notes (2.7)',
    [w7.keyMode, w7.keyShown.length, w7.panel.rows.length, w7.keyTextScale, wk.keyMode, wk.keyShown.length, wk.panel.rows.length, wk.keyTextScale, +wk.panelH.toFixed(3)]);
    // The safety net: 30 layers would not fit 8 rows at the smallest size, so fewer are listed and the note says so.
    const many = Array.from({ length: 30 }, (_, k) => wLayers[k % 10]).map((l, k) => Object.assign({}, l, { key: 'm' + k, label: 'Synthetic layer ' + (k + 1) }));
    const mRes = E.inside(wSites, many, { mode: 'rings', rings, positives: wPos });
    const net = EB.page(base({ positives: shownAll(wPos), sites: wSites, rings, unit: 'km', result: mRes, layers: pngLayers(many),
      days: wSites.map((st, i) => ({ site: st.id, days: i })), current: 12 })).model.panel;
    check(net.rows.length < 8 && clearOfNotes(net) && linesOk(net.rows) && net.rows.some(r => r.layerLines.length > 1)
      && net.more === (12 - net.rows.length) + ' more positives not listed (ranked by sites inside)',
    'map picture: the safety net: rows that do not fit at the smallest size are left out, the note counting them, never drawn over the notes (2.7)',
    [net.rows.length, net.scl, net.notes]);
    // From 10 to 30 layers: the key names every layer while it can, else as many as it can; the panel never over the notes.
    const sweep = [10, 12, 14, 16, 18, 20, 24, 30].map(k => {
      const ls = many.slice(0, k), mm = EB.page(base({ positives: shownAll(wPos), sites: wSites, rings, unit: 'km', layers: pngLayers(ls),
        result: E.inside(wSites, ls, { mode: 'rings', rings, positives: wPos }), days: wSites.map((st, i) => ({ site: st.id, days: i })), current: 12 })).model;
      return { k, mode: mm.keyMode, shown: mm.keyShown.length, rows: mm.panel.rows.length, clear: clearOfNotes(mm.panel) };
    });
    check(sweep.every(x => x.clear && x.rows >= 1 && (x.mode === 'one' ? x.shown === x.k : x.shown < x.k)) && sweep[0].mode === 'one' && sweep[sweep.length - 1].mode === 'top',
    'map picture: from 10 to 30 layers, the key names every layer while it can, then as many as it can; the panel\'s rows clear of the notes (2.7)', sweep);
    // One positive with 24 layers of 60 sites inside: the lone row has no row to drop, so the key leaves the panel at
    // least that row with its marks at the smallest size; it stays clear of the footer.
    const lone = [wPos[0]], loneSites = E.ringSites(lone, rings);
    const loneLayers = Array.from({ length: 24 }, (_, k) => ({ key: 'l' + k, label: 'Synthetic layer ' + (k + 1), color: '#000000',
      points: Array.from({ length: 60 }, (_, j) => ({ name: 'Synthetic site ' + k + '-' + j, county: null, town: null, geoSource: '', precision: {},
        lat: wPos[0].lat + (rnd() - 0.5) * 0.04, lon: wPos[0].lon + (rnd() - 0.5) * 0.06 })) }));
    const loneM = EB.page(base({ positives: shownAll(lone), sites: loneSites, rings, unit: 'km', layers: pngLayers(loneLayers),
      result: E.inside(loneSites, loneLayers, { mode: 'rings', rings, positives: lone }), days: [{ site: loneSites[0].id, days: 4 }], current: 1 })).model;
    check(loneM.panel.rows.length === 1 && loneM.panel.rows[0].layers.length === 24 && clearOfNotes(loneM.panel) && linesOk(loneM.panel.rows),
    'map picture: one positive with 24 layers of sites inside: its row and every layer\'s mark clear of the footer (2.7)',
    [loneM.panel.rows.length, +loneM.panel.scl.toFixed(2), loneM.keyMode, +loneM.panelH.toFixed(3)]);
    check(svg.indexOf(BRW.esc(EB.SENSITIVE)) > 0 && svg.indexOf('Synthetic sample data') > 0 && svg.indexOf('POSITIVES') > 0
      && !/MARKED-ADDRESS|Synthetic Town|Example Road|Landfill/.test(svg),
    'map picture: the sensitive-data line, the synthetic marker, the panel; no address or other unread column');
    // Past positives shown, with their rings.
    const past = EB.page(base({ positives: shownOf(agGroups.current.concat(agGroups.past)), pastSites: agPast })).model;
    check(same(past.keyItems.map(i => i.label).slice(1, 3), ['Confirmed positive', 'Closed positive'])
      && past.keyItems.some(i => i.label === 'Closed positives\' rings') && past.pastRings.length === agPast.length * 2 && past.pastRings.every(r => r.color === EB.PAST)
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
      && zf.panel.rows[0].subLeft === '246.7 sq mi, 157,869 acres' && same(zf.footer, [['Zones with a site inside', '0 of 1']]) && zf.panel.rows[0].nameSize === 3.1 * zf.panel.scl
      && zf.positives.some(q => q.name === 'Added point 1' && q.color === EB.PICK) && zf.panel.rows[0].days === '279 days since last positive',
    'map picture: a zone file\'s zones in the zone color, the file named in the meta line; a zone\'s name whole at the row\'s size, its area in place of a county line (2.6); an added point; days since per zone', [zf.panel.rows, zf.panel.scl]);
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
    check(same(cv.boxes.map(b => [b.label, b.value]), [['Active positives', '5'], ['Sites inside', String(agRes.total)], ['CVIs in or out', '12'], ['Animals moved', '3,400']])
      && /CVI records/.test(cv.source) && !/CVI records/.test(m.source), 'map picture: with a CVI master, the CVIs to or from the zones and the animals moved in the boxes', cv.boxes);
    // The four boxes: each label whole and inside its box, set clearly below its number; wider than the shared copy's.
    const sharedW = BRW.px(0.77 - 0.46) * (1 - 0.035 * 3) / 4;
    check(cv.boxLayout.length === 4 && cv.boxLayout.every((b, i) => b.label === cv.boxes[i].label
      && b.labelWidth <= b.x1 - b.x0 - 8 + 1e-6 && b.labelTop - b.valueBottom >= 4 && b.x1 - b.x0 > sharedW),
    'map picture: four value boxes: each label whole, inside its box and well below its number; wider than before',
      cv.boxLayout.map(b => [b.label, Math.round(b.x1 - b.x0), Math.round(b.labelWidth), +b.labelPt.toFixed(2), +(b.labelTop - b.valueBottom).toFixed(1)]));
    const longRow = EB.valueBoxes(['Active positives', 'Sites inside', 'A label far too long for any box at all', 'Animals moved']
      .map(label => ({ label, value: '1', color: '#245566' })), { prefix: 'Detected between', value: 'September 30, 2024 and December 31, 2026' }).boxes;
    check(Math.abs(longRow[0].x0 - BRW.px(0.46)) < 0.01 && longRow[0].labelPt < BRW.textPt(2.7) && longRow[0].label === 'Active positives'
      && longRow[1].labelPt === BRW.textPt(2.7) && longRow[2].labelPt === BRW.textPt(2.7) * 0.7 && /…$/.test(longRow[2].label)
      && longRow.every(b => b.labelWidth <= b.x1 - b.x0 - 8 + 1e-6),
    'map picture: the value boxes after a long period line start at 0.46 at the latest; a long label drawn smaller, one too long even then cut with "…"',
      longRow.map(b => [b.label, +b.labelPt.toFixed(2)]));
    // A label drawn smaller to fit its box exactly is never cut as well (at any period line's length). The 2.4 label
    // "Current positives" lands on the rounding edge (drawn smaller, a rounding error wider than its room); the check
    // also asks that some label reach that edge, so a renamed label cannot leave it testing nothing.
    const labelSets = [['Active positives', 'Sites inside', 'CVIs in or out', 'Animals moved'],
      ['Current positives', 'Sites inside', 'CVIs in or out', 'Animals moved']];
    const shrunk = labelSets.flatMap(labels => ['Jul 15, 2026 and Oct 5, 2026', 'Sep 30, 2024 and Dec 31, 2026', 'September 30, 2024 and December 31, 2026']
      .map(value => ({ labels, boxes: EB.valueBoxes(labels.map(label => ({ label, value: '1', color: '#245566' })), { prefix: 'Detected between', value }).boxes })));
    check(shrunk.every(row => row.boxes.every((b, i) => b.label === row.labels[i])) && shrunk.some(row => row.boxes.some(b => b.labelPt < BRW.textPt(2.7)))
      && shrunk.some(row => row.boxes.some(b => b.labelWidth > b.x1 - b.x0 - 8)),
    'map picture: the boxes\' labels whole after any period line, a label drawn smaller to fit never cut too (one at the rounding edge)',
      shrunk.map(row => row.boxes.map(b => b.label)));
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
    // The widest likely line over the map (2.7): HPAI's rings with two kinds named; kept clear of the date on its
    // right, 9 points apart, with the rings said short.
    const metaFits = mm => BRW.textWidth(mm.meta.left, 9) + 9 + BRW.textWidth(mm.meta.right, 9) <= BRW.px(BRW.LAYOUT.mapW - 0.005) - BRW.px(0.01) + 1e-6;
    const wide = EB.page(base({ rings: hpai.zones.rings, unit: 'km', sites: E.ringSites(agTargets, hpai.zones.rings, 'km'),
      animalsOnly: 'Positives: birds and other animals only' })).model;
    const birdsKm = EB.page(base({ rings: hpai.zones.rings, unit: 'km', sites: E.ringSites(agTargets, hpai.zones.rings, 'km'), animalsOnly: 'Positives: birds only' })).model;
    check(metaFits(wide) && wide.meta.left === 'Positives: birds and other animals only · Zones: 3 and 10 km rings'
      && birdsKm.meta.left === 'Positives: birds only · Zones: Infection zone 3 km (1.9 mi), Control zone 10 km (6.2 mi)' && metaFits(birdsKm) && metaFits(km),
    'map picture: the line over the map kept clear of the date on its right; whole, the rings in full, when it fits (2.7)', [wide.meta.left, birdsKm.meta.left]);
    // Too long with the rings in full: the rings said short as the fold's summary says them, the
    // rest whole; with the zones only there are no rings to shorten.
    const bothLong = EB.page(base({ rings: hpai.zones.rings, unit: 'km', sites: E.ringSites(agTargets, hpai.zones.rings, 'km'), show: 'both',
      zoneName: 'synthetic_control_area.geojson and 1 drawn', animalsOnly: 'Positives: cattle only' })).model;
    const zonesLong = EB.page(base({ rings: hpai.zones.rings, unit: 'km', sites: E.ringSites(agTargets, hpai.zones.rings, 'km'), show: 'zones',
      zonesMode: true, animalsOnly: 'Positives: birds and other animals only', zoneName: 'synthetic_control_area_north_county_revised_final_v2_for_review.geojson and 3 drawn' })).model;
    check(bothLong.meta.left === 'Positives: cattle only · Zones: 3 and 10 km rings; synthetic_control_area.geojson and 1 drawn' && metaFits(bothLong)
      && /^Positives: birds and other animals only · Zones: synthetic_control_area_north_county_revised_final.*…$/.test(zonesLong.meta.left) && metaFits(zonesLong)
      && /Infection zone 3 km \(1\.9 mi\)/.test(birdsKm.meta.left),
    'map picture: a line too long with the rings in full says them short ("3 and 10 km rings") before any cut; a zone file\'s long name is cut (2.7)', [bothLong.meta.left, zonesLong.meta.left]);
    // The animals' shapes (2.4): each positive in its shape, a middle mark only when current; the key's ANIMALS rows.
    const animalsShown = agGroups.current.concat(agGroups.past).map(p => Object.assign(shownOf([p])[0], { shape: E.animalShapeOf(hpai, p) }));
    const anBuilt = EB.page(base({ positives: animalsShown, animals: E.animalKeys(hpai, agGroups.current.concat(agGroups.past)) }));
    const an = anBuilt.model, anSvg = BRW.svg(anBuilt.parts, BRW.pixelSize(200)), anKey = an.keyItems.map(i => i.label);
    const squares = an.positives.filter(q => q.shape === 'square');
    const anRow = an.keyItems.find(i => i.label === 'Birds') || {};
    // The squares drawn on the map and in the inset: a white path with the status color's edge.
    const squarePaths = (anSvg.match(/<path d="M[^"]*" fill="#ffffff" stroke="(?!#444444)#[0-9a-f]{6}" stroke-width="[^"]*" stroke-linejoin="round"/g) || []).length;
    check(squares.length === animalsShown.filter(q => q.shape === 'square').length && squares.length > 0
      && an.positives.filter(q => q.shape === 'circle').length === animalsShown.length - squares.length
      && same(anKey.slice(1, 4), ['Confirmed positive', 'Closed positive', 'Birds']) && anRow.glyph.shape === 'animals'
      && same(anRow.glyph.marks.map(k => k.mark), ['circle', 'square']) && same(anRow.glyph.words.map(w => w.label), ['Cattle'])
      && anRow.glyph.words[0].dx > anRow.glyph.marks[1].dx && !m.keyItems.some(i => i.glyph && /^animal/.test(i.glyph.shape))
      && (anSvg.match(/<path d="M[^"]*" fill="#ffffff" stroke="#444444"/g) || []).length === 2 && anSvg.includes('>Cattle</text>')
      && squarePaths === 2 * squares.length,
    'map picture: the cattle squares and the birds circles; the key\'s animals on one row under the positives\' rows, each shape before its word; none without them', [squares.length, squarePaths, anKey]);
    const three = EB.keyItems({ statuses: [], pastColors: [], rings: [], facilities: [], animals: [{ shape: 'circle', label: 'Birds' },
      { shape: 'square', label: 'Cattle' }, { shape: 'triangle', label: 'Other animals' }] });
    const long = EB.keyItems({ statuses: [], pastColors: [], rings: [], facilities: [], animals: [{ shape: 'circle', label: 'Birds' },
      { shape: 'square', label: 'Cattle' }, { shape: 'triangle', label: 'Goats, sheep, alpacas and llamas' }] });
    const rowsOf = k => k.slice(1).map(i => i.glyph.marks.map(x => x.mark).join(' '));
    check(same(rowsOf(three), ['circle square', 'triangle']) && same(rowsOf(long), ['circle square', 'triangle'])
      && same(rowsOf(EB.keyItems({ statuses: [], pastColors: [], rings: [], facilities: [], animals: [{ shape: 'square', label: 'Cattle' }] })), ['square']),
    'map picture: the animals as many on a row as fit (three kinds on two rows); one kind on its own row', [rowsOf(three), rowsOf(long)]);
    // "Optional Map Title" and "Optional Filename" (2.4): the typed title (at most 80 characters) or the type's; the
    // file named YYYY-MM-DD_<name>.png, every character other than letters, digits, "_" and "-" made "_".
    const typed = EB.page(base({ title: '  Briefing map  ', label: ' Briefing Oct/22 ' })).model;
    const long80 = EB.title(hpai, 'x'.repeat(81));
    check(typed.title === 'Briefing map' && typed.titleSize === BRW.titleSize('Briefing map') && EB.title(hpai, '   ') === 'HPAI RESPONSE MAP'
      && EB.title(hpai, '') === 'HPAI RESPONSE MAP' && long80 === 'x'.repeat(79) + '…' && EB.title(hpai, 'y'.repeat(80)) === 'y'.repeat(80),
    'map picture: the title typed in "Optional Map Title" (trimmed, at most 80 characters), else the type\'s', [typed.title, long80.length]);
    check(typed.fileName === '2026-10-22_Briefing_Oct_22.png' && EB.fileName(hpai, DAY, '   ') === 'emergency_hpai_2026-10-22.png'
      && EB.safeLabel(' a b.c ') === 'a_b_c' && EB.safeLabel(null) === '' && EB.fileName(nws, DAY, 'Week-3_map') === '2026-10-22_Week-3_map.png',
    'map picture: the file named from "Optional Filename" (YYYY-MM-DD_<name>.png, CVI\'s rule), else emergency_<type>_<date>.png', typed.fileName);
    // "Name markers in PNG" (2.4): the positives' names unless left out; each picked layer's sites inside named in the
    // layer's darker color, clear of the marks and of the positives' names; a layer not drawn named by no one.
    const meetBox = (a, b) => Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);
    const noNames = EB.page(base({ nameLayers: [] })), nn = noNames.model;
    const nnSvg = BRW.svg(noNames.parts, BRW.pixelSize(200)), mSvg = BRW.svg(built.parts, BRW.pixelSize(200));
    check(same(m.nameLayers, ['positives']) && m.names.length === 5 && !m.facilityNames.length && !nn.names.length && !nn.facilityNames.length
      && mSvg.includes('paint-order="stroke">Lewis 02</text>') && !nnSvg.includes('paint-order="stroke">Lewis 02</text>')
      && nnSvg.includes('>Lewis 02</text>'),
    'map picture: the positives named by default; none named on the map with "Positives" unticked (the panel keeps them)', [m.names.length, nn.names.length]);
    const facNamed = EB.page(base({ nameLayers: ['positives', 'poultry', 'markets'] })).model;
    const bm = ctx.window.CVIWA.brandedmaps;
    const insideNames = [...new Set(agRes.rows.filter(r => r.layer === 'poultry').map(r => r.lat + ',' + r.lon + ',' + r.name))];
    check(facNamed.facilityNames.length === insideNames.length && insideNames.length > 0
      && facNamed.facilityNames.every(n => n.layer === 'poultry' && n.color === bm.facilityNameColor({ key: 'poultry', color: '#1f77b4' }))
      && facNamed.facilityNames.every(n => facNamed.names.every(q => !meetBox(n.at.box, q.at.box)))
      && facNamed.facilityNames.every(n => n.at.free) && facNamed.names.length === 5 && same(facNamed.names, m.names),
    'map picture: a picked layer\'s sites inside named in its darker color, clear of the marks and the positives\' names; a layer not drawn named by no one',
      facNamed.facilityNames.map(n => [n.lines.join(' '), n.at.free]));
    // A site 190 m east of a positive: its name kept off the positive's (with the positive's name not given as taken,
    // it lands on it).
    const nearSites = E.ringSites([{ name: 'Synthetic positive A', lat: 46.6, lon: -120.5 }], hpai.zones.rings, 'km');
    const near = EB.page(base({ positives: [{ name: 'Synthetic positive A', lat: 46.6, lon: -120.5, color: '#a50f15', status: 'Confirmed', past: false }],
      sites: nearSites, rings: hpai.zones.rings, unit: 'km', days: [], current: 1, nameLayers: ['positives', 'poultry'],
      result: { layers: [{ key: 'poultry', label: 'Commercial poultry', color: '#1f77b4' }], total: 1, leftOut: [],
        rows: [{ layer: 'poultry', site: nearSites[0].id, lat: 46.6, lon: -120.4975, name: 'Synthetic Poultry Farm 12' }] } })).model;
    check(near.facilityNames.length === 1 && near.names.length === 1 && !meetBox(near.facilityNames[0].at.box, near.names[0].at.box),
      'map picture: a site\'s name beside a positive kept off the positive\'s name', near.facilityNames.map(n => n.at.box));
    const facOnly = EB.page(base({ nameLayers: ['poultry'] })).model;
    check(!facOnly.names.length && facOnly.facilityNames.length === insideNames.length,
      'map picture: a layer\'s names without the positives\'', facOnly.names.length);
    // Streets (2.4): geo/streets-wa.js's roads, water and place names (none meeting another name), the counties light gray
    // under them with their lines over them, the source line naming the streets; Default without its data.
    vm.runInContext(fs.readFileSync(path.join(SITE, 'geo/streets-wa.js'), 'utf8'), ctx, { filename: 'geo/streets-wa.js' });
    const STREETS = ctx.window.WSDA_STREETS;
    const stBuilt = EB.page(base({ background: 'vector:streets', streets: STREETS, nameLayers: ['positives', 'poultry'] }));
    const st = stBuilt.model, stSvg = BRW.svg(stBuilt.parts, BRW.pixelSize(200));
    const placeBoxes = st.streetNames.map(n => n.box);
    const pane = st.mapPanel, inPane = q => q.x0 >= pane.left && q.x1 <= pane.left + pane.width && q.y0 >= pane.top && q.y1 <= pane.top + pane.height;
    const markSq = st.positives.map(q => ({ x0: q.x - 1, x1: q.x + 1, y0: q.y - 1, y1: q.y + 1 }));
    const otherBoxes = st.names.map(q => q.at.box).concat(st.facilityNames.map(q => q.at.box), markSq);
    check(st.background === 'vector:streets' && st.underlay === null && /Streets: U\.S\. Census Bureau TIGER\/Line/.test(st.source)
      && placeBoxes.length > 3 && placeBoxes.every(b => b && inPane(b) && otherBoxes.every(o => !meetBox(b, o)))
      && placeBoxes.every((b, i) => placeBoxes.every((o, j) => i === j || !meetBox(b, o)))
      && stSvg.includes('stroke="#ead7c2"') && stSvg.includes('fill="#f5f5f5"') && !stSvg.includes('fill="#e8e8e8"')
      && !mSvg.includes('stroke="#ead7c2"') && !/Streets:/.test(m.source) && same(st.names, facNamed.names),
    'map picture: Streets draws the roads, water and place and river names (each inside the map, on no other name or mark) over light gray counties and names its source',
      [st.background, placeBoxes.length, st.source]);
    // A positive on Yakima's own point, not named (its name would cover the mark): no place name on its mark.
    const yak = STREETS.places.find(q => q.name === 'Yakima');
    const onTown = EB.page(base({ background: 'vector:streets', streets: STREETS, positives: [{ name: 'Synthetic positive Y', lat: yak.lat, lon: yak.lon,
      color: '#a50f15', status: 'Confirmed', past: false }], sites: E.ringSites([{ name: 'Synthetic positive Y', lat: yak.lat, lon: yak.lon }], hpai.zones.rings, 'km'),
    rings: hpai.zones.rings, unit: 'km', days: [], current: 1, result: null, nameLayers: [] })).model;
    const yq = onTown.positives[0], yMark = { x0: yq.x - 9, x1: yq.x + 9, y0: yq.y - 9, y1: yq.y + 9 };
    check(onTown.streetNames.length > 3 && onTown.streetNames.every(n => !meetBox(n.box, yMark)) && !onTown.streetNames.some(n => n.name === 'Yakima'),
      'map picture: under Streets no place name on a positive\'s mark (one on Yakima\'s own point leaves Yakima unnamed)', onTown.streetNames.map(n => n.name).slice(0, 8));
    // A river's name kept only inside the map and off every other name and mark.
    const keptBoxes = [{ x0: 55, x1: 58, y0: 49, y1: 51 }];
    const rivers = EB.clearRiverNames([{ kind: 'place', name: 'Town', box: { x0: 10, x1: 30, y0: 10, y1: 16 } },
      { kind: 'river', name: 'Snake', x: 20, y: 13 }, { kind: 'river', name: 'Columbia', x: 99, y: 50 },
      { kind: 'river', name: 'Yakima', x: 50, y: 50 }, { kind: 'river', name: 'Spokane', x: 50, y: 80 }], keptBoxes, { x0: 0, x1: 100, y0: 0, y1: 100 });
    check(same(rivers.map(n => n.name), ['Town', 'Spokane']) && keptBoxes.length === 3 && rivers[1].box && rivers[1].box.y0 < 80 && rivers[1].box.y1 > 80,
      'map picture: a river\'s name dropped on a place name, past the map\'s edge or on a mark; kept where clear', rivers.map(n => n.name));
    const noData = EB.page(base({ background: 'vector:streets', streets: null })).model;
    check(noData.background === 'standard' && !/Streets:/.test(noData.source) && !noData.streetNames.length,
      'map picture: Streets without its data drawn on the Default background', noData.background);
  }

  {   // The view (map.js viewBounds, 2.4): the zones, the past zones and the positives shown, all of them.
    globalThis.CVIWA = globalThis.CVIWA || {};
    require(path.join(SITE, 'emergency/map.js'));
    const VB = globalThis.WSDA.emergencyMap.viewBounds;
    const square = (lon, lat, d) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[lon - d, lat - d], [lon + d, lat - d],
      [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] } });
    const multi = { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [square(-117, 47, 0.1).geometry.coordinates] } };
    const zone = square(-120, 46, 0.2), pastZone = square(-122, 48, 0.1), far = { lon: -124, lat: 45.5 };
    check(same(VB([zone], [], []), [-120.2, 45.8, -119.8, 46.2]) && same(VB([zone], [], [far]), [-124, 45.5, -119.8, 46.2])
      && same(VB([zone], [pastZone], []), [-122.1, 45.8, -119.8, 48.1]) && same(VB([], [], [far, { lon: -121, lat: 47 }]), [-124, 45.5, -121, 47])
      && same(VB([multi], [], []), [-117.1, 46.9, -116.9, 47.1]) && VB([], [], []) === null,
    'the view: the zones, every positive shown (one far outside the zones too), the past zones drawn, a zone file\'s multipolygon; nothing, no box');
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
      disease: 'Pox Kind', quarantine: 'Freed On', quarantineStatus: null, closed: 'Released', closedDate: 'Released On', flockType: 'Herd Kind',
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

  // ---- 8c. The Overview (2.3): counties, the positives table, the boxes, the bars, the people inside the zones ----
  const OV = FX.RULES.overview;
  const ovRows = csvOf(OV.positives);
  const ov = E.readPositives(ovRows[0], ovRows.slice(1), null);
  const ovByLine = ov.positives.concat(ov.dropped).sort((a, b) => a.line - b.line);
  const ovWin = E.windowOf(ov.positives);
  const COUNTIES = globalThis.CVIWA_GEO.counties.features;
  const TRACTS = globalThis.WSDA_TRACTS.tracts.map(t => ({ geoid: t.geoid, pop: t.pop,
    coordinates: globalThis.WSDA.population.geometry(t).coordinates }));
  const ovTargets = E.targets(ov.positives, { statuses: ['Confirmed'] }, ovWin);
  const ovSites = E.ringSites(ovTargets, OV.rings, OV.unit);
  // A stand-in when the rings give no estimate, so the checks below fail rather than stop the suite.
  const ovPeople = E.peopleInside(ovSites, TRACTS, { year: 2020 }) || { total: -1, rounded: null, tracts: [] };
  const holeZones = Z.readGeoJson(fs.readFileSync(path.join(FXD, OV.zoneFile), 'utf8'), OV.zoneFile).zones;
  const holePeople = E.peopleInside(E.zoneSites(holeZones), TRACTS, { year: 2020 });
  const ovCounties = E.countyRows(ov, ovWin, COUNTIES);
  {
    const byName = n => ovByLine.find(p => p.name === n);
    check(same(ovWin, agWin) && same(names(ovTargets), ['Positive 4 (Kittitas)', 'Umatilla 01', 'Lewis 02', 'Skagit 01',
      'Whatcom 01', 'Skagit 02', 'Idaho 01']), 'overview scenario: the agreed window; seven current positives with zones', names(ovTargets));
    check(E.countyOf(byName('Skagit 02'), COUNTIES) === 'Skagit' && E.countyOf(byName('Idaho 01'), COUNTIES) === 'Outside Washington'
      && E.countyOf(byName('Umatilla 01'), COUNTIES) === 'Umatilla (Oregon)' && E.countyOf(byName('Skagit 02'), []) === 'Outside Washington',
    'county: the County column as written, else the county shape holding the positive, else "Outside Washington"');
    check(same(ovCounties.map(r => [r.county, r.current, r.past, r.total]), [['Skagit', 2, 0, 2], ['Lewis', 1, 1, 2],
      ['Kittitas', 1, 0, 1], ['Umatilla (Oregon)', 1, 0, 1], ['Whatcom', 1, 0, 1], ['Yakima', 0, 2, 2], ['Benton', 0, 1, 1],
      ['Franklin', 0, 1, 1], ['Outside Washington', 1, 0, 1]]),
    'counties table: by current, then total, then name; "Outside Washington" last', ovCounties.map(r => [r.county, r.current, r.past]));
    check(same(ovCounties.map(r => r.animalsText), ['1.3M birds', '', '100 birds', '1,001 birds', '35 cattle', '', '', '', '30 birds'])
      && ovCounties[1].missing === 1 && ovCounties.every((r, k) => k === 1 || r.missing === 0),
    'counties table: the current positives\' animals by word (cattle apart); a blank inventory named, never zero', ovCounties.map(r => [r.animalsText, r.missing]));
    const pr = E.positiveRows(ov, ovWin, COUNTIES);
    check(same(pr.columns, ['Case ID', 'Detected', 'County', 'Flock size', 'Flock/Herd Type', 'Species', 'Active or closed', 'Quarantine Release']),
      'positives table: the columns the file has (no status column in the agreed table, so none shown)', pr.columns);
    check(same(pr.rows.map(r => r[0]), ['Skagit 01', 'Skagit 02', 'Lewis 02', 'Idaho 01', 'Umatilla 01', 'Whatcom 01', 'Franklin 01',
      'Benton 01', 'Yakima 02', 'Lewis 01', 'Yakima 01', 'Positive 4 (Kittitas)'])
      && same(pr.rows[1], ['Skagit 02', 'Oct 3, 2026', 'Skagit', 'Large', 'Commercial', 'Chicken', 'Active', ''])
      && same(pr.rows[6], ['Franklin 01', 'Mar 15, 2026', 'Franklin', 'Medium', 'Commercial', 'Turkey', 'Closed', 'Jun 30, 2026']),
    'positives table: newest first, the undated last; dates written out; the county from the location when blank', pr.rows.slice(0, 2));
    check(!/MARKED-ADDRESS|Synthetic Town|Landfill/.test(JSON.stringify([ovCounties, pr])), 'overview: no Premises, Address, City or Disposal Method reaches a table');
    const boxes = E.overviewBoxes(ov, ovWin, COUNTIES, ovPeople);
    check(same(boxes.counties, { value: 5, reason: null, label: 'Counties with an active positive', note: '8 counties since Nov 2024 · 1 outside Washington' }),
      'counties box: the counties with an active positive; the note the counties since the first positive, and those outside Washington', boxes.counties);
    // The one outside Washington closed on its detection day: Between dates it still counts as detected outside
    // Washington; On a day it is no longer active, so the note leaves it out.
    const ovOutClosed = Object.assign({}, ov, { positives: ov.positives.map(p => (p.name === 'Idaho 01'
      ? Object.assign({}, p, { closed: true, closedDate: p.detected }) : p)) });
    const outRange = E.overviewBoxes(ovOutClosed, E.rangeView(ovWin.start, ovWin.end), COUNTIES, ovPeople).counties;
    const outDay = E.overviewBoxes(ovOutClosed, E.dayView(ovWin, ovWin.end), COUNTIES, ovPeople).counties;
    check(ov.positives.some(p => p.name === 'Idaho 01' && p.detected) && /· 1 outside Washington$/.test(outRange.note)
      && !/outside Washington/.test(outDay.note),
    'counties box: a closed positive outside Washington is in the note Between dates (detected in the range), not On a day', [outRange, outDay]);
    check(same(boxes.animals, { value: '1.3M birds', reason: null, note: '35 cattle · 3 commercial, 4 backyard · 1 without a count' }),
      'animals box: the birds at the current positives; the cattle, the flock types and the blank inventory in its note', boxes.animals);
    check(boxes.people.value === ovPeople.rounded && boxes.people.note === 'Estimate from ' + ovPeople.tracts.length + ' Census tracts (2020)',
      'people box: the estimate to three significant figures, from the tracts touched', boxes.people);
    const early = E.overviewBoxes(ov, { start: ovWin.start, end: OV.earlierEnd }, COUNTIES, null);
    check(early.counties.value === 2 && early.counties.note === '5 counties since Nov 2024' && early.animals.value === '1,100 birds'
      && same(early.people, { value: null, reason: 'Not available: needs zones', note: null }),
    'the play: an earlier end changes the counties and animals; without zones the people box is not available, never zero', early);
    const noInv = E.readPositives(['Case ID', 'Latitude', 'Longitude'], [['A', '47.0', '-120.5']], hpai);
    const nb = E.overviewBoxes(noInv, E.windowOf(noInv.positives), COUNTIES, null);
    check(nb.animals.value === null && nb.animals.reason === 'Not available: needs Flock/Herd Inventory' && nb.counties.value === 1,
      'animals box: a file without an inventory column says what it needs', nb);
    const blank = E.readPositives(['Case ID', 'Latitude', 'Longitude', 'Flock/Herd Inventory'], [['A', '47.0', '-120.5', '']], hpai);
    check(E.overviewBoxes(blank, E.windowOf(blank.positives), COUNTIES, null).animals.reason === 'Not available: no animal counts at the active positives',
      'animals box: active positives that all lack a count give no number, never zero');
    const bars = E.overviewBars(ovCounties, { layers: [{ label: 'Dairies', inside: 3, byZone: [{ label: 'Zone A', count: 2 }, { label: 'Zone B', count: 2 }] }] });
    check(same(bars.counties[0], { label: 'Skagit', parts: [{ key: 'current', value: 2 }, { key: 'past', value: 0 }], total: 2 })
      && same(bars.layers, [{ label: 'Dairies', parts: [{ key: 'Zone A', value: 2, ring: false }, { key: 'Zone B', value: 2, ring: false }], total: 3 }])
      && same(E.overviewBars([], null).layers, []),
    'bars: by county (current, past) and by layer (one part per zone); a layer\'s total its distinct sites (a site in two overlapping zones once)', bars);
    // counties.csv: each animal word's exact total; blank where nothing is known, never zero for an unknown.
    const ct = E.countyTable(ov, ovCounties), at = n => ct.rows.find(r => r[0] === n);
    const birdsRow = ovCounties[0].animals.find(a => a[0] === 'birds'), birds = birdsRow ? birdsRow[1] : null;
    check(same(ct.columns, ['County', 'Active', 'Closed', 'Total', 'Birds at the active positives', 'Cattle at the active positives',
      'Active positives without a count'])
      && same(at('Skagit'), ['Skagit', 2, 0, 2, birds, 0, 0]) && birds > 1e6
      && same(at('Whatcom'), ['Whatcom', 1, 0, 1, 0, 35, 0]) && same(at('Lewis'), ['Lewis', 1, 1, 2, null, null, 1])
      && same(at('Yakima'), ['Yakima', 0, 2, 2, null, null, 0]) && ct.rows.length === ovCounties.length,
    'counties.csv: the exact totals by word; a county whose current positives have no count, or with none current, blank (not zero)', ct);
    const noInvTable = E.countyTable(noInv, E.countyRows(noInv, E.windowOf(noInv.positives), COUNTIES));
    check(same(noInvTable.columns, ['County', 'Active', 'Closed', 'Total']), 'counties.csv: no animal columns without an inventory column', noInvTable.columns);
    // Each positive's county (2.3): one county written four ways is one county; a name
    // not Washington's kept as written; a blank County by its location, the nearest county within 2 km off the shore.
    const crRows = csvOf('em_rules_counties.csv'), cr = E.readPositives(crRows[0], crRows.slice(1), hpai);
    const crNames = cr.positives.map(p => E.countyOf(p, COUNTIES));
    check(same(crNames, ['Yakima', 'Yakima', 'Yakima', 'Yakima', 'Umatilla (Oregon)', 'Benton', 'Yakima', 'Mason', 'Island',
      E.OUTSIDE_WA, E.OUTSIDE_WA, E.OUTSIDE_WA]),
    'counties: "yakima" and "Yakima County" are Yakima; "Umatilla (Oregon)" as written; a blank County by its shape, else the nearest within 2 km, else outside Washington', crNames);
    check(E.overviewBoxes(cr, E.windowOf(cr.positives), COUNTIES, null).counties.value === 5
      && E.countyRows(cr, E.windowOf(cr.positives), COUNTIES).filter(r => r.county === 'Yakima').map(r => r.current)[0] === 5,
    'counties box: the four ways of writing Yakima count one county (5: Yakima, Umatilla (Oregon), Benton, Mason, Island; Yakima\'s five positives in one row)');
    // Washington's tracts only (2.3): a ring across the state line says so; one wholly outside is not available.
    const ringAt = (lat, lon) => E.ringSites([{ index: 0, name: 'Ring', lat, lon }], [{ distance: 10 }], 'km');
    const peopleAt = (lat, lon) => E.peopleInside(ringAt(lat, lon), TRACTS, { year: 2020, counties: COUNTIES });
    const boxAt = (lat, lon) => E.overviewBoxes(cr, E.windowOf(cr.positives), COUNTIES, peopleAt(lat, lon)).people;
    const hermiston = boxAt(45.84, -119.29), moscow = boxAt(46.73, -117.0), sound = boxAt(48.42, -122.33), coast = boxAt(46.97, -124.16);
    check(same(hermiston, { value: null, reason: 'Not available: the zones are outside Washington', note: null })
      && moscow.value > 0 && / · Washington only$/.test(moscow.note) && sound.value > 0 && !/Washington only/.test(sound.note)
      && coast.value > 0 && !/Washington only/.test(coast.note),
    'people: a ring wholly in Oregon is not available (never ~0); one into Idaho says "Washington only"; rings over Puget Sound or the ocean do not', [hermiston, moscow, sound, coast]);
    check(E.reachesPastWashington(ringAt(48.99, -122.75), COUNTIES) && E.reachesPastWashington(ringAt(45.64, -122.66), COUNTIES)
      && !E.reachesPastWashington(ringAt(46.6, -120.5), COUNTIES) && !E.reachesPastWashington(ringAt(46.21, -119.14), COUNTIES)
      && E.reachesPastWashington(E.zoneSites([{ name: 'Across', point: [-117.1, 46.5], geometry: { type: 'Polygon',
        coordinates: [[[-117.2, 46.4], [-116.9, 46.4], [-116.9, 46.6], [-117.2, 46.6], [-117.2, 46.4]]] } }]), COUNTIES),
    'people: rings into British Columbia (Blaine) and Oregon (Vancouver) and a zone into Idaho reach past Washington; Yakima\'s and Kennewick\'s (over the Columbia, inside the state) do not');
    check(E.roughly(12437) === 12400 && E.roughly(99.6) === 100 && E.roughly(144759.8) === 145000 && E.roughly(0) === 0 && E.roughly(1004) === 1000,
      'the people estimate shown to three significant figures (whole people under 100)');
    // The people estimate on hand-made tracts (a tract about 7.6 by 11.1 km, 10,000 people).
    const square = (w, s0, e, n) => [[w, s0], [e, s0], [e, n], [w, n], [w, s0]];
    const tract = { geoid: 'T1', pop: 10000, coordinates: [[square(-120.1, 47.0, -120.0, 47.1)]] };
    const zone = (rings, name) => E.zoneSites([{ name, point: rings[0][0], geometry: { type: 'Polygon', coordinates: rings } }]);
    const half = E.peopleInside(zone([square(-120.2, 46.9, -120.05, 47.2)], 'Half'), [tract], {});
    check(Math.abs(half.tracts[0].share - 0.5) < 0.02 && Math.abs(half.total - 5000) < 200,
      'people: a tract half inside a zone gives about half its people (the grid within 2 points)', half.tracts);
    const holed = E.peopleInside(zone([square(-120.2, 46.9, -119.9, 47.2), square(-120.08, 47.02, -120.02, 47.08)], 'Holed'), [tract], {});
    check(Math.abs(holed.tracts[0].share - (1 - 0.36)) < 0.02, 'people: a zone\'s hole is left out (36% of the tract)', holed.tracts);
    const donut = { geoid: 'T3', pop: 6400, coordinates: [[square(-120.1, 47.0, -120.0, 47.1), square(-120.08, 47.02, -120.02, 47.08)]] };
    const donutIn = E.peopleInside(zone([square(-120.2, 46.9, -119.9, 47.2)], 'All'), [donut], {});
    // Edges along the grid's lines are its worst case (each row and column off alike), so 3 points here; counting the
    // hole's area in would give about half.
    check(Math.abs(donutIn.tracts[0].share - 1) < 0.03 && Math.abs(donutIn.total - 6400) < 192,
      'people: a tract with a hole (a lake) wholly inside a zone counts all its people (its area without the hole)', donutIn.tracts);
    const one = E.ringSites([{ index: 0, name: 'A', lat: 47.05, lon: -120.05 }], [{ distance: 3 }]);
    const twice = E.ringSites([{ index: 0, name: 'A', lat: 47.05, lon: -120.05 }, { index: 1, name: 'B', lat: 47.05, lon: -120.05 }], [{ distance: 3 }]);
    const p1 = E.peopleInside(one, [tract], {}), p2 = E.peopleInside(twice, [tract], {});
    check(p1.total > 0 && same(p1, p2), 'people: two rings over the same ground are counted once', [p1.total, p2.total]);
    const circle = Math.PI * 9 / (7.59 * 11.13);
    check(Math.abs(p1.tracts[0].share - circle) < 0.02, 'people: a 3 km ring inside the tract holds its share of the area (pi r squared)', [p1.tracts[0].share, circle]);
    check(E.peopleInside([], [tract], {}) === null && E.peopleInside(null, [tract], {}) === null, 'people: no zones, no estimate');
    check(E.peopleInside(E.ringSites([{ index: 0, name: 'Far', lat: 46.0, lon: -121.0 }], [{ distance: 3 }]), [tract], {}).total === 0,
      'people: zones outside every tract give no people');
    const fewer = E.peopleInside(ovSites.slice(0, 3), TRACTS, { year: 2020 }) || { total: -1 };
    check(same(E.peopleInside(ovSites, TRACTS, { year: 2020 }), ovPeople) && fewer.total < ovPeople.total,
      'people: the same zones give the same answer again (each tract\'s box, area and cells kept with it); fewer zones, fewer people', [fewer.total, ovPeople.total]);
    const tiny = { geoid: 'T2', pop: 1000, coordinates: [[square(-120.005, 47.0, -120.0, 47.005)]] };
    const tinyIn = E.peopleInside(zone([square(-120.2, 46.9, -119.9, 47.2)], 'All'), [tiny], {});
    const tinyHalf = E.peopleInside(zone([square(-120.2, 46.9, -120.0025, 47.2)], 'Half of a small one'), [tiny], {});
    check(Math.abs(tinyIn.tracts[0].share - 1) < 0.01 && Math.abs(tinyHalf.tracts[0].share - 0.5) < 0.02,
      'people: a small tract (0.2 km\u00b2) gets finer cells: wholly inside counts all its people, half inside about half', [tinyIn.tracts, tinyHalf.tracts]);
    check(ovPeople.tracts.length > 20 && ovPeople.tracts.every(t => t.share > 0 && t.share <= 1) && holePeople.total > 0,
      'people: the scenario\'s rings and the zone with a hole touch tracts, every share between 0 and 1', [ovPeople.tracts.length, holePeople.tracts.length]);
    const sp = FX.RULES.speed, t0 = Date.now();
    const spPeople = E.peopleInside(E.ringSites(sp.positives.map(([lat, lon], k) => ({ index: k, name: 'S' + k, lat, lon })), hpai.zones.rings), TRACTS, {});
    const ms = Date.now() - t0;
    console.log(`  people: ${sp.positives.length} positives with HPAI's rings: ${spPeople.tracts.length} tracts, ${ms} ms`);
    check(ms < 3000, 'speed: the people inside the zones of 40 positives in under 3 seconds (then kept per zone)', ms);
    // A city cluster (2.3): 40 positives within 15 km of downtown Seattle, where the tracts are small
    // and many. The page works them out once the play or the slider stops, so this is the wait after it.
    const city = Array.from({ length: 40 }, (x, k) => { const [lon, lat] = PX.destination(47.61, -122.33, 15 * ((k * 7) % 40) / 40, k * 137.5);
      return { index: k, name: 'C' + k, lat, lon }; });
    const t1 = Date.now(), cityPeople = E.peopleInside(E.ringSites(city, hpai.zones.rings), TRACTS, {}), cityMs = Date.now() - t1;
    console.log(`  people: 40 positives around Seattle with HPAI's rings: ${cityPeople.tracts.length} tracts, ${cityMs} ms`);
    check(cityMs < 3000 && cityPeople.tracts.length > 300, 'speed: the people inside the zones of 40 positives around Seattle in under 3 seconds', cityMs);
  }

  // ---- 8d. The quarantine status column (2.4) -------------------------------------------------------------------
  const QR = FX.RULES.quarantine;
  const qRows = csvOf(QR.positives);
  const qr = E.readPositives(qRows[0], qRows.slice(1), null);
  const qByLine = qr.positives.concat(qr.dropped).sort((a, b) => a.line - b.line);
  const qWin = E.windowOf(qr.positives);
  const qOn = (read, list, end) => list.map(p => E.quarantineOf(read, p, end));
  {
    check(qr.type === hpai && qr.columns.quarantineStatus === 'Quarantine Status' && qr.badQuarantineStatus === 1
      && same(qByLine.map(p => p.quarantineStatus), ['released', 'under', 'released', null, 'under', null, 'under', 'under', null,
        'under', 'under', null, 'released', null])
      && same(qByLine.slice(-2).map(p => p.quarantineStatusText), [' released '.trim(), 'Pending']),
    'quarantine status: the column read by its name, any case, spaces trimmed; "Pending" is not one of its values (counted, read as blank)',
    qByLine.map(p => [p.name, p.quarantineStatusText, p.quarantineStatus]));
    check(same(qOn(qr, qByLine, qWin.end), ['released', 'under', 'released', null, null, 'released', null, null, null, null, null,
      'unknown', 'released', 'unknown']),
    'quarantine: on the latest detection, the release date decides, else the status, else not known; current positives have none',
    qOn(qr, qByLine, qWin.end));
    check(same(qOn(qr, qByLine, QR.earlierEnd), ['released', 'under', 'under', null, null, 'released', null, null, null, null, null,
      'unknown', 'released', 'unknown']),
    'quarantine: on an earlier end, Franklin 01\'s release date after it decides (still under quarantine though its status says Released)',
    qOn(qr, qByLine, QR.earlierEnd));
    const qg = E.groups(qr, qWin), qgEarly = E.groups(qr, { start: qWin.start, end: QR.earlierEnd });
    check(same(names(qg.stillQuarantined), ['Yakima 02']) && same(names(qg.notKnown), ['Benton 01', 'Okanogan 01'])
      && same(names(qgEarly.stillQuarantined), ['Yakima 02', 'Franklin 01']) && same(names(qgEarly.notKnown), ['Benton 01', 'Okanogan 01']),
    'groups: still under quarantine and not known, on both end dates', [names(qg.stillQuarantined), names(qg.notKnown)]);
    const qb = E.valueBoxes(qr, null, qWin), qbEarly = E.valueBoxes(qr, null, { start: qWin.start, end: QR.earlierEnd });
    check(qb.past.value === 7 && qb.past.quarantined === 1 && qb.past.notKnown === 2 && qb.past.note === '1 still under quarantine, 2 not known'
      && qbEarly.past.note === '2 still under quarantine, 2 not known' && qb.positives.lines.includes('1 quarantine status not read'),
    'the "Past positives" box: "1 still under quarantine, 2 not known"; the line under the boxes names the status not read', [qb.past, qb.positives.lines]);
    // Without a release date column the status alone decides; with neither column there is no quarantine at all.
    const keep = (row, drop) => row.filter((v, i) => !drop.includes(i));
    const relAt = qRows[0].indexOf('Quarantine Release'), qsAt = qRows[0].indexOf('Quarantine Status');
    const onlyStatus = E.readPositives(keep(qRows[0], [relAt]), qRows.slice(1).map(r => keep(r, [relAt])), hpai);
    const neither = E.readPositives(keep(qRows[0], [relAt, qsAt]), qRows.slice(1).map(r => keep(r, [relAt, qsAt])), hpai);
    const byLine = read => read.positives.concat(read.dropped).sort((a, b) => a.line - b.line);
    check(same(qOn(onlyStatus, byLine(onlyStatus), QR.earlierEnd), ['released', 'under', 'released', null, null, 'unknown', null, null, null,
      null, null, 'unknown', 'released', 'unknown']) && byLine(neither).every(p => E.quarantineOf(neither, p, QR.earlierEnd) === null)
      && E.valueBoxes(neither, null, qWin).past.note === 'none under quarantine',
    'quarantine: with the status column alone, the status decides (Lewis 01 has none: not known); with neither column, none at all');
    const qEx = E.exportRows(qr, [], { rows: [], layers: [], leftOut: [] }, 'km', qWin);
    const qCol = qEx.positives.columns, qRow = n => qEx.positives.rows.find(r => r[0] === n);
    check(same(qCol.slice(4, 8), ['Close Date', 'Quarantine Release', 'Quarantine Status', 'Detection Date'])
      && qRow('Okanogan 01')[6] === 'Pending' && qRow('Okanogan 01').slice(-1)[0] === 'Quarantine not known'
      && qRow('Yakima 02').slice(-1)[0] === 'Still under quarantine' && qRow('Grant 01').slice(-1)[0] === ''
      && !E.exportRows(ag, [], { rows: [], layers: [], leftOut: [] }, 'km', agWin).positives.columns.includes('Quarantine Status'),
    'positives.csv: the Quarantine Status column as written (only when the file has it) and the notes', [qCol, qRow('Okanogan 01')]);
    const qp = E.positiveRows(qr, qWin, globalThis.CVIWA_GEO.counties.features);
    check(qp.columns.slice(-2).join() === 'Quarantine Release,Quarantine Status'
      && qp.rows.find(r => r[0] === 'Grant 01').slice(-1)[0] === 'released',
    'the Overview\'s positives table: the Quarantine Status column as written', qp.columns);
    check(T.quarantineStatusOf(hpai, ' LIFTED ') === 'released' && T.quarantineStatusOf(hpai, 'In quarantine') === 'under'
      && T.quarantineStatusOf(hpai, 'Pending') === null && T.quarantineStatusOf(hpai, '') === null && same(T.check(good()).quarantineValues, T.QUARANTINE_VALUES),
    'types: the quarantine status values, any case, spaces trimmed; a type naming none gets "Under quarantine" and "Released"');
  }

  // ---- 8e. The two views (2.5): On a day and Between dates -------------------------------------------------------
  const VR = FX.RULES.views;
  const vRows = csvOf(VR.positives);
  const vr = E.readPositives(vRows[0], vRows.slice(1), null);
  const vByLine = vr.positives.concat(vr.dropped).sort((a, b) => a.line - b.line);
  const vWin = E.windowOf(vr.positives);
  // Each row's group in a view: Not mapped, Outside (not in the view), Active or Closed.
  const viewRow = view => { const g = E.groups(vr, view);
    return vByLine.map(p => p.index === null ? 'Not mapped' : g.outside.includes(p) ? 'Outside' : E.groupOf(p, view.end)); };
  {
    // On a day: the same as a window from the file's first detection to the day, for every day of the scenario.
    check(VR.days.every(d => same(E.groups(vr, E.dayView(vWin, d)), E.groups(vr, { start: vWin.start, end: d }))
      && same(E.groups(vr, E.dayView(vWin, d)), E.groups(vr, { start: null, end: d }))),
    'On a day: the window from the file\'s first detection to the day (start held), the same as no first date at all');
    const day = d => E.groups(vr, E.dayView(vWin, d));
    check(same(names(day('2026-09-05').current), ['Kittitas', 'Umatilla 01', 'Whatcom 01', 'Pierce 01', 'Spokane 01'].map(n => n === 'Kittitas' ? 'Positive 4 (Kittitas)' : n))
      && same(names(day('2026-10-05').past).includes('Spokane 01'), true) && names(day('2025-03-12').current).includes('Pierce 01')
      && names(day('2026-10-30').current).includes('Pierce 01'),
    'On a day: Pierce 01 (detected Mar 2025, still open) active on every later day; Spokane 01 active on Sep 5, closed by Oct 5',
      names(day('2026-09-05').current));
    const before = day('2024-10-01');
    check(before.current.length === 1 && !before.current[0].detected && before.past.length === 0 && before.outside.length === vr.positives.length - 1,
      'On a day before the first detection: only the positive without a date (shown in both views); every dated one outside', before.current.map(p => p.name));
    // The sample's Franklin dairy (detected Aug 21, still open) counts on Sep 5, as the page shows it.
    const sRows = csvOf('em_sample_positives.csv'), sm = E.readPositives(sRows[0], sRows.slice(1), null), smWin = E.windowOf(sm.positives);
    check(names(E.groups(sm, E.dayView(smWin, '2026-09-05')).current).includes('SYN-HPAI-003')
      && !names(E.groups(sm, E.rangeView('2026-09-01', '2026-10-05')).current).includes('SYN-HPAI-003'),
    'the sample: the Franklin dairy (detected Aug 21, open) active On a day Sep 5; not in Between dates Sep 1 to Oct 5 (detected before it)');
    // Between dates: detected between the dates, active or closed on the second.
    const rg = E.groups(vr, E.rangeView('2026-09-01', '2026-10-05'));
    check(same(names(rg.current), ['Positive 4 (Kittitas)', 'Umatilla 01', 'Lewis 02', 'Skagit 01']) && rg.past.length === 0
      && rg.outside.some(p => p.name === 'Pierce 01') && rg.outside.some(p => p.name === 'Spokane 01'),
    'Between dates Sep 1 to Oct 5: the four detected in it (and the undated one); Pierce 01 and Spokane 01 detected before it', names(rg.current));
    // The opening views: the day today; the range from the first detection to today; a detection after today moves both.
    const open = E.openingViews(vWin, VR.today);
    check(same(open, { day: { view: 'day', start: '2024-11-05', end: '2026-10-30' }, range: { view: 'range', start: '2024-11-05', end: '2026-10-30' } })
      && same(E.openingViews({ start: '2026-01-01', end: '2026-11-15' }, '2026-10-30').day.end, '2026-11-15') && E.openingViews(null, VR.today) === null,
    'opening: On a day on today, Between dates from the first detection to today; a detection after today moves both to it; none without dates', open);
    check(same(E.groups(vr, open.day).current, E.groups(vr, open.range).current),
      'opening: the two views agree on the active positives after a load (question 2)');
    // The chart's span runs to today, so the line on today is not at the edge; its columns stay put whatever the view.
    check(same(E.chartSpan(vWin, VR.today), { start: '2024-11-05', end: '2026-10-30' }) && same(E.chartSpan({ start: '2026-08-01', end: '2026-10-05' }, '2026-10-30').end, '2026-10-30')
      && same(E.chartSpan({ start: '2026-08-01', end: '2026-11-15' }, '2026-10-30').end, '2026-11-15') && E.chartSpan(null, VR.today) === null,
    'the chart\'s span: the first detection to today, or to the last detection when it is later');
    const smSteps = E.playSteps(E.chartSpan(smWin, '2026-10-30'));
    check(smSteps.by === 'week' && smSteps.steps[smSteps.steps.length - 1].end === '2026-10-30' && smSteps.steps[smSteps.steps.length - 1].start === '2026-10-25',
      'the sample\'s chart: weekly columns up to today\'s week, ending on today', smSteps.steps.slice(-1));
    // The play in each view: the chart's columns that reach into it, the last ending on the view's end.
    const dSteps = E.viewSteps(smSteps, E.dayView(smWin, '2026-09-05')), rSteps = E.viewSteps(smSteps, E.rangeView('2026-09-01', '2026-10-05'));
    check(dSteps.by === 'week' && dSteps.steps[0].start === smSteps.steps[0].start && same(dSteps.steps.slice(-1)[0], { start: '2026-08-30', end: '2026-09-05', label: 'Week of Aug 30, 2026' })
      && dSteps.steps.length === 8,
    'the play On a day: from the file\'s first week (Jul 12) to the day\'s week, eight weeks, the last ending on the day', dSteps.steps.slice(-1));
    check(same(rSteps.steps.map(s => s.start), ['2026-08-30', '2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27', '2026-10-04'])
      && rSteps.steps.slice(-1)[0].end === '2026-10-05' && smSteps.steps.find(s => s.start === '2026-10-04').end === '2026-10-10',
    'the play Between dates: the weeks from the range\'s first date to its second, the last ending on it; the chart\'s own columns untouched',
      rSteps.steps.map(s => [s.start, s.end]));
    // A range starting on a Saturday keeps the week that ends on it (Sep 13 to 19), its first step that one day.
    const satSteps = E.viewSteps(smSteps, E.rangeView('2026-09-19', '2026-10-05'));
    check(satSteps.steps[0].start === '2026-09-13' && satSteps.steps[0].end === '2026-09-19' && satSteps.steps.length === 4,
      'the play Between dates from a Saturday: the week ending on it is the first step', satSteps.steps.map(s => [s.start, s.end]));
    check(same(E.viewSteps(smSteps, null).steps, []) && same(E.viewSteps(null, open.day), { by: null, steps: [] })
      && E.viewSteps(smSteps, E.dayView(smWin, '2026-07-01')).steps.length === 0,
    'the play: no steps without a view, without columns, or on a day before the first column');
    // A chart column: the day moves to its last day; the range becomes the column.
    const col = smSteps.steps.find(s => s.start === '2026-09-13');
    check(!!col && same(E.pickColumn(E.dayView(smWin, '2026-10-30'), col), { view: 'day', start: smWin.start, end: '2026-09-19' })
      && same(E.pickColumn(E.rangeView('2026-07-01', '2026-10-30'), col), { view: 'range', start: '2026-09-13', end: '2026-09-19' }),
    'a chart column: On a day moves the day to its last day; Between dates becomes its own week');
    // The boxes per view: their order, the Detected box with its two parts, and the last positive's words.
    const dBox = E.valueBoxes(vr, null, E.dayView(vWin, '2026-09-05')), rBox = E.valueBoxes(vr, null, E.rangeView('2025-07-01', '2026-10-05'));
    check(same(dBox.order, ['positives', 'past', 'last', 'inside']) && same(rBox.order, ['detected', 'positives', 'past', 'inside'])
      && same(E.valueBoxes(vr, null, null).order, dBox.order),
    'the boxes: On a day (and without a view) active, closed, last positive, sites inside; Between dates detected first, no last positive');
    check(same(rBox.detected, { value: 9, reason: null, active: 5, closed: 4 }) && rBox.positives.value === 5 && rBox.past.value === 4
      && dBox.positives.value === 5 && dBox.past.value === 5 && dBox.last.value === '2026-09-02' && dBox.last.note === 'As of Sep 5, 2026',
    'the boxes: Detected 9 (5 active, 4 closed) Between Jul 1, 2025 and Oct 5, 2026; On Sep 5 5 active, 5 closed, last positive Sep 2',
      [rBox.detected, dBox.last]);
    check(E.valueBoxes(vr, null, null).detected.value === null && E.valueBoxes(null, null, null).detected.value === null,
      'the Detected box: not available without a view or without the file');
    // The words: the badge, the picture's period line and export_params.json's fields.
    const d30 = E.dayView(vWin, '2026-10-30'), r95 = E.rangeView('2026-09-01', '2026-10-05');
    check(E.viewBadge(d30) === 'Oct 30, 2026' && E.viewBadge(r95) === 'Sep 1, 2026 – Oct 5, 2026' && E.viewBadge(null) === null
      && E.periodLine(d30) === 'Active on Oct 30, 2026' && E.periodLine(r95) === 'Detected Sep 1, 2026 to Oct 5, 2026'
      && E.periodLine(null) === null,
    'the words: the badge and the picture\'s period line for each view', [E.viewBadge(r95), E.periodLine(r95)]);
    check(same(E.viewParams(d30), { view: 'on a day', day: '2026-10-30' }) && same(E.viewParams(r95), { view: 'between dates', detected_between: ['2026-09-01', '2026-10-05'] })
      && same(E.viewParams(null), { view: null }),
    'export_params.json: the view named, with its day or its two dates');
    // The exports' and tables' words: Active and Closed (question 1).
    const vEx = E.exportRows(vr, [], { rows: [], layers: [], leftOut: [] }, 'km', d30);
    check(same([...new Set(vEx.positives.rows.map(r => r[1]))].sort(), ['Active', 'Closed', 'Not mapped'])
      && E.positiveRows(vr, d30, COUNTIES).columns.includes('Active or closed'),
    'the words: positives.csv\'s group and the positives table\'s column say Active and Closed');
    // The Overview's counties box: On a day the counties with an active positive; Between dates those with a positive
    // detected, "n with an active one".
    const ovDay = E.overviewBoxes(vr, E.dayView(vWin, '2026-09-05'), COUNTIES, null).counties;
    const ovRange = E.overviewBoxes(vr, E.rangeView('2025-07-01', '2026-10-05'), COUNTIES, null).counties;
    check(same(ovDay, { value: 5, reason: null, label: 'Counties with an active positive', note: '9 counties since Nov 2024' })
      && same(ovRange, { value: 9, reason: null, label: 'Counties with a positive detected', note: '5 with an active one' }),
    'the Overview\'s counties box in each view', [ovDay, ovRange]);
  }

  // ---- 8f. Drawn zones (2.6): the area, the crossing check, the set shapes, drawn zones as zones, the exports ------
  const DR = FX.RULES.drawn, R_M = 6378137, toRad = d => d * Math.PI / 180;
  const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.abs(b);
  // A box of latitudes and longitudes on the sphere: R² · Δλ · (sin φ2 - sin φ1), exactly.
  const boxM2 = (w, s, e, n) => R_M * R_M * toRad(e - w) * (Math.sin(toRad(n)) - Math.sin(toRad(s)));
  const poly = c => ({ type: 'Polygon', coordinates: [c.concat([c[0]])] });
  const fileZone = Z.readGeoJson(fs.readFileSync(path.join(FXD, DR.fileZone), 'utf8'), DR.fileZone).zones;
  const drawn = DR.zones.map(z => E.drawnZone(z.corners, z.name, z.shape));
  {   // The area.
    check(near(E.areaM2(poly([[0, 0], [1, 0], [1, 1], [0, 1]])), boxM2(0, 0, 1, 1), 1e-12)
      && near(E.areaM2(poly([[-121, 47], [-120, 47], [-120, 48], [-121, 48]])), boxM2(-121, 47, -120, 48), 1e-12),
    'area: a square degree at the equator and at 47 degrees north, exactly as the sphere gives it',
    [E.areaM2(poly([[0, 0], [1, 0], [1, 1], [0, 1]])), boxM2(0, 0, 1, 1)]);
    check(near(E.areaM2(poly([[-121.1, 46.0], [-119.6, 46.0], [-119.6, 46.9], [-121.1, 46.9]])), boxM2(-121.1, 46.0, -119.6, 46.9), 1e-12)
      && Math.round(E.areaM2(poly([[-121.1, 46.0], [-119.6, 46.0], [-119.6, 46.9], [-121.1, 46.9]])) / 2589988.110336) === 4450,
    'area: a county-sized box (1.5 by 0.9 degrees, about Yakima County\'s size) is 4,450 sq mi');
    const cap = 2 * Math.PI * R_M * R_M * (1 - Math.cos(5000 / R_M)), ring200 = DR.zones.find(z => z.name === '200 corners').corners;
    check(ring200.length === 200 && near(E.areaM2(poly(ring200)), cap, 1e-3),
      'area: 200 corners 5 km from a point: within 0.1% of the circle\'s area on the sphere', [E.areaM2(poly(ring200)), cap]);
    const box = [[-120.6, 46.45], [-120.34, 46.45], [-120.34, 46.65], [-120.6, 46.65]];
    check(E.areaM2(poly(box)) === E.areaM2(poly(box.slice().reverse())) && E.areaM2(poly(box)) === E.areaM2({ type: 'Polygon', coordinates: [box] }),
      'area: the same whichever way the corners run, and closed or not');
    const hole = Z.readGeoJson(fs.readFileSync(path.join(FXD, 'em_zone_hole.geojson'), 'utf8'), 'h').zones[0];
    check(near(E.areaM2(hole.geometry), boxM2(-120.6, 46.45, -120.34, 46.65) - boxM2(-120.5, 46.52, -120.44, 46.58), 1e-12)
      && near(E.areaM2({ type: 'MultiPolygon', coordinates: [hole.geometry.coordinates, [poly([[0, 0], [1, 0], [1, 1], [0, 1]]).coordinates[0]]] }),
        E.areaM2(hole.geometry) + boxM2(0, 0, 1, 1), 1e-12),
    'area: a hole taken off its polygon; a MultiPolygon\'s polygons added');
    check(same(E.areaOf(E.areaM2(poly(DR.zones[4].corners))), { sqMi: 16, acres: 10240 }) && same(E.areaOf(2589988.110336 * 0.125), { sqMi: 0.12, acres: 80 }),
      'area: the exports\' square miles to two decimals (R\'s round, 0.125 to 0.12) and whole acres; a 2-mile square is 16 sq mi, 10,240 acres');
    const sq = 2589988.110336;
    check(E.areaText(12.44 * sq) === '12.4 sq mi, 7,962 acres' && E.areaText(0.1 * sq) === '0.1 sq mi, 64 acres' && E.areaText(0.099 * sq) === '63 acres'
      && E.areaText(4046.8564224) === '1 acre' && E.areaText(3232.38 * sq) === '3,232.4 sq mi, 2,068,723 acres' && E.areaText(0.96 * sq) === '1.0 sq mi, 614 acres',
    'area: "12.4 sq mi, 7,962 acres"; acres alone under 0.1 sq mi; "1 acre"', [E.areaText(12.44 * sq), E.areaText(0.099 * sq), E.areaText(3232.38 * sq)]);
    check(E.lengthText(3.94, 'km') === '3.9 km' && E.lengthText(3.94, 'mi') === '2.4 mi' && E.lengthText(10, undefined) === '10.0 km',
      'length: one decimal in the unit shown (km by default)');
  }
  {   // The crossing check (question 6), the closing rules and the limits.
    const c = [[-120, 46], [-119.8, 46], [-119.8, 46.1]];
    check(!E.crossesAt(c, [-120, 46.1]) && E.crossesAt(c, [-119.9, 45.9]) && E.crossesAt(c, [-119.9, 46]) && E.crossesAt(c, [-120.2, 45.9]),
      'crossing: a next side crossing an earlier side, ending on it, or passing through its corner is refused; one clear of them kept');
    check(E.crossesAt(c, [-119.8, 46.05]) && !E.crossesAt(c, [-119.8, 46.2]) && !E.crossesAt([[-120, 46]], [-119, 46]) && !E.crossesAt([], [-119, 46]),
      'crossing: a side turning back along the last one is refused, one carrying straight on kept; the first and second corners never cross');
    for (const s of DR.shapes) {
      check(E.isSimple(s.corners) === ['A corner on a straight side', 'Arms close but apart'].includes(s.name), 'crossing: ' + s.name + ': ' +
        (E.isSimple(s.corners) ? 'kept' : 'refused'), s.corners);
    }
    check(!E.canClose(c.slice(0, 2)) && E.canClose(c) && !E.canClose([[-120, 46], [-119.9, 46], [-119.8, 46]]),
      'closing: fewer than three corners, or three on a line, cannot close');
    const ring = n => Array.from({ length: n }, (_, k) => PX.destination(46.6, -120.5, 5, k * 360 / n));
    check(E.DRAW.maxCorners === 200 && E.canClose(ring(200)) && !E.canClose(ring(201)) && E.DRAW.maxZones === 20 && E.DRAW.nameMax === 60,
      'limits: 3 to 200 corners a zone, 20 drawn zones, 60-character names (question 10)');
  }
  {   // The live label (questions 3 and 4).
    const c = [[-120.505, 46.598], [-120.43, 46.59], [-120.405, 46.553]];
    const km = PX.distanceKm(46.598, -120.505, 46.515, -120.418);
    const l3 = E.drawLabel(c, [-120.418, 46.515], 'km'), l2 = E.drawLabel(c.slice(0, 2), [-120.418, 46.515], 'mi');
    check(same(l3.lines, [km.toFixed(1) + ' km from the first click', 'Area ' + E.areaText(E.areaM2(poly(c.concat([[-120.418, 46.515]]))))]) && !l3.cross,
      'label: the distance from the first click and, from the third corner, the area with the pointer as the next corner', l3);
    check(same(l2.lines, [(km / 1.609344).toFixed(1) + ' mi from the first click']) && same(E.drawLabel([], [-120, 46], 'km'), { lines: [], cross: false, closes: false }),
      'label: in miles by the switch; no area before the third corner; nothing before the first click', l2);
    check(same(E.drawLabel(c, [-120.47, 46.62], 'km'), { lines: ['Sides can’t cross'], cross: true, closes: false }), 'label: "Sides can’t cross" for a move that would cross');
    // The next side fine, but the side back to the first corner would cross: no area.
    const open = [[6.32, 1.44], [4.57, 5.93], [1.38, 9.22], [8.85, 8.91]], at = [8.85, 9.08], lo = E.drawLabel(open, at, 'km');
    check(!lo.cross && !lo.closes && lo.lines[1] === 'Can’t close here: sides would cross' && !E.canClose(open.concat([at])) && l3.closes,
      'label: when the side back to the first corner would cross, "Can’t close here: sides would cross" in place of the area', lo);
    const tap = E.drawLabel(c, c[2], 'km');
    check(tap.closes && tap.lines[1] === 'Area ' + E.areaText(E.areaM2(poly(c))),
      'label: the pointer on the last corner (a phone, after a tap): the area of the corners alone', tap);
  }
  {   // The set shapes (3a).
    const a = [-120.33, 46.43], b = [-120.29, 46.37];
    check(same(E.rectangleCorners(a, b), [[-120.33, 46.43], [-120.29, 46.43], [-120.29, 46.37], [-120.33, 46.37]])
      && E.areaM2(poly(E.rectangleCorners(b, a))) === E.areaM2(poly(E.rectangleCorners(a, b)))
      && E.rectangleCorners(a, [-120.29, 46.43]) === null && E.rectangleCorners(a, [-120.33, 46.2]) === null,
    'rectangle: four corners from two opposite clicks, either way round; none when the clicks share a latitude or longitude');
    const z = E.rectangleSize(a, b);
    check(z.eastKm === PX.distanceKm(46.4, -120.33, 46.4, -120.29) && z.northKm === PX.distanceKm(46.43, -120.33, 46.37, -120.33)
      && near(E.areaM2(poly(E.rectangleCorners(a, b))), boxM2(-120.33, 46.37, -120.29, 46.43), 1e-12),
    'rectangle: its size east-west along its middle latitude and north-south; its area', z);
    check(same(E.rectangleLabel(a, b, 'km'), [z.eastKm.toFixed(1) + ' km by ' + z.northKm.toFixed(1) + ' km', 'Area 7.9 sq mi, 5,068 acres']),
      'rectangle: the label "3.1 km by 6.7 km", "Area 7.9 sq mi, 5,068 acres"', E.rectangleLabel(a, b, 'km'));
    const sides = (c, mid) => [[(c[0][0] + c[1][0]) / 2, c[0][1]], [c[1][0], mid[1]], [(c[2][0] + c[3][0]) / 2, c[2][1]], [c[3][0], mid[1]]]
      .map(p => PX.distanceKm(mid[1], mid[0], p[1], p[0]));
    let worst = 0;
    for (const [mid, n, unit] of [[[-120.47, 46.552], 3, 'km'], [[-122.96, 46.66], 2, 'mi'], [[-117.4, 48.9], 100, 'km'], [[-120.5, 47], 0.1, 'mi'], [[-120.5, 46.0], 100, 'mi']]) {
      const c = E.squareCorners(mid, n, unit), km = E.toKm(n, unit);
      for (const d of sides(c, mid)) worst = Math.max(worst, Math.abs(d / km - 1));
      worst = Math.max(worst, Math.abs(PX.distanceKm(c[0][1], c[0][0], c[3][1], c[3][0]) / (2 * km) - 1));
    }
    check(worst < 1e-3, 'square: each side its size from the middle, north, south, east and west (and its west side twice the size), within 0.1%, in km and miles, 0.1 to 100', worst);
    const r5 = read.positives.find(p => p.name === 'R-005'), c5 = E.squareCorners([r5.lon, r5.lat], 3, 'km');
    check((c5[0][0] + c5[2][0]) / 2 === r5.lon && near((c5[0][1] + c5[2][1]) / 2, r5.lat, 1e-15) && c5[0][0] < c5[1][0] && c5[0][1] > c5[3][1],
      'square: centered on a positive, its middle is the positive\'s place', c5);
    check(same(E.squareLabel([r5.lon, r5.lat], 3, 'km', 'R-005'), ['Around R-005', '6.0 km across (3.0 km each way)', 'Area 13.9 sq mi, 8,896 acres'])
      && same(E.squareLabel([-122.96, 46.66], 2, 'mi'), ['4.0 mi across (2.0 mi each way)', 'Area 16.0 sq mi, 10,240 acres']),
    'square: the label, with "Around R-005" when centered on a positive', E.squareLabel([r5.lon, r5.lat], 3, 'km', 'R-005'));
    check(same(['3', ' 2.5 ', '0.1', '100', '.5'].map(t => E.readSize(t).size), [3, 2.5, 0.1, 100, 0.5])
      && ['0.05', '100.5', '', 'abc', '-1', '1e2', '3 km', null].every(t => E.readSize(t).reason === 'Type a size from 0.1 to 100.'),
    'square: the size box takes a plain number from 0.1 to 100');
  }
  {   // A drawn zone is a zone: built as a zone file holding the same polygon would read.
    const d1 = drawn[0];
    check(drawn.every(Boolean) && drawn.every(z => z.source === 'drawn' && Z.signedArea(z.geometry.coordinates[0]) > 0 && same(z.geometry.coordinates[0][0], z.geometry.coordinates[0][z.geometry.coordinates[0].length - 1]))
      && PX.inZone(d1.point[0], d1.point[1], d1.geometry) && d1.vertices === 7 && d1.first === 'Drawn zone 1',
    'drawn zone: closed, counterclockwise (a square\'s clockwise corners reversed), its point inside, its vertices counted closed', drawn.map(z => z && z.vertices));
    const wobbly = E.drawnZone([[-120.1234567, 46.1], [-120, 46.1000004], [-120, 46.2]], 'W', null);
    check(same(wobbly.geometry.coordinates[0].slice(0, 3).sort(), [[-120.123457, 46.1], [-120, 46.1], [-120, 46.2]].sort())
      && E.drawnZone(DR.shapes[0].corners, 'X', null) === null && E.drawnZone([[-120, 46], [-119.9, 46]], 'X', null) === null,
    'drawn zone: corners to six decimals; none from sides that cross or from two corners', wobbly.geometry);
    const asFile = Z.readGeoJson(JSON.stringify({ type: 'FeatureCollection', features: drawn.map(z => ({ type: 'Feature',
      properties: { name: z.name }, geometry: z.geometry })) }), 'drawn.geojson').zones;
    check(same(drawn.map(z => [z.name, z.geometry, z.point, z.vertices]), asFile.map(z => [z.name, z.geometry, z.point, z.vertices])),
      'drawn zone: the same name, geometry, point and vertices as a zone file holding the same polygons');
    const counted = read.positives.filter(p => p.detected);
    const ds = E.zoneSites(drawn), fs2 = E.zoneSites(asFile);
    const rd = E.inside(ds, layers, { mode: 'zones', positives: read.targets }), rf = E.inside(fs2, layers, { mode: 'zones', positives: read.targets });
    check(same(rd, rf) && rd.rows.length === 12 && rd.total === 9, 'drawn zone: the same sites inside, counts by zone and left out as the same zones from a file (12 rows, 9 sites: three inside two zones)', rd.total);
    const dd = E.daysSince(ds, counted, DR.asOf), df = E.daysSince(fs2, counted, DR.asOf);
    check(same(dd.map(d => Object.assign({}, d, { source: null })), df.map(d => Object.assign({}, d, { source: null })))
      && same(dd.map(d => d.days), [33, null, null, 0, 5, null, null, 33]) && ds.every(s => s.source === 'drawn') && fs2.every(s => s.source === 'file'),
    'drawn zone: the same days since the last positive as from a file (R-001\'s 33 days, R-005\'s 0, R-007\'s 5)', dd.map(d => d.days));
    check(same(E.zoneRows(dd, { zonesMode: true, asOf: DR.asOf }), E.zoneRows(df, { zonesMode: true, asOf: DR.asOf })),
      'drawn zone: the same "Zones" rows and zones.csv as from a file');
    const gd = E.zonesGeoJson({ zones: ds }, { asOf: DR.asOf, positives: counted }), gf = E.zonesGeoJson({ zones: fs2 }, { asOf: DR.asOf, positives: counted });
    const strip = g => JSON.stringify(g, (k, v) => (k === 'source' || k === 'zone' ? undefined : v));
    check(strip(gd) === strip(gf) && gd.features.every(f => f.properties.source === 'drawn' && f.properties.zone === 'Drawn zone')
      && gf.features.every(f => f.properties.source === 'file' && f.properties.zone === f.properties.name),
    'drawn zone: zones.geojson byte for byte as from a file, apart from source ("drawn") and zone ("Drawn zone")');
    const back = Z.readGeoJson(JSON.stringify(gd), 'zones.geojson').zones;
    check(same(back.map(z => z.name), drawn.map(z => z.name)) && same(E.inside(E.zoneSites(back), layers, { mode: 'zones', positives: read.targets }), rd),
      'drawn zone: the exported zones.geojson reopens as a zone file with the zones\' names and the same sites inside (question 9)');
  }
  {   // Drawn and file zones together, and the rings giving way (question 1, A).
    const set = E.zoneSet(fileZone, drawn);
    check(same(set.map(z => z.name), ['Synthetic control area'].concat(DR.zones.map(z => z.name))) && same(E.zoneSet(null, drawn), drawn) && same(E.zoneSet(fileZone, []), fileZone),
      'zone set: the zone file\'s zones first, then the drawn ones');
    const both = E.inside(E.zoneSites(set), layers, { mode: 'zones', positives: read.targets });
    const d10 = both.rows.filter(r => r.name === 'Rules Dairy 10').map(r => r.zone);
    const dairy = both.layers.find(l => l.key === 'dairies');
    check(same(d10, ['Synthetic control area', 'Rectangle by the file zone']) && dairy.byZone.find(z => z.label === 'Synthetic control area').count === 1
      && dairy.byZone.find(z => z.label === 'Rectangle by the file zone').count === 1 && both.rows.length === 13 && both.total === 9,
    'zone set: a site inside a file zone and a drawn zone is listed in each, counted once in all', d10);
    check(E.showOf('zones', fileZone, []) === 'zones' && E.showOf('both', null, drawn) === 'both' && E.showOf('rings', fileZone, drawn) === 'rings'
      && E.showOf('both', null, []) === 'rings' && E.showOf('zones', [], []) === 'rings' && E.showOf('other', fileZone, drawn) === 'rings',
    'the switch (3b): its pick shows while a zone (from the file or drawn) exists; with none, the rings');
    const after = (change, show, f, d) => E.showAfter(change, { show, fileZones: f, drawn: d });
    check(after('drawn', 'rings', null, drawn) === 'both' && after('file', 'rings', fileZone, []) === 'zones' && after('file', 'rings', fileZone, drawn) === 'zones'
      && after('drawn', 'zones', fileZone, drawn) === 'zones' && after('drawn', 'both', null, drawn) === 'both' && after('file', 'both', fileZone, drawn) === 'both'
      && after('edited', 'rings', fileZone, drawn) === 'rings' && after('removed', 'rings', fileZone, drawn) === 'rings'
      && after('removed', 'both', null, []) === 'rings' && after('removed', 'zones', fileZone, []) === 'zones'
      && after('file cleared', 'zones', null, []) === 'rings' && after('file cleared', 'zones', null, drawn) === 'zones',
    'the switch (3b): on Rings a finished drawn zone picks Both and a zone file Zones; otherwise the pick stays; with no zone left, Rings');
    check(E.zonesNamed('zones.geojson', 2) === 'zones.geojson and 2 drawn' && E.zonesNamed(null, 2) === '2 drawn zones' && E.zonesNamed(null, 1) === '1 drawn zone'
      && E.zonesNamed('zones.geojson', 0) === 'zones.geojson' && E.zonesNamed(null, 0) === null,
    'the picture\'s meta line and export_params: "<file> and 2 drawn", "2 drawn zones", "1 drawn zone"');
    check(same(E.drawnParams(drawn, 'both'), { drawn_zones: 8, zones_shown: 'both' }) && same(E.drawnParams(null, 'rings'), { drawn_zones: 0, zones_shown: 'rings' }),
      'export_params.json: the drawn zones\' count and what showed (rings, zones or both)');
  }
  {   // The tick "CVI movements" (3c): the CVI premises the map draws, as the picture draws them.
    const row = (cvi, ho, hd, oLat, oLon, dLat, dLon) => ({ CVI: cvi, hitOrigin: ho, hitDest: hd,
      'Origin.Lat': oLat, 'Origin.Long': oLon, 'Dest.Lat': dLat, 'Dest.Long': dLon,
      'Origin.County': 'Yakima', 'Origin.State': 'WA', 'Dest.County': cvi === 'C' ? '' : 'Franklin', 'Dest.State': 'WA' });
    const ends = E.cviEnds([row('A', true, false, '46.5', '-120.5', '45.5', '-122.6'), row('B', true, true, '46.5', '-120.5', '46.4', '-119.0'),
      row('B', true, false, '46.5', '-120.5', '', ''), row('C', false, true, '', '', '46.4', '-119.0'), row('D', true, true, '95', '-120', 'x', '-119'),
      row('E', false, false, '47', '-121', '47', '-121')]);
    check(same(ends, { origins: [{ lat: 46.5, lon: -120.5, cvis: 2, ids: ['A', 'B'], place: 'Yakima, WA' }],
      dests: [{ lat: 46.4, lon: -119, cvis: 2, ids: ['B', 'C'], place: 'Franklin, WA' }] }),
      'the CVI premises (3c, 3d): each matched movement\'s end inside a zone once per spot, with its CVIs counted once, their numbers in order and the place of the first movement there (as the CVI movements table writes it); an end outside, blank or out of range left out', ends);
    const many = E.cviEnds(['CVI-10', 'CVI-9', 'CVI-2'].map(id => row(id, true, false, '46.5', '-120.5', '', '')));
    const blank = E.cviEnds([Object.assign(row('Z', true, false, '46.5', '-120.5', '', ''), { 'Origin.County': '', 'Origin.State': 'WA' })]);
    check(same(many.origins[0].ids, ['CVI-2', 'CVI-9', 'CVI-10']) && blank.origins[0].place === 'WA',
      'the CVI premises (3d): the numbers in their natural order (2 before 10); a blank county leaves the state', [many.origins, blank.origins]);
    check(same(E.cviEnds(null), { origins: [], dests: [] }) && same(E.cviEnds([]), { origins: [], dests: [] }),
      'the CVI premises (3c): none without matched movements');
  }
  {   // Both (3b): the rings and the zones together, each site counted once.
    const set = E.zoneSet(fileZone, drawn);
    const rs = E.ringSites(read.targets, rings), zs = E.zoneSites(set);
    const bs = E.bothSites(E.ringSites(read.targets, rings), E.zoneSites(set));
    const idsOwn = bs.length === rs.length + zs.length && new Set(bs.map(x => x.id)).size === bs.length;
    check(idsOwn && same(bs.slice(rs.length).map(x => x.id), zs.map((x, k) => rs.length + k + 1)) && bs.slice(rs.length).every(x => x.source),
    'both: the ring sites, then the zone sites numbered on after them (every id its own)', bs.map(x => x.id));
    // With ids not their own the counts cannot be kept apart: the checks below then fail rather than stop the suite.
    const insideBoth = (sites, o) => (idsOwn ? E.inside(sites, layers, o) : { rows: [], layers: [], leftOut: [], total: -1 });
    const noLayer = { label: '', byZone: [], inside: 0, usable: 0 };
    const rRes = E.inside(rs, layers, { mode: 'rings', rings, positives: read.targets });
    const zRes = E.inside(zs, layers, { mode: 'zones', positives: read.targets });
    const bRes = insideBoth(bs, { mode: 'both', rings, positives: read.targets });
    const keys = res => new Set(res.rows.map(r => r.layer + '\r' + r.lat + '\r' + r.lon + '\r' + r.name));
    const union = new Set([...keys(rRes), ...keys(zRes)]);
    check(bRes.rows.length === rRes.rows.length + zRes.rows.length && bRes.total === union.size && bRes.total < rRes.total + zRes.total,
      'both: every ring row and every zone row; a site inside a ring and a zone counted once in all', [rRes.total, zRes.total, bRes.total]);
    check(bRes.layers.every((l, i) => same(l.byZone.filter(z => z.ring), rRes.layers[i].byZone.map(z => Object.assign({}, z, { ring: true })))
      && same(l.byZone.filter(z => !z.ring), zRes.layers[i].byZone) && l.mode === 'both'
      && l.inside === new Set([...keys({ rows: rRes.rows.filter(r => r.layer === l.key) }), ...keys({ rows: zRes.rows.filter(r => r.layer === l.key) })]).size),
    'both: by ring as the rings alone (each site in its smallest ring), by zone as the zones alone, the rings first');
    const dairy = bRes.layers.find(l => l.key === 'dairies') || noLayer;
    check(/in the Infection zone|in the Control zone/.test(E.countLine(dairy)) && !/the Synthetic control area|the Drawn/.test(E.countLine(dairy))
      && /in Synthetic control area/.test(E.countLine(dairy)),
    'both: the count line says "the" before a ring\'s label, not before a zone\'s name', E.countLine(dairy));
    const named = E.zoneSites([Object.assign({}, fileZone[0], { name: rings[1].label })]);
    const clash = insideBoth(E.bothSites(E.ringSites(read.targets, rings), named), { mode: 'both', rings, positives: read.targets });
    const cl = clash.layers.find(l => l.key === 'dairies') || noLayer;
    check(cl.byZone.filter(z => z.label === rings[1].label).length === 2 && same(cl.byZone.filter(z => z.ring), rRes.layers.find(l => l.key === 'dairies').byZone.map(z => Object.assign({}, z, { ring: true }))),
    'both: a zone named as a ring ("' + rings[1].label + '") is counted apart from the ring', cl.byZone);
    const bDays = E.daysSince(bs, read.positives.filter(p => p.detected), DR.asOf);
    const zr = E.zoneRows(bDays, { zonesMode: false, rings, unit: 'km', asOf: DR.asOf });
    check(zr.rows.length === bs.length && zr.rows.filter(r => r[1] === '').length === zs.length
      && zr.rows.filter(r => r[1] !== '').every(r => / around /.test(r[0]) && r[8] === '') && zr.rows.filter(r => r[1] === '').every(r => r[8] !== ''),
    'both: the "Zones" rows and zones.csv hold each positive\'s outer ring and each zone (its area), the longest-quiet last');
    const bEx = E.exportRows(read, read.targets, bRes, 'km');
    check(bRes.rows.every(r => r.inZone === (r.site > rs.length)) && bEx.inside.rows.every((row, k) => (bRes.rows[k].inZone ? row[3] === '' : typeof row[3] === 'number'))
      && E.exportRows(read, read.targets, zRes, 'km').inside.rows.every(row => row[3] === ''),
    'both: inside_the_zones.csv gives a ring\'s rows their distance and a zone\'s none (in Zones too: no "0")', bEx.inside.rows.slice(0, 3));
    let noRings = null;
    try { noRings = E.inside(zs, layers, { mode: 'both', rings: null, positives: [] }); } catch (e) { noRings = e.message; }
    check(noRings && noRings.total === zRes.total, 'both: with no rings list yet (layers loaded before a positives file), the zones are counted alone', noRings && noRings.total);
    const g = E.zonesGeoJson({ rings: [{ sites: rs, group: 'Active' }], zones: zs }, { rings, unit: 'km', asOf: DR.asOf, positives: read.positives.filter(p => p.detected) });
    check(g.features.length === rs.length * rings.length + zs.length && g.features.filter(f => f.properties.source).length === zs.length,
      'both: zones.geojson holds every ring and every zone');
    check(bRes.layers.length > 0 && same(E.overviewBars([], bRes).layers[0].parts.map(x => x.ring), bRes.layers[0].byZone.map(z => z.ring)),
      'both: the Overview\'s bars by layer, the rings\' parts marked (for their colors)');
  }
  {   // The circle (3b): its corners on the rings' distance rule, its label, its row.
    const mid = [-120.47, 46.552];
    const km3 = E.circleCorners(mid, 3, 'km'), mi2 = E.circleCorners(mid, 2, 'mi');
    const far = (c, km) => Math.max(...c.map(q => Math.abs(PX.distanceKm(mid[1], mid[0], q[1], q[0]) - km)));
    check(km3.length === E.CIRCLE_SIDES && E.CIRCLE_SIDES === 120 && far(km3, 3) < 1e-6 && far(mi2, 2 * E.KM_PER_MILE) < 1e-6
      && Math.abs(km3[0][0] - mid[0]) < 1e-9 && km3[0][1] > mid[1] && km3[30][0] > mid[0],
    'circle: 120 corners, each the radius from the middle by the rings\' distance (both units), from the north, clockwise', [far(km3, 3), far(mi2, 2 * E.KM_PER_MILE)]);
    const a3 = E.areaM2(poly(km3));
    check(near(a3, Math.PI * 9e6, 0.001) && a3 < Math.PI * 9e6,
    'circle: its area within 0.1% of pi r squared (the 120 sides inside the true circle)', a3);
    check(same(E.circleLabel(mid, 3, 'km', 'SYN-HPAI-001'), ['Around SYN-HPAI-001', '3.0 km radius', 'Area 10.9 sq mi, 6,984 acres'])
      && same(E.circleLabel(mid, 2, 'mi'), ['2.0 mi radius', 'Area 12.6 sq mi, 8,039 acres']),
    'circle: the label, with "Around SYN-HPAI-001" when centered on a positive', [E.circleLabel(mid, 3, 'km'), E.circleLabel(mid, 2, 'mi')]);
    const cz = E.drawnZone(km3, 'Drawn zone 1', { kind: 'circle', km: 3 });
    check(cz && cz.vertices === 121 && cz.source === 'drawn' && E.shapeText(cz, 'km') === 'Circle, 3.0 km radius' && E.shapeText(cz, 'mi') === 'Circle, 1.9 mi radius'
      && PX.inZone(mid[0], mid[1], cz.geometry),
    'circle: a drawn zone of 120 corners; its row "Circle, 3.0 km radius" (1.9 mi)', cz && E.shapeText(cz, 'mi'));
    // A site just inside the radius is inside both the circle and the ring of the same distance around the same point.
    const ring = E.ringSites([{ index: 0, name: 'P', lat: mid[1], lon: mid[0] }], [{ label: 'R', distance: 3 }], 'km');
    const circle = E.zoneSites([cz]);
    const pts = [0, 45, 90, 180, 270].map(b => { const c = E.circleCorners(mid, 2.99, 'km')[b / 3]; return { name: 'S' + b, lat: c[1], lon: c[0] }; });
    const lay = [{ key: 't', label: 'T', points: pts }];
    check(E.inside(circle, lay, { mode: 'zones', positives: [] }).total === 5 && E.inside(ring, lay, { mode: 'rings', rings: [{ label: 'R', distance: 3 }], positives: [] }).total === 5,
    'circle: sites 10 m inside its radius are inside the circle and inside the ring of the same distance');
  }
  {   // Names, shapes in the list, editing.
    check(same(E.drawnName(0, []), { name: 'Drawn zone 1', count: 1 }) && same(E.drawnName(3, ['Drawn zone 2']), { name: 'Drawn zone 4', count: 4 })
      && same(E.drawnName(0, ['Drawn zone 1', 'Drawn zone 2']), { name: 'Drawn zone 3', count: 3 }),
    'names: "Drawn zone n" counting every zone drawn, skipping a name a zone already has (a reopened zones.geojson)');
    const z = { name: 'Drawn zone 2', first: 'Drawn zone 2' };
    check(same(E.zoneName('  Along   the  river ', z, ['Drawn zone 1']), { name: 'Along the river', taken: false, by: null }) && E.zoneName('x'.repeat(70), z, []).name.length === 60
      && same(E.zoneName('  ', { name: 'River', first: 'Drawn zone 2' }, []), { name: 'Drawn zone 2', taken: false, by: null })
      && same(E.zoneName('Synthetic control area', { name: 'River', first: 'Drawn zone 2' }, ['Synthetic control area']), { name: 'River', taken: true, by: 'zone' }),
    'names: spaces squeezed, at most 60 characters, blank gives the first name back, another zone\'s name refused');
    const reserved = { ring: ['Infection zone', 'Control zone'], positive: ['SYN-HPAI-001'] };
    check(same(E.zoneName('Control zone', z, [], reserved), { name: 'Drawn zone 2', taken: true, by: 'ring' })
      && same(E.zoneName(' SYN-HPAI-001 ', z, [], reserved), { name: 'Drawn zone 2', taken: true, by: 'positive' })
      && same(E.zoneName('Control zone east', z, [], reserved), { name: 'Control zone east', taken: false, by: null }),
    'names (3b): a ring\'s label or a positive\'s name refused for a drawn zone, with what has it; a name only like one kept');
    const rect = drawn.find(x => x.name === 'Rectangle by the file zone'), sq2 = drawn.find(x => x.name === 'Square around R-007');
    check(E.shapeText(drawn[4 - 1], 'km') === 'Square, 6.0 km across' && E.shapeText(sq2, 'mi') === 'Square, 4.0 mi across' && E.shapeText(sq2, 'km') === 'Square, 6.4 km across'
      && E.shapeText(rect, 'km') === 'Rectangle, 3.1 km by 6.7 km' && E.shapeText(drawn[0], 'km') === '6 corners',
    'list: the shape and size ("Square, 6.0 km across", "Rectangle, 3.1 km by 6.7 km"), or the corners', drawn.map(x => E.shapeText(x, 'km')));
    const moved = E.cornersOf(rect);
    moved[0] = [moved[0][0] - 0.01, moved[0][1]];
    const ed = E.editedZone(Object.assign({}, rect, { name: 'Renamed' }), moved);
    check(ed.shape === null && ed.name === 'Renamed' && ed.first === 'Rectangle by the file zone' && E.shapeText(ed, 'km') === '4 corners'
      && E.areaM2(ed.geometry) > E.areaM2(rect.geometry) && E.cornersOf(rect).length === 4,
    'editing: a moved corner gives the same zone with its new area and no shape; its name and first name kept');
    const crossed = E.cornersOf(rect);
    crossed[0] = [crossed[3][0] + 0.04, 46.40];   // the northwest corner dragged past the east side
    check(E.editedZone(rect, crossed) === null, 'editing: a drag that would cross sides gives no zone (the page puts it back)');
  }
  {   // The exports' new fields (question 11).
    const sites = E.zoneSites(E.zoneSet(fileZone, drawn.slice(0, 1))), days = E.daysSince(sites, read.positives.filter(p => p.detected), DR.asOf);
    const zr = E.zoneRows(days, { zonesMode: true, asOf: DR.asOf });
    check(same(zr.columns.slice(-2), ['Area (sq mi)', 'Area (acres)']) && same(zr.rows, [['Drawn zone 1', '', '', '', '', '2026-09-02', 33, '2026-10-05', 14.88, 9520],
      ['Synthetic control area', '', '', '', '', '', '', '2026-10-05', 27.8, 17792]]),
    'zones.csv: the drawn and file zones\' rows end with the area in sq mi and acres', zr.rows);
    const g = E.zonesGeoJson({ zones: sites }, { asOf: DR.asOf, positives: [] });
    check(same(Object.keys(g.features[0].properties), ['name', 'zone', 'positive', 'group', 'distance', 'unit', 'days_since_last_positive', 'as_of', 'area_sq_mi', 'area_acres', 'source'])
      && same(g.features.map(f => [f.properties.area_sq_mi, f.properties.area_acres, f.properties.source]), [[27.8, 17792, 'file'], [14.88, 9520, 'drawn']]),
    'zones.geojson: every zone with area_sq_mi, area_acres and source', g.features.map(f => f.properties));
    check(JSON.stringify(E.zonesGeoJson({ zones: E.zoneSites(E.zoneSet(fileZone, drawn)) }, { asOf: DR.asOf, positives: [] })) + '\n'
      === fs.readFileSync(path.join(FXD, DR.geojson), 'utf8'), 'zones.geojson: the page writes the same drawn zones\' file the R reference read');
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
    // The picture's panel (2.7): each positive's sites inside by layer, counted again in R.
    const theirPanel = (o.breakdown || []).map(b => ({ name: b.name, layers: Array.isArray(b.layers) ? [] : Object.entries(b.layers) }));
    const byName = list => list.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    check(theirPanel.length > 0 && fixturePanel && same(byName(fixturePanel), byName(theirPanel)),
      'R reference: the map picture\'s counts by positive and layer (2.7)', { mine: fixturePanel, r: theirPanel });
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
        && gc.filter(c => c.positive !== null).every(c => c.points === 361) && same(a.geojson.properties, [...new Set(agGeo.features.flatMap(f => Object.keys(f.properties)))])
        && gc.every((c, k) => same(c.days, agGeo.features[k].properties.days_since_last_positive)),
      'R reference: zones.geojson read with sf: every polygon valid, closed and counterclockwise, every circle 361 points, the same properties', gc.filter(c => !(c.valid && c.closed && c.ccw)));
      // Six decimals hold a position to about 0.1 m, so each vertex is within 1e-4 km of its ring's distance.
      const worstVertex = Math.max(...gc.filter(c => c.positive !== null).map(c => c.vertex_error_km));
      check(worstVertex < 1e-4, 'R reference: zones.geojson: every circle\'s vertices at the ring\'s distance from the positive, within 1e-4 km (six decimals)', worstVertex);
    }
    {   // The Overview's scenario against R.
      const v = o.overview;
      const sha = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(SITE, 'geo', f))).digest('hex');
      check(v && v.geo_sha.tracts === sha('tracts-wa.js') && v.geo_sha.counties === sha('wa-counties.js'),
        'R reference: overview: written from these tract and county files (else run Rscript tests/oracle/em_oracle.R again)');
      const mapped = ovByLine.map(p => p.index !== null);
      check(same(v.names, names(ovByLine)) && same(v.county.filter((c, k) => mapped[k]), ovByLine.filter(p => p.index !== null).map(p => E.countyOf(p, COUNTIES)))
        && same(v.targets, names(ovTargets)), 'R reference: overview: the same names, counties (sf and GEOS for the blank ones) and positives with zones', v.county);
      const crAll = csvOf('em_rules_counties.csv'), crNames = E.readPositives(crAll[0], crAll.slice(1), hpai).positives.map(p => E.countyOf(p, COUNTIES));
      check(same(v.countyRules, crNames), 'R reference: each positive\'s county from the county rules\' file (sf: the shapes, then the nearest within 2 km)', v.countyRules);
      const mine = Object.fromEntries(ovCounties.map(r => [r.county, r]));
      const word = (r, w) => { const x = r.animals.find(a => a[0] === w); return x ? x[1] : null; };
      check(v.counties.length === ovCounties.length && v.counties.every(c => mine[c.county] && mine[c.county].current === c.current
        && mine[c.county].past === c.past && word(mine[c.county], 'birds') === c.birds && word(mine[c.county], 'cattle') === c.cattle
        && mine[c.county].missing === c.missing), 'R reference: overview: the same counties table (counts, birds, cattle, blank inventories)', v.counties);
      check(same(v.positives, E.positiveRows(ov, ovWin, COUNTIES).rows), 'R reference: overview: the same positives table, row for row', v.positives.slice(0, 2));
      // The page's grid against R's exact areas: the total within 1% (or 25 people), each tract's share within 2 points.
      for (const [label, grid, exact] of [['rings', ovPeople, v.people.rings], ['zone with a hole', holePeople, v.people.zone]]) {
        const diff = Math.abs(grid.total - exact.total);
        check(diff <= Math.max(25, 0.01 * exact.total), 'R reference: people inside the ' + label + ': the grid within 1% of the exact total',
          [grid.total, exact.total]);
        const shares = new Map(exact.tracts.map(t => [t.geoid, t.share]));
        grid.tracts.forEach(t => { if (!shares.has(t.geoid)) shares.set(t.geoid, 0); });
        const gridShare = new Map(grid.tracts.map(t => [t.geoid, t.share]));
        const worstShare = Math.max(...[...shares].map(([g, x]) => Math.abs((gridShare.get(g) || 0) - x)));
        console.log(`  people inside the ${label}: grid ${grid.total.toFixed(1)}, exact ${exact.total.toFixed(1)} (${(100 * diff / exact.total).toFixed(2)}%), worst tract share ${(100 * worstShare).toFixed(2)} points`);
        check(worstShare <= 0.02, 'R reference: people inside the ' + label + ': every tract\'s share within 2 points of the exact share', worstShare);
      }
    }
  }

  {   // The two views' scenario against R (2.5): each row's group, the counts and the last positive in every view.
    const o = fs.existsSync(ORACLE) ? JSON.parse(fs.readFileSync(ORACLE, 'utf8')) : {};
    const v = o.views;
    const mine = view => { const b = E.valueBoxes(vr, null, view);
      return { group: viewRow(view), active: b.positives.value, closed: b.past.value, last: b.last.value }; };
    const theirs = x => ({ group: x.group, active: x.active, closed: x.closed, last: x.last });
    check(v && v.days.length === VR.days.length && v.days.every((x, k) => x.day === VR.days[k] && same(theirs(x), mine(E.dayView(vWin, x.day)))),
      'R reference: On a day, for each of six days: each row\'s group, the active and closed counts and the last positive',
      v && v.days.map(x => [x.day, x.active, x.closed, x.last]));
    check(v && v.ranges.length === VR.ranges.length && v.ranges.every((x, k) => same(x.range, VR.ranges[k])
      && same(theirs(x), mine(E.rangeView(x.range[0], x.range[1])))),
    'R reference: Between dates, for each of four ranges: each row\'s group, the active and closed counts and the last positive',
      v && v.ranges.map(x => [x.range, x.active, x.closed, x.last]));
  }

  {   // The closing day's scenario against R (2.5): closed by Status without a
    // Close Date, from the release date; with neither date, closed on a day not known (a line on a day before today).
    const o = fs.existsSync(ORACLE) ? JSON.parse(fs.readFileSync(ORACLE, 'utf8')) : {};
    const c = o.closedDay, CR = FX.RULES.closedDay;
    const cRows = csvOf(CR.positives);
    const cr = E.readPositives(cRows[0], cRows.slice(1), null, CR.today);
    const cWin = E.windowOf(cr.positives);
    const mine = (view, read = cr) => { const g = E.groups(read, view), b = E.valueBoxes(read, null, view);
      return { group: read.positives.concat(read.dropped).sort((a, b) => a.line - b.line)
        .map(p => p.index === null ? 'Not mapped' : g.outside.includes(p) ? 'Outside' : E.groupOf(p, view.end)),
        active: b.positives.value, closed: b.past.value, day_not_known: g.closedDayNotKnown.length }; };
    const theirs = x => ({ group: x.group, active: x.active, closed: x.closed, day_not_known: x.day_not_known });
    check(c && c.days.length === CR.days.length && c.days.every((x, k) => x.day === CR.days[k] && same(theirs(x), mine(E.dayView(cWin, x.day)))),
      'R reference: the closing day On a day, for each of six days: each row\'s group, the counts and those closed on a day not known',
      c && c.days.map(x => [x.day, x.active, x.closed, x.day_not_known]));
    check(c && c.ranges.length === CR.ranges.length && c.ranges.every((x, k) => same(x.range, CR.ranges[k])
      && same(theirs(x), mine(E.rangeView(x.range[0], x.range[1])))),
    'R reference: the closing day Between dates, for each of two ranges: each row\'s group, the counts and those closed on a day not known',
      c && c.ranges.map(x => [x.range, x.active, x.closed, x.day_not_known]));
    // Read on an earlier today (May 1, 2023): Yakima 11's release (Jun 1, 2023) is after it, so not its closing day:
    // closed on every day, closed on a day not known, as R; its release date gives no "?" sentence of its own then.
    const crEarly = E.readPositives(cRows[0], cRows.slice(1), null, CR.early.today);
    const early = c && c.early;
    const y11 = crEarly.positives.find(p => p.name === 'Yakima 11');
    check(early && early.today === CR.early.today && early.days.length === CR.early.days.length
      && early.days.every((x, k) => x.day === CR.early.days[k] && same(theirs(x), mine(E.dayView(cWin, x.day), crEarly)))
      && y11.releaseAfterToday && E.closedDayNotKnown(y11) && E.isPast(y11, '2023-04-01')
      && !cr.positives.find(p => p.name === 'Yakima 11').releaseAfterToday,
    'R reference: the closing day read on an earlier today: a release date after today is not the closing day (closed on every day, on a day not known)',
      early && early.days.map(x => [x.day, x.active, x.closed, x.day_not_known]));
    // Read on Yakima 11's release day itself: that day is not after today, so it is the closing day.
    const y11On = E.readPositives(cRows[0], cRows.slice(1), null, '2023-06-01').positives.find(p => p.name === 'Yakima 11');
    check(!y11On.releaseAfterToday && !E.closedDayNotKnown(y11On) && !E.isPast(y11On, '2023-05-31') && E.isPast(y11On, '2023-06-01'),
      'the closing day read on the release day itself: the release date is the closing day (active the day before, closed on it)', y11On);
    // By hand: a positive closed by its release is active before the release, closed on its day.
    const byName = (g, n) => g.current.some(p => p.name === n) ? 'Active' : g.past.some(p => p.name === n) ? 'Closed' : 'Outside';
    const onDay = d => E.groups(cr, E.dayView(cWin, d));
    check(byName(onDay('2023-04-01'), 'Yakima 11') === 'Active' && byName(onDay('2023-06-01'), 'Yakima 11') === 'Closed'
      && byName(onDay('2025-05-01'), 'Yakima 13') === 'Closed' && byName(onDay('2026-10-30'), 'Yakima 16') === 'Active',
    'the closing day: closed by Status, active until its release date and closed on it; a Close Date before the release decides; Active by Status stays active with a release date');
    // The line under the boxes: on a view ending before today only.
    const lines = d => E.valueBoxes(cr, null, E.dayView(cWin, d), CR.today).positives.lines;
    check(lines('2025-10-01').includes('2 closed on a day not known') && !lines(CR.today).some(l => /day not known/.test(l))
      && !E.valueBoxes(cr, null, E.dayView(cWin, '2025-10-01')).positives.lines.some(l => /day not known/.test(l)),
    'the closing day: "2 closed on a day not known" under the boxes on a day before today; not on today, nor without today',
      [lines('2025-10-01'), lines(CR.today)]);
  }

  {   // The quarantine status scenario against R (2.4).
    const o = fs.existsSync(ORACLE) ? JSON.parse(fs.readFileSync(ORACLE, 'utf8')) : {};
    const q = o.quarantine;
    const groupRow = (read, list, win) => { const g = E.groups(read, win);
      return list.map(p => p.index === null ? 'Not mapped' : g.outside.includes(p) ? 'Outside' : E.groupOf(p, win.end)); };
    const quarRow = (read, list, win) => { const g = E.groups(read, win);
      return list.map(p => p.index === null || g.outside.includes(p) ? null : E.quarantineOf(read, p, win.end)); };
    const early = { start: qWin.start, end: QR.earlierEnd };
    check(q && q.bad_status === qr.badQuarantineStatus && same(q.asOf.group, groupRow(qr, qByLine, qWin))
      && same(q.earlier.group, groupRow(qr, qByLine, early)) && same(q.asOf.quarantine, quarRow(qr, qByLine, qWin))
      && same(q.earlier.quarantine, quarRow(qr, qByLine, early)),
    'R reference: quarantine status scenario: each row\'s group and quarantine on both end dates, and the statuses not read', q);
    // The drawn zones (2.6): the areas against an equal-area projection, the sites inside, the squares, the crossing
    // check against GEOS's validity, and the page's zones.geojson read with sf.
    const od = o.drawn;
    if (!od) check(false, 'R reference: no drawn zones\' scenario (run Rscript tests/oracle/em_oracle.R again)');
    else {
      const worstArea = Math.max(...od.zones.map((z, k) => Math.abs(E.areaM2(drawn[k].geometry) / z.area_m2 - 1)));
      check(od.zones.length === 8 && worstArea < 2e-3 && od.zones.every(z => z.valid),
        'R reference: drawn zones: every area within 0.2% of NAD83 / Conus Albers (EPSG:5070), each polygon valid', worstArea);
      check(od.zones.every((z, k) => same(z.rows.map(r => r.layer + '|' + r.name).sort(),
        E.inside(E.zoneSites([drawn[k]]), layers, { mode: 'zones', positives: read.targets }).rows.map(r => r.layer + '|' + r.name).sort())),
      'R reference: drawn zones: the same sites inside each (sf and GEOS)', od.zones.map(z => z.rows.length));
      const halves = od.zones.filter(z => z.half_km).map(z => [z.half_km, E.toKm(DR.zones.find(x => x.name === z.name).square.size, DR.zones.find(x => x.name === z.name).square.unit)]);
      check(halves.length === 2 && halves.every(([h, km]) => h.every(d => Math.abs(d / km - 1) < 1e-3)),
        'R reference: the squares\' sides their size from the middle within 0.1% (distHaversine)', halves);
      check(same(od.shapes.map(x => [x.name, x.valid]), DR.shapes.map(x => [x.name, E.isSimple(x.corners)])),
        'R reference: the crossing check refuses exactly the shapes GEOS calls invalid', od.shapes);
      check(od.geojson.length === 9 && od.geojson.every(f => f.valid) && same(od.geojson.map(f => f.source), ['file'].concat(drawn.map(() => 'drawn')))
        && od.geojson.every(f => Math.abs(f.area_sq_mi * 2589988.110336 / f.area_m2 - 1) < 2e-3 || f.area_sq_mi < 1)
        && od.geojson.every(f => Math.abs(f.area_acres * 4046.8564224 - f.area_m2) <= 2e-3 * f.area_m2 + 0.5 * 4046.8564224),
      'R reference: zones.geojson with drawn zones: valid polygons, their source, and their area_sq_mi and area_acres within 0.2% of the projection\'s', od.geojson);
      // The circles (3b), checked alone.
      const oc = od.circles || [], circles = DR.circles.map(z => E.drawnZone(z.corners, z.name, z.shape));
      check(oc.length === 2 && oc.every((z, k) => z.valid && Math.abs(E.areaM2(circles[k].geometry) / z.area_m2 - 1) < 2e-3
        && Math.abs(z.area_m2 / (Math.PI * Math.pow(1000 * E.toKm(DR.circles[k].circle.size, DR.circles[k].circle.unit), 2)) - 1) < 2e-3),
      'R reference: the circles: each area within 0.2% of EPSG:5070\'s, and EPSG:5070\'s within 0.2% of pi r squared; each polygon valid', oc.map(z => z.area_m2));
      check(oc.length === 2 && oc.every((z, k) => { const km = E.toKm(DR.circles[k].circle.size, DR.circles[k].circle.unit); return z.radius_km.every(d => Math.abs(d / km - 1) < 1e-4); }),
      'R reference: the circles: every corner its radius from the middle within 0.01% (distHaversine; the corners kept to six decimals, about 0.1 m)', oc.map(z => z.radius_km));
      check(oc.length === 2 && oc.every((z, k) => same(z.rows.map(r => r.layer + '|' + r.name).sort(),
        E.inside(E.zoneSites([circles[k]]), layers, { mode: 'zones', positives: read.targets }).rows.map(r => r.layer + '|' + r.name).sort())),
      'R reference: the circles: the same sites inside each (sf and GEOS)', oc.map(z => z.rows.length));
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

  {   // The work-PC table check (tools/work-pc/check_hpai_table.R, base R, 2.4) against the page: its settings equal the
    // HPAI type's and rules.js's, and its report's counts equal the page's reading of each synthetic HPAI table, on
    // the last detection date and, from 2.5, on the day the page opens on (the script's third argument, the suite's
    // fixed today). The reports also hold no Case ID, address, coordinate, county name or full date from the table.
    const SCRIPT = path.join(ROOT, 'tools', 'work-pc', 'check_hpai_table.R');
    const OUTD = path.join(ROOT, 'local-test-artifacts', 'em', 'table-check');
    fs.rmSync(OUTD, { recursive: true, force: true });
    fs.mkdirSync(OUTD, { recursive: true });
    const rSource = fs.readFileSync(SCRIPT, 'utf8');
    const rList = (name, from) => { const m = new RegExp(name + ' = c\\(([^)]*)\\)').exec(from || rSource);
      return m ? [...m[1].matchAll(/"([^"]*)"/g)].map(x => x[1]) : null; };
    const roleBlock = (/ROLE_NAMES <- list\(([\s\S]*?)\)\)\n/.exec(rSource) || [])[1] + ')';
    const qv = hpai.quarantineValues;
    check(['id', 'detected', 'disease', 'status', 'quarantine', 'quarantineStatus', 'flockType', 'inventory', 'shown']
      .every(k => same(rList(k, roleBlock), hpai.columns[k])) && same(rList('closed', roleBlock), hpai.closed.column)
      && same(rList('closedDate', roleBlock), hpai.closed.dateColumn)
      && ['lat', 'lon', 'county', 'species'].every(k => same(rList(k, roleBlock), E.COLUMNS[k]))
      && same(rList('Confirmed'), hpai.statuses[0].words) && same(rList('Presumptive'), hpai.statuses[1].words)
      && same(rList('Suspect'), hpai.statuses[2].words) && same(/^CLOSED_VALUES <- c\(([^)]*)\)/m.exec(rSource)[1],
      hpai.closed.values.map(v => '"' + v + '"').join(', '))
      && same(/^QUARANTINE_UNDER <- c\(([^)]*)\)/m.exec(rSource)[1], qv.under.map(v => '"' + v + '"').join(', '))
      && same(/^QUARANTINE_RELEASED <- c\(([^)]*)\)/m.exec(rSource)[1], qv.released.map(v => '"' + v + '"').join(', '))
      && /^PRIVATE <- "address\|location\|street\|premise"$/m.test(rSource) && E.PRIVATE.source === 'address|location|street|premise',
    'table check: its column names, statuses, closed and quarantine words and private columns are the HPAI type\'s and rules.js\'s');
    const waBox = /const WA = \{ south: ([\d.-]+), north: ([\d.-]+), west: ([\d.-]+), east: ([\d.-]+) \}/
      .exec(fs.readFileSync(path.join(SITE, 'emergency', 'rules.js'), 'utf8')).slice(1).map(Number);
    const countyNames = globalThis.CVIWA_GEO.counties.features.map(f => f.properties.name).sort();
    // A date written with its month's name, as the table check reads one (a month and year alone is not a day).
    const MONTH_DAY = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(st|nd|rd|th)?\b|\b\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
    const rCounties = [.../^WA_COUNTIES <- c\(([^)]*)\)/m.exec(rSource.replace(/\n\s+/g, ' '))[1].matchAll(/"([^"]*)"/g)]
      .map(x => x[1]);
    check(same(/^WA <- c\(south = ([\d.-]+), north = ([\d.-]+), west = ([\d.-]+), east = ([\d.-]+)\)$/m.exec(rSource)
      .slice(1).map(Number), waBox) && same(rCounties.slice().sort(), countyNames) && rCounties.length === 39,
    'table check: Washington\'s box is rules.js\'s and its 39 county names are the map\'s', rCounties.length);
    // The .bat and the README open on Windows as they are: Windows' line ends and plain ASCII (as its ZIP requires).
    for (const name of ['CHECK_HPAI_TABLE.bat', 'README.txt']) {
      const text = fs.readFileSync(path.join(ROOT, 'tools', 'work-pc', name), 'latin1');
      check(text.endsWith('\r\n') && !/[^\r]\n/.test(text) && !/[^\x20-\x7e\r\n]/.test(text),
        'table check: ' + name + ' has Windows line ends and plain ASCII');
    }

    // The report's parts, read back.
    const reportOf = text => {
      const lines = text.split('\r\n'), at = re => lines.findIndex(l => re.test(l));
      const block = re => { const i = at(re); const out = []; for (let k = i + 1; i >= 0 && k < lines.length && lines[k]; k++) out.push(lines[k]); return out; };
      const num = (re, k) => { const m = re.exec(text); return m ? Number(m[k || 1]) : null; };
      const columns = block(/^Column\s+Read by the page as/).map(l => l.split(/\s{2,}/));
      const dates = {};
      for (const l of block(/^Dates \(/)) {
        const m = /^ {2}(\S.*?)\s+(\d+) read, (\d+) not read,\s+(\d+) blank(?:; years (\d+) to (\d+))?/.exec(l);
        if (m) dates[m[1]] = [+m[2], +m[3], +m[4], m[5] ? +m[5] : null, m[6] ? +m[6] : null];
      }
      const categories = {};
      for (const l of block(/^Category values/)) {
        const m = /^ {2}(\S.*?)\s{2,}(.*)$/.exec(l);
        categories[m[1]] = /different values/.test(m[2]) ? m[2] : m[2].split(', ').map(e => {
          const x = /^(.*): (\d+)(?: \((.+)\))?$/.exec(e); return [x[1], +x[2], x[3] || '']; });
      }
      const animals = /^Animals \((.+)\): (\d+) read, (\d+) not read, (\d+) blank$/m.exec(text);
      const county = /^ {2}"Name" (\d+), "name" (\d+), "Name County" (\d+), not a Washington county (\d+), blank (\d+)$/m.exec(text);
      const coords = /^Coordinates: mapped (\d+) \(outside the box around Washington (\d+)\), not mapped (\d+)\r\n {2}not mapped because: no coordinates (\d+), no latitude (\d+), no longitude (\d+), not readable (\d+), look swapped (\d+)$/m.exec(text);
      const GROUPS = / {2}active (\d+), closed (\d+) \(still under quarantine (\d+), not known (\d+)\), not mapped (\d+)/;
      const groupsLine = new RegExp('^What the page would show on the last detection date .*:\\r\\n' + GROUPS.source + '$', 'm').exec(text);
      const todayLine = new RegExp('^What the page opens on, today \\((\\w+ \\d+, \\d{4})\\), in both views:\\r\\n' + GROUPS.source + '\\r\\n'
        + ' {2}\\("On a day" opens on today, "Between dates" from the first detection to today: the same positives\\.\\)$', 'm').exec(text);
      return { rows: num(/^Rows below the header: (\d+)/m), ncol: num(/^Columns: (\d+)/m), columns, dates, categories,
        missing: block(/^Not found \(/).map(l => l.trim().split(/\s{2,}/)[0]),
        animals: animals ? animals.slice(1).map((v, k) => k ? +v : v) : null,
        county: county ? county.slice(1).map(Number) : null, coords: coords ? coords.slice(1).map(Number) : null,
        groups: groupsLine ? groupsLine.slice(1).map(Number) : null,
        today: todayLine ? todayLine.slice(2).map(Number) : null, todayWords: todayLine ? todayLine[1] : null,
        afterToday: (/^What the page opens on: a detection is after today \((\w+ \d+, \d{4})\), so both views open on the last\r\ndetection date \((\w+ \d{4})\), the counts above\.$/m.exec(text) || []).slice(1),
        noDay: /^What the page opens on: no readable detection date, so no day to open on \(the counts above\)\.$/m.test(text), undated: num(/without a readable detection date: (\d+)$/m),
        end: (/^What the page would show on the last detection date \((\w+ \d{4})\):$/m.exec(text) || [])[1] || null };
    };
    // The day the check takes as today: the suites' fixed today, unless named.
    const TODAY = '2026-10-30';
    const runCheck = (file, day) => {
      const out = path.join(OUTD, path.basename(file).replace(/\.csv$/, '') + (day ? '_' + day : '') + '.txt');
      const hash = () => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), before = hash();
      try { execFileSync('Rscript', ['--vanilla', SCRIPT, file, out, day || TODAY], { stdio: 'pipe' }); }
      catch (e) { return { failed: String(e.stderr || e.message).slice(0, 300) }; }
      if (hash() !== before) return { failed: 'the table changed' };
      return { text: fs.readFileSync(out, 'utf8') };
    };

    // The page's own reading of a table, in the report's terms.
    const ORD = ['1st', '2nd', '3rd'];
    const ROLE_WORDS = { id: "the positive's ID", disease: 'the disease', status: 'testing status',
      quarantine: 'quarantine released', quarantineStatus: 'quarantine status', closed: 'closed or not',
      closedDate: 'surveillance ended', flockType: 'flock type', inventory: 'animals', shown: 'shown in the hover',
      lat: 'latitude', lon: 'longitude', county: 'county', species: 'animal kind' };
    const ROLE_ORDER = ['id', 'disease', 'status', 'quarantine', 'quarantineStatus', 'closed', 'closedDate', 'flockType',
      'inventory', 'lat', 'lon', 'county', 'species'];
    const ALL_ROLES = ['id', 'detected', 'disease', 'status', 'quarantine', 'quarantineStatus', 'closed', 'closedDate',
      'flockType', 'inventory', 'shown', 'lat', 'lon', 'county', 'species'];
    const txt = v => (v === null || v === undefined ? '' : String(v).trim());
    const ckey = n => txt(n).replace(/\s+/g, ' ').replace(/ county$/i, '').toLowerCase();
    const mapNames = new Set(countyNames), mapKeys = new Set(countyNames.map(ckey));
    const KNOWN_WORDS = hpai.statuses.flatMap(s => s.words).concat(hpai.closed.values, ['open', 'no', 'n', 'false', '0'],
      qv.under, qv.released);
    const shapeOf = v => { const s = txt(v).replace(/[0-9]/g, '9').replace(/[A-Za-z]/g, 'a');
      return s.length > 24 ? s.slice(0, 24) + '...' : s; };
    const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
      'November', 'December'];
    const pageOf = (file, day) => {
      const parsed = globalThis.CVIWA.csv.parse(fs.readFileSync(file, 'utf8'));
      const header = parsed.header, read = E.readPositives(header, parsed.rows, null, day || TODAY);
      const rows = parsed.rows.filter(r => !r.every(v => txt(v) === '')).map(r => header.map((h, k) => txt(r[k])));
      const at = name => (name === null ? -1 : header.indexOf(name));
      const idx = names => [...new Set(names.map(n => header.findIndex(h => txt(h).toLowerCase() === n.toLowerCase()
        && !E.PRIVATE.test(h))).filter(i => i >= 0))];
      const detectedAt = idx(hpai.columns.detected), shownAt = idx(hpai.columns.shown);
      const roles = header.map((h, i) => {
        if (E.PRIVATE.test(h)) return 'never read (private)';
        const r = ROLE_ORDER.filter(k => at(read.columns[k]) === i).map(k => ROLE_WORDS[k]);
        if (detectedAt.includes(i)) r.push('detection date (' + ORD[detectedAt.indexOf(i)] + ')');
        if (shownAt.includes(i)) r.push(ROLE_WORDS.shown);
        return r.length ? r.join(', ') : 'not used';
      });
      // A cell that could be from a record is never shown as written (the script's looks_private): a date, a number
      // like a coordinate, a county's name or one of the table's Case IDs.
      const idAt = at(read.columns.id), ids = idAt < 0 ? [] : rows.map(r => r[idAt]).filter(Boolean);
      const countyWord = new RegExp('\\b(' + countyNames.join('|') + ')\\b', 'i');
      const looksPrivate = v => /\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}[-/]\d{1,2}[-/]\d{1,2}|(^|[^0-9.])-?\d{1,3}\.\d{3,}/.test(v)
        || MONTH_DAY.test(v) || countyWord.test(v) || ids.includes(v);
      const columns = header.map((h, i) => [txt(h) && looksPrivate(txt(h)) ? 'Column ' + (i + 1) + ' (name not shown)' : txt(h),
        roles[i], E.PRIVATE.test(h) ? '-' : String(rows.filter(r => r[i] === '').length)]);
      const missing = ALL_ROLES.filter(k => (k === 'detected' ? !detectedAt.length : k === 'shown' ? !shownAt.length
        : !read.columns[k])).map(k => k === 'detected' ? 'detection date' : ROLE_WORDS[k]);
      const dates = {};
      for (const i of [...new Set(detectedAt.concat([at(read.columns.closedDate), at(read.columns.quarantine)]).filter(i => i >= 0))]) {
        const v = rows.map(r => r[i]), ok = v.map(E.dateOf).filter(Boolean), years = ok.map(d => +d.slice(0, 4));
        dates[header[i]] = [ok.length, v.filter(x => x && !E.dateOf(x)).length, v.filter(x => !x).length,
          years.length ? Math.min(...years) : null, years.length ? Math.max(...years) : null];
      }
      const inv = at(read.columns.inventory), invV = inv < 0 ? [] : rows.map(r => r[inv]);
      const animals = inv < 0 ? null : [header[inv], invV.filter(v => E.inventoryOf(v) !== null).length,
        invV.filter(v => v && E.inventoryOf(v) === null).length, invV.filter(v => !v).length];
      const mark = (i, v) => {
        if (i === at(read.columns.status)) return v ? (T.statusOf(hpai, v) || { label: 'no status' }).label : 'no status';
        if (i === at(read.columns.closed)) return T.isClosed(hpai, v) ? 'closed' : '';
        if (i === at(read.columns.quarantineStatus)) return v ? T.quarantineStatusOf(hpai, v) || 'not read' : '';
        return '';
      };
      const catCols = [...new Set(['status', 'closed', 'disease', 'flockType', 'species', 'quarantineStatus']
        .map(k => at(read.columns[k])).concat(shownAt).filter(i => i >= 0))].sort((a, b) => a - b);
      const categories = {};
      if (rows.length) {
        for (const i of catCols) {
          const counts = new Map();
          rows.forEach(r => counts.set(r[i], (counts.get(r[i]) || 0) + 1));
          // A value in fewer than 2 rows (but the known words) or one that looks private, by its shape; values shown
          // the same are added up.
          const shown = (v, n) => v === '' ? '(blank)' : v.length > 40 ? '(a value of ' + v.length + ' characters)'
            : looksPrivate(v) || (n < 2 && !KNOWN_WORDS.includes(v.toLowerCase())) ? '"' + shapeOf(v) + '"'
            : v.replace(/[\x00-\x1f\x7f]/g, ' ');
          const added = new Map();
          for (const [v, n] of counts) {
            const s = shown(v, n), m = mark(i, v), k = s + ': ' + m;
            if (added.has(k)) added.get(k)[1] += n; else added.set(k, [s, n, m]);
          }
          categories[header[i]] = counts.size > 25 ? counts.size + ' different values: too many to be category words, so not listed'
            : [...added.values()];
        }
      }
      const cc = at(read.columns.county), cv = cc < 0 ? [] : rows.map(r => r[cc]);
      const known = v => v && mapKeys.has(ckey(v));
      const county = cc < 0 ? null : [cv.filter(v => known(v) && mapNames.has(v)).length,
        cv.filter(v => known(v) && !mapNames.has(v) && !/ county$/i.test(v.replace(/\s+/g, ' '))).length,
        cv.filter(v => known(v) && !mapNames.has(v) && / county$/i.test(v.replace(/\s+/g, ' '))).length,
        cv.filter(v => v && !known(v)).length, cv.filter(v => !v).length];
      const reasons = r => read.dropped.filter(d => d.reason === r).length;
      const inBox = p => p.lat >= waBox[0] && p.lat <= waBox[1] && p.lon >= waBox[2] && p.lon <= waBox[3];
      const coords = [read.positives.length, read.positives.filter(p => !inBox(p)).length, read.dropped.length,
        reasons('no coordinates'), reasons('no latitude'), reasons('no longitude'), reasons('coordinates not readable'),
        reasons('latitude and longitude look swapped')];
      const win = E.windowOf(read.positives), g = E.groups(read, win);
      const counts = x => [x.current.length, x.past.length, x.stillQuarantined.length, x.notKnown.length, x.notMapped.length];
      // The views the page opens on today (2.5): both on today, or on the last detection date when that is later.
      const open = E.openingViews(win, day || TODAY);
      const onDay = open ? counts(E.groups(read, open.day)) : null, onRange = open ? counts(E.groups(read, open.range)) : null;
      const monthYear = d => MONTH[+d.slice(5, 7) - 1] + ' ' + d.slice(0, 4);
      return { read, header, rows, ncol: header.length, columns, missing, dates, animals, categories, county, coords,
        groups: counts(g), undated: g.undated.length, end: win ? monthYear(win.end) : null,
        today: open && open.day.end === (day || TODAY) && same(onDay, onRange) ? onDay : null,
        moved: open && open.day.end !== (day || TODAY) ? monthYear(open.day.end) : null, noDay: !open };
    };
    // Nothing from the table but its shape: no Case ID, address, coordinate, county name or full date (the County
    // forms' line names its forms "Name", so no county name is ever in the report, 2.5).
    const leaks = (text, page) => {
      const body = text.split('\r\n').filter(l => !/^Made \d{4}-\d\d-\d\d\./.test(l)).join('\n');
      const ids = page.read.positives.concat(page.read.dropped).map(p => p.id).filter(Boolean);
      const latLon = ['lat', 'lon'].map(k => page.header.indexOf(page.read.columns[k])).filter(i => i >= 0)
        .flatMap(i => page.rows.map(r => r[i])).filter(v => /\d\.\d/.test(v));
      return ids.filter(v => body.includes(v)).concat(latLon.filter(v => body.includes(v)),
        countyNames.filter(n => new RegExp('\\b' + n + '\\b', 'i').test(body)),
        (body.match(/MARKED-ADDRESS|\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g) || [])
          .filter(m => !/^[9/-]+$/.test(m)),   // an unread date's shape (each digit a 9) is not a date
        // A date written with its month's name, from the table's own cells (the report writes today's date so).
        page.rows.flat().filter(v => MONTH_DAY.test(v) && body.includes(v)));
    };

    const TABLES = ['em_positives_agreed.csv', 'em_positives_times.csv', 'em_positives_agreed_header.csv',
      'em_positives_tool.csv', 'em_positives_demo.csv', 'em_positives_one_marker.csv', 'em_positives_no_date.csv',
      'em_sample_positives.csv', 'em_rules_positives.csv', 'em_rules_agreed.csv', 'em_rules_overview.csv',
      'em_rules_quarantine.csv', 'em_rules_closed_day.csv', 'em_table_check_edge.csv'];
    for (const name of TABLES) {
      const file = path.join(FXD, name), page = pageOf(file), run = runCheck(file);
      check(!run.failed, 'table check: ' + name + ': R ran and the table is unchanged', run.failed);
      // The closed positives by their closing day (2.5): the Close Date (whatever the Status), else the release date
      // on or before today, else not known; the three add up to those closed by either column.
      const days = /^ {2}of the mapped closed positives: closed on their Close Date (\d+), on their release date (\d+), on a day not known (\d+)$/m
        .exec(run.text || '');
      const mappedClosed = page.read.positives.filter(p => p.closed || p.closedDate);
      const pageDays = !page.read.columns.closed ? null : [mappedClosed.filter(p => p.closedDate).length,
        mappedClosed.filter(p => !p.closedDate && p.quarantine && !p.releaseAfterToday).length,
        mappedClosed.filter(E.closedDayNotKnown).length];
      check(same(days ? days.slice(1).map(Number) : null, pageDays),
        'table check: ' + name + ': the closed positives by their closing day (Close Date, release date, not known), as the page',
        { r: days && days.slice(1), page: pageDays });
      if (run.failed) continue;
      const r = reportOf(run.text);
      check(page.read.type.id === 'hpai' && r.rows === page.rows.length && r.ncol === page.ncol && same(r.columns, page.columns)
        && same(r.missing, page.missing), 'table check: ' + name + ': the rows, each column\'s role and blank cells, the columns not found',
      { r: [r.rows, r.ncol, r.columns.filter((c, i) => !same(c, page.columns[i])), r.missing], page: [page.rows.length, page.missing] });
      check(same(r.dates, page.dates) && same(r.animals, page.animals), 'table check: ' + name + ': each date column read, not read and blank, its years; the animals read',
        { r: [r.dates, r.animals], page: [page.dates, page.animals] });
      const sortCats = c => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, typeof v === 'string' ? v
        : v.slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))]));
      check(same(sortCats(r.categories), sortCats(page.categories)), 'table check: ' + name + ': each category value, its rows and how the page reads it',
        { r: r.categories, page: page.categories });
      check(same(r.county, page.county) && same(r.coords, page.coords), 'table check: ' + name + ': the County forms; the coordinates mapped and why not',
        { r: [r.county, r.coords], page: [page.county, page.coords] });
      check(same(r.groups, page.groups) && r.undated === page.undated && r.end === page.end,
        'table check: ' + name + ': active, closed, still under quarantine, not known and not mapped on the last detection date (as the page)',
        { r: [r.groups, r.undated, r.end], page: [page.groups, page.undated, page.end] });
      check(page.noDay ? r.noDay && r.today === null : page.today !== null && same(r.today, page.today) && r.todayWords === 'October 30, 2026' && !r.noDay,
        'table check: ' + name + ': the counts the page opens on today (Oct 30, 2026), in both views, as the page',
        { r: [r.today, r.todayWords, r.noDay], page: [page.today, page.noDay] });
      check(!leaks(run.text, page).length && !/[^\r]\n/.test(run.text), 'table check: ' + name + ': no Case ID, address, coordinate, county name or full date; Windows line ends',
        leaks(run.text, page));
    }
    // The edge table, as written in the fixture: each case named.
    const edge = reportOf(runCheck(path.join(FXD, 'em_table_check_edge.csv')).text || '');
    check(edge.rows === 17 && same(edge.groups, [8, 5, 2, 2, 4]) && edge.undated === 2 && same(edge.coords, [13, 0, 4, 1, 1, 0, 1, 1])
      && same(edge.county, [13, 2, 1, 1, 0]) && same(edge.dates['Confirmed Diagnosis'], [15, 2, 0, 2026, 2026])
      && same(edge.dates['Close Date'], [4, 1, 12, 2026, 2026]) && same(edge.animals, ['Flock/Herd Inventory', 15, 2, 0])
      && edge.columns[0].length === 3 && edge.columns.find(c => c[0] === 'Location Notes')[1] === 'never read (private)'
      && edge.columns.find(c => c[0] === 'Depop Inventory')[2] === '17',
    'table check: the edge table: 17 rows (the empty one not counted), 8 current, 5 past (2 still under quarantine, 2 not known), 4 not mapped, 2 without a date; an unquoted NA blank',
    edge);
    const edgeText = fs.readFileSync(path.join(OUTD, 'em_table_check_edge.txt'), 'utf8');
    check(/not read, written as: "9\.9\.9999" 1, "99999" 1/.test(edgeText) && /not read, written as: "99\/99\/9999" 1/.test(edgeText)
      && /written M\/D\/YYYY 11, M\/D\/YYYY with a time 2, YYYY-MM-DD 1, YYYY\/M\/D 1/.test(edgeText)
      && /"aa aaaa": 1 \(not read\)/.test(edgeText) && !/on hold/.test(edgeText) && /\(a value of 54 characters\): 1/.test(edgeText)
      && /Rows below the header: 17 \(1 empty row not counted, as the page skips them\)/.test(edgeText),
    'table check: the edge table: unread dates by their shape only, the forms read, an unread quarantine status in one row by its shape, a long value counted not shown', edgeText.slice(0, 300));

    // Made here: a table whose groups change after its last detection (Sep 1, 2026): a positive closed Sep 15 and
    // released Oct 1, one closed Oct 20 (no release date: still under quarantine), one closing Nov 15, one closed
    // by its Status with no Close Date and a release on Dec 1: on a day the page opens on before Dec 1 that date
    // cannot be when it closed, so it is closed on every day; opened in 2030, it is active until Dec 1 (2.5). The
    // day the page opens on decides; a day before the last detection opens on that date.
    const later = path.join(OUTD, 'groups_after.csv');
    fs.writeFileSync(later, ['Case ID,Confirmed Diagnosis,Latitude,Longitude,Status,Close Date,Quarantine Release',
      'SYN-L-01,8/1/2026,46.55,-120.47,Closed,9/15/2026,10/1/2026', 'SYN-L-02,9/1/2026,46.60,-120.50,Closed,10/20/2026,',
      'SYN-L-03,7/1/2026,46.61,-120.51,Open,11/15/2026,', 'SYN-L-04,6/1/2026,46.62,-120.52,Closed,,12/1/2026'].join('\n') + '\n');
    const laterRuns = ['2026-09-20', TODAY, '2030-01-01', '2026-08-01'].map(day => {
      const run = runCheck(later, day);
      return { day, page: pageOf(later, day), r: run.text ? reportOf(run.text) : {} };
    });
    check(same(laterRuns.map(x => x.r.groups), [[3, 1, 1, 0, 0], [3, 1, 1, 0, 0], [4, 0, 0, 0, 0], [3, 1, 1, 0, 0]])
      && laterRuns.every(x => same(x.r.groups, x.page.groups))
      && same(laterRuns.slice(0, 3).map(x => x.r.today), [[2, 2, 2, 0, 0], [1, 3, 2, 0, 0], [0, 4, 2, 0, 0]])
      && laterRuns.slice(0, 3).every(x => same(x.r.today, x.page.today))
      && same(laterRuns.slice(0, 3).map(x => x.r.todayWords), ['September 20, 2026', 'October 30, 2026', 'January 1, 2030'])
      && laterRuns[3].r.today === null && same(laterRuns[3].r.afterToday, ['August 1, 2026', 'September 2026'])
      && laterRuns[3].page.moved === 'September 2026',
    'table check: groups that change after the last detection: on Sep 20 2 active, 2 closed; on Oct 30 1 and 3; in 2030 0 and 4 (as the page); closed by Status with a release after the day closed on every day, before the release active once it is past; a day before the last detection opens on it',
      laterRuns.map(x => [x.day, x.r.groups, x.r.today, x.page.today, x.r.afterToday]));

    // Made here: a column of 30 different values (counted, not listed) and a table without its header row.
    const many = path.join(OUTD, 'many_values.csv');
    fs.writeFileSync(many, ['Case ID,Confirmed Diagnosis,Latitude,Longitude,Production Type']
      .concat(Array.from({ length: 30 }, (x, k) => `SYN-M-${k},9/${k % 28 + 1}/2026,46.5,-120.4,Kind ${k}`)).join('\n') + '\n');
    const manyText = runCheck(many).text || '';
    check(/^ {2}Production Type\s+30 different values: too many to be category words, so not listed$/m.test(manyText)
      && !/Kind \d/.test(manyText), 'table check: a column of 30 different values is counted, its values not listed', manyText.slice(-600));
    const headless = path.join(OUTD, 'no_header.csv');
    fs.writeFileSync(headless, 'SYN-H-01,9/3/2026,46.5520,-120.4700,Yakima\nSYN-H-02,9/4/2026,46.4010,-120.3150,Benton\n');
    const headlessText = runCheck(headless).text || '';
    check(/The first row does not look like the header/.test(headlessText) && /^Column 1\s+not used/m.test(headlessText)
      && !/SYN-H|46\.5520|Yakima|Benton|9\/3\/2026/.test(headlessText),
    'table check: a table without its header row: the columns by their place only, no cell shown', headlessText.slice(0, 600));
    // A table without its header row whose first row ends in a Yes/No cell: "Y" is a latitude's name, but a one-letter
    // name alone does not make the row a header.
    const headlessY = path.join(OUTD, 'no_header_y.csv');
    fs.writeFileSync(headlessY, 'SYN-H-01,9/3/2026,46.5520,-120.4700,Yakima,Y\n');
    const headlessYText = runCheck(headlessY).text || '';
    check(/The first row does not look like the header/.test(headlessYText) && /^Column 6\s/m.test(headlessYText)
      && !/SYN-H|46\.5520|120\.4700|Yakima|9\/3\/2026/.test(headlessYText),
    'table check: a table without its header row and a "Y" in its first row: still by place only, no cell shown', headlessYText.slice(0, 600));
    // Words typed into the category columns that are not category words: a name in one row, a date beside a status
    // word, a county's name in two rows, a coordinate, a Case ID in two rows; a column named with a date. Each by its shape (the
    // column by its place); the common words as written.
    const typed = path.join(OUTD, 'typed_categories.csv');
    fs.writeFileSync(typed, ['Case ID,Confirmed Diagnosis,Latitude,Longitude,County,Status,Production Type,Flock/Herd Type,Species,Quarantine Status,Note 9/3/2026',
      'SYN-T-01,9/3/2026,46.55,-120.47,Yakima,Closed 10/1/2026,Smith Farm backyard,Commercial,Chicken,Released 10/2/2026,',
      'SYN-T-02,9/5/2026,46.60,-120.50,Yakima,Open,Benton line,46.6012,Chicken,,',
      'SYN-T-03,9/6/2026,46.61,-120.51,Yakima,Open,Benton line,Commercial,SYN-T-01,Pending,',
      'SYN-T-04,9/7/2026,46.62,-120.52,Yakima,Closed,Commercial,Commercial,SYN-T-01,Pending,'].join('\n') + '\n');
    const typedPage = pageOf(typed), typedRun = runCheck(typed), typedText = typedRun.text || '';
    const typedR = typedRun.text ? reportOf(typedText) : {};
    check(!typedRun.failed && !leaks(typedText, typedPage).length && !/Smith|Farm|Released 10|Closed 10|46\.6012/.test(typedText)
      && /"aaaaa aaaa aaaaaaaa": 1/.test(typedText) && /^ {2}Status\s+Open: 2, Closed: 1 \(closed\), "aaaaaa 99\/9\/9999": 1$/m.test(typedText)
      && /"aaaaaaaa 99\/9\/9999": 1 \(not read\)/.test(typedText) && /Pending: 2 \(not read\)/.test(typedText)
      && /"aaa-a-99": 2/.test(typedText) && /"99\.9999": 1/.test(typedText) && /"aaaaaa aaaa": 2/.test(typedText)
      && /^Column 11 \(name not shown\)\s+not used/m.test(typedText)
      && same(typedR.columns, typedPage.columns),
    'table check: words typed into the category columns (a name, a date, a county, a coordinate, a Case ID) by their shape only; the common words as written',
      typedText.split('\r\n').filter(l => /^ {2}(Status|Production|Flock|Species|Quarantine)/.test(l)));
    check(same(Object.fromEntries(Object.entries(typedR.categories || {}).map(([k, v]) => [k, v.slice().sort()])),
      Object.fromEntries(Object.entries(typedPage.categories).map(([k, v]) => [k, v.slice().sort()]))),
    'table check: words typed into the category columns: the values as shown equal the page model\'s', [typedR.categories, typedPage.categories]);
    // Dates written with their month's name, each in two rows (so not left out as a one-row value): by their shape.
    const worded = path.join(OUTD, 'worded_dates.csv');
    fs.writeFileSync(worded, ['Case ID,Confirmed Diagnosis,Latitude,Longitude,County,Status,Production Type,Species',
      'SYN-W-01,9/3/2026,46.55,-120.47,Yakima,Open,"Oct 5, 2026",5 October',
      'SYN-W-02,9/5/2026,46.60,-120.50,Yakima,Open,"Oct 5, 2026",5 October',
      'SYN-W-03,9/6/2026,46.61,-120.51,Yakima,Open,October 2026,Chicken',
      'SYN-W-04,9/7/2026,46.62,-120.52,Yakima,Open,October 2026,Chicken'].join('\n') + '\n');
    const wordedPage = pageOf(worded), wordedRun = runCheck(worded), wordedText = wordedRun.text || '';
    check(!wordedRun.failed && !leaks(wordedText, wordedPage).length && !/Oct 5|5 October/.test(wordedText)
      && /"aaa 9, 9999": 2/.test(wordedText) && /"9 aaaaaaa": 2/.test(wordedText) && /October 2026: 2/.test(wordedText),
    'table check: a date written with its month\'s name, in two rows, by its shape only; a month and year alone as written',
      wordedText.split('\r\n').filter(l => /^ {2}(Production|Species)/.test(l)));
  }

  console.log(`Emergency unit tests: ${pass} passed, ${fail} failed`);
  for (const f of failures) console.log('  FAIL ' + f);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
