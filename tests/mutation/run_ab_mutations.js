#!/usr/bin/env node
'use strict';
// AB mutation checks (the all-in-one bundle). Each mutation is applied to a copy of the repository's site
// and tests (local-test-artifacts/ab/mutation-copy/, deleted at the end), one at a time, and must make a suite fail:
//   unit: mutations of bundle.js, checklist.js, sample.js, guide.js and landing.js against
//         node tests/node/run_f1_unit_tests.js (about 15 seconds each);
//   page: mutations of landing.js, guide.js and the Infrastructure page against node tests/browser/run_f1_browser.js
//         (about 30 seconds each, Chrome in the foreground as the suite needs).
// The copy first runs the unmutated suite (it must pass; in page mode the F1 unit tests run first, since they write
// the fixtures the browser suite reads); after each mutation the copied file is restored and checked by SHA-256, and at
// the end the repository's copies of the mutated files are checked unchanged by SHA-256. A mutation is "caught" only
// when the suite runs to its summary line and reports at least one failed check. Each suite run is stopped after
// 9 minutes (with SIGINT, so the browser suite closes its Chrome).
// Usage (repository root): node tests/mutation/run_ab_mutations.js unit|page [number ...]
//   (numbers: run only those, 1-based, as listed). Node >= 22, no packages.
const fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');
const COPY = path.join(ROOT, 'local-test-artifacts', 'ab', 'mutation-copy');
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const BUNDLE = 'site/shared/bundle.js', CHECK = 'site/shared/checklist.js', SAMPLE = 'site/shared/sample.js';
const GUIDE = 'site/shared/guide.js', LANDING = 'site/landing.js', INFRA = 'site/infrastructure/app.js';
const UNIT = [   // [name, file, text, replacement]
  ['"profiles" ignored', BUNDLE, 'if (obj.profiles !== undefined) info.profiles', 'if (false) info.profiles'],
  ['the older "profile" not read as a list', BUNDLE, 'if (!info.profiles && single) info.profiles = [single];', ''],
  ['no warning when "profile" and "profiles" disagree', BUNDLE,
    "warnings.push('bundle.json gives both \"profile\" and \"profiles\" and they differ; \"profiles\" was used');", ''],
  ['release left out of the banner', BUNDLE, 'if (info.release) parts.push(', 'if (false) parts.push('],
  ['a number version refused', BUNDLE, "typeof r.version === 'number' && isFinite(r.version) ? String(r.version)", "false ? ''"],
  ['files entries only for the first listed dashboard', BUNDLE, 'if (list && !list.includes(profile.id)) {', 'if (list && list[0] !== profile.id) {'],
  ['checkFor without the user\'s picks', CHECK, 'R.recognize(load.items, other, { assign: st.assign, choices: st.choices,',
    'R.recognize(load.items, other, { assign: {}, choices: {},'],
  ['checkFor answers while a newer check runs', CHECK, 'if (version !== st.version || load !== st.load || st.busy) return null;',
    'if (version !== st.version || load !== st.load) return null;'],
  ['checkFor without the shared mappings', CHECK, 'B.filesFor(displayBundle, other, { reuseShared: true, datasets: shared })',
    'B.filesFor(displayBundle, other)'],
  ['the master put in facilities/', SAMPLE, "const folder = name === 'CVI_Consolidated_Master.csv' ? 'cvi' : 'facilities';", "const folder = 'facilities';"],
  ['the sample without its release', SAMPLE, "profiles: ['cvi', 'infrastructure'],\n      release: { name: 'Synthetic sample', version: '1', date: '2026-09-15' }",
    "profiles: ['cvi', 'infrastructure']"],
  ['the safety note dropped', GUIDE, '<strong>This viewer does not make a bundle safe to share.</strong>', '<strong>Bundles.</strong>'],
  ['some features off still called "Ready."', LANDING, "if (off.length) return { kind: 'partial'", "if (false) return { kind: 'partial'"],
  ['routing to the first listed even when it is not available', LANDING,
    'const available = list.map(id => PROFILES.find(x => x.id === id && x.available)).find(Boolean);',
    'const available = PROFILES.find(x => x.id === list[0] && x.available);'],
  // later fixes
  ['a choice on a facility layer still "Ready."', LANDING, 'if (map && map.on && choices.length) {', 'if (false) {'],
  ['the older "profile" used without saying so', BUNDLE, `warnings.push(single ? 'bundle.json "profiles" names no dashboard' + instead`,
    `warnings.push(false ? 'bundle.json "profiles" names no dashboard' + instead`],
  ['rejected entries quoted in full', BUNDLE, "const quoted = s => s.length > 60 ? s.slice(0, 59) + '…' : s;", 'const quoted = s => s;'],
  ['marks that reorder text kept', BUNDLE, '\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]', ']'],
  ['checkFor works while a pick is checked', CHECK, 'if (!st.load || !st.result || st.busy) return null;', 'if (!st.load || !st.result) return null;']
];
const PAGE = [
  ['no direct open', LANDING, 'const direct = !checking && !!ready && ready.readiness.open && ready.version === cl.version;', 'const direct = false;'],
  ['readiness not worked out again after a choice', LANDING, 'if (state.readyKey === key) return;', 'if (state.readyKey) return;'],
  ['no "Not listed in this bundle."', LANDING, 'const unlisted = loaded && !!r.listed && !listed && !!profile.available;', 'const unlisted = false;'],
  ['the readiness line never shown', LANDING, 'el.hidden = !v;', 'el.hidden = true;'],
  ['the all-in-one button does nothing', GUIDE, '(opts.allInOne ? { id, sample: opts.allInOne } : null)', 'null'],
  ['a two-dashboard bundle taken as CVI-only on the Infrastructure page', INFRA,
    "if (listed && listed.includes('cvi') && !listed.includes('infrastructure')) {", "if (listed && listed.includes('cvi')) {"],
  // later fixes
  ['an answer for older files shown', LANDING, 'else if (loaded && ready && ready.version === cl.version) v = ready.readiness;', 'else if (loaded && ready) v = ready.readiness;'],
  ['"Checking…" kept when the files cannot be checked', LANDING, 'else if (loaded && !cl.result) v = null;', 'else if (false) v = null;'],
  ['a listed dashboard in preparation called openable', LANDING, "'Listed in this bundle; in preparation, so it cannot be opened yet.'",
    "'Your bundle.json says the files are for this dashboard.'"]
];

const mode = process.argv[2], pick = process.argv.slice(3).map(Number);
if (mode !== 'unit' && mode !== 'page') { console.error('Usage: node tests/mutation/run_ab_mutations.js unit|page [number ...]'); process.exit(2); }
const LIST = (mode === 'unit' ? UNIT : PAGE).map((m, i) => [i + 1].concat(m)).filter(m => !pick.length || pick.includes(m[0]));
const SUITE = mode === 'unit' ? 'tests/node/run_f1_unit_tests.js' : 'tests/browser/run_f1_browser.js';
const SUMMARY = mode === 'unit' ? /F1 unit tests: .*/ : /^\d+ passed, \d+ failed$/m;

const files = [...new Set(LIST.map(m => m[2]))];
const before = Object.fromEntries(files.map(f => [f, sha(path.join(ROOT, f))]));
fs.rmSync(COPY, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'site'), path.join(COPY, 'site'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tests'), path.join(COPY, 'tests'), { recursive: true, filter: src => !src.startsWith(__dirname) });   // not tests/mutation/
// The browser suite writes into local-test-artifacts/f1/handoff/ without making the folder (it exists in the repository).
fs.mkdirSync(path.join(COPY, 'local-test-artifacts', 'f1', 'handoff'), { recursive: true });

const ENV = Object.assign({}, process.env); delete ENV.F1_PAGE_URL;
const run = script => cp.spawnSync(process.execPath, [script], { cwd: COPY, encoding: 'utf8', env: ENV, maxBuffer: 64 << 20, timeout: 9 * 60000, killSignal: 'SIGINT' });
// One suite run: failed (the number of failed checks in its summary line; null without one), the summary or the
// error that stopped it, the first failure.
const runSuite = () => {
  const t0 = Date.now(), r = run(SUITE);
  const out = (r.stdout || '') + (r.stderr || ''), sum = out.match(SUMMARY), m = sum && sum[0].match(/(\d+) failed/);
  const err = (out.match(/^\w*Error: .*/m) || [out.trim().split('\n').slice(-1)[0] || ''])[0].slice(0, 160);
  return { status: r.status, failed: m ? Number(m[1]) : null, line: sum ? sum[0] : 'suite stopped' + (r.error ? ' (' + r.error.code + ')' : '') + ': ' + err,
    first: (out.match(/^ *FAIL .*/m) || [''])[0].trim().slice(0, 220), s: Math.round((Date.now() - t0) / 1000) };
};

let caught = 0, applied = 0, restored = true;
try {
  if (mode === 'page') {   // the browser suite reads the fixtures the unit tests write inside the copy
    const u = run('tests/node/run_f1_unit_tests.js'), line = ((u.stdout || '').match(/F1 unit tests: .*/) || ['unit tests stopped'])[0];
    console.log('fixtures in the copy: ' + line);
    if (u.status !== 0) throw new Error('the F1 unit tests do not pass in the copy');
  }
  const base = runSuite();
  console.log('unmutated copy: ' + base.line + ' (' + base.s + ' s)');
  if (base.status !== 0 || base.failed !== 0) { console.log('The unmutated copy does not pass; no mutation run.\n     ' + base.first); process.exitCode = 1; }
  else for (const [n, name, file, a, b] of LIST) {
    const p = path.join(COPY, file), orig = fs.readFileSync(p, 'utf8'), h = sha(p);
    const count = orig.split(a).length - 1;
    if (count !== 1) { console.log(n + '. NOT APPLIED (' + count + ' matches) ' + name); continue; }
    applied++;
    fs.writeFileSync(p, orig.replace(a, () => b));
    let r;
    try { r = runSuite(); } finally { fs.writeFileSync(p, orig); }
    if (sha(p) !== h) restored = false;
    const ok = r.failed !== null && r.failed > 0;
    if (ok) caught++;
    console.log(n + '. ' + (ok ? 'caught ' : r.failed === null ? 'SUITE ERROR ' : 'MISSED ') + name + ' -> ' + r.line + ' (' + r.s + ' s)' + (r.first ? '\n     ' + r.first : ''));
  }
} finally {
  fs.rmSync(COPY, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
const unchanged = files.every(f => sha(path.join(ROOT, f)) === before[f]);
console.log(mode + ': ' + caught + ' of ' + applied + ' applied mutations caught (' + LIST.length + ' listed); copy restored after each: ' + restored
  + '; the mutated files unchanged in the repository (SHA-256): ' + unchanged + '; copy deleted: ' + !fs.existsSync(COPY));
if (caught !== LIST.length || !restored || !unchanged) process.exitCode = 1;
