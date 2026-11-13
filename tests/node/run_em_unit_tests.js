#!/usr/bin/env node
'use strict';
// Emergency Response unit tests (Node >= 22, no packages): the rules (site/emergency/rules.js) against the R
// reference (tests/oracle/em_oracle.R, local-test-artifacts/em/oracle_em.json), the emergency types (types.js, the HPAI
// type and the made-up third type in tests/synthetic/em_made_up_type.js), the dataset list (site/emergency/datasets.js)
// and its recognition through the shared recognize.js (positives by their marker columns, the collision cases, the
// zone kind and the shapefile reason), the Emergency sample, bundle.json's shared entries, the guide's Emergency
// part and the chart (site/emergency/chart.js, its copied text widths and axis breaks against CVI's chartsvg.js), the
// HPAI update's figures (site/emergency/report.js, 2.9) by hand and against the R reference, and
// the work-PC table check (tools/work-pc/check_hpai_table.R, run with Rscript) against the page's counts. The page's
// own files run unchanged in Node.
// Usage (repository root): node tests/node/run_em_unit_tests.js   (also writes the fixtures, make_em_fixtures.js)
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const SITE = path.join(ROOT, 'site');
for (const f of ['cvi/app/csv.js', 'cvi/app/master.js', 'cvi/app/scaling.js', 'cvi/app/summary.js', 'cvi/app/lookup.js',
  'shared/zip.js', 'shared/load.js', 'shared/recognize.js', 'shared/bundle.js', 'shared/checklist.js',
  'shared/sample.js', 'shared/guide.js', 'shared/zones.js', 'shared/proximity.js', 'shared/facility-datasets.js',
  'cvi/datasets.js', 'infrastructure/datasets.js', 'emergency/datasets.js', 'emergency/sample.js', 'emergency/message-icons.js',
  'emergency/types.js', 'emergency/types/hpai.js', 'emergency/types/nws.js', 'emergency/rules.js', 'emergency/report.js', 'emergency/report-form.js', 'emergency/chart.js']) {
  require(path.join(SITE, f));
}
// The Overview's map data, as the page loads them: the county shapes and the 2020 Census tracts, decoded by
// population.js (its window globals land on globalThis here).
globalThis.window = globalThis.window || globalThis;
for (const f of ['shared/population.js', 'geo/wa-counties.js', 'geo/tracts-wa.js', 'shared/facilities.js']) require(path.join(SITE, f));
const { recognize: R, bundle: B, checklist: C, guide: G, zones: Z, emergencyTypes: T, emergencyRules: E,
  proximity: PX, emergencyReport: RP, emergencyReportForm: RF } = globalThis.WSDA;
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
  check(same(hpai.kinds.map(k => [k.key, k.label, k.word, k.nameEach]), [['birds', 'Birds', 'birds', false], ['cattle', 'Cattle', 'cattle', false],
    ['other', 'Other animals', 'other animals', true]]) && same(hpai.kinds[1].words, hpai.layers.bySpecies[1].words)
    && hpai.layers.bySpecies[0].words.every(w => hpai.kinds[0].words.includes(w))
    && ['pigeon', 'dove', 'waterfowl', 'swan'].every(w => hpai.kinds[0].words.includes(w))
    && ['goat', 'sheep', 'swine', 'horse', 'alpaca', 'mink', 'cat', 'dog', 'pig', 'seal', 'fox', 'raccoon', 'skunk', 'bear'].every(w => hpai.kinds[2].words.includes(w)),
  'HPAI: three kinds (2.8), birds first (their words hold the bird layers\' and "pigeon"), cattle by the same words as its cattle layers, then other mammals each named, "pig" and "seal" among them', hpai.kinds);
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
  bad(t => { t.inventoryWord = 'birds'; }, /"inventoryWord" should be left out: the animals are listed in "kinds"/, '2.7\'s inventoryWord');
  bad(t => { t.countedApart = []; }, /"countedApart" should be left out: the animals are listed in "kinds"/, '2.7\'s countedApart');
  bad(t => { t.kinds = []; }, /"kinds" should be a list of one or more kinds of animal/, 'no kinds');
  bad(t => { t.kinds = { key: 'birds' }; }, /"kinds" should be a list of one or more kinds of animal/, 'kinds not a list');
  bad(t => { t.kinds[1] = 'cattle'; }, /"kinds\[1\]" should be a kind of animal in \{ \}/, 'a kind that is a word');
  bad(t => { t.kinds[1].key = 'Dairy Cattle'; }, /"kinds\[1\]\.key" should be a short key/, 'a kind key with capitals and spaces');
  bad(t => { t.kinds[2].key = 'birds'; }, /"kinds\[2\]\.key" should be a key no other kind has \("birds" is used twice\)/, 'two kinds with one key');
  bad(t => { delete t.kinds[0].label; }, /"kinds\[0\]\.label" should be a text/, 'a kind with no label');
  bad(t => { t.kinds[1].word = ' '; }, /"kinds\[1\]\.word" should be a text/, 'a kind with an empty word');
  bad(t => { t.kinds[1].words = []; }, /"kinds\[1\]\.words" should be a list of one or more words/, 'a kind before the last with no words');
  bad(t => { t.kinds[2].nameEach = 'yes'; }, /"kinds\[2\]\.nameEach" should be true or false/, 'nameEach as a word');
  bad(t => { t.kinds[2].words.push('Dairy'); }, /"kinds\[2\]\.words" should be words no earlier kind has \("dairy" is in kinds\[1\], "Cattle", too\)/, 'a word in two kinds');
  // The printed update's words (2.9): optional, each checked; a type without them has no Report view.
  bad(t => { t.report = 'HPAI update'; }, /"report" should be the printed update's words, in \{ \}/, 'report words that are a word');
  bad(t => { delete t.report.title; }, /"report\.title" should be a text/, 'a report with no title');
  bad(t => { t.report.cases.pigs = ['pig farm', 'pig farms']; }, /"report\.cases\.pigs" should be a kind's key \(birds, cattle, other\)/, 'case words for a kind the type does not have');
  bad(t => { t.report.cases.birds = ['flock']; }, /"report\.cases\.birds" should be two words: for one case and for more/, 'one case word only');
  bad(t => { t.report.livestock = 'dairy'; }, /"report\.livestock" should be a kind's key/, 'a livestock kind the type does not have');
  bad(t => { delete t.report.status.free; }, /"report\.status\.free" should be a text/, 'no "free" status wording');
  bad(t => { t.report.milk = []; }, /"report\.milk" should be a list of one or more milk testing stages/, 'no milk testing stage');
  bad(t => { t.report.map.url = 'http://arcg.is/05KT8S'; }, /"report\.map\.url" should be an https:\/\/ address/, 'an outbreak map over http');
  bad(t => { t.report.messages[0].link = { label: 'Defend the Flock' }; }, /"report\.messages\[0\]\.link\.url" should be an https:\/\/ address/, 'a message link without an address');
  bad(t => { delete t.report.messages[1].headline; }, /"report\.messages\[1\]\.headline" should be a text/, 'a message without a headline');
  bad(t => { t.report.messages[2].icon = 'bell'; }, /"report\.messages\[2\]\.icon" should be the name of a message icon/, 'a message icon that is not one');
  bad(t => { t.report.messages[0].icon = 'constructor'; }, /"report\.messages\[0\]\.icon" should be the name of a message icon/, 'a message icon named after an object\'s own field');
  bad(t => { delete t.report.messages[1].icon; }, /"report\.messages\[1\]\.icon" should be the name of a message icon/, 'a message without an icon');
  // Page 2's words (2.9): the sources over https; a list's link https or mailto:; the box's parts a list.
  bad(t => { t.report.page2.national.source = 'http://www.aphis.usda.gov/'; }, /"report\.page2\.national\.source" should be an https:\/\/ address/, 'page 2: a source over http');
  bad(t => { t.report.page2.resources[0].links[1].url = 'avhealth@agr.wa.gov'; }, /"report\.page2\.resources\[0\]\.links\[1\]\.url" should be an https:\/\/ or mailto: address/,
    'page 2: a list\'s email address without mailto:');
  bad(t => { t.report.page2.call[0].link.url = 'mailto:a@b.c'; }, /"report\.page2\.call\[0\]\.link\.url" should be an https:\/\/ address/, 'page 2: the box\'s link a mailto: (a page only)');
  bad(t => { t.report.page2.call = []; }, /"report\.page2\.call" should be the "Report sick birds" box's parts, a list/, 'page 2: no "Report sick birds" box');
  bad(t => { delete t.report.page2.testing.lists[1].name; }, /"report\.page2\.testing\.lists\[1\]\.name" should be a text/, 'page 2: a link list without its heading');
  bad(t => { t.report.page2.testing.categories = 'Wild Birds'; }, /"report\.page2\.testing\.categories" should be a list of category names/, 'page 2: the categories not a list');
  {
    const t = good(); t.id = 'test-no-page2'; delete t.report.page2;
    const p = hpai.report.page2;
    check(T.check(t).report.page2 === null && p.resources[0].links[1].url === 'mailto:avhealth@agr.wa.gov' && p.testing.categories.length === 8
      && same(p.testing.lists.map(g => g.name + ' ' + g.links.length), ['Avian influenza testing information 4', 'Quick links 3'])
      && same(p.resources.map(g => g.name + ' ' + g.links.length), ['Animal health 4', 'Wild birds and wildlife 4', 'Public health 2']) && p.call.length === 2,
    'types: page 2\'s words: none is fine (no page 2); HPAI\'s from the update of September 1, 2026 (8 categories, the lists, the box\'s two parts)', p);
  }
  {
    const t = good();
    t.id = 'test-report'; delete t.report.livestock; t.report.messages[0].link = null; delete t.report.messages[1].link;
    const c = T.check(t), plain = good(); plain.id = 'test-no-report'; delete plain.report;
    check(c.report.livestock === null && c.report.messages[0].link === null && c.report.messages[1].link === null
      && c.report.messages[2].highlight === true && c.report.messages[0].highlight === false && T.check(plain).report === null
      && T.get('nws').report === null && hpai.report.messages.length === 3 && hpai.report.cases.cattle[1] === 'dairy herds',
      'types: report words: no livestock kind, a message without a link and a type without a report (New World screwworm\'s) are fine', c.report);
  }
  {   // The key messages' icons (2.9, message-icons.js): 44 in six groups, each in both styles, from the sets passed.
    const MI = globalThis.WSDA.emergencyMessageIcons, keys = Object.keys(MI.ICONS), gs = MI.groups();
    check(keys.length === 44 && gs.map(g => g.name + ' ' + g.icons.length).join(', ') === 'General 16, Animals 13, Farm and dairy 3, ' +
      'Biosecurity and testing 5, Rules and events 2, Contact and places 5' && gs[1].icons[1].key === 'turkey' && gs[1].icons[1].label === 'Turkey',
      'message icons: 44 in the form\'s six groups, in order', gs.map(g => g.name + ' ' + g.icons.length));
    const from = s => { const n = {}; for (const k of keys) { const w = MI.ICONS[k][s].from.replace(/,.*$/, ''); n[w] = (n[w] || 0) + 1; } return n; };
    const drawnKeys = keys.filter(k => MI.ICONS[k].filled.from === 'drawn for this page' && MI.ICONS[k].outline.from === 'drawn for this page');
    check(same(from('filled'), { OCHA: 18, 'Phosphor fill': 17, 'Healthicons filled': 5, 'drawn for this page': 4 })
      && same(from('outline'), { Phosphor: 35, Healthicons: 5, 'drawn for this page': 4 }) && drawnKeys.join() === 'turkey,sheep,goat,silo',
      'message icons: Filled from OCHA 18, Phosphor fill 17, Healthicons 5; Outline from Phosphor 35, Healthicons 5; turkey, sheep, goat and silo drawn in both',
      [from('filled'), from('outline'), drawnKeys]);
    const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+eE-]+$/, wrong = [];
    for (const k of keys) for (const s of MI.STYLES) {
      const ic = MI.ICONS[k][s], box = ic.box.split(' ').map(Number), out = MI.svg(k, s, 22);
      const ok = box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0 && ic.parts.length > 0
        && ic.parts.every(p => PATH.test(p[0]) && (p.length === 1 || p[1] === 'e' || (typeof p[1] === 'number' && p[1] > 0)))
        && out.startsWith('<svg class="em-ic" viewBox="' + ic.box + '" width="22" height="22"') && (out.match(/<path /g) || []).length === ic.parts.length
        && (out.match(/fill-rule="evenodd"/g) || []).length === ic.parts.filter(p => p[1] === 'e').length
        && (out.match(/stroke-width="/g) || []).length === ic.parts.filter(p => typeof p[1] === 'number').length;
      if (!ok) wrong.push(k + ' ' + s);
    }
    check(!wrong.length, 'message icons: every icon draws in both styles: its own grid, each shape a path, its fill rule and lines kept', wrong);
    check(MI.svg('cow', 'filled', 16) !== MI.svg('cow', 'outline', 16) && MI.svg('cow', 'sideways', 16) === MI.svg('cow', 'filled', 16)
      && MI.svg('cow', undefined, 16) === MI.svg('cow', 'filled', 16) && MI.svg('cow').includes('width="22"')
      && MI.svg('bell', 'filled') === '' && (() => { try { return MI.svg('toString'); } catch (e) { return 'threw'; } })() === ''
      && !MI.has('constructor') && !MI.has(undefined) && MI.has('silo'),
      'message icons: Filled unless "outline", 22 pixels unless sized; a name that is not an icon draws nothing');
    check(hpai.report.messages.map(m => m.icon).join() === 'shield-check,person,truck' && MI.has('droplet'),
      'message icons: HPAI\'s three messages and the livestock card (droplet) name icons that exist');
  }
  {   // The last kind may have no words (it takes every species no other kind names); a kind's word defaults to its label.
    const t = good();
    t.id = 'test-kinds'; t.kinds = [{ key: 'birds', label: 'Birds', words: ['bird'] }, { key: 'rest', label: 'Every other animal' }];
    delete t.report;   // its case words name kinds this test type does not have
    const c = T.check(t);
    check(same(c.kinds, [{ key: 'birds', label: 'Birds', word: 'birds', words: ['bird'], nameEach: false },
      { key: 'rest', label: 'Every other animal', word: 'every other animal', words: [], nameEach: false }]),
    'types: the last kind may name no species; a kind\'s count word is its label in lowercase when left out', c.kinds);
  }
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
  check(same(T.problems().slice(-1), [{ file: null, message: 'Emergency type "hpai" is added twice' }]) && same(T.files(), [])
    && T.list().filter(t => t.id === 'hpai').length === 1,
  'types: a refused type is noted with its message for the page\'s red notice (no file outside a page), and not added (2.8)', T.problems());
  {   // A type that names no columns takes E1a's names; the unit "mi" is accepted.
    const t = good();
    t.id = 'test-defaults'; delete t.columns; delete t.closed.dateColumn; delete t.kinds; delete t.title; delete t.report;
    t.closed.column = 'Surveillance Closed'; t.zones.unit = 'mi';
    const c = T.check(t);
    check(same(c.columns, { id: ['AnimalDiseaseReportId'], detected: ['Detection Date'], disease: ['Disease Name'], status: [],
      quarantine: [], quarantineStatus: [], flockType: [], inventory: [], shown: [] }) && same(c.closed.column, ['Surveillance Closed'])
      && same(c.closed.dateColumn, []) && c.zones.unit === 'mi' && same(c.kinds, T.KINDS) && c.kinds[0].word === 'animals' && c.title === 'HIGHLY PATHOGENIC AVIAN INFLUENZA (HPAI) RESPONSE MAP',
    'types: no columns field: E1a\'s names, no flock type or inventory; one closed column as text; no closed date; miles; one kind, "Animals"', c.columns);
  }

  // The second type: New World screwworm (site/emergency/types/nws.js).
  const nws = T.get('nws');
  check(nws.name === 'New World screwworm (NWS)' && same(nws.diseaseWords, ['screwworm', 'nws', 'cochliomyia', 'hominivorax', 'myiasis']),
    'NWS: name and disease words', nws.diseaseWords);
  check(same(nws.statuses.map(s => s.label), ['Confirmed', 'Presumptive']) && same(nws.columns, hpai.columns)
    && same(nws.closed, hpai.closed), 'NWS: two statuses (no suspect group); HPAI\'s column names until its own are known', nws.statuses);
  check(same(nws.kinds, T.KINDS), 'NWS: one kind, "Animals", counted as animals', nws.kinds);
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
  check(same(made.kinds.map(k => [k.key, k.label, k.word]), [['head', 'Head of stock', 'head']]) && same(made.columns.flockType, ['Herd Kind']) && same(made.columns.inventory, ['Herd Size']),
    'third type: its own flock type and inventory columns, and its own kind of animal', made.columns);

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
  {   // 2.8: the facility layers through the shared select, as the page keeps them (rules.js layersOf): each point
    // keeps its ID and filter values; an attribute pick keeps only the matching points, each with its own row's
    // precision columns (a blank line in the file does not shift them).
    const FAC = globalThis.WSDA.facilities, parse = globalThis.CVIWA.csv.parse;
    const manifest = parse('key,file,name_col,label,group\npoultry,p.csv,name,Commercial Poultry,Dairy & Producers\n');
    const file = parse('name,lat,long,Type,geocode_precision,match_status\nFarm A,46.6,-120.5,Layers,rooftop,Matched\n\n' +
      'Farm B,46.61,-120.49,Broilers,street,Matched\nFarm C,46.62,-120.48,Layers,city,Matched\n');
    const prepared = FAC.prepare({ poultry: file }, manifest, globalThis.CVIWA_GEO.counties, 1);
    const precision = { poultry: E.precisionRows(file.header, file.rows) };
    const all = E.layersOf(FAC.select(prepared, { layers: ['poultry'], attributes: {} }), precision).poultry;
    const picked = E.layersOf(FAC.select(prepared, { layers: ['poultry'], attributes: { poultry: { Type: ['Layers'] } } }),
      precision).poultry;
    const precOf = l => l.points.map(p => p.name + ':' + p.precision.geocode_precision);
    check(all.label === 'Commercial Poultry' && same(precOf(all), ['Farm A:rooftop', 'Farm B:street', 'Farm C:city'])
      && all.points.every(p => typeof p.id === 'string' && p.id && p.values && /^(Layers|Broilers)$/.test(p.values.Type)),
    'layers (2.8): every point through the shared select, with its ID, its filter values and its own precision columns', all);
    check(same(precOf(picked), ['Farm A:rooftop', 'Farm C:city']) && same(picked.points.map(p => p.id), [all.points[0].id, all.points[2].id]),
    'layers (2.8): an attribute pick (Type: Layers) keeps only the matching points, each with its own precision columns', picked);
    check(same(Object.keys(E.layersOf(FAC.select(prepared, { layers: [], attributes: {} }), precision)), []),
    'layers (2.8): a layer not asked for is not kept');
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
    // A layer left with no site: by its filters (2.8), or by its file.
    const emptyLayer = { label: 'Premise PINs by Species', inside: 0, usable: 0, nearest: null };
    check(E.countLine(emptyLayer, 'km', true) === 'Premise PINs by Species: none inside (no sites match the filters)'
      && E.countLine(emptyLayer, 'km', false) === 'Premise PINs by Species: none inside (no usable locations)',
    'rules: a layer whose filters leave no site says so, not "no usable locations"', [E.countLine(emptyLayer, 'km', true), E.countLine(emptyLayer)]);
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
    check(same(agByLine.map(p => p.size), ['Large', 'Small', 'Large', 'Medium', 'Large', 'Small', null, 'Small', 'Large', 'Large', 'Small', 'Small']),
      'flock size classes from the inventories (99 Small, 100 Medium, 1,000 and 1,001 Large; blank none)', agByLine.map(p => p.size));
    check(E.inventoryOf('1,250,000') === 1250000 && E.inventoryOf(' 2,400 ') === 2400 && E.inventoryOf('35') === 35 && E.inventoryOf('0') === 0
      && E.inventoryOf('') === null && E.inventoryOf('1,25') === null && E.inventoryOf('12,3456') === null && E.inventoryOf('-5') === null
      && E.inventoryOf('about 40') === null, 'inventories: thousands commas read; a blank or unreadable one is none, never zero');
    check(E.sizeClass(99) === 'Small' && E.sizeClass(100) === 'Medium' && E.sizeClass(999) === 'Medium' && E.sizeClass(1000) === 'Large'
      && E.sizeClass(1001) === 'Large'
      && E.sizeClass(0) === 'Small' && E.sizeClass(null) === null, 'size classes at their edges (2.9: 1,000 Large)');
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
    // The kinds of animal (2.8, option E): the first kind with a word in the species, birds first; a species no kind
    // names is the last kind and unlisted; "Other animals" named species by species.
    const kindIs = (type, species) => { const k = E.kindOf(type, { species }); return [k.kind.key, k.named, k.one, k.unlisted]; };
    check(same(kindIs(hpai, 'Racing Pigeon'), ['birds', 'birds', 'birds', false]) && same(kindIs(hpai, 'Pig'), ['other', 'pigs', 'pig', false])
      && same(kindIs(hpai, 'Harbor Seal'), ['other', 'seals', 'seal', false]) && same(kindIs(hpai, 'Red  Fox'), ['other', 'foxes', 'fox', false])
      && same(kindIs(hpai, 'Gray wolf'), ['other', 'wolves', 'wolf', false]) && same(kindIs(hpai, 'Meat Goat'), ['other', 'goats', 'goat', false])
      && same(kindIs(hpai, 'Sheep'), ['other', 'sheep', 'sheep', false]) && same(kindIs(hpai, 'Dairy'), ['cattle', 'cattle', 'cattle', false])
      && same(kindIs(hpai, 'Opossum'), ['other', 'opossums', 'opossum', true]) && same(kindIs(hpai, 'Bobcat'), ['other', 'bobcats', 'bobcat', true])
      && same(kindIs(hpai, ''), ['birds', 'birds', 'birds', false]) && same(kindIs(hpai, null), ['birds', 'birds', 'birds', false])
      && same(kindIs(hpai, 'Pigeon'), ['birds', 'birds', 'birds', false]) && same(kindIs(hpai, 'Pigeons and doves'), ['birds', 'birds', 'birds', false])
      && same(kindIs(nws, 'Opossum'), ['animals', 'animals', 'animals', false]) && same(kindIs(nws, 'Cattle'), ['animals', 'animals', 'animals', false]),
    'kinds: "pigeon" a bird though "pig" starts it; pig, seal, fox, wolf and goat other animals each by its own word; no species birds; a species no kind names (Opossum; "cat" does not start "Bobcat") other animals, unlisted; screwworm\'s one kind never unlisted');
    // A species naming two kinds is both: mixed, its animals "animals", both marks.
    const mixedIs = (type, species) => { const k = E.kindOf(type, { species });
      return [E.kindKeysOf(type, { species }).join('+'), k.kind.key, k.mixed, k.named, k.one, E.animalShapesOf(type, { species }).join('+')]; };
    check(same(mixedIs(hpai, 'Cattle, Chicken'), ['birds+cattle', 'birds', true, 'animals', 'animal', 'circle+square'])
      && same(mixedIs(hpai, 'Chicken and cattle'), ['birds+cattle', 'birds', true, 'animals', 'animal', 'circle+square'])
      && same(mixedIs(hpai, 'Pigeon, pig'), ['birds+other', 'birds', true, 'animals', 'animal', 'circle+triangle'])
      && same(mixedIs(hpai, 'Chicken, goat, dairy cow'), ['birds+cattle+other', 'birds', true, 'animals', 'animal', 'circle+square+triangle'])
      && same(mixedIs(hpai, 'Dairy cattle'), ['cattle', 'cattle', false, 'cattle', 'cattle', 'square'])
      && same(mixedIs(hpai, 'Racing Pigeon'), ['birds', 'birds', false, 'birds', 'birds', 'circle'])
      && E.inventoryWordOf(hpai, { species: 'Cattle, Chicken', inventory: 400 }) === 'animals (birds and cattle)'
      && E.inventoryWordOf(hpai, { species: 'Pigeon, pig', inventory: 1 }) === 'animal (birds and pigs)'
      && E.inventoryWordOf(hpai, { species: 'Pigeon', inventory: 1 }) === 'birds',
    'kinds: a species naming two kinds is both, in the type\'s order ("Cattle, Chicken" and "Chicken and cattle" birds and cattle; "Pigeon, pig" birds and other animals; three kinds all three); both marks; its hover "400 animals (birds and cattle)"; one kind not mixed');
    const mixL = [{ species: 'Cattle, Chicken', inventory: 400 }, { species: 'Pigeon, pig', inventory: null }, { species: 'Chicken', inventory: 1000 },
      { species: 'Cattle', inventory: 50 }, { species: 'Chicken and cattle', inventory: 1 }];
    check(E.mixedLine(hpai, mixL) === '3 positives name two kinds: "Cattle, Chicken", "Chicken and cattle", "Pigeon, pig" (401 animals, counted in neither kind)'
      && E.mixedLine(hpai, mixL.slice(1, 2)) === '1 positive names two kinds: "Pigeon, pig" (counted in neither kind)'
      && E.mixedLine(hpai, [{ species: 'Chicken and cattle', inventory: 1 }]) === '1 positive names two kinds: "Chicken and cattle" (1 animal, counted in neither kind)'
      && E.mixedLine(hpai, [{ species: 'Chicken, goat, cow', inventory: 2 }]) === '1 positive names more than one kind: "Chicken, goat, cow" (2 animals, counted in neither kind)'
      && E.mixedLine(hpai, mixL.slice(2, 4)) === null && E.mixedLine(nws, [{ species: 'Cattle, Chicken' }]) === null
      && E.mixedLine(hpai, ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(x => ({ species: 'Cow and hen ' + x, inventory: null })))
        === '7 positives name two kinds: "Cow and hen A", "Cow and hen B", "Cow and hen C", "Cow and hen D", "Cow and hen E" and 2 more (counted in neither kind)',
      'kinds: the line naming the positives whose species names more than one kind, their animals counted in neither kind; none without; five names then how many more');
    check(same(E.animalTotals({ type: hpai }, mixL), { totals: [['birds', 1000], ['cattle', 50], ['animals of several kinds', 401]], missing: 1 })
      && same(E.animalTotals({ type: hpai }, [{ species: 'Cow and hen', inventory: 1 }]), { totals: [['animal of several kinds', 1]], missing: 0 }),
      'kinds: the mixed positives\' animals in no kind\'s total, apart and last ("401 animals of several kinds"), one singular; a mixed one without a count still missing');
    check(['goat', 'fox', 'wolf', 'sheep', 'sea lion', 'pony', 'mink', 'horses', 'ox'].map(E.pluralOf).join() === 'goats,foxes,wolves,sheep,sea lions,ponies,mink,horses,oxen',
      'kinds: a species word for many animals', ['goat', 'fox', 'wolf', 'sheep', 'sea lion', 'pony', 'mink', 'horses', 'ox'].map(E.pluralOf));
    // The 2.8 review's words: geese a bird; heifers, steers, calves and a beef herd cattle; a bulldog not cattle (a species not listed); a word
    // already plural kept; a species not listed ending in something other than a plain word kept as written.
    check(same(kindIs(hpai, 'Geese'), ['birds', 'birds', 'birds', false]) && same(kindIs(hpai, 'Canada geese'), ['birds', 'birds', 'birds', false])
      && ['Heifers', 'Steer', 'Calf', 'Calves', 'Beef herd'].every(x => same(kindIs(hpai, x), ['cattle', 'cattle', 'cattle', false]))
      && same(kindIs(hpai, 'Bulldog'), ['other', 'bulldogs', 'bulldog', true])
      && same(kindIs(hpai, 'Mice'), ['other', 'mice', 'mice', true]) && same(kindIs(hpai, 'Opossum (juvenile)'), ['other', 'opossum (juvenile)', 'opossum (juvenile)', true])
      && ['geese', 'mice', 'oxen', 'opossum (juvenile)', 'sea-lion'].map(E.pluralOf).join() === 'geese,mice,oxen,opossum (juvenile),sea-lions',
    'kinds: geese a bird, heifers, steers, calves and a beef herd cattle, a bulldog not cattle; no "geeses", "mices" or "opossum (juvenile)s"',
      ['Geese', 'Heifers', 'Bulldog', 'Mice', 'Opossum (juvenile)'].map(x => kindIs(hpai, x)));
    check(E.inventoryWordOf(hpai, { species: 'Opossum', inventory: 1 }) === 'opossum' && E.inventoryWordOf(hpai, { species: 'Harbor seal', inventory: 2 }) === 'seals'
      && E.inventoryWordOf(hpai, { species: 'Chicken', inventory: 1 }) === 'birds' && E.inventoryWordOf(hpai, { species: 'Goat', inventory: null }) === 'goats',
    'the hover\'s word: a species named by its own word, singular for one animal ("1 opossum"); a kind\'s own word as it is');
    const zoo = [{ flockType: 'Backyard', inventory: 30, species: 'Chicken' }, { flockType: 'Commercial', inventory: 400, species: 'Dairy' },
      { flockType: 'Backyard', inventory: 12, species: 'Goat' }, { flockType: 'Backyard', inventory: 6, species: 'Pig' },
      { flockType: 'Wildlife', inventory: 2, species: 'Harbor seal' }, { flockType: 'Wildlife', inventory: 1, species: 'Opossum' },
      { flockType: 'Backyard', inventory: 3, species: 'Pygmy goat' }];
    check(same(E.animalTotals({ columns: ag.columns, type: hpai }, zoo).totals, [['birds', 30], ['cattle', 400], ['goats', 15], ['pigs', 6], ['seals', 2], ['opossum', 1]])
      && E.numbersLine({ columns: ag.columns, type: hpai }, zoo) === '1 commercial, 4 backyard, 2 wildlife, 30 birds, 400 cattle, 15 goats, 6 pigs, 2 seals, 1 opossum'
      && same(E.animalTotals({ columns: ag.columns, type: hpai }, zoo.slice(2, 4).concat([zoo[1]])).totals, [['cattle', 400], ['goats', 12], ['pigs', 6]]),
    'the totals: the first kind\'s first, then the most animals first, other animals by species ("15 goats", "1 opossum"); with no birds, the most first',
      E.animalTotals({ columns: ag.columns, type: hpai }, zoo).totals);
    // The marks' shapes (2.4; 2.8 one per kind): the kind the numbers count each positive under.
    check(E.animalShapeOf(hpai, agAt('Skagit 01')) === 'circle' && E.animalShapeOf(hpai, agAt('Whatcom 01')) === 'square'
      && E.animalShapeOf(hpai, { species: 'Meat Goat' }) === 'triangle' && E.animalShapeOf(hpai, { species: 'Racing Pigeon' }) === 'circle'
      && E.animalShapeOf(hpai, { species: 'Harbor seal' }) === 'triangle' && E.animalShapeOf(hpai, { species: 'Opossum' }) === 'triangle'
      && E.animalShapeOf(hpai, { species: null }) === 'circle' && E.animalShapeOf(hpai, { species: 'Dairy Cow' }) === 'square'
      && E.animalShapeOf(nws, { species: 'Cattle' }) === 'circle' && same(E.ANIMAL_SHAPES, ['circle', 'square', 'triangle', 'diamond', 'pentagon', 'hexagon']),
    'the mark\'s shape: birds (a blank species too) a circle, cattle a square, other animals (an unlisted one too) a triangle; screwworm\'s animals one circle');
    const row = (key, shape, label) => ({ key, shape, label, legend: label });
    check(same(E.animalKeys(hpai, ag.positives), [row('birds', 'circle', 'Birds'), row('cattle', 'square', 'Cattle')])
      && same(E.animalKeys(hpai, [{ species: 'Goat' }, { species: 'Chicken' }]), [row('birds', 'circle', 'Birds'), row('other', 'triangle', 'Other animals')])
      && same(E.animalKeys(hpai, [agAt('Whatcom 01')]), [row('cattle', 'square', 'Cattle')]) && same(E.animalKeys(hpai, []), [])
      && same(E.animalKeys(nws, [{ species: 'Cattle' }]), [row('animals', 'circle', 'Animals')]),
    'the legend\'s animal rows: one per kind among the positives drawn, in the type\'s order; none for none', E.animalKeys(hpai, ag.positives));
    // The animal filter (2.7; 2.8 by the kind's key and by species): a kind left out leaves the read, the rows not
    // mapped too; the words say what is shown.
    {
      const mixed = { type: hpai, columns: ag.columns, positives: [{ name: 'B1', species: 'Chicken' }, { name: 'C1', species: 'Dairy Cow' },
        { name: 'B2', species: null }, { name: 'G1', species: 'Goat' }, { name: 'M1', species: 'Cattle, Chicken' }, { name: 'P1', species: 'Pig' }],
      dropped: [{ name: 'Line 9', species: 'Cattle' }, { name: 'Line 10', species: 'Duck' }], badDates: [] };
      const names = r => r.positives.map(p => p.name).join(' ');
      const cattle = E.byAnimals(mixed, ['cattle']), birdsOther = E.byAnimals(mixed, ['birds', 'other']);
      check(names(cattle) === 'C1 M1' && cattle.dropped.map(p => p.name).join() === 'Line 9' && names(birdsOther) === 'B1 B2 G1 M1 P1'
        && birdsOther.dropped.map(p => p.name).join() === 'Line 10' && names(E.byAnimals(mixed, [])) === '' && names(E.byAnimals(mixed, ['birds', 'cattle', 'other'])) === 'B1 C1 B2 G1 M1 P1'
        && names(E.byAnimals(mixed, ['circle', 'square', 'triangle'])) === ''
        && cattle.columns === mixed.columns && cattle.type === hpai && mixed.positives.length === 6 && mixed.dropped.length === 2,
      'the filter keeps the kinds ticked by key, not by shape (positives and rows not mapped), a positive naming cattle and birds while either is ticked, and leaves the read itself as it was', [names(cattle), names(birdsOther)]);
      const pigOnly = E.byAnimals(mixed, ['birds', 'other'], ['Pig']), noSpecies = E.byAnimals(mixed, ['birds', 'cattle', 'other'], ['(no species)', 'Duck']);
      check(names(pigOnly) === 'P1' && pigOnly.dropped.length === 0 && names(noSpecies) === 'B2' && noSpecies.dropped.map(p => p.name).join() === 'Line 10'
        && names(E.byAnimals(mixed, ['cattle'], ['Pig'])) === '' && names(E.byAnimals(mixed, ['other'], [])) === 'G1 P1',
      'Refine by species: only the species picked, within the kinds ticked; "(no species)" picks the blank one; none picked is every species', [names(pigOnly), names(noSpecies)]);
      check(E.animalsOnly(hpai, mixed.positives, ['cattle']) === 'Cattle' && E.animalsOnly(hpai, mixed.positives, ['birds', 'cattle']) === 'Birds and cattle'
        && E.animalsOnly(hpai, mixed.positives, ['birds', 'cattle', 'other']) === null && E.animalsOnly(hpai, mixed.positives, []) === null
        && E.animalsOnly(hpai, [{ species: 'Chicken' }], ['birds']) === null && E.animalsOnly(hpai, mixed.positives, ['other']) === 'Other animals'
        && E.animalsOnly(hpai, ag.positives, ['birds']) === 'Birds',
      'the filter in words: the kinds shown, only when some are left out ("Cattle", "Birds and cattle"); null for every kind, one kind in the file, or none ticked');
      const birdsMapped = Object.assign({}, mixed, { positives: [mixed.positives[0], mixed.positives[2]], dropped: [mixed.dropped[0]] });
      const noneMapped = Object.assign({}, mixed, { positives: [], dropped: [mixed.dropped[0]] });
      check(same(E.animalKindsOf(birdsMapped), [row('birds', 'circle', 'Birds'), row('cattle', 'square', 'Cattle')])
        && same(E.animalKindsOf(noneMapped), [row('cattle', 'square', 'Cattle')]) && same(E.animalKindsOf(Object.assign({}, mixed, { positives: [], dropped: [] })), [])
        && E.animalsOnly(hpai, birdsMapped.positives.concat(birdsMapped.dropped), ['birds']) === 'Birds',
      'the file\'s kinds: its positives\' and its rows not mapped, so cattle whose only row has no coordinates still get a tick', E.animalKindsOf(birdsMapped));
      // "Refine by species": the species of the kinds ticked, under each kind, the most animals first; no count said so.
      const counted = Object.assign({}, mixed, { positives: mixed.positives.map((p, k) => Object.assign({}, p, { inventory: [1200, 40, 30, 12, 7, null][k] })),
        dropped: mixed.dropped.map((p, k) => Object.assign({}, p, { inventory: [5, 1][k] })) });
      const sp = E.speciesList(counted, ['birds', 'other']);
      check(same(sp.map(g => [g.key, g.label, g.shape, g.species.map(x => [x.name, x.positives, x.animals, x.text])]), [
        ['birds', 'Birds', 'circle', [['Chicken', 1, 1200, '1 positive, 1,200 animals'], ['(no species)', 1, 30, '1 positive, 30 animals'],
          ['Cattle, Chicken', 1, 7, '1 positive, 7 animals'], ['Duck', 1, 1, '1 positive, 1 animal']]],
        ['other', 'Other animals', 'triangle', [['Goat', 1, 12, '1 positive, 12 animals'], ['Pig', 1, null, '1 positive, no count']]]])
        && same(E.speciesList(counted, []), []) && same(E.speciesList(counted, ['cattle']).map(g => g.species.map(x => x.text)), [['1 positive, 40 animals', '1 positive, 7 animals', '1 positive, 5 animals']]),
      'Refine by species: under each kind ticked, every species (rows not mapped too) with its positives and animals, the most first, one naming two kinds under both; none ticked lists none', sp);
    }
    {   // A type of seven kinds: the seventh shares the sixth's mark, and its legend row says so.
      const sevenRaw = JSON.parse(JSON.stringify(hpai));
      sevenRaw.id = 'test-seven-kinds';
      sevenRaw.kinds = ['birds', 'cattle', 'swine', 'mink', 'goats', 'wild', 'other'].map((key, i) => ({ key, label: key.charAt(0).toUpperCase() + key.slice(1),
        words: i < 6 ? [[['bird'], ['cattle'], ['pig', 'swine'], ['mink'], ['goat'], ['seal']][i]].flat() : [] }));
      const seven = T.check(sevenRaw), list = ['Wild bird', 'Cattle', 'Pig', 'Mink', 'Goat', 'Seal', 'Alpaca'].map(species => ({ species }));
      check(same(list.map(p => E.animalShapeOf(seven, p)), ['circle', 'square', 'triangle', 'diamond', 'pentagon', 'hexagon', 'hexagon'])
        && same(E.animalKeys(seven, list.slice(5)), [{ key: 'wild', shape: 'hexagon', label: 'Wild', legend: 'Wild' },
          { key: 'other', shape: 'hexagon', label: 'Other', legend: 'Other (same mark as Wild)' }])
        && E.kindOf(seven, { species: 'Alpaca' }).unlisted && E.kindOf(seven, { species: 'Wild bird' }).named === 'birds' && !E.kindOf(seven, { species: 'Chicken' }).kind.words.length,
      'a type of seven kinds: six marks in order, the seventh sharing the hexagon with its legend row saying so', E.animalKeys(seven, list));
    }
    // The line under the boxes naming the species no kind names: five names, then how many more.
    check(E.unlistedLine(hpai, [{ species: 'Opossum' }, { species: 'Chicken' }, { species: 'Bobcat' }, { species: ' Opossum ' }])
      === '3 positives with a species not listed: Bobcat, Opossum' && E.unlistedLine(hpai, [{ species: 'Opossum' }]) === '1 positive with a species not listed: Opossum'
      && E.unlistedLine(hpai, [{ species: 'Chicken' }, { species: null }]) === null && E.unlistedLine(nws, [{ species: 'Opossum' }]) === null
      && E.unlistedLine(hpai, ['Aa', 'Bb', 'Cc', 'Dd', 'Ee', 'Ff', 'Gg'].map(species => ({ species })))
        === '7 positives with a species not listed: Aa, Bb, Cc, Dd, Ee and 2 more',
    'the unlisted line: the positives with a species no kind names, the names once each and sorted; none in a type listing no species words');
    {
      const withOpossum = Object.assign({}, ag, { positives: ag.positives.concat([Object.assign({}, agAt('Skagit 01'), { name: 'Opossum 01', species: 'Opossum' })]) });
      const lines = E.valueBoxes(withOpossum, null, agWin).positives.lines, lineIn = E.valueBoxes(ag, null, agWin).positives.lines;
      check(lines.includes('1 positive with a species not listed: Opossum') && !lineIn.some(l => /not listed/.test(l))
        && !E.valueBoxes(E.byAnimals(withOpossum, ["birds", "cattle"]), null, agWin).positives.lines.some(l => /not listed/.test(l)),
      'the unlisted line under the boxes; gone with the kind holding it unticked', lines);
      const withMixed = Object.assign({}, ag, { positives: ag.positives.concat([Object.assign({}, agAt('Skagit 01'), { name: 'Mixed 01', species: 'Pigeon, pig', inventory: 9 })]) });
      const mLines = E.valueBoxes(withMixed, null, agWin).positives.lines;
      check(mLines.includes('1 positive names two kinds: "Pigeon, pig" (9 animals, counted in neither kind)') && !lineIn.some(l => /names two/.test(l))
        && E.valueBoxes(E.byAnimals(withMixed, ['other']), null, agWin).positives.lines.some(l => /names two/.test(l))
        && !E.valueBoxes(E.byAnimals(withMixed, ['cattle']), null, agWin).positives.lines.some(l => /names two/.test(l))
        && same(E.animalKeys(hpai, [{ species: 'Pigeon, pig' }]), [row('birds', 'circle', 'Birds'), row('other', 'triangle', 'Other animals')]),
      'the line naming a positive with two kinds under the boxes, there while either kind is ticked; each of its kinds gets a legend row', mLines);
    }
    check(E.numbersLine(ag, early.current) === '1 commercial, 1 backyard, 1,100 birds' && E.numbersLine(ag, []) === null
      && E.numbersLine(read, read.positives) === null, 'the numbers line on an earlier end; none for no positives or a file without the columns');
    const nr = csvOf('em_positives_nws.csv'), nw = E.readPositives(nr[0], nr.slice(1), null);
    check(E.numbersLine(nw, nw.positives) === '1 commercial, 1 backyard, 243 animals', 'the numbers line in screwworm\'s word', E.numbersLine(nw, nw.positives));
    check(E.notMappedLine(ag.dropped) === '2 not mapped: 1 no coordinates, 1 latitude and longitude look swapped'
      && E.notMappedLine([{ reason: 'no coordinates' }, { reason: 'no coordinates' }]) === '2 not mapped: no coordinates' && E.notMappedLine([]) === null,
    'the not-mapped line, by reason', E.notMappedLine(ag.dropped));
    const vb = E.valueBoxes(ag, null, agWin, undefined, E.targets(ag.positives, { statuses: ['Confirmed'] }, agWin));
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
    const vbFew = E.valueBoxes(ag, null, agWin, undefined, E.targets(ag.positives, { statuses: ['Confirmed'] }, agWin).slice(0, 3));
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
      { detected: null, closedDate: null, closed: false }], dropped: [], type: hpai };
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
    // A hatched series (2.8, "Several kinds"): its marks, its key swatch and its county bar point at a pattern of their
    // own chart, diagonal lines in its fill on white; two drawings never share an id; no pattern without one.
    const hs = [{ key: 'a', label: 'with birds', name: 'Birds', fill: '#1c5a83' }, { key: 'b', label: 'with several kinds', name: 'Several kinds', fill: '#4d4d4d', hatch: true }];
    const hc = [{ label: 'Week A', tick: 'A', values: { a: 1, b: 1 } }];
    const h1 = CH.columns({ title: 't', series: hs, columns: hc }, { width: 300, height: 170 });
    const h2 = CH.bars({ title: 't', series: hs, rows: [{ label: 'Yakima', values: { a: 1, b: 1 } }] }, { width: 300 });
    const idOf = s => (s.match(/<pattern id="([^"]+)"/) || [])[1];
    const hatchOk = s => { const id = idOf(s); return !!id && /patternTransform="rotate\(45\)"/.test(s) && s.includes('<rect width="6" height="6" fill="#ffffff"/><rect width="2.2" height="6" fill="#4d4d4d"/>')
      && (s.match(new RegExp('fill="url\\(#' + id + '\\)"', 'g')) || []).length >= 2 && !/<rect (?!width="2\.2")[^>]*fill="#4d4d4d"/.test(s) && s.indexOf('<defs>') < s.indexOf('<rect'); };
    check(hatchOk(h1) && hatchOk(h2) && idOf(h1) !== idOf(h2) && !/<pattern/.test(svg) && hs[1].fill === '#4d4d4d',
    'chart: a hatched series drawn as dark lines on white from a pattern of its own chart (its marks and its key swatch), each drawing\'s id new; none without one; the series given is not changed',
    [idOf(h1), idOf(h2)]);
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
      'cvi/app/brandedmaps.js', 'emergency/message-icons.js', 'emergency/types.js', 'emergency/types/hpai.js', 'emergency/types/nws.js', 'emergency/rules.js',
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
    {   // 2.8: a positive naming two kinds is drawn with both marks side by side, centered on its spot (as the live map).
      const one = shownOf(agGroups.current), first = Object.assign({}, one[0], { shape: 'circle', shapes: ['circle'] });
      const single = EB.page(base({ positives: [first].concat(one.slice(1)) }));
      const mixed = EB.page(base({ positives: [Object.assign({}, first, { shapes: ['circle', 'square'] })].concat(one.slice(1)) }));
      const at = mixed.model.positives[0], cx = '<circle cx="' + BRW.num(at.x) + '" cy="' + BRW.num(at.y) + '"';
      const count = (parts, t) => parts.join('').split(t).length - 1;
      const left = new RegExp('<circle cx="([0-9.]+)" cy="' + BRW.num(at.y).replace('.', '\\.') + '"').exec(mixed.parts.join(''));
      check(same(at.shapes, ['circle', 'square']) && count(single.parts, cx) === 2 && count(mixed.parts, cx) === 0
        && left && Number(left[1]) < at.x && count(mixed.parts, '<path') - count(single.parts, '<path') >= 2,
      'map picture: a positive naming two kinds gets a circle and a square side by side, the pair centered on its spot (2.8)',
        [at.shapes, count(single.parts, cx), count(mixed.parts, cx), left && left[1], at.x]);
      // The key's animals rows say a shared mark as the live legend does.
      const shared = EB.page(base({ animals: [{ key: 'wild', shape: 'hexagon', label: 'Wild mammals', legend: 'Wild mammals' },
        { key: 'other', shape: 'hexagon', label: 'Other animals', legend: 'Other animals (same mark as Wild mammals)' }] })).model;
      const words = shared.keyItems.filter(i => i.glyph && i.glyph.shape === 'animals').flatMap(i => [i.glyph.first].concat(i.glyph.words.map(w => w.label)));
      check(words.includes('Other animals (same mark as Wild mammals)'),
        'map picture: the key\'s animals rows say a kind sharing a mark, "Other animals (same mark as Wild mammals)" (2.8)', words);
    }
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
    {   // 2.8: the key names only the end the CVI tab counts; species picked draw no funnel there.
      const keyOf = cvi => EB.page(base({ cvi: Object.assign({ cvis: 12, animals: 3400, matched, years: '2025–2026' }, cvi) })).model;
      const rows = mm => mm.keyItems.filter(i => /in a zone$/.test(i.label)).map(i => i.label + (i.funnel ? ' (funnel)' : ''));
      const notes = mm => mm.keyRows.filter(r => r.label === 'Filtered: some sites left out').length;
      const origin = keyOf({ end: 'origin', filtered: true }), dest = keyOf({ end: 'dest' }), either = keyOf({ end: 'either' });
      check(same(rows(origin), ['Origin in a zone']) && same(rows(dest), ['Destination in a zone'])
        && same(rows(either), ['Origin in a zone', 'Destination in a zone']) && same(rows(cv), rows(either)),
      'map picture (2.8): the key names only the end counted (Origin, Destination, or both for Either), with no funnel even with species picked',
        [rows(origin), rows(dest), rows(either)]);
      check(notes(origin) === 0 && notes(dest) === 0 && notes(either) === 0,
        'map picture (2.8): species picked with no layer filtered: no "Filtered" note in the key', [notes(origin), notes(dest)]);
    }
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
      && same(pr.rows[6], ['Franklin 01', 'Mar 15, 2026', 'Franklin', 'Large', 'Commercial', 'Turkey', 'Closed', 'Jun 30, 2026']),
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
    {   // 2.8: other animals named species by species: the Overview's animals box names six after the first, else five
      // and how many more; counties.csv a column per species word, one animal ("1 opossum") in its plural's column.
      const zooRows = [['Chicken', '30', 'Skagit'], ['Dairy', '400', 'Skagit'], ['Goat', '12', 'Lewis'], ['Pig', '6', 'Lewis'],
        ['Harbor seal', '2', 'Lewis'], ['Opossum', '1', 'Lewis'], ['Opossum', '4', 'Skagit'], ['Fox', '5', 'Lewis'], ['Mink', '7', 'Lewis']];
      const zooRead = rows => E.readPositives(['Case ID', 'Latitude', 'Longitude', 'Species', 'Flock/Herd Inventory', 'County'],
        rows.map((r, k) => ['Z' + k, '47.0', '-120.5', r[0], r[1], r[2]]), hpai);
      const zr = zooRead(zooRows), zw = E.windowOf(zr.positives), six = zooRead(zooRows.slice(0, 7).concat([zooRows[8]]));
      check(E.overviewBoxes(zr, zw, COUNTIES, null).animals.value === '30 birds'
        && E.overviewBoxes(zr, zw, COUNTIES, null).animals.note === '400 cattle, 12 goats, 7 mink, 6 pigs, 5 foxes and 2 more'
        && E.overviewBoxes(six, E.windowOf(six.positives), COUNTIES, null).animals.note === '400 cattle, 12 goats, 7 mink, 6 pigs, 5 opossums, 2 seals',
      'animals box: up to six named after the first, else five and how many more', E.overviewBoxes(zr, zw, COUNTIES, null).animals);
      const zt = E.countyTable(zr, E.countyRows(zr, zw, COUNTIES)), zat = n => zt.rows.find(r => r[0] === n) || [];   // a row missing fails, not stops
      check(same(zt.columns.slice(4), ['Birds at the active positives', 'Cattle at the active positives', 'Foxes at the active positives',
        'Goats at the active positives', 'Mink at the active positives', 'Opossums at the active positives', 'Pigs at the active positives',
        'Seals at the active positives', 'Active positives without a count'])
        && same(zat('Lewis').slice(4), [0, 0, 5, 12, 7, 1, 6, 2, 0]) && same(zat('Skagit').slice(4), [30, 400, 0, 0, 0, 4, 0, 0, 0]),
      'counties.csv: a column per kind and per named species (the type\'s order, then by name); one opossum in the Opossums column', zt);
      // A positive naming two kinds: its animals in a column of their own, last, in neither kind's.
      const mr = zooRead([['Chicken', '30', 'Skagit'], ['Cattle, Chicken', '400', 'Skagit'], ['Dairy cow', '50', 'Lewis']]);
      const mt = E.countyTable(mr, E.countyRows(mr, E.windowOf(mr.positives), COUNTIES)), mat = n => mt.rows.find(r => r[0] === n) || [];
      check(same(mt.columns.slice(4), ['Birds at the active positives', 'Cattle at the active positives',
        'Animals of several kinds at the active positives', 'Active positives without a count'])
        && same(mat('Skagit').slice(4), [30, 0, 400, 0]) && same(mat('Lewis').slice(4), [0, 50, 0, 0])
        && E.overviewBoxes(mr, E.windowOf(mr.positives), COUNTIES, null).animals.note === '50 cattle, 400 animals of several kinds',
      'counties.csv and the animals box: a positive naming two kinds counted in a column of its own, last, in neither kind\'s', mt);
      // A species typed like a spreadsheet formula names its column with the export's guard in front (2.8 review).
      const fr = zooRead([['Chicken', '30', 'Skagit'], ['=HYPERLINK("http://x","y")', '3', 'Skagit'], ['@sum', '2', 'Lewis']]);
      const ft = E.countyTable(fr, E.countyRows(fr, E.windowOf(fr.positives), COUNTIES));
      check(ft.columns.filter(c => /at the active positives$/.test(c)).every(c => !/^[=+\-@]/.test(c))
        && ft.columns.includes('\'=hyperlink("http://x","y") at the active positives') && ft.columns.includes('\'@sum at the active positives')
        && ft.columns.includes('Birds at the active positives'),
      'counties.csv: a column named from a species typed like a formula starts with an apostrophe, so a spreadsheet reads it as text', ft.columns);
    }
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
  {   // "Refine by species" and the movement's end in the CVI movements tab (2.8).
    const mrow = (group, species, cvi) => ({ CVI: cvi, 'Species.Group': group, Species: species });
    const master = { header: ['CVI', 'Species.Group', 'Species'], hasSpecies: true, rows: [mrow('Poultry', 'Turkeys', 'A'),
      mrow('Cattle', 'Dairy cows', 'B'), mrow('Poultry', 'chickens', 'C'), mrow('Poultry', 'Chickens', 'D'), mrow('Cattle', 'Beef cattle', 'E'),
      mrow('Cattle', 'Dairy cows', 'F'), mrow('Cattle', '', 'G'), mrow('Cattle', null, 'H'), mrow('Sheep and goats', 'Dairy goats', 'I')] };
    check(same(E.cviSpeciesIn(master, ['Poultry', 'Cattle']), ['Beef cattle', 'chickens', 'Chickens', 'Dairy cows', 'Turkeys']),
      'the CVI tab\'s species (2.8): the raw species of the groups ticked, each once, blanks left out, in CVI\'s order (lowercase first)',
      E.cviSpeciesIn(master, ['Poultry', 'Cattle']));
    check(same(E.cviSpeciesIn(master, ['Sheep and goats']), ['Dairy goats']) && same(E.cviSpeciesIn(master, []), [])
      && same(E.cviSpeciesIn(Object.assign({}, master, { hasSpecies: false }), ['Cattle']), []) && same(E.cviSpeciesIn(null, ['Cattle']), []),
    'the CVI tab\'s species (2.8): only the groups ticked; none with no group ticked, without a Species column or a master');
    const picked = E.cviRows(master, ['Dairy cows', 'Turkeys']);
    check(same(picked.rows.map(r => r.CVI), ['A', 'B', 'F']) && same(picked.header, master.header) && picked.hasSpecies && master.rows.length === 9,
      'the CVI query\'s rows (2.8): only the species picked, in the master\'s order, the master itself left whole', picked.rows.map(r => r.CVI));
    check(E.cviRows(master, []) === master && E.cviRows(master, null) === master
      && E.cviRows(Object.assign({}, master, { hasSpecies: false, rows: master.rows }), ['Turkeys']).rows.length === 9
      && E.cviRows(master, ['Chickens']).rows.length === 1,
    'the CVI query\'s rows (2.8): the whole master with none picked or without a Species column; a pick matches its own spelling only');
    check(same(E.CVI_ENDS.map(e => [e.key, e.label]), [['either', 'Either'], ['origin', 'Origin'], ['dest', 'Destination']])
      && E.cviEndOf('origin').words === 'left from inside the zones' && E.cviEndOf('dest').words === 'arrived inside the zones'
      && E.cviEndOf('either').words === 'left from or arrived inside the zones' && E.cviEndOf('nope').key === 'either' && E.cviEndOf(undefined).key === 'either',
    'the movement\'s end (2.8): Either, Origin and Destination as lookup.js query\'s endpoints, each with its words; any other key is Either');
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

  // ---- 8g. The Overview by animal and the lines by the kinds ticked (2.8) ----------------------------------------
  {
    // Made-up rows in the agreed columns: two birds and a third with a close date not read, a dairy, a mixed farm, a
    // seal detected before the dates, and a dairy whose detection and release dates are not read.
    const row = (id, reported, close, confirmed, release, county, species) => [id, reported, close, confirmed, release,
      '(synthetic) Farm', '(synthetic) Road', 'Town', county, '46.5', '-120.5', 'Active', 'H5N1', 'Commercial', 'Mixed', species,
      '100', '', '', ''];
    const KR = [row('K-1', '', '', '09/02/2026', '', 'Yakima', 'Chicken'), row('K-2', '', '09/20/2026', '09/10/2026', '', 'Yakima', 'Duck'),
      row('K-3', '', '', '09/03/2026', '', 'Franklin', 'Dairy Cow'), row('K-4', '', '', '09/12/2026', '', 'Yakima', 'Cattle, Chicken'),
      row('K-5', '', '', '08/01/2026', '', 'Lewis', 'Seal'), row('K-6', '', '', 'soon', 'later', 'Franklin', 'Dairy Cow'),
      row('K-7', '', 'tbd', '09/15/2026', '', 'Yakima', 'Chicken')];
    const kr = E.readPositives(FX.AGREED_HEAD, KR, hpai, '2026-10-05');
    const kWin = E.rangeView('2026-09-01', '2026-10-05');
    const kSteps = E.playSteps({ start: '2026-07-26', end: '2026-10-05' });
    check(same(KR.map((r, i) => E.chartKindOf(hpai, kr.positives[i])), ['birds', 'birds', 'cattle', E.SEVERAL, 'other', 'cattle', 'birds'])
      && E.chartKindOf(hpai, { species: null }) === 'birds' && E.SEVERAL === 'several',
    'by animal: each positive in one part, its kind\'s, "Cattle, Chicken" in "several", no species the first kind');
    const kinds = keys => E.chartKinds(kr, keys).map(k => [k.key, k.index, k.label]);
    check(same(kinds(['birds', 'cattle', 'other']), [['birds', 0, 'Birds'], ['cattle', 1, 'Cattle'], ['other', 2, 'Other animals'], ['several', 3, 'Several kinds']])
      && same(kinds(['cattle', 'birds']), [['birds', 0, 'Birds'], ['cattle', 1, 'Cattle'], ['several', 3, 'Several kinds']])
      && same(E.chartKinds(E.byAnimals(kr, ['cattle']), ['cattle']).map(k => k.key), ['cattle', 'several'])
      && same(E.chartKinds(E.byAnimals(kr, ['other']), ['other']).map(k => k.key), ['other']),
    'by animal: the parts are the kinds ticked among the rows, in the type\'s order whatever the ticks\' order, "Several kinds" last when a mixed positive is there',
    kinds(['cattle', 'birds']));
    const kt = E.overTime(kr, kWin, kSteps), col = label => kt.columns.find(c => c.label === label) || {};   // a column missing fails, not stops
    check(same(col('Week of Aug 30, 2026').kinds, { birds: 1, cattle: 1 }) && same(col('Week of Sep 6, 2026').kinds, { birds: 1, several: 1 })
      && same(col('Week of Sep 13, 2026').kinds, { birds: 1 }) && same(col('Week of Jul 26, 2026').kinds, {}) && col('Week of Jul 26, 2026').outside === 1
      && kt.columns.every(c => Object.values(c.kinds).reduce((s, n) => s + n, 0) === c.current + c.past) && col('Week of Sep 6, 2026').past === 1,
    'by animal: each column counts the positives inside the dates by kind, active and closed together, the seal before the dates outside only; each column\'s parts add up to its active and closed',
    kt.columns.map(c => [c.label, c.kinds, c.outside]));
    const kc = E.countyRows(kr, kWin, COUNTIES), yak = kc.find(r => r.county === 'Yakima');
    check(same(yak.kinds, { birds: 3, several: 1 }) && yak.total === 4 && kc.every(r => Object.values(r.kinds).reduce((s, n) => s + n, 0) === r.total)
      && !kc.some(r => r.county === 'Lewis'),
    'by animal: each county\'s positives by kind (Yakima 3 birds, 1 of several kinds), adding up to its total', kc.map(r => [r.county, r.kinds, r.total]));
    const kb = E.overviewBars(kc, null, ['birds', 'cattle', 'several']), yb = kb.counties.find(r => r.label === 'Yakima');
    check(same(yb.parts, [{ key: 'birds', value: 3 }, { key: 'cattle', value: 0 }, { key: 'several', value: 1 }]) && yb.total === 4
      && same(E.overviewBars(kc, null).counties.find(r => r.label === 'Yakima').parts.map(x => x.key), ['current', 'past']),
    'by animal: the county bars\' parts one per kind given, in that order; without kinds, active and closed as before', yb);
    // The lines under the value boxes count the kinds ticked: the dairy's two dates and the bird's close date.
    const notRead = x => E.valueBoxes(x, null).positives.lines.filter(l => /not read/.test(l));
    check(kr.badDates === 1 && kr.badCloseDates === 1 && kr.badReleaseDates === 1
      && same(notRead(kr), ['3 dates not readable']) && same(notRead(E.byAnimals(kr, ['birds'])), ['1 date not readable'])
      && same(notRead(E.byAnimals(kr, ['cattle'])), ['2 dates not readable']) && same(notRead(E.byAnimals(kr, ['other'])), []),
    'lines by the kinds ticked: "3 dates not readable" for the whole file, 1 with the birds only, 2 with the cattle only, none with the seal only',
    [notRead(kr), notRead(E.byAnimals(kr, ['birds'])), notRead(E.byAnimals(kr, ['cattle']))]);
    const QH = FX.AGREED_HEAD.concat(['Quarantine Status']);
    const qk = E.readPositives(QH, [KR[0].concat(['Under quarantine']), KR[2].concat(['maybe']), KR[5].concat(['perhaps'])], hpai, '2026-10-05');
    check(qk.badQuarantineStatus === 2 && same(notRead(E.byAnimals(qk, ['birds'])), [])
      && notRead(qk).includes('2 quarantine statuses not read') && notRead(E.byAnimals(qk, ['cattle'])).includes('2 quarantine statuses not read'),
    'lines by the kinds ticked: the quarantine statuses not read counted only while their kind is ticked', [notRead(qk), notRead(E.byAnimals(qk, ['birds']))]);
    // One key for "the same site": two barns at one spot are two sites, a line repeated is one.
    const barn = name => ({ name, lat: 46.5005, lon: -120.5005, county: null, town: null, geoSource: '', precision: {} });
    const kSites = E.ringSites([kr.positives[0]], hpai.zones.rings);
    const kIn = E.inside(kSites, [{ key: 'barns', label: 'Barns', color: '#000000', points: [barn('Barn A'), barn('Barn A'), barn('Barn B')] }],
      { mode: 'rings', rings: hpai.zones.rings, positives: [kr.positives[0]], includeCoarse: true });
    check(kIn.layers[0].inside === 2 && kIn.total === 2 && E.siteKey(barn('Barn A')) === '46.5005\r-120.5005\rBarn A'
      && E.layerSiteKey('barns', barn('Barn B')) === 'barns\r46.5005\r-120.5005\rBarn B',
    'one site key: two barns at one spot counted as two sites, a line repeated once; the key is the place and the name, with the layer first', [kIn.layers[0].inside, kIn.total]);
  }

  // ---- 8h. The how-to's worked example (2.8): "Changing the kinds of animals", site/emergency/changing-kinds.html --
  // Taken from the page as written: the lines it says to find are in hpai.js and the table check, the line it says to
  // paste is applied to HPAI with "mink" taken out of Other animals, and every row of its table and its four ticks are
  // what the rules give on em_rules_species.csv; its two slip messages are the page's red notice. Its plain-text twin,
  // CHANGING_THE_KINDS_OF_ANIMALS.txt, holds the same lines, table, ticks and messages.
  {
    const html = fs.readFileSync(path.join(SITE, 'emergency', 'changing-kinds.html'), 'utf8');
    const txt = fs.readFileSync(path.join(SITE, 'emergency', 'CHANGING_THE_KINDS_OF_ANIMALS.txt'), 'utf8');
    const plain = t => t.replace(/<svg[^>]*aria-label="(\w+)"[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').replace(/&ldquo;|&rdquo;/g, '"')
      .replace(/&lsquo;|&rsquo;/g, "'").replace(/&middot;/g, '·').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    const blocks = [...html.matchAll(/<div class="paste[^"]*"><span class="label">[^<]*<\/span><code>([^<]*)<\/code><\/div>/g)].map(m => m[1].trim());
    const hpaiSource = fs.readFileSync(path.join(SITE, 'emergency', 'types', 'hpai.js'), 'utf8');
    const rSource = fs.readFileSync(path.join(ROOT, 'tools', 'work-pc', 'check_hpai_table.R'), 'utf8');
    const find = b => blocks.find(x => x.includes(b));
    const pasted = find("key: 'mink'"), txtLines = txt.split(/\r?\n/).map(l => l.trim());
    check(blocks.length === 8 && hpaiSource.includes(find("'porpoise'] }")) && hpaiSource.includes(find("key: 'cattle'"))
      && find("'opossum'] }") === find("'porpoise'] }").replace("'porpoise']", "'porpoise', 'opossum']") && /'equine', 'mink', /.test(hpaiSource)
      && rSource.includes(find('Cattle = c(')) && /"mink", /.test(rSource) && blocks.every(x => txtLines.includes(x)),
    'how-to: the lines it says to find are in hpai.js and the table check as written, and its plain-text twin has every line', blocks);
    const raw = JSON.parse(JSON.stringify(hpai));
    const at = raw.kinds.findIndex(k => k.key === 'cattle') + 1, other = raw.kinds.find(k => k.label === 'Other animals');
    raw.kinds.splice(at, 0, Function('return (' + pasted.replace(/,\s*$/, '') + ')')());
    other.words = other.words.filter(w => w !== 'mink');
    const mink = T.check(raw);
    const said = (t, species) => {
      const k = E.kindOf(t, { species });
      return k.indices.map(i => t.kinds[i].label).join(' and ') + (k.unlisted ? ', not listed' : '')
        + ' (' + E.animalShapesOf(t, { species }).join(', ') + ')';
    };
    // The page's table: each cell's marks (drawn, named by aria-label) and its words.
    const cell = c => plain(c) + ' (' + [...c.matchAll(/aria-label="(\w+)"/g)].map(m => m[1]).join(', ') + ')';
    const rows = [...html.matchAll(/<tr><td>([^<]+)<\/td><td>([\s\S]*?)<\/td><td[^>]*>([\s\S]*?)<\/td><\/tr>/g)].map(m => [m[1], cell(m[2]), cell(m[3])]);
    // The twin's table: lined-up columns (species, before, after), a row's second line under its first.
    const tLines = txt.split(/\r?\n/), head = tLines.findIndex(l => /^\s+Species\s+Before\s+After$/.test(l));
    const cols = [tLines[head].indexOf('Species'), tLines[head].indexOf('Before'), tLines[head].indexOf('After')];
    const tRows = [];
    for (let i = head + 2; i < tLines.length && tLines[i].trim(); i++) {
      const part = [tLines[i].slice(cols[0], cols[1]), tLines[i].slice(cols[1], cols[2]), tLines[i].slice(cols[2])].map(x => x.trim());
      if (part[0]) tRows.push(part); else tRows[tRows.length - 1] = tRows[tRows.length - 1].map((x, j) => j ? x + ' ' + part[j] : x);
    }
    const SHAPES = /^(.*?)\s+((?:circle|square|triangle|diamond|pentagon|hexagon)(?:, (?:circle|square|triangle|diamond|pentagon|hexagon))*)$/;
    const tCell = c => { const m = SHAPES.exec(c.replace(/\s+/g, ' ')); return m ? m[1] + ' (' + m[2] + ')' : c; };
    const sRows = csvOf(FX.RULES.species.positives), file = E.readPositives(sRows[0], sRows.slice(1), mink);
    const inFile = new Set(sRows.slice(1).map(r => r[sRows[0].indexOf('Species')]));
    check(rows.length === 5 && rows.every(r => inFile.has(r[0]) && said(hpai, r[0]) === r[1] && said(mink, r[0]) === r[2])
      && same(tRows.map(r => [r[0], tCell(r[1]), tCell(r[2])]), rows)
      && same(E.animalKeys(mink, file.positives).map(k => k.label), ['Birds', 'Cattle', 'Mink', 'Other animals'])
      && plain(html).includes('"Animals" now has four ticks: Birds, Cattle, Mink, Other animals.')
      && txt.includes('"Animals" has four ticks: Birds, Cattle, Mink, Other animals.')
      && E.inventoryWordOf(mink, { species: 'Mink', inventory: 7 }) === 'mink' && plain(html).includes('("7 mink")') && txt.includes('("7 mink")'),
    'how-to: its worked example, mink as a kind of its own, gives every row of its table (the same in the twin) and its four ticks on em_rules_species.csv',
    [rows, tRows]);
    const notices = [...html.matchAll(/<div class="notice">([\s\S]*?)<\/div>/g)].map(m => plain(m[1]));
    const twice = JSON.parse(JSON.stringify(raw));
    twice.kinds.find(k => k.label === 'Other animals').words.push('mink');
    let refused = '';
    try { T.check(twice); } catch (e) { refused = e.message; }
    const appSource = fs.readFileSync(path.join(SITE, 'emergency', 'app.js'), 'utf8'), txtFlat = txt.replace(/\s+/g, ' ');
    check(notices.length === 2 && notices[0] === 'The emergency type file "types/hpai.js" was not used. ' + refused + '.'
      && notices[1] === 'The emergency type file "types/hpai.js" could not be read: a typing slip in it, such as quotes made curly or a missing comma or bracket, or the file is missing.'
      && notices.every(n => txtFlat.includes(n))
      && appSource.includes("'The emergency type file \"' + (p.file || 'types/') + '\" was not used. ' + p.message + '.'")
      && appSource.includes("'\" could not be read: a typing slip in it, such as quotes made curly'")
      && appSource.includes("+ ' or a missing comma or bracket, or the file is missing.'"),
    'how-to: its two slip messages are the page\'s red notice, word for word, in the page and in its twin', notices);
    // The twin opens in Notepad as it is: Windows' line ends, lines under 100 characters.
    check(!/[^\r]\n/.test(txt) && txt.split('\r\n').every(l => l.length < 100) && /^\s*<script src="changing-kinds\.js"><\/script>$/m.test(html),
      'how-to: the plain-text twin with Windows\' line ends and short lines; the page loads its Copy script from a file');
  }

  // ---- 8b. The HPAI update's figures (2.9, E2: site/emergency/report.js) ---------------------------------------
  // em_rules_report.csv on Sep 1, 2026: every figure worked out by hand from its 17 rows (make_em_fixtures.js), then
  // the same figures against the R reference below.
  {
    const RR = FX.RULES.report, rRows = csvOf(RR.positives);
    const rRead = E.readPositives(rRows[0], rRows.slice(1), hpai, RR.today);
    const COUNTY_SHAPES = globalThis.CVIWA_GEO.counties.features;
    const f = RP.figures(rRead, RR.date, COUNTY_SHAPES);
    check(f.cases === 16 && f.later === 1 && f.undated === 1 && f.noPoint === 3 && f.active === 3,
      'report: 16 cases on the date (Skagit 11, detected after it, left out; Pierce 11 without a date and the three rows without a point counted); 3 active (Thurston 11 without a point among them)',
      [f.cases, f.later, f.undated, f.noPoint, f.active]);
    check(same(f.flocks, { total: 14, commercial: 2, backyard: 10, others: [['Live Bird Market', 1]], untyped: 1, active: 2,
      birds: { commercial: 1251000, backyard: 196, rest: 200 } }),
      'report: the flocks are the bird rows (the two-kind one among them; the dairy herd and the goats not): 2 commercial, 10 backyard, one of another type as written, one without a type; their birds by type (King 11 and Franklin 11 commercial; the two-kind Lewis 11 in none, Clark 11 blank; the market\'s 200 the rest), adding up to the birds affected',
      f.flocks);
    check(f.flocks.birds.commercial + f.flocks.birds.backyard + f.flocks.birds.rest === f.birds,
      'report: the flocks\' birds by type add up to the birds affected');
    check(same(f.kinds.map(k => [k.key, k.cases, k.active, k.animals, k.missing]),
      [['birds', 14, 2, 1251396, 1], ['cattle', 2, 1, 3550, 0], ['other', 1, 0, 6, 0]]) && f.birds === 1251396 && same(f.mixed, { cases: 1, animals: 30 }),
      'report: the animals by kind (birds 1,251,396 with one blank inventory counted, never zero; the dairy herd\'s 3,550 cattle; 6 goats); the two-kind row a case of both, its 30 animals in neither',
      [f.kinds, f.mixed]);
    check(same(f.counties.map(c => [c.county, c.cases, c.active, c.flocks, c.washington]),
      [['Franklin', 2, 1, 1, true], ['King', 2, 0, 2, true], ['Pierce', 2, 0, 2, true], ['Snohomish', 2, 0, 2, true], ['Yakima', 2, 1, 2, true],
        ['Clark', 1, 0, 1, true], ['Lewis', 1, 0, 1, true], ['Thurston', 1, 1, 1, true], ['Whatcom', 1, 0, 0, true], ['Multnomah', 1, 0, 1, false],
        [RP.COUNTY_NOT_GIVEN, 1, 0, 1, false]]) && f.countiesAffected === 9,
      'report: the counties ("king county" is King; a row without a point in its County; one with neither "county not given"; Multnomah kept as written, not one of Washington\'s); 9 Washington counties',
      f.counties);
    check(same(f.thisYear.map(r => [r.detected, r.county, r.size, r.flockType, r.species, r.active]),
      [['2026-03-14', 'Franklin', 'Large', 'Commercial', 'Turkey', false], ['2026-06-10', 'Lewis', 'Small', 'Backyard', 'Cattle, Chicken', false],
        ['2026-07-01', 'Whatcom', 'Small', 'Backyard', 'Meat Goat', false], ['2026-08-20', 'Franklin', 'Large', 'Commercial', 'Dairy cattle', true],
        ['2026-08-25', 'Yakima', 'Small', 'Backyard', 'Chicken', true], ['2026-08-28', 'Thurston', 'Small', 'Backyard', 'Chicken', true]]),
      'report: this year\'s detections, oldest first (the turkey flock of exactly 1,000 Large)', f.thisYear);
    const busy = f.byMonth.filter(m => m.commercial || m.backyard || m.other).map(m => [m.month, m.commercial, m.backyard, m.other]);
    check(f.last === '2026-08-28' && f.daysSince === 4 && f.byMonth.length === 55 && f.byMonth[0].month === '2022-03'
      && f.byMonth[54].month === '2026-09' && same(busy, [['2022-03', 1, 0, 0], ['2022-04', 0, 1, 0], ['2023-03', 0, 0, 1],
        ['2023-11', 0, 1, 0], ['2024-01', 0, 1, 0], ['2024-02', 0, 1, 0], ['2025-02', 0, 1, 0], ['2025-05', 0, 0, 1],
        ['2025-09', 0, 1, 0], ['2026-03', 1, 0, 0], ['2026-06', 0, 1, 0], ['2026-07', 0, 0, 1], ['2026-08', 0, 2, 1]]),
      'report: the last detection 4 days before the date; 55 months, March 2022 to September 2026, commercial and backyard flocks and every other row; the undated row in none',
      [f.last, f.daysSince, busy]);
    check(same(f.zones, { active: 2, counties: 2 }) && same(f.twice, { premises: 1, rows: 2 }),
      'report: zones around the 2 active rows with a point, in 2 counties (Thurston 11, active without a point, has none); one premises detected twice (Yakima 11 and 12 at the same point)', [f.zones, f.twice]);
    check(RP.statusFits('free', f) === false && RP.statusFits('active', f) === true && RP.statusFits('own', f) === null
      && RP.statusFits('free', RP.figures(rRead, '2026-08-01', COUNTY_SHAPES)) === true,
      'report: the status wording checked against the active flocks ("free" does not fit Yakima 12; it fits Aug 1, when only the goats were active; staff\'s own words not checked)');
    // Page 1's words (2.9 step 2), from the figures and types/hpai.js report.
    const w = RP.wording(f, hpai, {}, COUNTY_SHAPES.length);
    check(w.banner.active && w.banner.headline === '3 active detections: 2 flocks · 1 dairy herd'
      && w.banner.line === hpai.report.status.active + ' Last detection Aug 28, 2026, 4 days ago.',
      'report words: the banner counts every kind, split by kind; the status wording that fits the data; the last detection', w.banner);
    check(same(w.tiles.map(t => [t.label, t.value, t.sub, !!t.active]), [
      ['Active now', '3', '2 flocks · 1 dairy herd', true], ['This year', '6', 'detections in 2026', false],
      ['Flocks since 2022', '14', '2 commercial · 10 backyard · 2 other', false], ['Birds affected', '1.25M', '1,251,396 since 2022, 1 without a count', false],
      ['Counties', '9', 'of 39, since 2022', false], ['Last detection', 'Aug 28', '4 days ago', false]]),
      'report words: the six tiles (the market and the untyped flock "other"; the blank inventory said, never zero)', w.tiles);
    check(same(w.also, ['2 dairy herds (3,550 cattle)', '1 premises with other animals (6 other animals)', '1 case naming more than one kind of animal'])
      && w.zones === 'Surveillance areas are active around 2 cases in 2 counties.'
      && /1 case without a detection date: in the totals only\.$/.test(w.source),
      'report words: the other kinds named apart; the zones line; the source line names the undated row', [w.also, w.zones, w.source]);
    check(w.livestock.highlight && w.livestock.headline === '1 active livestock case in Washington'
      && w.livestock.text === 'There is 1 active confirmed livestock case in Washington state (2 cases since 2022).'
      && same(w.livestock.others, ['Other animals: 1 case since 2022, none active.']) && w.livestock.stage === 'Unaffected / Stage 4',
      'report words: the livestock card from the data (the active cattle case, the total beside it), the other farm animals a line of their own', w.livestock);
    const aug1 = RP.wording(RP.figures(rRead, '2026-08-01', COUNTY_SHAPES), hpai, { suspected: true }, 39);
    check(aug1.banner.headline === '1 active detection: 1 premises with other animals; none in domestic flocks'
      && aug1.banner.line.startsWith(hpai.report.status.free)
      && aug1.livestock.headline === 'Suspected livestock cases in Washington' && aug1.livestock.highlight
      && aug1.livestock.text === 'There are no active confirmed livestock cases in Washington state; suspected cases are being tested (1 case since 2022).',
      'report words: Aug 1, the goats active alone ("free" fits the flocks); "suspected" ticked; the two-kind row the one cattle case by then',
      [aug1.banner, aug1.livestock]);
    const own = RP.wording(f, hpai, { status: 'own', own: '  Our own words.  ' }, 39);
    check(own.status === 'Our own words.' && own.banner.line.startsWith('Our own words. Last detection'),
      'report words: staff\'s own status words, trimmed');
    const undatedOnly = RP.wording(RP.figures(rRead, '2021-01-01', COUNTY_SHAPES), hpai, {}, 39);
    check(undatedOnly.banner.headline === '1 active detection: 1 flock' && undatedOnly.banner.line.endsWith('No detection date in the table yet.')
      && undatedOnly.tiles[5].value === 'None' && undatedOnly.tiles[5].sub === '' && undatedOnly.since === '2021',
      'report words: before every dated detection, the undated Pierce 11 alone, still active; no last detection', undatedOnly);
    const none = RP.wording(RP.figures(Object.assign({}, rRead, { positives: [], dropped: [] }), RR.date, COUNTY_SHAPES), hpai, {}, 39);
    check(none.banner.headline === 'No active detections in domestic flocks' && none.banner.line === hpai.report.status.free + ' No detection yet.'
      && none.tiles.map(t => t.value).join() === '0,0,0,0,0,None' && none.zones === 'There are no currently active surveillance areas.'
      && none.livestock.text === 'There are no confirmed or suspected livestock cases in Washington state.' && !none.also.length,
      'report words: a table with no rows: none active, "free", no surveillance areas, the update\'s own livestock sentence', none);
    check(RP.dateLong('2026-09-01') === 'September 1, 2026' && RP.dateShort('2026-04-02') === 'Apr 2, 2026' && RP.dateTable('2026-03-19') === '3/19/26'
      && RP.short(4133418) === '4.13M' && RP.short(12000000) === '12M' && RP.short(66540) === '66,540' && RP.short(1250000) === '1.25M',
      'report words: the dates ("September 1, 2026", "Apr 2, 2026", "3/19/26") and the short numbers (4.13M, 12M, 66,540)');
    // The printed map's dots: one per case of a Washington county, inside it, the same at every drawing, the active first.
    const dots = RP.spread(f, COUNTY_SHAPES), again = RP.spread(f, COUNTY_SHAPES);
    const shapeOf = n => COUNTY_SHAPES.find(x => x.properties.name === n).geometry.coordinates;
    check(dots.length === 14 && same(dots, again)
      && f.counties.filter(c => c.washington).every(c => dots.filter(d => d.county === c.county).length === c.cases
        && dots.filter(d => d.county === c.county && d.active).length === c.active)
      && dots.every(d => shapeOf(d.county).some(poly => RP.inside([d.lon, d.lat], poly))),
      'report map: one dot per case in each of the 9 Washington counties (14), inside its county, the same twice, the active ones counted; Multnomah and "county not given" none', dots.length);
    const pts = new Set(rRead.positives.map(p => p.lat.toFixed(5) + ',' + p.lon.toFixed(5)));
    check(dots.every(d => !pts.has(d.lat.toFixed(5) + ',' + d.lon.toFixed(5))), 'report map: no dot at a case\'s own point');
    const islands = RP.spread({ counties: [{ county: 'San Juan', cases: 40, active: 3, washington: true }] }, COUNTY_SHAPES);
    check(islands.length === 40 && islands.every(d => shapeOf('San Juan').some(poly => RP.inside([d.lon, d.lat], poly)))
      && islands.filter(d => d.active).length === 3, 'report map: 40 dots on the San Juan islands, each on land');
    const early = RP.figures(rRead, '2021-01-01', COUNTY_SHAPES);
    check(early.cases === 1 && early.later === 16 && early.last === null && early.daysSince === null && !early.byMonth.length && !early.thisYear.length,
      'report: before every detection only the undated row is counted; no last detection, no months', [early.cases, early.later]);
    check(RP.SIZE_LINE === 'Small under 100 · Medium 100 to 999 · Large 1,000 or more' && RP.daysBetween('2026-02-28', '2026-03-01') === 1
      && RP.daysBetween('2024-02-28', '2024-03-01') === 2, 'report: the size line\'s words; days between dates by the calendar (leap years)');
    // The page's own counts are not changed by the report's: the read still leaves the rows without a point off its groups.
    check(E.groups(rRead, E.dayView(E.windowOf(rRead.positives), RR.date)).current.length === 2 && rRead.dropped.length === 3,
      'report: the page\'s own groups unchanged (the three rows without a point still "not mapped" there)');
    const ORACLE_R = path.join(ROOT, 'local-test-artifacts', 'em', 'oracle_em.json');
    const oR = fs.existsSync(ORACLE_R) ? JSON.parse(fs.readFileSync(ORACLE_R, 'utf8')).report : null;
    check(!!oR, 'R reference: the report\'s figures present (run Rscript tests/oracle/em_oracle.R)');
    if (oR) {
      for (const k of ['cases', 'later', 'undated', 'noPoint', 'active', 'flocks', 'kinds', 'birds', 'mixed', 'counties',
        'countiesAffected', 'thisYear', 'last', 'daysSince', 'byMonth', 'zones', 'twice']) {
        check(same(f[k], oR[k]), 'R reference: report: the same ' + k, { page: f[k], r: oR[k] });
      }
    }
  }

  // ---- 8i. The Report view's form (2.9, E2: site/emergency/report-form.js) ------------------------------------------
  // The words and choices staff type beside the pages: a new report text from the update's own words, what the pages
  // are drawn with, each fold's heading and warnings on em_rules_report.csv (Sep 1, 2026: 2 active flocks and the
  // dairy herd; Aug 1: only the goats), the cards' lines and hints, and the saved report text read back.
  // A form check that throws (a mutant) is one failed check, and the suite goes on.
  try {
    const RR = FX.RULES.report, rRows = csvOf(RR.positives);
    const rRead = E.readPositives(rRows[0], rRows.slice(1), hpai, RR.today);
    const SHAPES = globalThis.CVIWA_GEO.counties.features;
    const sep1 = RP.figures(rRead, '2026-09-01', SHAPES), aug1 = RP.figures(rRead, '2026-08-01', SHAPES);
    const copy = o => JSON.parse(JSON.stringify(o));
    // fresh: the update's own words, copied (the type's own words never change with the form).
    const t0 = RF.fresh(hpai);
    check(t0.type === 'hpai' && t0.status === null && t0.own === '' && t0.milk === 0 && same(t0.milkOwn, { stage: '', text: '' })
      && t0.suspected === false && t0.mapLook === 'dots' && t0.note === '' && t0.iconStyle === 'filled' && same(t0.aside, []) && t0.ready === false,
    'form: a new report text: the wording that fits the data, the first milk stage, Soft dots, Filled icons, not ready to send', t0);
    check(same(t0.messages.map(m => [m.headline, m.icon, m.link.label, m.highlight]), [
      ['Protect your flock', 'shield-check', 'USDA\'s Defend the Flock program', false],
      ['Low risk to the public', 'person', 'Reducing Exposure for Workers to Avian Influenza A Viruses', false],
      ['Moving dairy cattle', 'truck', 'APHIS Requirements and Recommendations for HPAI H5N1 Virus in Livestock', true]])
      && t0.messages.every((m, i) => m.text === hpai.report.messages[i].text && m.link.url === hpai.report.messages[i].link.url),
    'form: a new report text: the update\'s three key messages, their icons, words, links and the highlighted third', t0.messages);
    check(t0.heading === hpai.report.note && same(t0.hotline, { ask: 'Sick birds?', name: 'Sick Bird Hotline', number: '1-800-606-3056' })
      && same(t0.online, { label: 'agr.wa.gov/birdflu', url: 'https://agr.wa.gov/birdflu' }) && t0.alternate === hpai.report.alternate,
    'form: a new report text: the line under the title, the hotline, "report online at" and the alternate-format line from the update', t0);
    // The type's words are read-only: a message shared with it, not copied, could not be typed into.
    let typed = true;
    try { t0.messages[0].headline = 'Changed'; t0.hotline.number = '0'; } catch (e) { typed = false; }
    check(typed && t0.messages[0].headline === 'Changed' && hpai.report.messages[0].headline === 'Protect your flock' && hpai.report.hotline.number === '1-800-606-3056'
      && RF.fresh(hpai).messages[0].headline === 'Protect your flock',
    'form: typing in the form leaves the update\'s own words as they were (a new report text has them again)');

    // choices: what the pages are drawn with.
    const c0 = RF.choices(RF.fresh(hpai), hpai);
    check(c0.status === undefined && c0.own === '' && same(c0.milk, hpai.report.milk[0]) && c0.suspected === false && c0.mapLook === 'dots'
      && c0.note === '' && c0.iconStyle === 'filled' && c0.draft === true && c0.messages.length === 3
      && same(c0.messages[2].link, { label: hpai.report.messages[2].link.label, url: hpai.report.messages[2].link.url }) && c0.messages[2].highlight === true,
    'form: the pages from a new report text: the wording that fits, the update\'s milk stage and messages, a draft', c0);
    check(same(c0.page, { note: hpai.report.note, hotline: { ask: 'Sick birds?', name: 'Sick Bird Hotline', number: '1-800-606-3056' },
      online: { label: 'agr.wa.gov/birdflu', url: 'https://agr.wa.gov/birdflu' }, alternate: hpai.report.alternate }),
    'form: the pages\' title line and foot from the form\'s boxes', c0.page);
    const t1 = RF.fresh(hpai);
    t1.messages = [
      { headline: '  Spaced  ', icon: 'truck', text: '  words  ', link: { label: '', url: '' }, highlight: false },
      { headline: '', icon: 'truck', text: '   ', link: { label: 'Gone', url: 'https://example.org' }, highlight: true },
      { headline: 'Words only', icon: 'person', text: '', link: { label: 'A page', url: '' }, highlight: false },
      { headline: 'Address only', icon: 'person', text: '', link: { label: '', url: 'https://example.org/a' }, highlight: false },
      { headline: 'Not an address', icon: 'person', text: '', link: { label: 'Click', url: 'javascript:alert(1)' }, highlight: false },
      { headline: 'Bare', icon: 'person', text: '', link: { label: 'Site', url: 'example.org' }, highlight: false }];
    const c1 = RF.choices(t1, hpai);
    check(same(c1.messages.map(m => m.headline), ['Spaced', 'Words only', 'Address only', 'Not an address', 'Bare']) && c1.messages[0].text === 'words',
      'form: an empty message (no headline, no words) left off the pages; the words trimmed', c1.messages);
    check(c1.messages[0].link === null && same(c1.messages[1].link, { label: 'A page', url: null })
      && same(c1.messages[2].link, { label: 'https://example.org/a', url: 'https://example.org/a' }),
    'form: a link: none without words or an address; words without an address print as words; an address alone prints as itself', c1.messages.map(m => m.link));
    check(same(c1.messages[3].link, { label: 'Click', url: null }) && same(c1.messages[4].link, { label: 'Site', url: null }),
      'form: a link that is not http(s) (javascript:, or no https://) prints as words only, never as a link', c1.messages.map(m => m.link));
    t1.ready = true; t1.mapLook = 'counties'; t1.iconStyle = 'outline'; t1.status = 'own'; t1.own = ' Ours. '; t1.note = ' A gap. ';
    t1.heading = ' A line. '; t1.online = { label: '', url: 'agr.wa.gov' };
    const c1b = RF.choices(t1, hpai);
    check(c1b.draft === false && c1b.mapLook === 'counties' && c1b.iconStyle === 'outline' && c1b.status === 'own' && c1b.note === 'A gap.'
      && c1b.page.note === 'A line.' && same(c1b.page.online, { label: 'agr.wa.gov', url: null }),
    'form: "Ready to send" leaves the DRAFT mark off; Counties shaded, Outline, staff\'s own status, the note and title line trimmed; "report online at" with an address that would not open prints its words', c1b);
    t1.mapLook = 'squares'; t1.iconStyle = 'bold';
    check(RF.choices(t1, hpai).mapLook === 'dots' && RF.choices(t1, hpai).iconStyle === 'filled',
      'form: a map look or icon style that is not one draws Soft dots and Filled');
    t1.milk = 'own'; t1.milkOwn = { stage: ' Stage 2 ', text: ' Sampling. ' };
    check(same(RF.choices(t1, hpai).milk, { stage: 'Stage 2', text: 'Sampling.' }), 'form: staff\'s own milk stage and its sentence, trimmed');
    t1.milk = 5;
    check(same(RF.choices(t1, hpai).milk, hpai.report.milk[0]), 'form: a milk stage the type does not have prints the first');

    // checks: each fold's heading and warnings.
    const k0 = RF.checks(RF.fresh(hpai), hpai, sep1, '2026-09-01');
    check(same(k0.date.tag, { words: 'September 1, 2026', how: '' }), 'form: the date fold says the report\'s date', k0.date);
    check(k0.status.picked === 'active' && same(k0.status.tag, { words: 'Check', how: 'warn' }) && k0.status.statusWarn === ''
      && k0.status.milkWarn === '1 active dairy herd on September 1, 2026: check the milk testing stage.',
    'form: Sep 1: the wording that fits is "active"; the dairy herd active, so the milk stage asks to be checked', k0.status);
    check(k0.status.dataLine === 'From the data on September 1, 2026: 2 active flocks, 1 active dairy herd, 0 active premises with other animals; surveillance areas around 2 cases.',
      'form: the data\'s line beside the status, every kind', k0.status.dataLine);
    const k1 = RF.checks(RF.fresh(hpai), hpai, aug1, '2026-08-01');
    check(k1.status.picked === 'free' && same(k1.status.tag, { words: 'Matches the data', how: 'ok' }) && k1.status.milkWarn === '',
      'form: Aug 1 (only the goats active): "free" fits, the dairy herd not active, "Matches the data"', k1.status);
    const tFree = RF.fresh(hpai); tFree.status = 'free';
    check(RF.checks(tFree, hpai, sep1, '2026-09-01').status.statusWarn === 'The data has 2 active flocks on September 1, 2026: this wording says there are none. Pick the other wording, or write your own.',
      'form: "free" picked while flocks are active: the warning names them');
    const tAct = RF.fresh(hpai); tAct.status = 'active';
    const kAct = RF.checks(tAct, hpai, aug1, '2026-08-01');
    check(kAct.status.statusWarn === 'The data has no active flocks on August 1, 2026: this wording says there are some. Pick the other wording, or write your own.'
      && kAct.status.tag.how === 'warn', 'form: "active" picked with no active flock: the warning, and the fold says "Check"', kAct.status);
    const tOwn = RF.fresh(hpai); tOwn.status = 'own';
    check(RF.checks(tOwn, hpai, aug1, '2026-08-01').status.statusWarn === 'Write the sentence, or pick an approved wording.',
      'form: "Write my own" with nothing written asks for the sentence');
    tOwn.own = '  Anything at all.  ';
    const kOwn = RF.checks(tOwn, hpai, aug1, '2026-08-01');
    check(kOwn.status.statusWarn === '' && same(kOwn.status.tag, { words: 'Your own wording', how: '' }),
      'form: staff\'s own sentence is not checked against the data: "Your own wording"', kOwn.status);
    const tMilk = RF.fresh(hpai); tMilk.milk = 'own'; tMilk.milkOwn = { stage: 'Stage 2', text: '' };
    check(RF.checks(tMilk, hpai, aug1, '2026-08-01').status.milkWarn === 'Write the stage and its sentence.'
      && RF.checks(tMilk, hpai, sep1, '2026-09-01').status.milkWarn === '1 active dairy herd on September 1, 2026: check the milk testing stage. Write the stage and its sentence.',
    'form: a milk stage of staff\'s own without its sentence asks for both (after the active herd\'s reminder)');
    tMilk.milkOwn = { stage: '', text: 'Sampling.' };
    check(RF.checks(tMilk, hpai, aug1, '2026-08-01').status.milkWarn === 'Write the stage and its sentence.', 'form: a milk sentence without its stage asks for both');
    tMilk.milkOwn = { stage: 'Stage 2', text: 'Sampling.' };
    check(RF.checks(tMilk, hpai, aug1, '2026-08-01').status.milkWarn === '', 'form: a milk stage of staff\'s own with both written: no warning');
    const noLv = copy(hpai); noLv.report.livestock = null;
    const tNoLv = RF.fresh(noLv); tNoLv.milk = 'own';
    check(RF.checks(tNoLv, noLv, sep1, '2026-09-01').status.milkWarn === '', 'form: a type without a livestock card has no milk stage to check');
    check(same(k0.data.tag, { words: 'Automatic', how: 'ok' })
      && k0.data.auto === 'Filled in from the file, never typed: 2 commercial flocks, 10 backyard flocks, 1,251,396 birds affected, 9 counties; the cases by county; 6 detections in 2026; the map.',
    'form: the figures fold says "Automatic" and lists what the file fills in', k0.data.auto);
    // The boxes.
    check(same(k0.boxes.warns, []) && same(k0.boxes.tag, { words: 'Kept month to month', how: '' }), 'form: the update\'s own boxes: no warning, "Kept month to month"', k0.boxes);
    const tBox = RF.fresh(hpai); tBox.hotline.number = '  ';
    check(same(RF.checks(tBox, hpai, sep1, '2026-09-01').boxes.warns, ['The hotline has no number: the foot prints without one.'])
      && RF.checks(tBox, hpai, sep1, '2026-09-01').boxes.tag.how === 'warn', 'form: the hotline without a number: a warning, the fold says "Check"');
    tBox.hotline.number = '1'; tBox.online.url = 'agr.wa.gov/birdflu';
    check(same(RF.checks(tBox, hpai, sep1, '2026-09-01').boxes.warns, ['The address after "report online at" does not start with https:// (or http://), so it would not open: it prints as words only.']),
      'form: "report online at" with an address that would not open: a warning');
    tBox.online.url = '';
    check(same(RF.checks(tBox, hpai, sep1, '2026-09-01').boxes.warns, ['"Report online at" has no address: it prints as words only.']),
      'form: "report online at" without an address: a warning');
    tBox.online.url = 'http://agr.wa.gov/birdflu';
    check(same(RF.checks(tBox, hpai, sep1, '2026-09-01').boxes.warns, []), 'form: an http:// address opens: no warning');
    // The key messages' warnings and heading.
    const kM = RF.checks(t1, hpai, sep1, '2026-09-01');
    check(same(kM.messages.warns[0], []) && same(kM.messages.warns[1], ['Message 2 is empty, so it is left off the pages: write it, or remove it.'])
      && same(kM.messages.warns[2], ['The link has words but no address: it prints as words only.']) && same(kM.messages.warns[3], [])
      && same(kM.messages.warns[4], ['This address does not start with https:// (or http://), so it would not open: it prints as words only. Copy it from the browser\'s address bar.'])
      && kM.messages.warns[5].length === 1 && same(kM.messages.tag, { words: 'Check: 4 messages', how: 'warn' }),
    'form: each message\'s warnings (empty; link words without an address; an address that would not open); the fold counts the messages to check', kM.messages);
    check(same(k0.messages.tag, { words: '3 messages', how: '' }) && same(k0.messages.warns, [[], [], []]),
      'form: the update\'s own messages: no warning, "3 messages"', k0.messages.tag);
    const tNone = RF.fresh(hpai); tNone.messages = [];
    check(same(RF.checks(tNone, hpai, sep1, '2026-09-01').messages.tag, { words: 'No messages', how: '' }), 'form: no key messages: "No messages", nothing to check');
    const tOne = RF.fresh(hpai); tOne.messages = tOne.messages.slice(0, 1);
    check(RF.checks(tOne, hpai, sep1, '2026-09-01').messages.tag.words === '1 message', 'form: one key message: "1 message"');
    // "Still to check": the folds that say "Check", in the form's order.
    // Page 2's two folds (step 4) say "Check" until their boxes are filled.
    const P2 = ['National (USDA)', 'Wild birds and testing (WADDL)'];
    check(same(k0.checking, ['Washington: the status'].concat(P2)) && same(k1.checking, P2),
      'form: "Ready to send" names the folds still saying "Check" (Sep 1, the milk stage; both days, page 2 not filled)', [k0.checking, k1.checking]);
    const tAll = RF.fresh(hpai); tAll.messages.push({ headline: '', icon: 'truck', text: '', link: { label: '', url: '' }, highlight: false }); tAll.hotline.number = '';
    check(same(RF.checks(tAll, hpai, sep1, '2026-09-01').checking, ['Washington: the status', 'Key messages'].concat(P2, 'Boxes and resources')),
      'form: every fold saying "Check" named, in the form\'s order');
    // The cards as drawn: each message's lines (the empty one not printed), a hint for a card much longer than the one
    // beside it, the pages they print on.
    const tL = RF.fresh(hpai);
    tL.messages = ['A', '', 'B', 'C', 'D', 'E'].map(h => ({ headline: h, icon: 'truck', text: '', link: { label: '', url: '' }, highlight: false }));
    const cards = [{ m: 0, page: 1, row: 0, lines: 3 }, { m: 1, page: 1, row: 0, lines: 12 },
      { m: 2, page: 2, row: 1, lines: 8 }, { m: 3, page: 2, row: 1, lines: 4 },
      { m: 4, page: 2, row: 2, lines: 6 }, { m: 'lv', page: 3, row: 2, lines: 2 }];
    const kL = RF.checks(tL, hpai, sep1, '2026-09-01', cards).messages;
    check(same(kL.lines, [3, null, 12, 8, 4, 6]), 'form: each printed message\'s lines on its card (the empty one, not printed, none)', kL.lines);
    check(kL.pairs[2] === 'Message 3 runs about 12 lines, the card beside it 3 (message 1): shorten it, or move the messages so the long ones sit together.'
      && kL.pairs[0] === '', 'form: a card much longer than the one beside it gets a hint; the short one none', kL.pairs);
    check(kL.pairs[3] === 'Message 4 runs about 8 lines, the card beside it 4 (message 5): shorten it, or move the messages so the long ones sit together.',
      'form: twice as long and four lines more, exactly: the hint (8 lines beside 4)', kL.pairs);
    check(kL.pairs[5] === 'Message 6 runs about 6 lines, the card beside it 2 (the livestock card): shorten it, or move the messages so the long ones sit together.',
      'form: beside the livestock card, the hint names it', kL.pairs);
    const near = RF.checks(tL, hpai, sep1, '2026-09-01', [{ m: 0, page: 1, row: 0, lines: 7 }, { m: 1, page: 1, row: 0, lines: 4 },
      { m: 2, page: 1, row: 1, lines: 5 }, { m: 3, page: 1, row: 1, lines: 2 }]).messages.pairs;
    check(near.every(p => p === ''), 'form: no hint for 7 lines beside 4 (not twice as long) or 5 beside 2 (only three more)', near);
    check(same(kL.pages, [1, 2]), 'form: the key messages print on pages 1 and 2 (the livestock card\'s page 3 not counted)', kL.pages);
    const noCards = RF.checks(tL, hpai, sep1, '2026-09-01').messages;
    check(noCards.lines.every(n => n === null) && noCards.pairs.every(p => p === '') && same(noCards.pages, []),
      'form: without the drawn cards (the unit suite): no lines, hints or pages', noCards);

    // The saved report text: one small file of the form's words and choices, read back field by field.
    const tS = RF.fresh(hpai);
    Object.assign(tS, { status: 'own', own: 'Our words.', milk: 'own', milkOwn: { stage: 'Stage 2', text: 'Sampling.' }, suspected: true,
      mapLook: 'counties', note: 'A gap.', iconStyle: 'outline', heading: 'A line.', alternate: 'Call us.', ready: true });
    tS.messages[0].highlight = true; tS.messages[1].icon = 'turkey'; tS.aside.push(tS.messages.pop());
    tS.hotline = { ask: 'Q?', name: 'N', number: '1' }; tS.online = { label: 'L', url: 'https://example.org' };
    const words = RF.toFile(tS, hpai, '2026-09-01', '2026-09-03'), o = JSON.parse(words);
    check(o.kind === 'WSDA Emergency Response report text' && o.version === 1 && o.type === 'hpai' && o.reportDate === '2026-09-01' && o.saved === '2026-09-03'
      && same(Object.keys(o), ['kind', 'version', 'type', 'reportDate', 'saved', 'text']) && words.endsWith('}\n'),
    'saved report text: the kind, version, type, the report\'s date and the day saved first', Object.keys(o));
    check(same(Object.keys(o.text).sort(), Object.keys(RF.fresh(hpai)).filter(k => k !== 'type').sort())
      && !/Franklin|Yakima|1,251,396|SYN-|46\.\d{3}/.test(words),
    'saved report text: the form\'s words and choices only, nothing from the table', Object.keys(o.text));
    const back = RF.fromFile(words, hpai);
    // Read back as a draft, page 2's figures kept to compare with next month (past, step 4).
    const tSDraft = Object.assign(copy(tS), { ready: false, past: o.text.past, pastLoaded: true });
    check(same(back.text, tSDraft) && same(back.notes, []) && back.saved === '2026-09-03' && back.reportDate === '2026-09-01',
      'saved report text: read back the same, every field (messages, set aside, boxes), with no notes', back);
    check(back.text.ready === false, 'saved report text: a report text loaded is a draft ("Ready to send" unticked)');
    const freshBack = RF.fromFile(RF.toFile(RF.fresh(hpai), hpai, '2026-09-01', '2026-09-01'), hpai).text;
    check(same(Object.assign(copy(freshBack), { past: [] }), Object.assign(RF.fresh(hpai), { pastLoaded: true })) && freshBack.past.length === 1,
      'saved report text: a new report text saved and read back is the update\'s own');
    // Files that are not one.
    const notOne = { error: 'This file is not a report text saved from this page.' };
    const doc = (o2) => JSON.stringify(Object.assign({ kind: 'WSDA Emergency Response report text', version: 1, type: 'hpai', text: {} }, o2));
    check(same(RF.fromFile('not json {', hpai), notOne) && same(RF.fromFile('null', hpai), notOne) && same(RF.fromFile('[1,2]', hpai), notOne)
      && same(RF.fromFile('"words"', hpai), notOne) && same(RF.fromFile(JSON.stringify({ kind: 'Something else', version: 1 }), hpai), notOne),
    'saved report text: a file that is not one (not JSON, empty, a list, words, another kind) refused');
    check(same(RF.fromFile(doc({ version: undefined }), hpai), notOne) && same(RF.fromFile(doc({ version: 0 }), hpai), notOne)
      && same(RF.fromFile(doc({ version: '1' }), hpai), notOne) && same(RF.fromFile(doc({ version: 1.5 }), hpai), notOne),
    'saved report text: a file of the right kind without a version number (missing, 0, "1", 1.5) refused as not one');
    check(same(RF.fromFile(doc({ version: 2 }), hpai), { error: 'This report text was saved by a newer version of the page: open it there.' }),
      'saved report text: a newer version refused, and said so');
    check(same(RF.fromFile(doc({ type: 'nws' }), hpai), { error: 'This report text is for another emergency type (nws), not Highly pathogenic avian influenza (HPAI).' }),
      'saved report text: another emergency type\'s refused, both named');
    check(String(RF.fromFile(doc({ type: 'x'.repeat(100) }), hpai).error).includes('(' + 'x'.repeat(40) + ')'), 'saved report text: another type\'s name cut to 40 characters');
    const bare = RF.fromFile(doc({ text: undefined }), hpai);
    check(same(bare.text, Object.assign(RF.fresh(hpai), { pastLoaded: true })) && same(bare.notes, []) && bare.saved === null && bare.reportDate === null,
      'saved report text: a file with nothing in it gives the update\'s own, no notes, no dates');
    // Each field checked: a value the page does not know is left at the update's own and named.
    const odd = RF.fromFile(doc({ saved: 'Nov 11', reportDate: '2026-9-1', text: { status: 'maybe', own: 5, milk: 3, suspected: 'true', mapLook: 'squares',
      note: ['a'], iconStyle: 'bold', heading: 7, hotline: { ask: null, name: 'Hotline', number: 12 }, alternate: 'Call.', ready: true } }), hpai);
    check(odd.text.status === null && odd.text.own === '' && odd.text.milk === 0 && odd.text.suspected === false && odd.text.mapLook === 'dots'
      && odd.text.note === '' && odd.text.iconStyle === 'filled' && odd.text.heading === hpai.report.note && odd.text.hotline.ask === 'Sick birds?'
      && odd.text.hotline.name === 'Hotline' && odd.text.hotline.number === '1-800-606-3056' && odd.text.alternate === 'Call.' && odd.text.ready === false
      && odd.saved === null && odd.reportDate === null,
    'saved report text: each value that is not one the page knows left at the update\'s own; the good ones kept; dates not YYYY-MM-DD none', odd.text);
    check(same(odd.notes, [
      'The status choice is not one this page knows: the wording that fits the data instead.',
      'The status sentence was not words: left empty.',
      'The milk testing stage saved is not one of this page\'s: "Unaffected / Stage 4" instead.',
      'The map\'s look is not one this page knows: Soft dots instead.',
      'The note was not words: left empty.',
      'The icon style is not one this page knows: Filled instead.',
      'The line under the title was not words: the update\'s own kept.',
      'The hotline\'s question was not words: the update\'s own kept.',
      'The hotline\'s number was not words: the update\'s own kept.']),
    'saved report text: each value left out named in the form\'s own words', odd.notes);
    const odd2 = RF.fromFile(doc({ text: { milk: 0.5, messages: 'three', aside: {} } }), hpai);
    check(odd2.text.milk === 0 && same(odd2.text.messages, RF.fresh(hpai).messages) && same(odd2.text.aside, [])
      && same(odd2.notes, ['The milk testing stage saved is not one of this page\'s: "Unaffected / Stage 4" instead.',
        'The key messages were not a list: the update\'s own kept.', 'The messages set aside were not a list: none kept.']),
    'saved report text: a milk stage that is not a whole number, messages that are not a list: the update\'s own', odd2.notes);
    const odd3 = RF.fromFile(doc({ text: { milk: 'own', messages: [null, 'x', { headline: 4, text: 'W', icon: 'bell', highlight: 'yes', link: { label: 'L', url: 9 } },
      { headline: 'H', icon: 'turkey', highlight: true, link: 'none' }] } }), hpai);
    check(odd3.text.milk === 'own' && same(odd3.text.messages, [
      { headline: '', icon: 'information', text: 'W', link: { label: 'L', url: '' }, highlight: false },
      { headline: 'H', icon: 'turkey', text: '', link: { label: '', url: '' }, highlight: true }]),
    'saved report text: messages read one by one: things that are not messages dropped; a headline that is not words, an unknown icon, a highlight that is not true', odd3.text.messages);
    check(same(odd3.notes, ['Message 1\'s headline was not words: left empty.', 'Message 1\'s address was not words: left empty.',
      'Message 1\'s icon is not one of the page\'s: Information instead.']), 'saved report text: each message\'s values left out named', odd3.notes);
    const big = RF.fromFile(doc({ text: { own: 'w'.repeat(6000), messages: Array.from({ length: 70 }, (_, i) => ({ headline: 'M' + i })),
      aside: [{ headline: 'Kept', icon: 'truck' }] } }), hpai);
    check(big.text.own.length === 5000 && big.text.messages.length === 60 && big.text.messages[59].headline === 'M59'
      && same(big.text.aside.map(m => [m.headline, m.icon]), [['Kept', 'truck']]) && same(big.notes, []),
    'saved report text: words cut at 5,000 characters, at most 60 messages; the set-aside ones read back', [big.text.own.length, big.text.messages.length]);
  } catch (e) { check(false, 'form: the form\'s checks stopped', String(e && e.stack || e)); }

  // ---- 8j. Page 2 of the update (2.9: report-form.js page 2) ---------------------------------------------------------
  // The boxes typed from USDA and WADDL each month, filled from the update of September 1, 2026: each check's words and
  // its edges, the counts in the folds' headings, page 2 as it prints, "Save for ArcGIS" against the ArcGIS build
  // sheet's file, and the saved report text keeping last month's figures to compare with. A check that throws (a
  // mutant) is one failed check, and the suite goes on.
  try {
    const copy = o => JSON.parse(JSON.stringify(o));
    const RR = FX.RULES.report, rRows = csvOf(RR.positives);
    const sep1Fig = RP.figures(E.readPositives(rRows[0], rRows.slice(1), hpai, RR.today), '2026-09-01', globalThis.CVIWA_GEO.counties.features);
    const p0 = RF.fresh(hpai).p2, P = hpai.report.page2;
    check(p0.nat.source === P.national.source && p0.nat.lvSource === P.national.livestock && p0.nat.sequencing === P.national.sequencing
      && ['asOf', 'birds', 'states', 'commercial', 'backyard', 'c30', 'lastFlock', 'lastLivestock'].every(k => p0.nat[k] === '')
      && same(Object.entries(p0.wild).sort(), Object.entries({ since: '', window: '', d30: '', m30: '', d30None: false, m30None: false }).sort()) && p0.tests.asOf === '' && p0.tests.total === ''
      && p0.tests.intro === P.testing.intro && same(p0.tests.cats.map(c => c.n), Array(8).fill('')) && p0.tests.cats[2].name === 'Domestic Cattle/Milk'
      && same(p0.testingLists.map(l => l.length), [4, 3]) && same(p0.resources.map(l => l.length), [4, 4, 2]) && p0.call[1].label === 'online reporting tool',
    'page 2: a new report text: the sources, WADDL\'s sentence, the categories\' names, the box and the lists from the update; every number and date empty', p0);
    const noP2 = copy(hpai); noP2.id = 'test-no-page2'; delete noP2.report.page2;
    const tNoP2 = T.check(noP2);
    check(RF.fresh(tNoP2).p2 === null && RF.choices(RF.fresh(tNoP2), tNoP2).page2 === null && same(RF.checks(RF.fresh(tNoP2), tNoP2, sep1Fig, '2026-09-01').checking, ['Washington: the status']),
      'page 2: a type with report words but none for page 2 has no page 2: none printed, no folds to check');
    p0.nat.birds = '1'; p0.tests.cats.push({ name: 'x', n: '' }); p0.resources[0][0].label = 'changed';
    check(hpai.report.page2.testing.categories.length === 8 && hpai.report.page2.resources[0].links[0].label === 'agr.wa.gov/birdflu' && RF.fresh(hpai).p2.nat.birds === '',
      'page 2: typing into the form never changes the type\'s own words');

    // Dates and numbers as staff type them.
    check(same(['September 1, 2026', 'Sep 1, 2026', 'Sept. 1, 2026', 'sep 1 2026', '9/1/2026', '09/01/2026', '2026-09-01'].map(RF.dateOf), Array(7).fill('2026-09-01')),
      'page 2: a date typed in words, short words, 9/1/2026 or 2026-09-01');
    check(same(['', '  '].map(RF.dateOf), [null, null]) && same(['Feb 30, 2026', '13/1/2026', 'Ma 3, 2026', 'soon', '2026', 'Smarch 1, 2026'].map(RF.dateOf), Array(6).fill('')),
      'page 2: no date is null; a day that does not exist, a 13th month, "Ma" (March or May), words, a year alone: not a date (\'\')');
    check(RF.numOf('1,032', 'int') === 1032 && RF.numOf(' 690 ', 'int') === 690 && RF.numOf('0.15', 'num') === 0.15 && RF.numOf('.5', 'num') === 0.5
      && RF.numOf('', 'int') === null && Number.isNaN(RF.numOf('2.5', 'int')) && Number.isNaN(RF.numOf('about 2', 'num')) && Number.isNaN(RF.numOf('-3', 'int'))
      && Number.isNaN(RF.numOf('208.33M', 'num')), 'page 2: numbers: commas and spaces allowed; a whole number for counts; words, a minus or "M" are not numbers');

    // The update's figures, filled as on September 1, with four slips typed on purpose (checked against
    // August 1's and July 1's figures).
    const SEPT = { asOf: 'September 1, 2026', birds: '208.33', states: '50', commercial: '1032', backyard: '1211', territories: '1', c30: '3', b30: '4',
      birds30: '0.15', regional30: '3', lastFlock: 'September 1, 2026', lvStates: '1', lvCases: '2', lvRegional: '0', lastLivestock: 'August 14, 2026' };
    const filled = () => {
      const t = RF.fresh(hpai);
      Object.assign(t.p2.nat, SEPT);
      Object.assign(t.p2.wild, { since: '690', window: 'July 28 to August 27, 2026', d30None: true, m30None: true });
      Object.assign(t.p2.tests, { asOf: 'September 1, 2026', total: '9575' });
      [195, 41, 6920, 148, 2937, 4, 2627, 424].forEach((n, i) => { t.p2.tests.cats[i].n = String(n); });
      return t;
    };
    const tF = filled(), kF = RF.page2Checks(tF, '2026-09-01', 3);
    check(same(kF.why, {}) && same(kF.nat.tag, { words: 'All filled', how: 'ok' }) && same(kF.wild.tag, { words: 'All filled', how: 'ok' })
      && kF.flocks === 2243 && kF.flocksLine === 'Flocks in all: 2,243 (added up, never typed)',
    'page 2: the update of September 1 typed in full, with the three pictures: nothing to check, "All filled", the flocks added up (2,243)', kF);
    check(kF.compared === 'Compared with: nothing loaded, so "lower than last month" and "the same two reports running" are not checked. Load last month\'s report text to check them.',
      'page 2: nothing loaded: the line says what is not checked', kF.compared);
    const tS = filled();
    Object.assign(tS.p2.nat, { asOf: 'July 30, 2026', backyard: '1201', c30: '1320' });
    tS.past = [{ date: '2026-07-01', values: { 'nat.birds': '208.33', 'nat.backyard': '1200', cats: {} } },
      { date: '2026-08-01', values: { 'nat.birds': '208.33', 'nat.backyard': '1211', 'nat.commercial': '1032', cats: {} } },
      { date: '2026-09-01', values: { 'nat.backyard': '9999', cats: {} } }];
    tS.pastLoaded = true;
    const kS = RF.page2Checks(tS, '2026-09-01', 2);
    check(same(kS.why, {
      'nat.asOf': 'July 30, 2026 is 33 days before the report\'s date. Is it USDA\'s latest?',
      'nat.birds': '208.33, the same as the last two reports (July 1 and August 1). Still current on USDA\'s page?',
      'nat.backyard': '1,201 is lower than last month\'s 1,211. A number since the outbreak began never goes down.',
      'nat.c30': '1,320 in the last 30 days is more than the 1,032 commercial flocks since the outbreak began.' }),
    'page 2: four slips typed on purpose, each with its line: an old "as of", the same number two reports running, lower than last month\'s, a last-30-days number above its total', kS.why);
    check(same(kS.nat.tag, { words: '4 to check · 1 picture', how: 'warn' }) && kS.nat.checks === 4 && kS.flocks === 2233
      && kS.compared === 'Compared with: the report text of August 1, 2026 (loaded).',
    'page 2: the National fold counts them ("4 to check") and the picture to add; compared with the latest report before the date (its own date\'s left out)', [kS.nat, kS.compared]);
    check(RF.page2Checks(Object.assign(copy(tS), { pastLoaded: false }), '2026-09-01', 3).compared === 'Compared with: the report text of August 1, 2026.',
      'page 2: last month\'s figures not loaded from a file (kept from before): no "(loaded)"');
    // The edges: 31 days old is fine, 32 a check; a date after the report's; the same number but last month only; a
    // number above its total by one, and equal to it; a number lower only than the month before last.
    const edge = (change, past) => { const t = filled(); change(t.p2); if (past) t.past = past; return RF.page2Checks(t, '2026-09-01', 3).why; };
    check(same(edge(p => { p.nat.asOf = 'August 1, 2026'; p.tests.asOf = '7/31/2026'; }), {
      'tests.asOf': 'July 31, 2026 is 32 days before the report\'s date. Is it WADDL\'s latest?' }),
    'page 2: an "as of" date 31 days before the report\'s is fine, 32 days is a check (WADDL\'s too)');
    check(same(edge(p => { p.nat.lastFlock = 'September 14, 2026'; p.nat.lastLivestock = 'Sept 2, 2026'; }), {
      'nat.lastFlock': 'September 14, 2026 is after the report\'s date (September 1, 2026).', 'nat.lastLivestock': 'September 2, 2026 is after the report\'s date (September 1, 2026).' }),
    'page 2: a date after the report\'s is a check (the report\'s own date is fine)');
    check(same(edge(p => { p.nat.lastFlock = 'Smarch 1'; }), { 'nat.lastFlock': '"Smarch 1" is not a date. Type it as September 1, 2026 or 9/1/2026.' }),
      'page 2: words where a date goes: a check, with the two ways to type one');
    check(same(edge(() => {}, [{ date: '2026-08-01', values: { 'nat.birds': '208.33', cats: {} } }]), {})
      && same(edge(() => {}, [{ date: '2026-08-01', values: { 'nat.birds': '208.33', cats: {} } }, { date: '2026-07-01', values: { 'nat.birds': '208.32', cats: {} } }]), {}),
    'page 2: the same number as last month alone, or as last month but not the month before: no check');
    check(same(edge(() => {}, [{ date: '2026-08-01', values: { 'nat.states': '50', 'nat.territories': '1', cats: {} } },
      { date: '2026-07-01', values: { 'nat.states': '50', 'nat.territories': '1', cats: {} } }]), {}),
    'page 2: States and Territories may stay the same month to month: never "the same two reports running"');
    check(same(edge(p => { p.nat.b30 = '1212'; p.nat.c30 = '1032'; p.nat.birds30 = '208.34'; }), {
      'nat.b30': '1,212 in the last 30 days is more than the 1,211 backyard flocks since the outbreak began.',
      'nat.birds30': '208.34 in the last 30 days is more than the 208.33 million birds since the outbreak began.' }),
    'page 2: a last-30-days number above its total by one is a check; equal to it is fine (commercial 1,032 of 1,032)');
    check(same(edge(() => {}, [{ date: '2026-08-01', values: { 'nat.commercial': '1032', cats: {} } }, { date: '2026-07-01', values: { 'nat.commercial': '2000', cats: {} } }]), {}),
      'page 2: "lower than last month\'s" looks at last month only (the month before\'s larger number is not compared)');
    check(same(edge(p => { p.wild.since = '689'; p.tests.total = '9,574'; }, [{ date: '2026-08-01', values: { 'wild.since': '690', 'tests.total': '9575', cats: {} } }]), {
      'wild.since': '689 is lower than last month\'s 690. A number since 2021 never goes down.',
      'tests.total': '9,574 is lower than last month\'s 9,575. A count of tests run never goes down.' }),
    'page 2: Washington\'s wild birds since 2021 and WADDL\'s tests never go down either');
    check(same(edge(p => { p.nat.birds30 = 'about 2'; p.nat.states = '50 states'; p.tests.total = 'n/a'; }), {
      'nat.states': '"50 states" is not a number. Type it as USDA shows it, e.g. 1032.', 'nat.birds30': '"about 2" is not a number. Type it as USDA shows it, e.g. 0.15.',
      'tests.total': '"n/a" is not a number. Type it as WADDL shows it, e.g. 1032.' }),
    'page 2: words where a number goes: a check naming the source to copy from (USDA or WADDL)');
    check(same(edge(p => { p.nat.source = 'www.aphis.usda.gov'; p.nat.sequencing = ''; }), {
      'nat.source': 'This address does not start with https://, so it would not open. Copy it from the browser\'s address bar.' }),
    'page 2: a source address that would not open is a check; one left empty is not');
    check(same(edge(p => { p.tests.cats[0].n = 'many'; p.tests.cats.push({ name: '', n: '12' }, { name: '', n: '' }); p.testingLists[1][0].url = 'waddl.vetmed.wsu.edu';
      p.testingLists[0][2].url = ''; }), {
      'cat.0': '"many" is not a number. Type the tests as WADDL shows them, e.g. 2937.', 'cat.8': 'This category has a number but no name.',
      'list.0.2': 'The link has words but no address: it prints as words only.', 'list.1.0': 'This address would not open: it prints as words only.' }),
    'page 2: WADDL\'s categories (a word, a number with no name; an empty row ignored) and its lists\' links (no address, one that would not open)');

    // Nothing typed, and the worst case: the boxes counted, the "as of" dates said, three slips.
    const tE = RF.fresh(hpai), kE = RF.page2Checks(tE, '2026-09-01', 0);
    check(same(kE.nat.tag, { words: '15 not filled · 3 pictures', how: 'warn' }) && same(kE.wild.tag, { words: '14 not filled', how: 'warn' })
      && same(kE.why, { 'nat.asOf': 'Not filled. Type the date on USDA\'s page.', 'tests.asOf': 'Not filled. Type the date on WADDL\'s page.' })
      && kE.flocks === null && kE.flocksLine === 'Flocks in all: not filled (added up, never typed)',
    'page 2: nothing typed: "15 not filled · 3 pictures" (the worst case), WADDL\'s 14 (its 8 categories too), each "as of" said', [kE.nat, kE.wild, kE.why]);
    Object.assign(tE.p2.nat, { c30: '5000', birds30: 'about 2', lastFlock: 'September 14, 2026' });
    const kW = RF.page2Checks(tE, '2026-09-01', 1);
    check(same(kW.why, { 'nat.asOf': 'Not filled. Type the date on USDA\'s page.',
      'nat.c30': '5,000 in the last 30 days, and the total since the outbreak began is not filled: the two cannot be compared.',
      'nat.birds30': '"about 2" is not a number. Type it as USDA shows it, e.g. 0.15.',
      'nat.lastFlock': 'September 14, 2026 is after the report\'s date (September 1, 2026).', 'tests.asOf': 'Not filled. Type the date on WADDL\'s page.' })
      && same(kW.nat.tag, { words: '3 to check · 12 not filled · 2 pictures', how: 'warn' }),
    'page 2: the worst case: a last-30-days number with its total not filled, a word for a number, a date after the report\'s; counted apart from the boxes not filled', kW);
    const tN = RF.fresh(hpai); tN.p2.wild.d30None = true; tN.p2.wild.d30 = '7';
    check(RF.page2Checks(tN, '2026-09-01', 0).wild.blanks === 13 && !('wild.d30' in RF.page2Checks(tN, '2026-09-01', 0).why),
      'page 2: "No wild bird detections reported" ticked: the box is not counted or checked, whatever it holds');

    // Page 2 as it prints (report-view.js draws these words): commas, the dates in words, the flocks added up, the sources.
    const chF = RF.choices(tS, hpai, { flocks: { url: 'data:image/png;base64,AAAA' }, livestock: null, wild: null }).page2;
    check(chF.nat.commercial === '1,032' && chF.nat.backyard === '1,201' && chF.nat.flocks === '2,233' && chF.nat.flocks30 === '1,324' && chF.nat.birds === '208.33'
      && chF.nat.lastLivestock === 'August 14, 2026' && chF.nat.asOf === 'July 30, 2026' && chF.nat.source === P.national.source
      && same(chF.maps, { flocks: 'data:image/png;base64,AAAA', livestock: null, wild: null }) && chF.wild.d30None && chF.wild.d30 === null,
    'page 2 printed: numbers with their commas, the flocks added up (never typed), the dates in words, the pictures added; a value typed as it is (a check never changes it)', chF.nat);
    const tP = filled(); tP.p2.nat.birds = ''; tP.p2.nat.lastFlock = '9/1/2026'; tP.p2.nat.lvSource = 'aphis.gov'; tP.p2.tests.cats[1].n = '';
    tP.p2.resources[2].push({ label: '', url: '' }, { label: 'Words only', url: 'not an address' });
    const chP = RF.choices(tP, hpai, null).page2;
    check(chP.nat.birds === null && chP.nat.lastFlock === 'September 1, 2026' && chP.nat.lvSource === null && same(chP.maps, { flocks: null, livestock: null, wild: null })
      && same(chP.tests.cats[1], { name: 'Domestic Cats', n: null, value: 0 }) && chP.tests.since === 'January 1, 2024'
      && same(chP.resources[2].links.slice(-1), [{ label: 'Words only', url: null }]) && chP.resources[2].links.length === 3 && chP.resources[2].name === 'Public health',
    'page 2 printed: a box left empty is "not filled" (null), never last month\'s; a link that would not open its words alone; an empty link row left out', chP);

    // "Save for ArcGIS": the ArcGIS dashboard's monthly table, hpai-monthly-figures.csv, its columns and its September 1 row.
    const ARC_HEAD = 'report_date,wa_status,wa_livestock,wa_milk_stage,us_as_of,us_birds_m,us_flocks,us_commercial,us_backyard,us_states,us_territories,' +
      'us_30d_commercial,us_30d_backyard,us_30d_birds_m,us_30d_regional,us_lv_states,us_lv_cases,us_lv_regional,us_last_flock,us_last_livestock,wild_window,' +
      'wild_since_2021,wild_birds_30d,wild_mammals_30d,waddl_tests,waddl_since';
    const ARC_SEPT = '"September 1, 2026",Washington is currently considered free of highly pathogenic avian influenza in domestic flocks.,There are no confirmed ' +
      'or suspected livestock cases in Washington state.,Unaffected / Stage 4,"September 1, 2026",208.33,2243,1032,1211,50,1,3,4,0.15,3,1,2,0,"September 1, 2026",' +
      '"August 14, 2026","July 28 to August 27, 2026",690,No detections reported,No detections reported,9575,"January 1, 2024"';
    const sWords = { status: hpai.report.status.free, livestock: { text: 'There are no confirmed or suspected livestock cases in Washington state.', stage: 'Unaffected / Stage 4' } };
    const arc = RF.arcgisFile(tF, hpai, '2026-09-01', sWords);
    check(RF.ARC_COLS.join(',') === ARC_HEAD && arc.csv === ARC_HEAD + '\r\n' + ARC_SEPT + '\r\n' && arc.blanks === 0,
      'Save for ArcGIS: the monthly table\'s columns, and the update of September 1 typed in full gives its September 1 row', arc.csv);
    // A typed cell that a spreadsheet would read as a formula is written as words, a single quote before it.
    const tFm = filled(); tFm.p2.wild.window = '=cmd|\' /C calc\'!A0'; tFm.p2.nat.birds = '+5'; tFm.p2.nat.states = '@SUM(1)';
    const arcFm = RF.arcgisFile(tFm, hpai, '2026-09-01', sWords).csv;
    check(arcFm.includes('"\'=cmd|\' /C calc\'!A0"') && arcFm.includes('"\'+5"') && arcFm.includes('"\'@SUM(1)"') && !/,[=+@]/.test(arcFm),
      'Save for ArcGIS: a cell starting with =, + or @ is written as words (a single quote before it, quoted)', arcFm);
    const tQ = filled(); tQ.p2.nat.commercial = '1,032'; tQ.p2.nat.birds = ''; tQ.p2.nat.backyard = ''; tQ.p2.wild.d30None = false; tQ.p2.wild.d30 = '12';
    const arcQ = RF.arcgisFile(tQ, hpai, '2026-09-01', { status: 'Our "own" words, with a comma.', livestock: null });
    const rowQ = R.parseCsv(arcQ.csv)[1];
    check(rowQ[1] === 'Our "own" words, with a comma.' && rowQ[2] === '' && rowQ[5] === '' && rowQ[6] === '' && rowQ[7] === '1032' && rowQ[8] === '' && rowQ[22] === '12'
      && arcQ.blanks === 5 && rowQ.length === 26,
    'Save for ArcGIS: a sentence with quotes and a comma kept whole; a number with no commas; a box not filled blank (and the flocks it adds to), counted', rowQ);
    check(RF.arcgisFile(RF.fresh(hpai), hpai, '2026-09-01', sWords).blanks === 21,
      'Save for ArcGIS: nothing typed: the file still has its row, 21 figures blank');

    // The saved report text: page 2 kept with this month's figures, and last month's to compare with.
    const words = RF.toFile(tS, hpai, '2026-09-01', '2026-09-03'), o = JSON.parse(words);
    check(same(o.text.past.map(p => p.date), ['2026-09-01', '2026-08-01']) && o.text.past[0].values['nat.backyard'] === '1201'
      && o.text.past[0].values.cats['Domestic Cattle/Milk'] === '6920' && !('nat.asOf' in o.text.past[0].values) && !words.includes('data:image'),
    'saved report text: this report\'s figures (its own date\'s replaced) and the latest before it, two at most; no dates or pictures among them', o.text.past);
    const sameDay = RF.fromFile(words, hpai, '2026-09-01');
    check(!sameDay.cleared && same(sameDay.text.p2, tS.p2) && same(sameDay.notes, []),
      'saved report text: loaded for the same report date: page 2 read back as typed, every box', sameDay.text.p2);
    const next = RF.fromFile(words, hpai, '2026-10-01');
    check(next.cleared && next.text.p2.nat.birds === '' && next.text.p2.nat.asOf === '' && next.text.p2.wild.window === '' && !next.text.p2.wild.d30None
      && next.text.p2.tests.total === '' && next.text.p2.tests.cats.every(c => c.n === '') && next.text.p2.tests.cats[2].name === 'Domestic Cattle/Milk'
      && next.text.p2.nat.source === tS.p2.nat.source && same(next.text.p2.resources, tS.p2.resources) && same(next.text.p2.call, tS.p2.call)
      && same(next.text.past.map(p => [p.date, Object.entries(p.values).sort()]), o.text.past.map(p => [p.date, Object.entries(p.values).sort()])),
    'saved report text: loaded for another month: page 2\'s numbers, dates and ticks empty (never last month\'s); the sources, categories\' names, box and lists kept; the figures kept to compare', next.text.p2);
    check(RF.fromFile(words, hpai).cleared === true, 'saved report text: loaded with no report date given: page 2\'s figures left empty');
    const kNext = RF.page2Checks(Object.assign(next.text, { p2: Object.assign(next.text.p2, { nat: Object.assign(next.text.p2.nat, { backyard: '1200', birds: '208.33' }) }) }),
      '2026-10-01', 3);
    check(kNext.why['nat.backyard'] === '1,200 is lower than last month\'s 1,201. A number since the outbreak began never goes down.'
      && kNext.why['nat.birds'] === '208.33, the same as the last two reports (August 1 and September 1). Still current on USDA\'s page?'
      && kNext.compared === 'Compared with: the report text of September 1, 2026 (loaded).',
    'saved report text: next month, the checks compare with the file\'s two months ("lower than last month\'s 1,201"; 208.33 three months running)', kNext.why);
    const docP = text => JSON.stringify({ kind: 'WSDA Emergency Response report text', version: 1, type: 'hpai', reportDate: '2026-09-01', text });
    const oddP = RF.fromFile(docP({ p2: { nat: { birds: 5, source: ['x'] }, tests: { cats: 'none', intro: 3 }, resources: 'list', call: [{ headline: 7 }] },
      past: [{ date: 'Aug 1', values: {} }, { date: '2026-08-01', values: { 'nat.birds': 12, 'nat.states': '50', 'x.y': '1', cats: { A: '1', B: 2 } } }, 'x'] }), hpai, '2026-09-01');
    check(oddP.text.p2.nat.birds === '' && oddP.text.p2.nat.source === P.national.source && oddP.text.p2.tests.cats.length === 8 && oddP.text.p2.tests.intro === P.testing.intro
      && oddP.text.p2.call[0].headline === P.call[0].headline && same(oddP.text.past, [{ date: '2026-08-01', values: { 'nat.states': '50', cats: { A: '1' } } }]),
    'saved report text: page 2\'s values that are not words left at the update\'s own (or empty); only well-made months kept, and only their numbers', oddP.text);
    check(same(oddP.notes, ['Page 2\'s "Data source (address)" was not words: the update\'s own kept.', 'Page 2\'s "Birds affected (millions)" was not words: left empty.',
      'WADDL\'s sentence was not words: the update\'s own kept.', 'WADDL\'s categories were not a list: the update\'s own kept.',
      'The resources lists were not a list: the update\'s own kept.', '"Report sick birds" part 1\'s headline was not words: the update\'s own kept.']),
    'saved report text: page 2\'s values left out named', oddP.notes);

    // The boxes' and the "Ready to send" line's checks.
    const tB = filled(); tB.p2.call[1].url = 'wdfw.wa.gov'; tB.p2.resources[1][2].url = 'aphis.usda.gov/wild';
    const kB = RF.checks(tB, hpai, sep1Fig, '2026-09-01', null, 3);
    check(same(kB.boxes.warns, ['The "Report sick birds" box, part 2: its address does not start with https://, so it would not open.',
      'Wild birds and wildlife, link 3 ("USDA APHIS wild bird data"): its address would not open, so it prints as words only.']) && kB.boxes.tag.words === 'Check'
      && same(kB.nat.tag, { words: 'All filled', how: 'ok' }) && same(kB.checking, ['Washington: the status', 'Boxes and resources']),
    'page 2: the box\'s and the resources\' addresses checked in "Boxes and resources"; page 2 filled: its folds not named beside "Ready to send"', kB.boxes);
    check(RF.checks(tB, hpai, sep1Fig, '2026-09-01', null, 2).checking.includes('National (USDA)'),
      'page 2: a picture still to add keeps the National fold named beside "Ready to send"');
  } catch (e) { check(false, 'page 2: the checks stopped', String(e && e.stack || e)); }

  // ---- 8k. Figures, the update's figures on screen (2.9: report.js picked, places, hover) --------------------------
  // The report scenario on Sep 1, 2026 (em_rules_report.csv): what a county or a month clicked lists, the map's places,
  // and every hover's words, worked out by hand from its rows. A check that throws (a mutant) is one failed check.
  try {
    const RR = FX.RULES.report, rRows = csvOf(RR.positives), SH = globalThis.CVIWA_GEO.counties.features;
    const rRead = E.readPositives(rRows[0], rRows.slice(1), hpai, RR.today);
    const f = RP.figures(rRead, '2026-09-01', SH), w = RP.wording(f, hpai, {}, 39);
    const strip = r => ({ detected: r.detected, county: r.county, size: r.size, flockType: r.flockType, species: r.species, active: r.active });
    // Every row counted, in the table's shape: oldest first, the undated last, with its point and whether it is a flock.
    check(f.listed.length === f.cases && f.listed[15].detected === null && f.listed[15].county === 'Pierce'
      && f.listed.filter(r => r.lat === null).length === f.noPoint && f.listed.filter(r => r.lat === null).every(r => r.lon === null)
      && f.listed.slice(0, 15).every((r, i, a) => !i || a[i - 1].detected <= r.detected)
      && same(f.listed.filter(r => r.detected && r.detected.startsWith('2026')).map(strip), f.thisYear),
    'figures: every row listed in the table\'s shape, oldest first, Pierce 11 (no date) last; this year\'s rows the same as the table\'s', f.listed.map(r => [r.detected, r.county]));
    check(same(f.listed.filter(r => r.detected && r.detected.startsWith('2026')).map(r => r.flock), [true, true, false, false, true, true]),
      'figures: a flock is a row of birds (the two-kind Lewis row one; the goats and the dairy herd not)', f.listed.map(r => r.flock));
    // What the table lists for a pick.
    const none = RP.picked(f, null), fr = RP.picked(f, { county: 'Franklin' }), ng = RP.picked(f, { county: RP.COUNTY_NOT_GIVEN });
    check(none.heading === '2026 detections' && none.chip === null && same(none.rows, f.thisYear) && none.of === 6 && none.none === 'No detections in 2026 so far.',
      'figures: nothing picked: this year\'s 6 detections', none);
    check(fr.heading === '2026 detections' && fr.chip === 'Franklin' && same(fr.rows.map(r => r.detected), ['2026-03-14', '2026-08-20']) && fr.of === 6,
      'figures: Franklin clicked: its 2 cases this year, "2 of 6"', fr);
    check(ng.chip === 'Not given' && ng.rows.length === 0 && ng.none === 'No detections in 2026 in Not given so far.',
      'figures: "county not given" clicked: named "Not given", none this year, said so', ng);
    const aug = RP.picked(f, { month: '2026-08' }), mar22 = RP.picked(f, { month: '2022-03' }), jun23 = RP.picked(f, { month: '2023-06' });
    check(aug.heading === 'Detections' && aug.chip === 'August 2026' && same(aug.rows.map(r => r.county), ['Franklin', 'Yakima', 'Thurston']) && aug.of === 6,
      'figures: August 2026 clicked: its 3 cases (the dairy herd among them), "3 of 6"', aug);
    check(mar22.chip === 'March 2022' && same(mar22.rows.map(strip), [{ detected: '2022-03-10', county: 'King', size: 'Large', flockType: 'Commercial', species: 'Chicken', active: false }])
      && mar22.of === null, 'figures: a month of another year (March 2022) lists its case, with no "of" (it is not in this year\'s table)', mar22);
    check(jun23.rows.length === 0 && jun23.none === 'No detections in June 2023.', 'figures: a month without detections says so', jun23);
    // The map's places: one per point, the closed first.
    const pl = RP.places(f), yak = pl.find(p => p.cases.length === 2);
    check(pl.length === 12 && pl.reduce((s, p) => s + p.cases.length, 0) === f.cases - f.noPoint && pl.filter(p => p.active).length === 2
      && pl.slice(10).every(p => p.active) && yak && yak.active && same(yak.cases.map(r => [r.detected, r.active]), [['2025-02-10', false], ['2026-08-25', true]]),
    'figures: 12 places for the 13 rows with a point (Yakima 11 and 12 at one, active by 12); the 2 active places last; Thurston 11, without a point, on none',
      pl.map(p => [p.cases.length, p.active]));
    // Two premises 55 m apart are two places; the same point to 5 decimals (about a metre) is one.
    const near = (lat, lon) => ({ detected: '2026-01-02', county: 'Adams', size: 'Small', flockType: 'Backyard', species: 'Chicken', active: false, flock: true, lat, lon });
    check(RP.places({ listed: [near(47.0001, -118.5), near(47.0006, -118.5)] }).length === 2
      && RP.places({ listed: [near(47.000011, -118.500002), near(47.000014, -118.500004)] }).length === 1,
    'figures: two premises 55 m apart are two places; the same point to 5 decimals one');
    // The hovers: each tile's number and how it is counted.
    const tips = [0, 1, 2, 3, 4, 5].map(i => RP.hover.tile(f, hpai, w, i, 39));
    check(same(tips[0], { head: 'Active now', text: '3', lines: ['2 flocks · 1 dairy herd',
      'A case is active until its Close Date, or its Quarantine Release when its status says closed; counted on Sep 1, 2026.',
      'Every kind of animal, mapped or not. Surveillance areas are active around 2 cases in 2 counties.'] }), 'figures: the "Active now" hover', tips[0]);
    check(same(tips[1], { head: 'This year', text: '6 detections in 2026', lines: [
      'Detected (Confirmed Diagnosis, else Date Reported) in 2026, on or before Sep 1, 2026; listed in the table below.', '1 case without a detection date: in no year.'] }),
    'figures: the "This year" hover (the undated case in no year)', tips[1]);
    check(same(tips[2], { head: 'Flocks since 2022', text: '14', lines: ['2 commercial, 10 backyard, 1 Live Bird Market, 1 without a type, by Flock/Herd Type.',
      'Every row of birds is a flock; herds and other animals are not.', '1 premises detected more than once (the same map point): each detection counts.'] }),
    'figures: the flocks\' hover (by type, as written; a premises detected twice counted twice)', tips[2]);
    check(same(tips[3], { head: 'Birds affected', text: '1,251,396', lines: ['Flock/Herd Inventory added up over the rows of birds since 2022.',
      '1 row without a count left out, never counted as zero.', '1 row naming more than one kind of animal: in no kind\'s total.'] }),
    'figures: the birds\' hover (the whole number; the blank and the two-kind row said)', tips[3]);
    check(same(tips[4], { head: 'Counties', text: '9 of 39', lines: ['Washington\'s counties with a case since 2022.',
      'A case\'s county is its County column, else the county of its map point (or the nearest within 2 km).',
      'Not among them: Multnomah (not a Washington county); 1 case with no county and no map point.'] }), 'figures: the counties\' hover', tips[4]);
    check(same(tips[5], { head: 'Last detection', text: 'August 28, 2026', lines: ['The latest detection on or before Sep 1, 2026, 4 days before it.'] }),
      'figures: the last detection\'s hover', tips[5]);
    const aug1 = RP.figures(rRead, '2026-08-01', SH), t0 = RP.hover.tile(aug1, hpai, RP.wording(aug1, hpai, {}, 39), 0, 39);
    const day = RP.figures(rRead, '2026-08-28', SH), t5 = RP.hover.tile(day, hpai, RP.wording(day, hpai, {}, 39), 5, 39);
    check(t0.text === '1' && t0.lines[0] === '1 premises with other animals' && /counted on Aug 1, 2026\.$/.test(t0.lines[1])
      && t0.lines[2] === 'Every kind of animal, mapped or not. Surveillance areas are active around 1 case in 1 county.'
      && t5.lines[0] === 'The latest detection on or before Aug 28, 2026, the day of this update.',
    'figures: the hovers follow the date (Aug 1: the goats alone active; Aug 28: the day of the update)', [t0, t5]);
    // A county's, a month's, a bar's and a place's hover.
    const cy = name => f.counties.find(c => c.county === name);
    check(same(RP.hover.county(f, cy('Franklin'), false), { head: 'Franklin', text: '2 cases since 2022, 2 in 2026, 1 active', lines: ['Click to list its 2026 cases.'] })
      && same(RP.hover.county(f, cy('Franklin'), true).lines, ['Listed below; click again to show every county.'])
      && same(RP.hover.county(f, cy('King'), false).text, '2 cases since 2022, 0 in 2026')
      && same(RP.hover.county(f, cy('Multnomah'), false).lines, ['Not a Washington county (as the table writes it).', 'Click to list its 2026 cases.'])
      && same(RP.hover.county(f, cy(RP.COUNTY_NOT_GIVEN), false), { head: 'Not given', text: '1 case since 2022, 0 in 2026',
        lines: ['No county and no map point in the table.', 'Click to list its 2026 cases.'] }),
    'figures: a county\'s hover (its cases since the start and this year, the active ones; picked or not; Multnomah and "Not given" said)');
    const mo = ym => f.byMonth.find(m => m.month === ym);
    check(same(RP.hover.month(f, mo('2026-08'), false), { head: 'August 2026', text: '3 detections', lines: ['0 commercial, 2 backyard, 1 other · click to list them'] })
      && same(RP.hover.month(f, mo('2026-08'), true).lines, ['0 commercial, 2 backyard, 1 other · listed below; click again to show 2026\'s'])
      && same(RP.hover.month(f, mo('2022-03'), false), { head: 'March 2022', text: '1 detection', lines: ['1 commercial, 0 backyard · click to list them'] })
      && same(RP.hover.month(f, mo('2023-06'), false), { head: 'June 2023', text: '0 detections', lines: ['0 commercial, 0 backyard'] }),
    'figures: a month\'s hover (by flock type, "other" only when there is any; no click words for a month without detections)');
    check(same(RP.hover.split(f, hpai, 'flocks'), { head: 'Flocks', text: '12 commercial or backyard', lines: [
      'Commercial 2 (17%), backyard 10 (83%), by Flock/Herd Type.', 'Other types and rows without a type are not in the bar.'] })
      && same(RP.hover.split(f, hpai, 'animals'), { head: 'Birds affected', text: '1,251,196 in commercial or backyard flocks', lines: [
        'Commercial 1,251,000 (100%), backyard 196 (0%).', 'Flock/Herd Inventory added up by Flock/Herd Type; a blank left out.'] }),
    'figures: the commercial and backyard bars\' hovers (the bars\' own percentages)');
    const dairy = pl.find(p => p.cases.length === 1 && p.cases[0].species === 'Dairy cattle');
    const closed = pl.find(p => p.cases.length === 1 && p.cases[0].detected === '2022-03-10');
    check(same(RP.hover.place(yak), { head: '2 cases at this place, 1 active', text: '', lines: ['Detected Feb 10, 2025 · Backyard · Small flock · closed',
      'Detected Aug 25, 2026 · Backyard · Small flock · active', 'Yakima · its place in the table: internal only, never printed.'] })
      && same(RP.hover.place(dairy).head, 'Active case') && same(RP.hover.place(dairy).lines[0], 'Detected Aug 20, 2026 · Commercial · Dairy cattle')
      && same(RP.hover.place(closed), { head: 'Closed case', text: '', lines: ['Detected Mar 10, 2022 · Commercial · Large flock',
        'King · its place in the table: internal only, never printed.'] }),
    'figures: a place\'s hover (a premises detected twice lists both; a dairy herd by its species, not as a flock; a closed flock)');
    const eight = { lon: 0, lat: 0, active: false, cases: Array(8).fill(null).map((x, i) => ({ detected: '2024-01-0' + (i + 1), county: 'Adams', size: '', flockType: '',
      species: 'Chicken', active: false, flock: true })) };
    const h8 = RP.hover.place(eight);
    check(h8.head === '8 cases at this place' && h8.lines.length === 8 && h8.lines[6] === 'and 2 more' && h8.lines[0] === 'Detected Jan 1, 2024 · closed',
      'figures: a place of 8 cases lists 6 and "and 2 more"; a blank type and size left out of the line', h8.lines);
    // An empty table: nothing to pick or place.
    const empty = RP.figures(Object.assign({}, rRead, { positives: [], dropped: [] }), '2026-09-01', SH);
    check(RP.places(empty).length === 0 && RP.picked(empty, null).rows.length === 0 && same(RP.hover.tile(empty, hpai, RP.wording(empty, hpai, {}, 39), 5, 39),
      { head: 'Last detection', text: 'none', lines: [] }) && RP.monthName('2022-10') === 'October 2022',
    'figures: an empty table: no places, nothing listed, the last detection "none"; a month\'s name');
  } catch (e) { check(false, 'figures: the checks stopped', String(e && e.stack || e)); }

  // ---- 8l. The guide "Making the HPAI update" (2.9: site/emergency/making-the-update.html) --------------------------
  // Every button, fold, tick and heading word the guide names is the page's own (index.html and the Report view's
  // scripts), and its plain-text twin, MAKING_THE_HPAI_UPDATE.txt, names the same; the twin opens in Notepad as it is.
  try {
    const html = fs.readFileSync(path.join(SITE, 'emergency', 'making-the-update.html'), 'utf8');
    const txt = fs.readFileSync(path.join(SITE, 'emergency', 'MAKING_THE_HPAI_UPDATE.txt'), 'utf8');
    const plain = t => t.replace(/<[^>]+>/g, '').replace(/&#8595;/g, '↓').replace(/&times;/g, '×').replace(/&middot;/g, '·')
      .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    const page = plain(html), twin = txt.replace(/\s+/g, ' ');
    const code = ['index.html', 'app.js', 'report-form.js', 'report-view.js', 'report-figures.js', 'types/hpai.js']
      .map(f => fs.readFileSync(path.join(SITE, 'emergency', f), 'utf8')).join('\n').replace(/\\'/g, "'").replace(/&#8595;/g, '↓');
    const NAMES = ['Load your data', 'Report', 'Map', 'Overview', 'Fill in', 'Figures', 'Load last month\'s', 'Report date',
      'Washington: the status', 'From the data on', 'Write my own', 'Suspected livestock cases are being tested',
      'Washington: from the data', 'Soft dots (no exact place)', 'Counties shaded by cases', 'Key messages', 'Highlight',
      'Set aside', 'Add a message', 'Icon style', 'National (USDA)', 'As of', 'USDA\'s maps, last 30 days',
      'Add USDA\'s picture', 'Wild birds and testing (WADDL)', 'No wild bird detections reported in the last 30 days',
      'Testing (WADDL)', 'Boxes and resources', 'Report online at', 'Save report text', 'Save for ArcGIS',
      'hpai-monthly-figures.csv', ' report text.json', 'Matches the data', 'Automatic', 'All filled', 'Kept month to month',
      'to check', 'not filled', 'Ready to send', 'Print / Save as PDF', 'HPAI update', 'Places', 'Counties',
      'The update\'s figures: Report'];
    const missing = NAMES.filter(n => !code.includes(n)), notInPage = NAMES.filter(n => !page.includes(n.trim()) && !/json$/.test(n)),
      notInTwin = NAMES.filter(n => !twin.includes(n.trim()) && !/json$/.test(n));
    check(!missing.length, 'guide: every name it gives is the page\'s own (a button, fold, tick or heading word)', missing);
    check(!notInPage.length && !notInTwin.length, 'guide: the page and its plain-text twin name the same', { notInPage, notInTwin });
    check(page.includes('Small under 100 birds, Medium 100 to 999, Large 1,000 or more') && RP.SIZE_LINE.includes('Medium 100 to 999')
      && E.sizeClass(1000) === 'Large' && E.sizeClass(999) === 'Medium' && twin.includes('Medium 100 to 999, Large 1,000 or'),
    'guide: its flock sizes are the rules\' (1,000 Large)', RP.SIZE_LINE);
    check(!/[^\r]\n/.test(txt) && txt.split('\r\n').every(l => l.length < 100) && !/[^\x20-\x7e\r\n]/.test(txt),
      'guide: the plain-text twin with Windows\' line ends, lines under 100 characters, plain ASCII');
    const idx = fs.readFileSync(path.join(SITE, 'emergency', 'index.html'), 'utf8');
    check(/<a href="making-the-update\.html" target="_blank" rel="noopener" id="rp-guide">Making the HPAI update<\/a>/.test(idx)
      && /<title>Making the HPAI update<\/title>/.test(html) && !/<script/i.test(html),
    'guide: the form\'s opening line links it, in a new tab; the guide has no script');
  } catch (e) { check(false, 'guide: the checks stopped', String(e && e.stack || e)); }

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
    // 2.8: "Refine by species" (rules.js cviRows) with each movement's end, against CVI's query in R on the master
    // narrowed the same way.
    for (const end of cv.refine.endpoints) {
      const rr = o.cvi.refined && o.cvi.refined[end];
      const qr = globalThis.CVIWA.lookup.query(E.cviRows(master, cv.refine.species), sTargets.map(p => ({ name: p.name, lat: p.lat, long: p.lon })),
        { defaultKm: Math.max(...cv.bands), bands: cv.bands, endpoint: E.cviEndOf(end).key, filters: {} });
      const ids = flag => [...new Set(qr.matched.filter(r => !flag || r[flag]).map(r => r.CVI))].sort();
      check(rr && qr.status === rr.status && same(ids(), rr.cvis) && same(ids('hitOrigin'), rr.hit_origin) && same(ids('hitDest'), rr.hit_dest)
        && qr.summary.cvis === rr.summary.n_cvis && qr.summary.animals === rr.summary.n_animals
        && qr.summary.origins === rr.summary.n_origins && qr.summary.dests === rr.summary.n_dests,
      'R reference: the CVI movements refined to ' + cv.refine.species.join(' and ') + ', end ' + end + ', as CVI\'s run_proximity_query finds them',
      { mine: [qr.status, ids(), ids('hitOrigin'), ids('hitDest'), qr.summary], r: rr });
    }
    check(o.cvi.refined && o.cvi.refined.origin.summary.n_cvis < o.cvi.refined.either.summary.n_cvis
      && o.cvi.refined.either.summary.n_cvis < o.cvi.summary.n_cvis && !o.cvi.refined.dest.hit_origin.length,
    'R reference: the refined scenario can tell the ends and the species apart (fewer CVIs with Origin, fewer with the species)', o.cvi.refined);
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

  {   // The kinds of animal against R (2.8, option E): each row's kind, its count word and whether it is listed, and
    // the animals' totals by word, R reading the kinds' words from types/hpai.js and writing the rule fresh.
    const o = fs.existsSync(ORACLE) ? JSON.parse(fs.readFileSync(ORACLE, 'utf8')) : {};
    const sp = o.species, sRows = csvOf(FX.RULES.species.positives), sr = E.readPositives(sRows[0], sRows.slice(1), hpai);
    const mineRows = sr.positives.map(p => { const k = E.kindOf(hpai, p);
      return { id: p.id, kind: k.kind.key, kinds: E.kindKeysOf(hpai, p), mixed: k.mixed, named: k.named, one: k.one, unlisted: k.unlisted }; });
    check(sp && sr.positives.length === 20 && !sr.dropped.length && same(sp.kinds, hpai.kinds.map(k => ({ key: k.key, label: k.label, word: k.word, nameEach: k.nameEach })))
      && same(sp.rows, mineRows), 'R reference: species: the kinds read from the type file, and each row\'s kinds (mixed naming two), count word and listing, as the page',
      sp && sp.rows.filter((x, k) => !same(x, mineRows[k])).concat(mineRows.filter((x, k) => !sp.rows[k] || !same(x, sp.rows[k]))));
    const a = E.animalTotals(sr, sr.positives);
    check(sp && same(sp.totals, a.totals) && sp.missing === a.missing && sp.rows.filter(x => x.unlisted).length === 2 && sp.rows.filter(x => x.mixed).length === 3,
      'R reference: species: the animals\' totals by word in the same order (birds first, then the most, the mixed positives\' last), one animal singular; the count missing', { r: sp && sp.totals, page: a.totals });
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
    const rKinds = [...(/^KINDS <- list\(([\s\S]*?)\)\)$/m.exec(rSource) || ['', ''])[1].matchAll(/(\w+|`[^`]+`) = c\(([^)]*)/g)]
      .map(m => [m[1].replace(/`/g, ''), [...m[2].matchAll(/"([^"]*)"/g)].map(x => x[1])]);
    check(same(rKinds, hpai.kinds.map(k => [k.label, k.words])),
      'table check: its kinds of animal and their species words are the HPAI type\'s, in its order (2.8)', rKinds.map(k => k[0]));
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
        // Each "value: rows (reading)", whole: a value or a reading may hold a comma ("Other animals, not listed").
        categories[m[1]] = /different values/.test(m[2]) ? m[2]
          : [...m[2].matchAll(/(.*?): (\d+)(?: \(([^)]*)\))?(?:, |$)/g)].filter(x => x[0]).map(x => [x[1], +x[2], x[3] || '']);
      }
      const animals = /^Animals \((.+)\): (\d+) read, (\d+) not read, (\d+) blank$/m.exec(text);
      // The animals added up over every row (2.8): each column's total, read, not read and blank; null when not in the table.
      const sums = {};
      for (const l of block(/^\(a cell not read is left out\):$/)) {
        const m = /^ {2}(\S.*?)\s{2,}(?:not in the table|([\d,]+) \((\d+) read, (\d+) not read, (\d+) blank\))$/.exec(l);
        if (m) sums[m[1]] = m[2] ? [Number(m[2].replace(/,/g, '')), +m[3], +m[4], +m[5]] : null;
      }
      const county = /^ {2}"Name" (\d+), "name" (\d+), "Name County" (\d+), not a Washington county (\d+), blank (\d+)$/m.exec(text);
      const coords = /^Coordinates: mapped (\d+) \(outside the box around Washington (\d+)\), not mapped (\d+)\r\n {2}not mapped because: no coordinates (\d+), no latitude (\d+), no longitude (\d+), not readable (\d+), look swapped (\d+)$/m.exec(text);
      const GROUPS = / {2}active (\d+), closed (\d+) \(still under quarantine (\d+), not known (\d+)\), not mapped (\d+)/;
      const groupsLine = new RegExp('^What the page would show on the last detection date .*:\\r\\n' + GROUPS.source + '$', 'm').exec(text);
      const todayLine = new RegExp('^What the page opens on, today \\((\\w+ \\d+, \\d{4})\\), in both views:\\r\\n' + GROUPS.source + '\\r\\n'
        + ' {2}\\("On a day" opens on today, "Between dates" from the first detection to today: the same positives\\.\\)$', 'm').exec(text);
      return { rows: num(/^Rows below the header: (\d+)/m), ncol: num(/^Columns: (\d+)/m), columns, dates, categories,
        missing: block(/^Not found \(/).map(l => l.trim().split(/\s{2,}/)[0]),
        animals: animals ? animals.slice(1).map((v, k) => k ? +v : v) : null, sums,
        county: county ? county.slice(1).map(Number) : null, coords: coords ? coords.slice(1).map(Number) : null,
        groups: groupsLine ? groupsLine.slice(1).map(Number) : null,
        today: todayLine ? todayLine.slice(2).map(Number) : null, todayWords: todayLine ? todayLine[1] : null,
        afterToday: (/^What the page opens on: a detection is after today \((\w+ \d+, \d{4})\), so both views open on the last\r\ndetection date \((\w+ \d{4})\), the counts above\.$/m.exec(text) || []).slice(1),
        noDay: /^What the page opens on: no readable detection date, so no day to open on \(the counts above\)\.$/m.test(text), undated: num(/without a readable detection date: (\d+)$/m),
        end: (/^What the page would show on the last detection date \((\w+ \d{4})\):$/m.exec(text) || [])[1] || null };
    };
    // The day the check takes as today: the suites' fixed today, unless named.
    const TODAY = '2026-10-30';
    // update: the HPAI update's date (2.9), or "ask" with input, the words typed in the window.
    const runCheck = (file, day, update, input) => {
      const out = path.join(OUTD, path.basename(file).replace(/\.csv$/, '') + (day ? '_' + day : '') + (update ? '_u' + update.replace(/\W/g, '') : '') + '.txt');
      const hash = () => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), before = hash();
      let shown = '';
      try { shown = execFileSync('Rscript', ['--vanilla', SCRIPT, file, out, day || TODAY].concat(update ? [update] : []), { input: input || '', stdio: 'pipe' }).toString(); }
      catch (e) { return { failed: String(e.stderr || e.message).slice(0, 300) }; }
      if (hash() !== before) return { failed: 'the table changed' };
      return { text: fs.readFileSync(out, 'utf8'), shown };
    };
    // The update's figures (2.9) read back from the report: its lines joined again where the report wraps them.
    const figuresOf = text => {
      const i = text.indexOf('The HPAI update\'s figures on ');
      if (i < 0) return null;
      const body = text.slice(i).split('\r\n\r\n')[0].replace(/\r\n {4,}/g, ' ');
      const m = (re, k) => { const x = re.exec(body); return x ? x.slice(1).map(v => /^[\d,]+$/.test(v) ? Number(v.replace(/,/g, '')) : v) : null; };
      return { day: m(/^The HPAI update's figures on (\w+ \d+, \d{4})( \(the date typed was not read as a date, so today's\))?, as the update counts them$/m),
        cases: m(/^ {2}Cases: (\d+) \(left out, detected after the date: (\d+); without a readable detection date, in the totals only: (\d+); without a map point: (\d+)\)$/m),
        active: m(/^ {2}Active on the date: (\d+) \(birds (\d+), cattle (\d+), other animals (\d+)\); around a map point, so with zones: (\d+)$/m),
        flocks: m(/^ {2}Flocks \(the rows of birds\): (\d+): commercial (\d+), backyard (\d+), another type (\d+), without a type (\d+); active on the date (\d+)$/m),
        birds: m(/^ {2}Birds affected \(Flock\/Herd Inventory of the flocks\): ([\d,]+) \(without a count: (\d+)\); in the commercial flocks ([\d,]+), the backyard ones ([\d,]+)$/m),
        kinds: m(/^ {2}The other kinds: cattle (\d+) cases?(?: \(([\d,]+) animals(?:, (\d+) without a count)?\))?, other animals (\d+) cases?(?: \(([\d,]+) animals(?:, (\d+) without a count)?\))?; naming more than one kind (\d+) cases? \(([\d,]+) animals, in no kind's total\)$/m),
        counties: m(/^ {2}Counties: (\d+) of Washington's 39 have a case; their counts, largest first: ([\d, ]+|none); not a Washington county (\d+) cases?; county not given (\d+) cases?$/m),
        fromPoint: m(/^ {2}\((\d+) cases? ha(?:s|ve) a map point and a blank County: the page finds their county from the point; not counted in the counties here\)$/m),
        year: m(/^ {2}This year \((\d{4})\): (\d+) detections?; the last detection in (\w+ \d{4}|no month \(no readable date\))$/m),
        twice: m(/^ {2}Premises detected more than once \(the same map point\): (\d+) \((\d+) cases\)$/m) };
    };
    // The same, from report.js's figures on the date (the counties as the check can read them: a row with a map point
    // and a blank County takes its point's county on the page, which the check names apart).
    const SHAPES = globalThis.CVIWA_GEO.counties.features, WA_NAMES = new Set(SHAPES.map(x => x.properties.name));
    const figuresPage = (read, date, dayWords, slip) => {
      const f = RP.figures(read, date, SHAPES), k = key => f.kinds.find(x => x.key === key);
      const kindPart = x => [x.cases, x.cases ? x.animals : undefined, x.cases && x.missing ? x.missing : undefined];
      const named = f.rows.map(p => txt(p.county) ? E.countyOf(p, SHAPES) : p.lat === null ? 'not given' : null);
      const counts = new Map();
      named.filter(c => WA_NAMES.has(c)).forEach(c => counts.set(c, (counts.get(c) || 0) + 1));
      const top = [...counts.values()].sort((a, b) => b - a);
      const fromPoint = named.filter(c => c === null).length;
      const year = f.thisYear.length;
      return { day: [dayWords, slip ? ' (the date typed was not read as a date, so today\'s)' : undefined],
        cases: [f.cases, f.later, f.undated, f.noPoint], active: [f.active, k('birds').active, k('cattle').active, k('other').active, f.zones.active],
        flocks: [f.flocks.total, f.flocks.commercial, f.flocks.backyard, f.flocks.others.reduce((s, o) => s + o[1], 0), f.flocks.untyped, f.flocks.active],
        birds: [f.birds, f.kinds[0].missing, f.flocks.birds.commercial, f.flocks.birds.backyard],
        kinds: kindPart(k('cattle')).concat(kindPart(k('other')), [f.mixed.cases, f.mixed.animals]),
        counties: [counts.size, top.length ? top.join(', ') : 'none', named.filter(c => c && c !== 'not given' && !WA_NAMES.has(c)).length,
          named.filter(c => c === 'not given').length].map(v => /^\d+$/.test(String(v)) && typeof v === 'string' ? Number(v) : v),
        fromPoint: fromPoint ? [fromPoint] : null, year: [Number(date.slice(0, 4)), year, f.last ? RP.monthName(f.last.slice(0, 7)) : 'no month (no readable date)'],
        twice: [f.twice.premises, f.twice.rows], countiesAffected: f.countiesAffected };
    };
    // The two compared: the check's own figures, and its counties against the page's own count when no row takes its
    // county from its point.
    const sameFigures = (r, p) => r && same(Object.assign({}, r, { countiesAffected: p.countiesAffected }), p)
      && (p.fromPoint || r.counties[0] === p.countiesAffected);

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
      // The animals added up over every row, mapped or not, each cell read as the inventory is (2.8); Depop Inventory
      // is not read by the page, so its cells are read here by the same rule.
      const sumOf = i => {
        if (i < 0) return null;
        const v = rows.map(r => r[i]), n = v.map(E.inventoryOf);
        return [n.reduce((t, x) => t + (x || 0), 0), n.filter(x => x !== null).length,
          v.filter((x, k) => x && n[k] === null).length, v.filter(x => !x).length];
      };
      const depop = header.findIndex(h => txt(h).toLowerCase() === 'depop inventory');
      const sums = { [inv < 0 ? 'Flock/Herd Inventory' : header[inv]]: sumOf(inv),
        [depop < 0 ? 'Depop Inventory' : header[depop]]: sumOf(depop) };
      const mark = (i, v) => {
        if (i === at(read.columns.status)) return v ? (T.statusOf(hpai, v) || { label: 'no status' }).label : 'no status';
        if (i === at(read.columns.closed)) return T.isClosed(hpai, v) ? 'closed' : '';
        if (i === at(read.columns.quarantineStatus)) return v ? T.quarantineStatusOf(hpai, v) || 'not read' : '';
        if (i === at(read.columns.species)) { const k = E.kindOf(hpai, { species: v }); return k.indices.map(j => hpai.kinds[j].label).join(' and ') + (k.unlisted ? ', not listed' : ''); }
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
      return { read, header, rows, ncol: header.length, columns, missing, dates, animals, sums, categories, county, coords,
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
      check(same(r.sums, page.sums), 'table check: ' + name + ': Flock/Herd Inventory and Depop Inventory added up over every row, as the page reads an inventory (2.8)',
        { r: r.sums, page: page.sums });
      const sortCats = c => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, typeof v === 'string' ? v
        : v.slice().sort((a, b) => (a.join('|') < b.join('|') ? -1 : a.join('|') > b.join('|') ? 1 : 0))]));
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
      // The update's figures (2.9), counted on today when no date is given, as report.js counts them.
      const fr = figuresOf(run.text), fp = figuresPage(page.read, TODAY, 'October 30, 2026');
      check(sameFigures(fr, fp), 'table check: ' + name + ': the update\'s figures on today (no date given), as report.js counts them', { r: fr, page: fp });
    }
    // The update's figures on the update's own date (2.9): the report scenario on Sep 1 and Aug 1, 2026 and Dec 31,
    // 2025 (another year), as report.js
    // counts them; the date asked for in the window (as CHECK_HPAI_TABLE.bat runs it), Enter for today, and a date that
    // is not one said so and counted on today.
    {
      const file = path.join(FXD, FX.RULES.report.positives), page = pageOf(file);
      for (const [iso, words] of [['2026-09-01', 'September 1, 2026'], ['2026-08-01', 'August 1, 2026'], ['2025-12-31', 'December 31, 2025']]) {
        const run = runCheck(file, TODAY, iso), fr = run.text ? figuresOf(run.text) : null, fp = figuresPage(page.read, iso, words);
        check(!run.failed && sameFigures(fr, fp) && !leaks(run.text, page).length,
          'table check: the report scenario: the update\'s figures on ' + words + ' as report.js counts them, no name or full date', { r: fr, page: fp });
      }
      // A case closed by its release date (no Close Date) is active on an update's date before the release:
      // em_rules_closed_day.csv on Jan 15, 2024, Yakima 12 released Feb 1, 2024.
      const cd = path.join(FXD, 'em_rules_closed_day.csv'), cdPage = pageOf(cd), cdRun = runCheck(cd, TODAY, '2024-01-15');
      const cdR = cdRun.text ? figuresOf(cdRun.text) : null, cdP = figuresPage(cdPage.read, '2024-01-15', 'January 15, 2024');
      check(!cdRun.failed && sameFigures(cdR, cdP) && cdR.active && cdR.active[0] === 2,
        'table check: em_rules_closed_day.csv on Jan 15, 2024: 2 active (Yakima 12, closed by its release on Feb 1, 2024, and the undated Yakima 18), as report.js', { r: cdR, page: cdP });
      const sep = figuresOf(runCheck(file, TODAY, '2026-09-01').text || '');
      check(sep && sep.cases && same(sep.cases, [16, 1, 1, 3]) && same(sep.flocks, [14, 2, 10, 1, 1, 2]) && same(sep.birds, [1251396, 1, 1251000, 196])
        && same(sep.counties, [9, '2, 2, 2, 2, 2, 1, 1, 1, 1', 1, 1]) && same(sep.year, [2026, 6, 'August 2026']),
      'table check: the report scenario on Sep 1, 2026, by hand: 16 cases, 14 flocks (2 commercial, 10 backyard), 1,251,396 birds, 9 counties, 6 this year', sep);
      const typed = runCheck(file, TODAY, 'ask', '9/1/2026\n'), enter = runCheck(file, TODAY, 'ask', '\n'), slip = runCheck(file, TODAY, 'ask', 'Sept 1\n');
      const t = typed.text ? figuresOf(typed.text) : null, e = enter.text ? figuresOf(enter.text) : null, s = slip.text ? figuresOf(slip.text) : null;
      const dayOf = x => (x && x.day) || [];
      check(t && same(t.cases, sep.cases) && dayOf(t)[0] === 'September 1, 2026'
        && /^\n {2}To compare with an update already sent, type its date \(for example 9\/1\/2026\),\n {2}or press Enter for today: \n/.test(typed.shown)
        && e && dayOf(e)[0] === 'October 30, 2026' && !dayOf(e)[1] && same(e.cases, [17, 0, 1, 3])
        && s && dayOf(s)[0] === 'October 30, 2026' && dayOf(s)[1] === ' (the date typed was not read as a date, so today\'s)',
      'table check: the date asked for in the window: 9/1/2026 typed counts on Sep 1; Enter on today; "Sept 1" said not read, counted on today',
        { t: t && t.day, e: e && [e.day, e.cases], s: s && s.day, shown: (typed.shown || '').slice(0, 160) });
      const part = (typed.text || '').slice((typed.text || '').indexOf('The HPAI update\'s figures on ')).split('\r\n\r\n')[0];
      const wide = part.split('\r\n').filter(l => l.length > 116);
      check(part.length > 200 && !wide.length, 'table check: the update\'s figures without a line wider than 116 characters (Notepad without scrolling sideways)', wide);
      const bat = fs.readFileSync(path.join(ROOT, 'tools', 'work-pc', 'CHECK_HPAI_TABLE.bat'), 'latin1');
      check(/^"%R_EXE%" --vanilla "%HERE_NOSLASH%\\check_hpai_table\.R" "%PICKED%" "%REPORT%" "%TODAY%" ask\r$/m.test(bat),
        'table check: CHECK_HPAI_TABLE.bat runs the check with today and "ask", so R asks for the update\'s date');
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
    // The animals added up (2.8): the edge table's 15 readable cells of 1,200, the 4 not mapped among them, its
    // "1200.5" and "12,00" left out, its Depop Inventory all blank; the agreed table's commas read; the demo table
    // without either column.
    const agreedSums = reportOf(runCheck(path.join(FXD, 'em_positives_agreed.csv')).text || '').sums;
    const demoSums = reportOf(runCheck(path.join(FXD, 'em_positives_demo.csv')).text || '').sums;
    check(same(edge.sums, { 'Flock/Herd Inventory': [18000, 15, 2, 0], 'Depop Inventory': [0, 0, 0, 17] })
      && same(agreedSums, { 'Flock/Herd Inventory': [1268535, 3, 0, 1], 'Depop Inventory': [1268535, 3, 0, 1] })
      && same(demoSums, { 'Flock/Herd Inventory': null, 'Depop Inventory': null }),
    'table check: the animals added up over every row: 18,000 on the edge table (its 4 not mapped counted, 2 cells not read left out), commas read, "not in the table" without the columns',
    { edge: edge.sums, agreed: agreedSums, demo: demoSums });
    const edgeText = fs.readFileSync(path.join(OUTD, 'em_table_check_edge.txt'), 'utf8');
    check(/not read, written as: "9\.9\.9999" 1, "99999" 1/.test(edgeText) && /not read, written as: "99\/99\/9999" 1/.test(edgeText)
      && /written M\/D\/YYYY 11, M\/D\/YYYY with a time 2, YYYY-MM-DD 1, YYYY\/M\/D 1/.test(edgeText)
      && /"aa aaaa": 1 \(not read\)/.test(edgeText)
      && /"aaa": 1 \(Other animals\)/.test(edgeText) && /"aaaaaa aaa aaa": 1 \(Other animals\)/.test(edgeText) && /Opossum: 2 \(Other animals, not listed\)/.test(edgeText)
      && /"aaaaaa  aaaaaa": 1 \(Birds\)/.test(edgeText) && /\(blank\): 1 \(Birds\)/.test(edgeText) && /Dairy cattle: 2 \(Cattle\)/.test(edgeText) && /"aaaaaa, aaaaaaa": 1 \(Birds and Cattle\)/.test(edgeText) && !/on hold/.test(edgeText) && /\(a value of 54 characters\): 1/.test(edgeText)
      && /Rows below the header: 17 \(1 empty row not counted, as the page skips them\)/.test(edgeText),
    'table check: the edge table: unread dates by their shape only, the forms read, an unread quarantine status in one row by its shape, a long value counted not shown; each species with its kind (an unlisted one said so, one naming two kinds both)', edgeText.slice(0, 300));

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
