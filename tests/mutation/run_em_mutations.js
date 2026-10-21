#!/usr/bin/env node
'use strict';
// Emergency Response spot mutations: changes to the rules (which positives get zones, names, the coarse-location
// rule, the edge, the counts, the "nearest" line, the boxes, dates), the types, recognition and the page must each
// fail a suite.
//
// Each mutant changes one exact piece of code in a temporary copy of the repository; the suite named for its group
// must then report failed checks. A suite that stops early does not count as catching it.
//   unit   site/emergency/rules.js, types.js, datasets.js and site/shared/recognize.js, against the Emergency unit
//          suite (which also compares the rules with the R reference)
//   page   site/emergency/app.js and index.html, against the Emergency Chrome suite's parts "page" and "results"
//          (foreground only; about 40 seconds a mutant, so run a few numbers at a time to stay under 600 seconds)
//
// Usage (repository root): node tests/mutation/run_em_mutations.js unit|page [numbers ...]
//                          node tests/mutation/run_em_mutations.js list
// The unmutated suite runs first in the same copy and must pass. The copy is deleted at the end, and the
// repository's files are checked unchanged (SHA-256). Logs and a ledger: local-test-artifacts/em/mutations/.
// Copied from tests/mutation/run_s11_mutations.js (its copy, run and ledger), with the Emergency suites.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 'em', 'mutations');
const TEMP = path.join(ROOT, 'local-test-artifacts', 'em', 'mutation-copy-' + process.argv[2]);
const COPY = path.join(TEMP, 'platform');
const RU = 'site/emergency/rules.js', TY = 'site/emergency/types.js', DS = 'site/emergency/datasets.js';
const RE = 'site/shared/recognize.js', AP = 'site/emergency/app.js', HT = 'site/emergency/index.html';

// [name, file, exact original text, replacement]
const GROUPS = {
  unit: [
    ['closed positives get zones', RU,
      "return positives.filter(p => on.has(p.status ? p.status.label : 'none') && (!p.closed || ticks.closed));",
      "return positives.filter(p => on.has(p.status ? p.status.label : 'none'));"],
    ['applyTo "confirmed" ticks every status', RU,
      "return { statuses: applyTo === 'confirmed' ? [type.statuses[0].label] : all, closed: applyTo === 'all' };",
      "return { statuses: all, closed: applyTo === 'all' };"],
    ['names: the county left out of "Positive n (County)"', RU,
      "name: id || 'Positive ' + n + (county ? ' (' + county + ')' : ''),", "name: id || 'Positive ' + n,"],
    ['dates: M/D/YYYY read as D/M/YYYY', RU, 'y = +m[3]; mo = +m[1]; d = +m[2];', 'y = +m[3]; mo = +m[2]; d = +m[1];'],
    ['coarse: a street-level location left out', RU, "if (v !== 'rooftop' && v !== 'street') return",
      "if (v !== 'rooftop') return"],
    ['coarse: a missing match_status column counts against the point', RU,
      "if (p.match_status !== undefined && text(p.match_status) !== 'Matched')", "if (text(p.match_status) !== 'Matched')"],
    ['coarse: a town-level location kept', RU, "    if (TOWN_LEVEL.test(text(point.geoSource))) return 'located only to a town';\n", ''],
    ['coarse: a point not placed kept', RU, "    if (UNPLACED.test(text(point.geoSource))) return 'not placed';\n", ''],
    ['edge: a site on a ring\'s edge left out', RU, 'if (km === null || km > s.bufferKm) return;',
      'if (km === null || km >= s.bufferKm) return;'],
    ['counts: a site inside two zones counted twice', RU, 'const insideCount = new Set(found.map(siteKey)).size;',
      'const insideCount = found.length;'],
    ['nearest: the farthest site', RU, 'if (!nearest || km < nearest.exactKm ||', 'if (!nearest || km > nearest.exactKm ||'],
    ['boxes: a missing Detection Date shown as a value', RU,
      "!read.columns.detected ? { value: null, reason: 'Not available: needs Detection Date' }",
      "!read.columns.detected ? { value: 0, reason: null }"],
    ['types: a status spelled in capitals not recognized', TY,
      "const v = String(value == null ? '' : value).trim().toLowerCase();\n    if (!v) return null;",
      "const v = String(value == null ? '' : value).trim();\n    if (!v) return null;"],
    ['types: a disease word matches inside a word', TY,
      'if (at === 0 || !/[a-z0-9]/.test(textLower[at - 1])) return true;', 'return true;'],
    ['types: an http link accepted', TY, "!/^https:\\/\\/[^\\s\"<>]+$/.test(url)", "!/^https?:\\/\\/[^\\s\"<>]+$/.test(url)"],
    ['datasets: "Surveillance Closed" not a marker', DS,
      "const MARKERS = ['Surveillance Closed', 'Case Status',", "const MARKERS = ['Case Status',"],
    ['recognition: bundle.json ignored for zone files', RE, 'let ds = fits.find(d => d.id === mappedId);', 'let ds = null;'],
    ['recognition: CSV files matched against the zone dataset', RE,
      "const dsList = allList.filter(d => d.kind !== 'zone'), zoneList", 'const dsList = allList, zoneList'],
    ['recognition: a shapefile part without its reason', RE,
      "if (zoneSets.length && SHAPEFILE_PARTS.includes(ext)) return", "if (false) return"]
  ],
  page: [
    ['the loader stays open after a clean load', AP, "if (ready && !failed && !notes.length) $('load-fold').open = false;",
      'void ready;'],
    ['a zone file in the files replaces the rings at once', AP,
      "state.useZones = source === 'page' || state.type.zones.source === 'file';", 'state.useZones = true;'],
    ['rings in the wrong order accepted', AP, 'next.every((r, i) => i === 0 || r.distance > next[i - 1].distance);', 'true;'],
    ['the sites outside the zones not drawn', AP,
      "outside.push({ lat: p.lat, lon: p.lon, shape: l.shape, color: l.color, label: name + ' (' + l.label + ')' });", 'void name;'],
    ['the type\'s "?" leaves its fold closed', AP, 'if (fold && !note.hidden) fold.open = true;', 'void fold;'],
    ['the left-out sites not listed', AP, '    if (r.leftOut.length) {\n      const d = el(\'details\', \'em-leftout\')',
      '    if (false) {\n      const d = el(\'details\', \'em-leftout\')'],
    ['CVI movements: origins only', AP, "const opts = { endpoint: 'either',", "const opts = { endpoint: 'origin',"],
    ['the CVI export keeps the address column', AP, 'const header = state.master.header.filter(h => !E.PRIVATE.test(h));',
      'const header = state.master.header;'],
    ['the boxes say nothing of a missing column', AP,
      "card.querySelector('strong').textContent = value === null ? note :", "card.querySelector('strong').textContent = value === null ? '0' :"],
    ['at 320 pixels the results widen the page', HT, '.explore { grid-template-columns: minmax(0, 1fr); }',
      '.explore { grid-template-columns: 1fr; }'],
    ['the sidebar scrolls away with the results', HT, '.em-controls { position: sticky;', '.em-controls { position: static;'],
    ['an added point\'s typed name not used', AP, '        p.name = typed || p.first;', '        void typed;'],
    ['a removed point\'s name given again', AP, 'const n = ++state.pointsAdded;', 'const n = state.points.length + 1;']
  ]
};

// The references and inputs the suites read (the sample is written by the Chrome suite's part "load").
const ARTIFACTS = ['local-test-artifacts/em/oracle_em.json', 'local-test-artifacts/em/sample'];

const mode = process.argv[2];
const picks = process.argv.slice(3).map(Number);
if (mode === 'list') {
  Object.keys(GROUPS).forEach(g => GROUPS[g].forEach((m, i) => console.log(g + ' ' + (i + 1) + '. ' + m[0] + ' (' + m[1] + ')')));
  process.exit(0);
}
if (!GROUPS[mode] || picks.some(n => !Number.isInteger(n) || n < 1 || n > GROUPS[mode].length)) {
  throw new Error('Use: <unit|page> [numbers ...] | list');
}
const list = GROUPS[mode].map((m, i) => ({ n: i + 1, name: m[0], file: m[1], from: m[2], to: m[3] }))
  .filter(m => !picks.length || picks.includes(m.n));

const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const files = [...new Set(list.map(m => m.file))];
const before = Object.fromEntries(files.map(f => [f, sha(path.join(ROOT, f))]));

// One run of the group's suite in the copy: the summary line, the failed checks and whether it stopped early.
function runSuite(label) {
  const started = Date.now();
  const suite = mode === 'page' ? ['tests/browser/run_em_browser.js', 'page', 'results'] : ['tests/node/run_em_unit_tests.js'];
  const r = cp.spawnSync(process.execPath, suite, { cwd: COPY, encoding: 'utf8',
    maxBuffer: 64 << 20, timeout: 5 * 60000, killSignal: 'SIGINT' });
  const output = (r.stdout || '') + (r.stderr || '');
  fs.writeFileSync(path.join(OUT, mode + '-' + label + '.log'), output);
  // The suite's summary line (the unit suite lists its failures after it).
  const m = [...output.matchAll(/(\d+) passed, (\d+) failed/g)].pop();
  const fails = output.split('\n').filter(l => /^\s*FAIL /.test(l));
  return { status: r.status, passed: m ? Number(m[1]) : null, failed: m ? Number(m[2]) : null,
    crashed: !m || r.signal !== null, firstFails: fails.slice(0, 4).map(l => l.slice(0, 200)),
    seconds: Math.round((Date.now() - started) / 1000) };
}

if (fs.existsSync(TEMP)) throw new Error('A mutation-copy folder exists: inspect the interrupted run before starting again.');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
let caught = 0;
let restored = true;
try {
  for (const d of ['site', 'tests']) fs.cpSync(path.join(ROOT, d), path.join(COPY, d), { recursive: true });
  for (const a of ARTIFACTS) fs.cpSync(path.join(ROOT, a), path.join(COPY, a), { recursive: true });
  // The fixtures (and test-tables/ in the copy) for the suites.
  cp.execFileSync(process.execPath, ['tests/synthetic/make_em_fixtures.js'], { cwd: COPY, stdio: 'ignore' });
  const base = runSuite('baseline');
  console.log('unmutated: ' + JSON.stringify(base));
  results.push(Object.assign({ baseline: mode }, base));
  if (base.status !== 0 || base.failed !== 0 || base.crashed) throw new Error('The unmutated suite must pass before mutations.');
  for (const m of list) {
    const p = path.join(COPY, m.file);
    const original = fs.readFileSync(p, 'utf8');
    const hash = sha(p);
    const count = original.split(m.from).length - 1;
    if (count !== 1) throw new Error(m.n + '. ' + m.name + ': expected exactly one match, found ' + count);
    fs.writeFileSync(p, original.replace(m.from, () => m.to));
    let r;
    try {
      r = runSuite(String(m.n));
    } finally {
      fs.writeFileSync(p, original);
    }
    restored = restored && sha(p) === hash;
    const ok = r.status === 1 && r.failed > 0 && !r.crashed;
    if (ok) caught++;
    results.push(Object.assign({ n: m.n, name: m.name, file: m.file, caught: ok }, r));
    console.log(m.n + '. ' + (ok ? 'caught' : r.crashed ? 'STOPPED (not counted)' : 'MISSED') + ': ' + m.name + ' (' +
      r.passed + ' passed, ' + r.failed + ' failed, ' + r.seconds + ' s)');
    (r.firstFails || []).forEach(l => console.log('     ' + l));
  }
} finally {
  fs.rmSync(TEMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  fs.writeFileSync(path.join(OUT, mode + '-' + (picks.join('-') || 'all') + '.json'), JSON.stringify(results, null, 2) + '\n');
}
const unchanged = files.every(f => sha(path.join(ROOT, f)) === before[f]);
console.log(mode + ': ' + caught + ' of ' + list.length + ' mutants caught; copy restored: ' + restored
  + '; repository files unchanged: ' + unchanged + '; copy deleted: ' + !fs.existsSync(TEMP));
if (caught !== list.length || !restored || !unchanged) process.exitCode = 1;
