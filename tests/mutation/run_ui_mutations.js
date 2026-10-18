#!/usr/bin/env node
'use strict';
// UI and style-guide pass mutation checks. Each mutation is applied to a copy of the repository's site, tests and
// test-tables (local-test-artifacts/ui/mutation-copy/, deleted at the end), one at a time, and must make a suite fail:
//   unit: mutations of the shared stylesheet, the pages, brand.js, facilities.js, branded.js, charts.js, exports.js and
//         the Infrastructure dashboard's script
//         against node tests/node/run_ui_unit_tests.js (about 2 seconds each);
//   page: mutations the pages show (text floor, contrast, buttons, keyboard, "Show as table", the Stats text, the
//         glossary, the name placer) against node tests/browser/run_ui_browser.js, each with the part that covers it
//         (30 seconds to 2 minutes each, Chrome in the foreground as the suite needs). The name placer mutation puts
//         back site/shared/labels.js as it was before the placer's speed-up (commit d9e0c9e), read from git.
// The copy first runs the unmutated suite (it must pass; in page mode with every part used); after each mutation the
// copied file is restored and checked by SHA-256, and at the end the repository's copies of the mutated files are
// checked unchanged by SHA-256. A mutation is "caught" only when the suite runs to its summary line and reports at
// least one failed check that is not a "[source text]" search (those only show the code is in place). Each suite run is
// stopped after 9 minutes (with SIGINT, so the browser suite closes Chrome).
// Usage (repository root): node tests/mutation/run_ui_mutations.js unit|page [number ...]
//   (numbers: run only those, 1-based, as listed; keep a page batch under 600 seconds). Node >= 22, no packages.
const fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');
const COPY = path.join(ROOT, 'local-test-artifacts', 'ui', 'mutation-copy');
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const CSS = 'site/shared/brand.css', BRAND = 'site/shared/brand.js', FAC = 'site/shared/facilities.js';
const BRANDED = 'site/shared/branded.js', CHARTS = 'site/cvi/app/charts.js', EXPORTS = 'site/cvi/app/exports.js';
const CVI = 'site/cvi/index.html', INFRA = 'site/infrastructure/index.html', LANDING = 'site/index.html';
const LANDING_JS = 'site/landing.js', UI = 'site/cvi/app/ui.js', LABELS = 'site/shared/labels.js';
const UNIT = [   // [name, file, text, replacement]
  // colors, the text floor, the badge, the font and the logo
  ['Dark Blue not the guide\'s', CSS, '--wsda-dark-blue: #1c5a83;', '--wsda-dark-blue: #1c5a84;'],
  ['a tint not the color mixed with white', CSS, '--dark-blue-10: #e8eff3;', '--dark-blue-10: #e8eff4;'],
  ['controls under the floor', CSS, 'button, input, select, textarea { font-family: inherit; font-size: 0.85rem; }',
    'button, input, select, textarea { font-family: inherit; font-size: 0.8rem; }'],
  ['a second badge text', INFRA, 'title="Synthetic test data only; not for real records.">SYNTHETIC DATA ONLY</span>',
    'title="Synthetic test data only; not for real records.">SYNTHETIC DATA</span>'],
  ['the font refused by the page policy', INFRA, "font-src 'self' file:;", "font-src 'none';"],
  ['the logo hook gone', BRAND, "root.document.querySelectorAll('img[data-wsda-logo]').forEach(img => { img.src = LOGO.dataUrl; });", ''],
  // facility colors, chart tables and PNG shapes
  ['Feedlots back to CVI\'s color', FAC, "feedlots: { shape: 'triangle', color: '#0094aa' },", "feedlots: { shape: 'triangle', color: '#0097a7' },"],
  ['a manifest\'s own color ignored', FAC, 'const fixed = l.ownColor ? l.color : l.builtin', 'const fixed = false ? l.color : l.builtin'],
  ['a chart table without its total', CHARTS, "cell(of('Outbound') ? of('Outbound').value : null), cell(g.total)];",
    "cell(of('Outbound') ? of('Outbound').value : null), cell(null)];"],
  ['the PNG ignores the shape', BRANDED, "if (shape && shape !== 'circle') {", 'if (false) {'],
  // the Stats text
  ['quarters run together again', EXPORTS, "const quarterLabel = quarters => quarters.slice().sort(collate).join(', ');",
    "const quarterLabel = quarters => quarters.slice().sort(collate).join('');"],
  ['no WA-to-WA note', EXPORTS, 'const twice = rows.length - vol.length;', 'const twice = 0;'],
  ['the change counts WA-to-WA movements twice', EXPORTS, 'const animals = k => SUM().dedupeVolume(inPeriod(k))',
    'const animals = k => inPeriod(k)'],
  ['"Same quarter last year" ignored', EXPORTS, "const lastYear = f.compare === 'last_year';", 'const lastYear = false;'],
  ['Unique CVIs counted without a CVI column', EXPORTS, "return hasCviColumn(rows) ? S().comma(SUM().uniqueCvis(rows)) : 'none (the file has no CVI column)';",
    'return S().comma(SUM().uniqueCvis(rows));'],
  ['a percentage from zero', EXPORTS, 'const pct = a > 0 ?', 'const pct = a >= 0 ?'],
  // help notes and the glossary
  ['a hover text not its note', CVI, 'title="Shows Washington county names on the live map and its screenshot."',
    'title="Shows WA county names on the live map and its screenshot."'],
  ['a shouted word in a note', INFRA, 'Pick the facility layers whose names print on the branded PNG; leave all unticked for a clean map. A named layer is drawn as its facilities, not one mark per county, and only a facility alone in its area is named. Many names in a busy area crowd the map: pick the one or two layers that matter. PNG only, not the live map.</p>',
    'Pick the facility layers whose names print on the branded PNG; leave all unticked for a clean map. A named layer is drawn as its facilities, not one mark per county, and only a facility alone in its area is named. Many names in a busy area crowd the map: pick the one or two layers that matter. PNG ONLY, not the live map.</p>'],
  ['shorthand in a note', CVI, 'data-help="fo-bins" aria-controls="help-fo-bins" aria-label="About Number of bins" title="The number of circle sizes for',
    'data-help="fo-bins" aria-controls="help-fo-bins" aria-label="About Number of bins" title="The number of circle sizes/widths for'],
  // (Two mutations the unit suite caught only by a source-text search, the Infrastructure "?" handler and the tab
  // icon, are page mutations.)
  ['a glossary term dropped', BRAND, "    ['Bundle', 'A ZIP file or folder", "    ['Bundles', 'A ZIP file or folder"],
  ['no glossary in a footer', LANDING, '  <div data-wsda-glossary></div></footer>', '</footer>'],
  // facility colors, the Coverage (planned) box and the Stats change line
  ['8-digit hex colors not read', FAC, 'let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(t);',
    'let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(t);'],
  ['rgb() colors not read', FAC, 'm = /^rgba?\\(([^()]*)\\)$/.exec(t);', 'm = null;'],
  ['the list picture drops the see-through part', FAC, 'const opacity = parts && parts.alpha < 1 ?', 'const opacity = false ?'],
  ['the Coverage (planned) box usable', INFRA, '<input id="planned-coverage-on" type="checkbox" disabled>',
    '<input id="planned-coverage-on" type="checkbox">'],
  ['a wide Stats change line not wrapped', EXPORTS, "if (counts.length + 1 + diff.length <= 64) return [counts + ' ' + diff];",
    "return [counts + ' ' + diff];"]
];
const PAGE = [   // [name, file, text, replacement, part]
  ['a note under the floor', CSS, 'footer.foot { font-size: 0.75rem;', 'footer.foot { font-size: 0.7rem;', 'checks'],
  ['gray notes under 4.5:1', CSS, 'footer.foot .agency { color: var(--heading); font-weight: 600; }',
    'footer.foot .agency { color: #8a8a8a; font-weight: 600; }', 'checks'],
  ['the glossary summary under the control floor', CSS, 'font-weight: 600; font-size: 0.85rem; }\nfooter.foot details.glossary dl',
    'font-weight: 600; font-size: 0.75rem; }\nfooter.foot details.glossary dl', 'checks'],
  ['no focus outline on buttons', CSS, '.btn[hidden] { display: none; }', '.btn[hidden] { display: none; } .btn:focus-visible { outline: none; }', 'controls'],
  ['the drop area deaf to Enter', LANDING_JS, "if (e.key !== 'Enter' && e.key !== ' ') return;", "if (e.key !== ' ') return;", 'controls'],
  ['"Show as table" not kept open', UI, 'if (tablesOpen.has(id)) tablesOpen.delete(id); else tablesOpen.add(id);', 'tablesOpen.delete(id);', 'controls'],
  ['Preview Stats ignores "Compare with"', UI, "compare: st.view === 'flow' ? 'previous' : st.chartCompare", "compare: 'previous'", 'day3'],
  ['the glossary not filled in', BRAND, "    root.document.querySelectorAll('[data-wsda-glossary]').forEach(holder => {\n      holder.replaceChildren(glossaryElement(root.document));\n    });\n", '', 'day3'],
  ['the glossary open when the page opens', BRAND, "fold.className = 'glossary';", "fold.className = 'glossary';\n    fold.open = true;", 'day3'],
  ['the name placer before its speed-up (slow)', LABELS, null, null, 'day3'],
  // chart axis labels, row numbers, the banner, the tab icon and the "?" buttons
  ['chart axis labels let run out again', 'site/cvi/app/chartsvg.js', 'if (at > 0) plotW = Math.min(plotW, (room - half) / at);', '', 'chartlabels'],
  ['gray row numbers on a selected Premise Lookup row', CVI,
    '  .lk-sites tbody tr.selected td.row-no, .lk-sites tbody tr.selected td.lk-fixed { color: var(--text); }\n', '', 'checks'],
  ['the banner back to 6 px above and below the logo', CSS, 'min-height: var(--banner-height); padding: 9px 1rem;',
    'min-height: 44px; padding: 6px 1rem;', 'checks'],
  ['the tab icon not given to the page', BRAND, '    setFavicon(root.document);\n', '', 'day3'],
  ['no 24 px hit area on the CVI page\'s "?" buttons', CVI, '  .tip { position: relative; }\n', '', 'controls'],
  ['a "?" squeezed beside a long Infrastructure label', INFRA, '.tip-row > .tip { margin-top: 0.2rem; flex: none; }',
    '.tip-row > .tip { margin-top: 0.2rem; }', 'controls'],
  ['the Coverage (planned) label not grayed', INFRA,
    '  #planned-coverage-fold label:has(input:disabled) { color: var(--disabled); cursor: not-allowed; }\n', '', 'controls'],
  ['a "?" on Infrastructure outside Export not opening', 'site/infrastructure/app.js',
    "document.addEventListener('click', e => {\n    const b = e.target.closest && e.target.closest('button.tip[data-help]');",
    "$('export-section').addEventListener('click', e => {\n    const b = e.target.closest && e.target.closest('button.tip[data-help]');", 'day3'],
  // the "?" hit area
  ['the "?" hit area over its label again', CVI, 'height: 1.05em; margin-left: 0.37em; padding: 0;',
    'height: 1.05em; margin-left: 0.1em; padding: 0;', 'controls']
];

const mode = process.argv[2], pick = process.argv.slice(3).map(Number);
if (mode !== 'unit' && mode !== 'page') { console.error('Usage: node tests/mutation/run_ui_mutations.js unit|page [number ...]'); process.exit(2); }
const LIST = (mode === 'unit' ? UNIT : PAGE).map((m, i) => [i + 1].concat(m)).filter(m => !pick.length || pick.includes(m[0]));
const SUMMARY = mode === 'unit' ? /UI unit: (\d+)\/(\d+) passed.*/ : /UI browser \([^)]*\): (\d+)\/(\d+) passed/;
// The name placer as it was before its speed-up, read from this repository's git history; a copy without that
// history skips the mutation that needs it, with a note.
let OLD_LABELS = null;
try {
  OLD_LABELS = cp.execSync('git show d9e0c9e:site/shared/labels.js', { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 << 20,
    stdio: ['ignore', 'pipe', 'ignore'] });
} catch (e) { /* no history: that mutation is skipped */ }

const files = [...new Set(LIST.map(m => m[2]))];
const before = Object.fromEntries(files.map(f => [f, sha(path.join(ROOT, f))]));
fs.rmSync(COPY, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'site'), path.join(COPY, 'site'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tests'), path.join(COPY, 'tests'), { recursive: true, filter: src => !src.startsWith(__dirname) });   // not tests/mutation/
if (mode === 'page') fs.cpSync(path.join(ROOT, 'test-tables'), path.join(COPY, 'test-tables'), { recursive: true });

const ENV = Object.assign({}, process.env); delete ENV.UI_SITE_URL;
const run = args => cp.spawnSync(process.execPath, args, { cwd: COPY, encoding: 'utf8', env: ENV, maxBuffer: 64 << 20, timeout: 9 * 60000, killSignal: 'SIGINT' });
// One suite run: failed (from its summary line; null without one), the summary or the error that stopped it, the
// first failure.
const runSuite = parts => {
  const t0 = Date.now();
  const r = run(mode === 'unit' ? ['tests/node/run_ui_unit_tests.js'] : ['tests/browser/run_ui_browser.js'].concat(parts));
  const out = (r.stdout || '') + (r.stderr || ''), sum = out.match(SUMMARY);
  const failed = sum ? Number(sum[2]) - Number(sum[1]) : null;
  const err = (out.match(/^\w*Error: .*/m) || [out.trim().split('\n').slice(-1)[0] || ''])[0].slice(0, 160);
  const failures = out.split('\n').filter(l => /^ {2}\S/.test(l)).map(l => l.trim());
  const first = (failures[0] || '').slice(0, 220);
  // A failure of a check that only searches source text does not count as catching the mutation.
  const behavioral = failures.some(l => !l.startsWith('[source text]'));
  return { status: r.status, failed, behavioral, line: sum ? sum[0] : 'suite stopped' + (r.error ? ' (' + r.error.code + ')' : '') + ': ' + err,
    first, s: Math.round((Date.now() - t0) / 1000) };
};

let caught = 0, applied = 0, textOnly = 0, restored = true;
try {
  const parts = [...new Set(LIST.map(m => m[5]).filter(Boolean))];
  const base = runSuite(parts);
  console.log('unmutated copy: ' + base.line + ' (' + base.s + ' s)');
  if (base.status !== 0 || base.failed !== 0) { console.log('The unmutated copy does not pass; no mutation run.\n     ' + base.first); process.exitCode = 1; }
  else for (const [n, name, file, a, b, part] of LIST) {
    const p = path.join(COPY, file), orig = fs.readFileSync(p, 'utf8'), h = sha(p);
    let mutated;
    if (a === null) {   // a whole file put back
      if (OLD_LABELS === null) { console.log(n + '. NOT APPLIED (the older file is not in this copy\'s history) ' + name); continue; }
      mutated = OLD_LABELS;
    } else {
      const count = orig.split(a).length - 1;
      if (count !== 1) { console.log(n + '. NOT APPLIED (' + count + ' matches) ' + name); continue; }
      mutated = orig.replace(a, () => b);
    }
    applied++;
    fs.writeFileSync(p, mutated);
    let r;
    try { r = runSuite(part ? [part] : []); } finally { fs.writeFileSync(p, orig); }
    if (sha(p) !== h) restored = false;
    const failedSome = r.failed !== null && r.failed > 0, ok = failedSome && r.behavioral;
    if (ok) caught++;
    if (failedSome && !ok) textOnly++;
    const verdict = ok ? 'caught ' : failedSome ? 'MISSED (only a source-text search failed) '
      : r.failed === null ? 'SUITE ERROR ' : 'MISSED ';
    console.log(n + '. ' + verdict + name + ' -> ' + r.line + ' (' + r.s + ' s)' + (r.first ? '\n     ' + r.first : ''));
  }
} finally {
  fs.rmSync(COPY, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
const unchanged = files.every(f => sha(path.join(ROOT, f)) === before[f]);
console.log(mode + ': ' + caught + ' of ' + applied + ' applied mutations caught by a behavior check (' + LIST.length + ' listed; ' +
  textOnly + ' failed only a source-text search); copy restored after each: ' + restored
  + '; the mutated files unchanged in the repository (SHA-256): ' + unchanged + '; copy deleted: ' + !fs.existsSync(COPY));
if (caught !== LIST.length || !restored || !unchanged) process.exitCode = 1;
