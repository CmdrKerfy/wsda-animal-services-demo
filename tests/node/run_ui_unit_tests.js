#!/usr/bin/env node
'use strict';
// UI and style-guide unit tests, read from the files:
//   1. the brand colors in site/shared/brand.css against the guide's values written out here (pages 7 and 8), and
//      each tint against its color mixed with white;
//   2. every text and background pair the stylesheet names, at 4.5:1 (3:1 for large text and for field borders);
//   3. the font: CVI's file byte for byte (SHA-256), its license file with the font's own copyright line, the
//      @font-face address, and each page's policy allowing the site's own font file only;
//   4. the banner and footer of the three pages: the logo, the names, one badge, the same footer line, the tab titles;
//   5. the pages' own styles: no color written out except the listed map items, no rule the shared
//      stylesheet owns, and no text size under the floor (0.85rem for controls, 0.75rem for notes; map labels as
//      accepted);
//   6. the logo hook in site/shared/brand.js (every <img data-wsda-logo> gets the logo).
//   7. the facility marks (site/shared/facilities.js): ten shapes, six guide color families that never look
//      alike (normal vision and three simulated color-vision types, computed again here), the built-in marks, 1 to 60
//      added layers (every mark its own up to the 60 pairs, then the legend's note), a manifest's own color, the
//      outlines, the list picture, the PNG point, and every drawing place using the mark.
//   8. "Show as table": each chart kind's numbers.
//   9. the Stats text: the quarters, Unique CVIs, the WA-to-WA note and the change from the previous quarter.
//  10. the help notes (hover text and note agree, plain words) and the glossary.
// The pages as drawn (computed sizes and colors of every visible text) are checked by tests/browser/run_ui_browser.js.
// Usage (repository root): node tests/node/run_ui_unit_tests.js      (Node >= 22; no packages)
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');
const SITE = path.join(ROOT, 'site');
const read = rel => fs.readFileSync(path.join(SITE, rel), 'utf8');

let pass = 0, fail = 0;
const failures = [];
const check = (ok, name, detail) => {
  if (ok) pass++;
  else {
    fail++;
    failures.push(name + (detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 400) : ''));
  }
};
// A check that only searches a script's source text: it shows the code is in place, not that it
// works; the browser suites (tests/browser/run_ui_browser.js, run_safari.js --ui) check the behavior. Counted apart
// in the summary line, and its name starts with "[source text]".
// A check of a page's markup (an HTML attribute such as "disabled", a label's words) is not a source-text search: the
// browser draws the page from that markup as written, so the attribute is the behavior. Such
// checks use check(), and the mutation runner counts them as behavior checks.
let textChecks = 0;
const textCheck = (ok, name, detail) => {
  textChecks++;
  check(ok, '[source text] ' + name, detail);
};

// ── Color arithmetic (WCAG 2.2 relative luminance and contrast ratio) ─────────────────────────────────────────
const rgb = hex => {
  let h = hex.replace('#', '').toLowerCase();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
};
const luminance = hex => {
  const [r, g, b] = rgb(hex).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
// A tint: the color mixed with white, pct percent of the color.
const tint = (hex, pct) => '#' + rgb(hex).map(v => Math.round(255 - pct / 100 * (255 - v)).toString(16).padStart(2, '0')).join('');

// ── 1. The brand colors ───────────────────────────────────────────────────────────────────────────────────────
const css = read('shared/brand.css');
const rootBlock = (/:root\s*\{([\s\S]*?)\}/.exec(css) || [])[1] || '';
const vars = {};
rootBlock.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g, (m, k, v) => { vars[k] = v.trim(); });
const resolve = (v, depth) => {
  const m = /^var\((--[a-z0-9-]+)\)$/.exec(v);
  if (!m) return v;
  return (depth || 0) > 5 || !(m[1] in vars) ? null : resolve(vars[m[1]], (depth || 0) + 1);
};
const color = name => (name.startsWith('#') ? name : resolve('var(' + name + ')'));

// The guide's values ("Brand Guidelines", AGR Publication No. 140-608, pages 7 and 8), written out.
const GUIDE = {
  'light-blue': '#a7d7e2', 'evergreen': '#4a8b2c', 'gold': '#fcb614', 'dark-blue': '#1c5a83', 'black': '#000000',
  'dark-teal': '#245566', 'orange': '#f07325', 'grass-green': '#8bc04a', 'blue-green': '#0094aa', 'crimson': '#ca3014',
  'eggplant': '#522348', 'dark-brown': '#382513', 'cream': '#f7e8c8'
};
Object.keys(GUIDE).forEach(k => check(vars['--wsda-' + k] === GUIDE[k], 'brand.css: --wsda-' + k + ' is the guide\'s ' + GUIDE[k],
  vars['--wsda-' + k]));
const tints = Object.keys(vars).filter(k => /^--[a-z-]+-\d+$/.test(k) && !k.startsWith('--wsda-'));
check(tints.length >= 10, 'brand.css: the tints are listed', tints);
tints.forEach(k => {
  const [, name, pct] = /^--([a-z-]+)-(\d+)$/.exec(k);
  check(name in GUIDE && vars[k] === tint(GUIDE[name], Number(pct)),
    'brand.css: ' + k + ' is ' + pct + '% ' + name + ' over white', { css: vars[k], want: name in GUIDE ? tint(GUIDE[name], Number(pct)) : '?' });
});
// Every color the stylesheet uses by name resolves to a guide color, one of its tints, or white.
const allowed = new Set(Object.values(GUIDE).concat(tints.map(k => vars[k]), ['#ffffff', '#fff']));
Object.keys(vars).forEach(k => {
  const v = color(k);
  check(v !== null && allowed.has(v), 'brand.css: ' + k + ' resolves to a guide color or tint', { [k]: vars[k], resolved: v });
});
const literals = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/:root\s*\{[\s\S]*?\}/, '').match(/#[0-9a-fA-F]{3,6}\b/g) || [];
check(literals.every(h => ['#fff', '#ffffff'].includes(h.toLowerCase())),
  'brand.css: outside :root only white is written out (every other color by name)', literals);

// ── 2. Text and background pairs ──────────────────────────────────────────────────────────────────────────────
// [text, background, minimum, where]. Text at the pages' sizes is normal text (4.5:1); the banner's name is large
// (1.1rem semibold is under 18.66 px bold, so it is held to 4.5:1 too); field borders are non-text (3:1).
const PAIRS = [
  ['--text', '#ffffff', 4.5, 'body text'], ['--text', '--panel', 4.5, 'text on a panel'],
  ['--text', '--panel-open', 4.5, 'text on an open section'], ['--text', '--selected', 4.5, 'a selected table row'],
  ['--text', '--info-bg', 4.5, 'text in a blue box'], ['--text', '--notice-bg', 4.5, 'text in a notice'],
  ['--muted', '#ffffff', 4.5, 'notes'], ['--muted', '--panel', 4.5, 'notes on a panel (was 4.44:1)'],
  ['--muted', '--panel-open', 4.5, 'notes on an open section'], ['--muted', '--info-bg', 4.5, 'notes in a blue box'],
  ['--muted', '--notice-bg', 4.5, 'notes in a notice'],
  ['--heading', '#ffffff', 4.5, 'headings and labels'], ['--heading', '--panel', 4.5, 'headings on a panel'],
  ['--heading', '--panel-open', 4.5, 'headings on an open section'], ['--heading', '--info-bg', 4.5, 'headings in a blue box'],
  ['--primary', '#ffffff', 4.5, 'links, outlined buttons'], ['--primary', '--panel', 4.5, 'section titles'],
  ['--primary', '--panel-open', 4.5, 'an open section\'s title'], ['--primary', '--info-bg', 4.5, 'Compare\'s left heading'],
  ['#ffffff', '--primary', 4.5, 'the banner, filled buttons, the active choice'],
  ['--info-text', '--info-bg', 4.5, 'information messages'], ['--ok-text', '--ok-bg', 4.5, 'success messages'],
  ['--ok-text', '#ffffff', 4.5, '"Found", "Ready"'], ['--notice-text', '--notice-bg', 4.5, 'warnings and notices'],
  ['--notice-text', '#ffffff', 4.5, '"Conflict", reasons'], ['--error-text', '--error-bg', 4.5, 'error messages'],
  ['--error-text', '#ffffff', 4.5, 'a remove button'],
  ['--wsda-dark-brown', '--wsda-gold', 4.5, 'the badge'], ['--wsda-dark-brown', '--gold-20', 4.5, 'Compare\'s right heading'],
  ['--border-input', '#ffffff', 3, 'field and list borders (non-text)']
];
const pairRows = PAIRS.map(([fg, bg, min, where]) => {
  const a = color(fg), b = color(bg), r = a && b ? contrast(a, b) : 0;
  check(r >= min, 'contrast ' + fg + ' on ' + bg + ' (' + where + ') at least ' + min + ':1', { fg: a, bg: b, ratio: r.toFixed(2) });
  return { fg, bg, fgHex: a, bgHex: b, ratio: Number(r.toFixed(2)), min, where };
});
// Evergreen is a success color only as a background: as text it is under 4.5:1 (the reason it is not --ok-text).
check(contrast(GUIDE.evergreen, '#ffffff') < 4.5 && contrast('#ffffff', GUIDE.evergreen) < 4.5,
  'Evergreen text or white on Evergreen is under 4.5:1 (so the pages do not use it for text)');
fs.mkdirSync(path.join(ROOT, 'local-test-artifacts', 'ui'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'local-test-artifacts', 'ui', 'contrast_pairs.json'), JSON.stringify(pairRows, null, 1));

// ── 3. The font ───────────────────────────────────────────────────────────────────────────────────────────────
const FONT = 'shared/fonts/OpenSans-Variable-latin.woff2';
const FONT_SHA = 'd8e4fe0452aa2076429a9bb5d8757d00a994dd95986cf950e9a1a371b9a072a0';   // CVI's file
const fontBytes = fs.readFileSync(path.join(SITE, FONT));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
check(sha(fontBytes) === FONT_SHA, 'font: ' + FONT + ' has CVI\'s SHA-256', sha(fontBytes));
const cviFont = path.join(ROOT, '..', 'CVI_Traceability', 'shiny', 'www', 'fonts', 'OpenSans-Variable-latin.woff2');
if (fs.existsSync(cviFont)) check(sha(fs.readFileSync(cviFont)) === FONT_SHA, 'font: CVI\'s file still has that SHA-256');
// The font's own name records (the name table is never transformed in WOFF2): its copyright line must open OFL.txt.
function woff2Names(b) {
  const numTables = b.readUInt16BE(12);
  let p = 48;
  const base128 = () => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const x = b[p++];
      v = v * 128 + (x & 0x7f);
      if (!(x & 0x80)) return v;
    }
    return v;
  };
  const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep'];
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const flags = b[p++];
    let tag = KNOWN[flags & 63] || '?';
    if ((flags & 63) === 63) { tag = b.toString('latin1', p, p + 4); p += 4; }
    const length = base128();
    const version = (flags >> 6) & 3;
    const transformed = (tag === 'glyf' || tag === 'loca') ? version === 0 : version !== 0;
    tables.push({ tag, length: transformed ? base128() : length });
  }
  const data = zlib.brotliDecompressSync(b.subarray(p, p + b.readUInt32BE(20)));
  let offset = 0;
  const names = {};
  for (const t of tables) {
    if (t.tag === 'name') {
      const n = data.subarray(offset, offset + t.length), count = n.readUInt16BE(2), strings = n.readUInt16BE(4);
      for (let i = 0; i < count; i++) {
        const r = 6 + i * 12;
        if (n.readUInt16BE(r) !== 3) continue;   // Windows platform, UTF-16BE
        const id = n.readUInt16BE(r + 6), len = n.readUInt16BE(r + 8), at = strings + n.readUInt16BE(r + 10);
        let s = '';
        for (let k = 0; k < len; k += 2) s += String.fromCharCode(n.readUInt16BE(at + k));
        names[id] = s;
      }
    }
    offset += t.length;
  }
  return names;
}
const names = woff2Names(fontBytes);
const ofl = read('shared/fonts/OFL.txt');
check(names[1] === 'Open Sans' && /OFL/.test(names[14] || ''), 'font: the file names itself Open Sans under the OFL', names);
check(ofl.split('\n')[0] === names[0], 'OFL.txt: opens with the font\'s own copyright line', { ofl: ofl.split('\n')[0], font: names[0] });
check(/SIL OPEN FONT LICENSE Version 1\.1/.test(ofl) && /PERMISSION & CONDITIONS/.test(ofl) && /DISCLAIMER/.test(ofl),
  'OFL.txt: the SIL Open Font License 1.1 text');
const face = (/@font-face\s*\{([\s\S]*?)\}/.exec(css) || [])[1] || '';
const faceUrl = (/url\("([^"]+)"\)/.exec(face) || [])[1];
check(/font-family:\s*"Open Sans"/.test(face) && faceUrl && fs.existsSync(path.join(SITE, 'shared', faceUrl))
  && path.join('shared', faceUrl) === FONT, '@font-face: "Open Sans" from the site\'s own file', faceUrl);
check(/body\s*\{[^}]*font-family:\s*"Open Sans", Arial/.test(css), 'brand.css: body text in Open Sans, then Arial (the guide\'s acceptable face)');

// ── 4. The three pages: policy, banner, footer, tab title ─────────────────────────────────────────────────────
const PAGES = [
  // Tab titles (they were "... — WSDA Visualization Platform").
  { file: 'index.html', css: 'shared/brand.css', js: 'shared/brand.js', dashboard: null,
    title: 'WSDA Animal Services — Visualization Platform', connect: "'none'" },
  { file: 'cvi/index.html', css: '../shared/brand.css', js: '../shared/brand.js', dashboard: 'CVI Traceability',
    title: 'CVI Traceability — WSDA Animal Services' },
  { file: 'infrastructure/index.html', css: '../shared/brand.css', js: '../shared/brand.js', dashboard: 'Infrastructure',
    title: 'Infrastructure — WSDA Animal Services' }
];
const textOf = html => html.replace(/<[^>]+>/g, '').replace(/&middot;/g, '·').replace(/&mdash;/g, '—').replace(/\s+/g, ' ').trim();
const footLines = [];
PAGES.forEach(pg => {
  const html = read(pg.file);
  const tag = pg.file + ': ';
  const csp = (/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html) || [])[1] || '';
  const dir = name => ((new RegExp('(?:^|;)\\s*' + name + ' ([^;]*)')).exec(csp) || [])[1];
  check(dir('font-src') === "'self' file:", tag + 'policy: fonts only from the site\'s own files', dir('font-src'));
  check(dir('img-src') === 'data: blob:' && dir('default-src') === "'none'", tag + 'policy: pictures still data:/blob: only (the logo is a data: picture)');
  if (pg.connect) check(dir('connect-src') === pg.connect, tag + 'policy: still no network connections', dir('connect-src'));
  check((/<title>([^<]*)<\/title>/.exec(html) || [])[1] === pg.title, tag + 'tab title "' + pg.title + '"');
  // The tab icon: "data:," in the page (no request for one), the symbol put in by brand.js.
  check((html.match(/<link rel="icon"[^>]*>/g) || []).join() === '<link rel="icon" href="data:,">', tag + 'one icon link, empty until brand.js fills it');
  const head = html.indexOf('<head>'), style = html.indexOf('<style>'), link = html.indexOf('<link rel="stylesheet" href="' + pg.css + '">');
  check(link > head && link < style, tag + 'links ' + pg.css + ' before its own styles (its rules can build on the shared ones)');
  check(fs.existsSync(path.join(SITE, path.dirname(pg.file), pg.css)), tag + pg.css + ' exists');
  const headers = html.match(/<header class="top">[\s\S]*?<\/header>/g) || [];
  check(headers.length === 1, tag + 'one banner', headers.length);
  const h = headers[0] || '';
  check(/<img class="brand-logo" data-wsda-logo alt="Washington State Department of Agriculture" width="78" height="32">/.test(h),
    tag + 'banner: the logo first, 32 px high (78 x 32, the file\'s 1760 x 724), with its alt text');
  check(h.indexOf('<img') < h.indexOf('<h1>') && h.indexOf('<h1>') < h.indexOf('class="badge"'), tag + 'banner order: logo, names, badge');
  const h1 = (/<h1>([\s\S]*?)<\/h1>/.exec(h) || [])[1] || '';
  // The platform's name: "Animal Services Division · Visualization Platform" (it was "WSDA Visualization Platform"; the symbol reads "WSDA" and every footer names the agency).
  const NAME = 'Animal Services Division &middot; Visualization Platform';
  const want = pg.dashboard ? NAME + ' <span class="dashboard-name">' + pg.dashboard + '</span>' : NAME;
  check(h1 === want, tag + 'banner: "Animal Services Division · Visualization Platform"' + (pg.dashboard ? ' and "' + pg.dashboard + '"' : ''), h1);
  const badges = h.match(/<span class="badge"[^>]*>([^<]*)<\/span>/g) || [];
  check(badges.length === 1 && />SYNTHETIC DATA ONLY</.test(badges[0]), tag + 'banner: one badge, "SYNTHETIC DATA ONLY"', badges);
  check(!/EXPERIMENT|experiment\)/.test(html.replace(/<!--[\s\S]*?-->/g, '')), tag + 'no slice names in the page (no "EXPERIMENT")');
  const foot = (/<footer class="foot">([\s\S]*?)<\/footer>/.exec(html) || [])[1] || '';
  const line = (/<p class="foot-line">([\s\S]*?)<\/p>/.exec(foot) || [])[1] || '';
  footLines.push(textOf(line).replace(/ Runs entirely.*$/, ''));
  check(foot.trim().startsWith('<p class="foot-line"><span class="agency">Washington State Department of Agriculture</span>'),
    tag + 'footer: opens with the agency\'s name');
  const js = html.indexOf('<script src="' + pg.js + '"></script>');
  check(js > html.indexOf('</header>'), tag + 'loads ' + pg.js + ' after the banner (it sets the logo)');
});
check(new Set(footLines).size === 1 && footLines[0] ===
  'Washington State Department of Agriculture · Synthetic test data only. Not an official WSDA service.',
  'every page: the same footer line', footLines);

// ── 5. The pages' own styles ──────────────────────────────────────────────────────────────────────────────────
// Map items keep their own colors by design (S1.1, MC, S9, PC, S11): county and place names, counts, legends,
// hover cards, the map buttons' icons. Each selector start is written out with the slice it belongs to.
const MAP_KEEP = [
  '.legend-toggle', '.legend-panel', '.county-label', '.mc-on .county-label', '.state-label', '.focus-count', '.focus-stack',
  '.lk-legend', '.map-screenshot', '.pc-tip', '.lg-', '.region-label', '.region-name', '.facility-count',
  '#facility-legend'
];
const SHARED_ONLY = [':root', 'body', 'header.top', 'header.top h1', '.badge', 'footer.foot', '.status', '.status.info',
  '.muted', '#bundle-banner', 'a',
  // The buttons, one size and look on every page; the All and Clear links.
  '.btn', '.btn.full', '.btn.primary', '.btn.export-btn', '.btn.reset', '.btn:disabled', '.btn[hidden]', '.btn-icon', '.links button',
  '.ctl-row .links button', '.facility-swatch.facility-mark-box'];
// Text sizes under 0.75rem kept on the maps by design (county and place names, region names; px values).
const SMALL_OK = ['.county-label', '.county-label.pc-name', '.state-label', '.lg-cl'];
const CONTROL = /(^|[\s,>])(button|select|input|textarea|summary)\b|\.btn\b|\.links\b|-toggle\b|\.tip\b|\.dt-filter|\.dt-page/;
function rules(cssText) {
  const out = [];
  const body = cssText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{([\s\S]*?\})\s*\}/g, '$1');
  body.replace(/([^{}]+)\{([^}]*)\}/g, (m, sel, decl) => { out.push({ sel: sel.trim().replace(/\s+/g, ' '), decl }); });
  return out;
}
const sizeRem = decl => {
  const m = /font-size:\s*([\d.]+)(rem|px|em)\b/.exec(decl);
  if (!m) return null;
  return { value: Number(m[1]), unit: m[2], rem: m[2] === 'px' ? Number(m[1]) / 16 : Number(m[1]) };
};
const sheets = [{ name: 'shared/brand.css', list: rules(css.replace(/@font-face\s*\{[\s\S]*?\}/, '')) }].concat(PAGES.map(pg => {
  const html = read(pg.file);
  return { name: pg.file, list: rules(html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'))) };
}));
let underFloor = 0;
sheets.forEach(sh => {
  sh.list.forEach(r => {
    const keep = MAP_KEEP.some(k => r.sel.startsWith(k) || r.sel.includes(', ' + k));
    if (sh.name !== 'shared/brand.css') {
      const hex = (r.decl.match(/#[0-9a-fA-F]{3,6}\b/g) || []).filter(h => !['#fff', '#ffffff'].includes(h.toLowerCase()));
      check(keep || !hex.length, sh.name + ': "' + r.sel.slice(0, 60) + '" uses the color names (or is a map item)', hex);
      check(SHARED_ONLY.indexOf(r.sel) < 0, sh.name + ': "' + r.sel + '" is left to shared/brand.css');
    }
    const s = sizeRem(r.decl);
    if (!s) return;
    if (s.unit === 'em') {
      check(s.value >= 1 || r.sel === '.legend-panel', sh.name + ': "' + r.sel + '" sizes in em only where nothing nests (the legend panel)', s);
      return;
    }
    if (s.rem < 0.75) {
      underFloor++;
      check(SMALL_OK.indexOf(r.sel) >= 0, sh.name + ': "' + r.sel + '" under 0.75rem only for map names', s);
    }
    if (CONTROL.test(r.sel) && !keep) {
      check(s.rem >= 0.85, sh.name + ': control "' + r.sel.slice(0, 60) + '" at least 0.85rem', s);
    }
  });
});
check(underFloor <= SMALL_OK.length + 2, 'only the map names are under 0.75rem', underFloor);
// Sizes set from scripts: the legend notes in rem (nested em made them about 9 px).
const ui = fs.readFileSync(path.join(SITE, 'cvi', 'app', 'ui.js'), 'utf8');
const emSizes = ui.match(/font-?[sS]ize\s*[:=]\s*'?0\.\d+em/g) || [];
check(!emSizes.length, 'ui.js: no em font sizes under 1 (they nest inside the legend)', emSizes);

// Premise Lookup's selected row: gray on its blue is under 4.5:1, so its row number and a zone's fixed
// cells are written in the text color there (the browser suite measures the row number on a selected row).
check(contrast(color('--muted'), color('--selected')) < 4.5, 'contrast: gray on a selected row is under 4.5:1 (so the ' +
  'page does not use it there)', contrast(color('--muted'), color('--selected')).toFixed(2));
{
  const cviRules = sheets.find(sh => sh.name === 'cvi/index.html').list;
  const darkOn = cell => cviRules.some(r => r.sel.split(',').map(x => x.trim()).includes('.lk-sites tbody tr.selected td.' + cell)
    && /color:\s*var\(--text\)/.test(r.decl));
  check(darkOn('row-no') && darkOn('lk-fixed'), 'Premise Lookup: a selected row\'s number and fixed cells in the text color');
}

// S12's place on the Infrastructure dashboard: a grayed control in neutral words, none of the
// claims CVI's coverage plan rules out (demand, service area, capacity, access, service gap).
{
  const infraHtml = read('infrastructure/index.html');
  const fold = (/<details class="section" id="planned-coverage-fold">([\s\S]*?)<\/details>/.exec(infraHtml) || [])[1] || '';
  const words = fold.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  check(words === 'Coverage (planned) Show coverage Planned for a later update; not part of this release.',
    'Coverage (planned): the agreed words', words);
  check(!/demand|service|capacity|access|gap/i.test(words), 'Coverage (planned): none of CVI\'s ruled-out claims', words);
  // Markup, a behavior check (see textCheck above): the browser makes this box unusable from the attribute alone.
  check(/<input id="planned-coverage-on" type="checkbox" disabled>/.test(fold), 'Coverage (planned): its box is disabled');
  textCheck(!/planned-coverage/.test(read('infrastructure/app.js')), 'Coverage (planned): no script reads it');
}

// ── 6. The logo hook ──────────────────────────────────────────────────────────────────────────────────────────
const imgs = [{ src: '' }, { src: '' }];
const box = { document: { querySelectorAll: sel => (sel === 'img[data-wsda-logo]' ? imgs : []) } };
box.window = box;
vm.createContext(box);
vm.runInContext(read('shared/brand.js'), box, { filename: 'brand.js' });
const logo = box.WSDA.brand.LOGO;
check(imgs.every(i => i.src === logo.dataUrl) && logo.dataUrl.startsWith('data:image/png;base64,'),
  'brand.js: every <img data-wsda-logo> shows the logo (a data: picture)');
const logoBytes = Buffer.from(logo.dataUrl.split(',')[1], 'base64');
check(sha(logoBytes) === logo.sha256 && logoBytes.readUInt32BE(16) === 1760 && logoBytes.readUInt32BE(20) === 724,
  'brand.js: the logo is CVI\'s file (SHA-256, 1760 x 724)', sha(logoBytes));
const box2 = {};
vm.createContext(box2);
vm.runInContext(read('shared/brand.js'), box2, { filename: 'brand.js' });
check(!!box2.WSDA.brand.LOGO, 'brand.js: still loads without a page (the Node suites)');

// ── 7. Facility marks: a shape and color per layer, from site/shared/facilities.js ───────────────
// The look-alike measure is computed again here (Machado 2009 matrices, CIE76), not taken from the module.
const MACHADO = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]]
};
const lin = v => (v / 255 <= 0.04045 ? v / 255 / 12.92 : Math.pow((v / 255 + 0.055) / 1.055, 2.4));
const gamma = v => {
  const c = Math.min(1, Math.max(0, v));
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
};
const seen = (hex, kind) => {
  const c = rgb(hex).map(lin);
  return kind === 'normal' ? rgb(hex) : MACHADO[kind].map(r => gamma(r[0] * c[0] + r[1] * c[1] + r[2] * c[2]));
};
const labOf = c => {
  const [r, g, b] = c.map(lin);
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
const smallestDifference = (a, b) => Math.min(...['normal', 'protanopia', 'deuteranopia', 'tritanopia'].map(k => {
  const p = labOf(seen(a, k)), q = labOf(seen(b, k));
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}));
const fbox = {};
fbox.window = fbox;
vm.createContext(fbox);
vm.runInContext(read('shared/facilities.js'), fbox, { filename: 'facilities.js' });
const FAC = fbox.WSDA.facilities;
check(Math.abs(FAC.visionDifference('#f07325', '#4a8b2c') - smallestDifference('#f07325', '#4a8b2c')) < 1e-9 &&
  Math.abs(FAC.visionDifference('#1c5a83', '#245566') - smallestDifference('#1c5a83', '#245566')) < 1e-9,
  'marks: the module\'s look-alike measure equals this suite\'s own');
check(['#ffffff', '#808080'].every(c => smallestDifference(c, c) === 0 && labOf(seen(c, 'protanopia'))[0] > 0) &&
  smallestDifference('#ffffff', '#fefefe') < 1, 'marks: the simulation keeps white and gray');
check(FAC.SHAPES.length === 10 && new Set(FAC.SHAPES).size === 10 &&
  FAC.ADDED_SHAPES.slice().sort().join() === FAC.SHAPES.slice().sort().join(), 'marks: ten shapes, each once');
// The six families: guide colors, no two alike in any of the four kinds of vision.
check(FAC.FAMILIES.length === 6 && FAC.FAMILIES.every(c => Object.values(GUIDE).includes(c)),
  'marks: six families, all guide colors',
  FAC.FAMILIES);
FAC.FAMILIES.forEach((a, i) => FAC.FAMILIES.slice(i + 1).forEach(b => check(smallestDifference(a, b) >= 10,
  'marks: families ' + a + ' and ' + b + ' do not look alike', smallestDifference(a, b))));
// The built-in layers: their chosen shapes; Feedlots in the guide's Blue Green, CVI's kept.
const builtin = FAC.registry(null).layers;
const wantBuiltin = { slaughterhouses: ['square', '#382513'], markets: ['diamond', '#f07325'],
  feedlots: ['triangle', '#0094aa'], restricted: ['triangle-down', '#ca3014'], fairgrounds: ['star', '#522348'] };
builtin.forEach(l => check(l.shape === wantBuiltin[l.key][0] && l.color === wantBuiltin[l.key][1] &&
  !l.sharesMarkWith.length, 'marks: built-in ' + l.key + ' is a ' + wantBuiltin[l.key].join(' in '), [l.shape, l.color]));
check(builtin.find(l => l.key === 'feedlots').cviColor === '#0097a7', 'marks: Feedlots keeps CVI\'s color as cviColor');
// 1 to 60 added layers, no colors given: each count checked as a whole page would get it.
const manifestOf = (n, extra) => ({ header: ['key', 'file', 'label', 'color'], rows: Array.from({ length: n },
  (x, i) => ['added' + (i + 1), 'added' + (i + 1) + '.csv', 'Added ' + (i + 1), '']).concat(extra || []) });
let firstShared = null;
const marksAt60 = FAC.registry(manifestOf(60)).layers;
for (let n = 1; n <= 60; n++) {
  const layers = FAC.registry(manifestOf(n)).layers;
  const pairs = new Set(layers.map(l => l.shape + ' ' + l.color));
  let alikeOnShape = 0;
  layers.forEach((a, i) => layers.slice(i + 1).forEach(b => {
    if (a.shape === b.shape && smallestDifference(a.color, b.color) < 10) alikeOnShape++;
  }));
  const shared = layers.filter(l => l.sharesMarkWith.length).length;
  if (shared && firstShared === null) firstShared = n;
  const note = FAC.sharedNote(layers);
  if (n <= 58) {
    check(pairs.size === layers.length && !alikeOnShape && !shared && note === '',
      'marks: ' + n + ' added layers, every mark its own, no look-alike colors on one shape', [pairs.size, alikeOnShape]);
  } else {
    check(shared === 2 * (n - 58) && alikeOnShape === n - 58 && /^Some layers share a mark: /.test(note),
      'marks: ' + n + ' added layers, past the 60 pairs the legend names the layers that share', [shared, note]);
  }
  check(layers.every((l, i) => l.shape === marksAt60[i].shape && l.color === marksAt60[i].color),
    'marks: ' + n + ' added layers, each mark the same as with 60 (a later layer never changes an earlier one)');
}
check(firstShared === 59, 'marks: the first shared mark at the 59th added layer (60 pairs, two taken by the built-in ' +
  'colors that look like a family: Livestock Markets\' Orange and Restricted\'s Crimson)', firstShared);
check(JSON.stringify(marksAt60.slice(5, 9).map(l => [l.shape, l.color])) === JSON.stringify([['circle', '#1c5a83'],
  ['pentagon', '#4a8b2c'], ['hexagon', '#fcb614'], ['cross', '#8bc04a']]),
  'marks: the first four added layers as designed (circle, pentagon, hexagon, cross; CVI\'s first four colors)');
check(marksAt60[9].shape === 'x', 'marks: the fifth added layer takes the tenth shape, the X');
// A manifest's own color is kept, with a shape where no look-alike color is drawn.
const own = FAC.registry(manifestOf(0, [['orange', 'o.csv', 'Orange layer', '#F07325'],
  ['green', 'g.csv', 'Green layer', '#4a8b2c'], ['feedlots', 'f.csv', 'My feedlots', '#123456']])).layers;
const lk = k => own.find(l => l.key === k);
check(lk('orange').color === '#F07325' && lk('orange').shape === 'circle', 'marks: a manifest\'s own color kept, on the ' +
  'first free shape', [lk('orange').shape, lk('orange').color]);
check(lk('green').color === '#4a8b2c' && lk('green').shape !== 'circle' && lk('green').shape !== 'diamond',
  'marks: an own color never on a shape with a look-alike (Evergreen: not with Orange)', lk('green').shape);
check(lk('feedlots').color === '#123456' && lk('feedlots').shape === 'triangle' && lk('feedlots').cviColor === '#123456',
  'marks: a manifest row for a built-in key keeps the built-in shape and its own color');
const named = FAC.registry(manifestOf(0, [['a', 'a.csv', 'A', 'red'], ['b', 'b.csv', 'B', 'Red']])).layers;
check(named[5].shape !== named[6].shape, 'marks: colors written as names are compared as text (red and Red alike)');
// The outlines: closed, centered, inside their reach; the circle at radius r.
FAC.SHAPES.forEach(shape => {
  const d = FAC.markPath(shape, 50, 40, 10);
  const nums = (d.match(/-?\d+(\.\d+)?/g) || []).map(Number);
  const xs = shape === 'circle' ? [40, 60] : nums.filter((v, i) => i % 2 === 0);
  const ys = shape === 'circle' ? [40] : nums.filter((v, i) => i % 2 === 1);
  const reach = FAC.MARK_EXTENT[shape] * 10 + 0.01;
  check(/^M/.test(d) && /Z$/.test(d) && xs.every(x => Math.abs(x - 50) <= reach) && ys.every(y => Math.abs(y - 40) <= reach),
    'marks: the ' + shape + ' outline is closed and within its reach', d);
});
check(/^M40 40A10 10 0 1 0 60 40A10 10 0 1 0 40 40Z$/.test(FAC.markPath('circle', 50, 40, 10)),
  'marks: the circle has the radius it is given');
const svg = FAC.markSvg({ shape: 'star', color: '#522348' }, 16);
check(/^<svg class="facility-mark" width="16" height="16"/.test(svg) && svg.includes('fill="#522348"') &&
  svg.includes('aria-hidden="true"'), 'marks: the list and legend picture (16 px, its color, hidden from readers)');
check(FAC.markSvg({ shape: '"><script>', color: '"><b>' }).includes('fill="#666666"') &&
  !FAC.markSvg({ shape: '"><script>', color: '"><b>' }).includes('<script'),
  'marks: an unknown shape draws a circle and an unreadable color gray (nothing from a file reaches the markup)');
// Colors written other ways: 8-digit hex and rgb() are read, the see-through part kept for the
// list picture, and two ways of writing one color count as one color.
const parsed = {
  '#1C5A83': ['#1c5a83', 1], '#abc': ['#aabbcc', 1], '#1c5a83cc': ['#1c5a83', 0.8], '#abcd': ['#aabbcc', 0.867],
  'rgb(28, 90, 131)': ['#1c5a83', 1], 'RGBA(28,90,131,0.5)': ['#1c5a83', 0.5], 'rgb(28 90 131 / 50%)': ['#1c5a83', 0.5],
  'rgb(100%, 0%, 0%)': ['#ff0000', 1]
};
Object.keys(parsed).forEach(c => {
  const got = FAC.colorParts(c), [hex, alpha] = parsed[c];
  check(got && got.hex === hex && Math.abs(got.alpha - alpha) < 0.001 && FAC.hexColor(c) === hex,
    'marks: the color ' + c + ' is read as ' + hex + ' at ' + alpha, got);
});
['teal', 'hsl(200, 50%, 30%)', 'rgb(1, 2)', '#12345', ''].forEach(c => check(
  FAC.colorParts(c) === null && FAC.hexColor(c) === null, 'marks: the color "' + c + '" is not read (a known limit for names)'));
// Colors read as CSS reads them: out-of-range values clamped; the separator mixes CSS refuses not read.
const clamped = { 'rgb(300, 0, 0)': ['#ff0000', 1], 'rgba(28,90,131,1.2)': ['#1c5a83', 1], 'rgb(-5, 0, 0)': ['#000000', 1],
  'rgb(10% 20 30)': ['#1a141e', 1], 'rgb(1 2 3 / 150%)': ['#010203', 1] };
Object.keys(clamped).forEach(c => {
  const got = FAC.colorParts(c), [hex, alpha] = clamped[c];
  check(got && got.hex === hex && got.alpha === alpha, 'marks: the color ' + c + ' is clamped to ' + hex + ' at ' + alpha,
    got);
});
['rgb(1 / 2 / 3)', 'rgb(1, 2 3)', 'rgb(10%, 20, 30)', 'rgb(1, 2, 3 / 0.5)', 'rgb(1,2,3,)', 'rgb(1 2 3 /)', 'rgb(1 2 3 4)']
  .forEach(c => check(FAC.colorParts(c) === null, 'marks: the color "' + c + '" is not read, as CSS refuses it',
    FAC.colorParts(c)));
check(/stroke="#666666"/.test(FAC.markSvg({ color: 'rgba(0,0,0,0)', shape: 'square' })) &&
  /stroke="#666666"/.test(FAC.markSvg({ color: '#1c5a8300', shape: 'circle' })) &&
  /stroke="#ffffff"/.test(FAC.markSvg({ color: 'rgba(0,0,0,0.5)', shape: 'circle' })),
'marks: a fully see-through color gets a gray outline in the lists');
const seeThrough = FAC.markSvg({ shape: 'circle', color: '#1c5a83cc' }, 16);
check(seeThrough.includes('fill="#1c5a83"') && seeThrough.includes('fill-opacity="0.8"'),
  'marks: an 8-digit color draws its color, see-through, in the list picture (it drew gray)', seeThrough);
const solid = FAC.markSvg({ shape: 'circle', color: 'rgb(28, 90, 131)' }, 16);
check(solid.includes('fill="#1c5a83"') && !solid.includes('fill-opacity'),
  'marks: an rgb() color draws its color in the list picture (it drew gray)', solid);
const twice = FAC.registry({ header: ['key', 'file', 'label', 'color'], rows: [
  ['green1', 'g1.csv', 'Green one', '#4A8B2C80'], ['green2', 'g2.csv', 'Green two', '#4a8b2c'],
  ['blue1', 'b1.csv', 'Blue one', 'rgb(28, 90, 131)'], ['blue2', 'b2.csv', 'Blue two', '#1C5A83']] }).layers;
const twiceOf = k => twice.find(l => l.key === k);
check(twiceOf('green1').shape !== twiceOf('green2').shape && twiceOf('blue1').shape !== twiceOf('blue2').shape &&
  twice.every(l => !l.sharesMarkWith.length),
  'marks: one color written two ways (8-digit hex, rgb()) is not drawn twice on one shape',
  twice.map(l => [l.key, l.shape, l.color]));
// A manifest color the browser cannot read never reaches the map (it would refuse the layer): the
// layer takes an automatic color the lists and the map read, CVI's color is kept for the parity checks, and the
// manifest's rows are named in the checklist's notes.
const unreadable = ['1c5a83', '#12345', 'Teal Blue'];
const badRows = unreadable.map((c, i) => ['bad' + i, 'bad' + i + '.csv', 'Bad ' + i, c]);
const badLayers = FAC.registry({ header: ['key', 'file', 'label', 'color'], rows: badRows }).layers.slice(-3);
check(badLayers.every((l, i) => l.cviColor === unreadable[i] && l.color !== unreadable[i] && FAC.colorParts(l.color)),
  'marks: an unreadable manifest color is replaced by an automatic one',
  badLayers.map(l => [l.key, l.cviColor, l.color]));
vm.runInContext(read('shared/facility-datasets.js'), fbox, { filename: 'facility-datasets.js' });
const badNotes = fbox.WSDA.facilityDatasets.expandManifest([['key', 'file', 'label', 'color']].concat(badRows,
  [['good', 'good.csv', 'Good', '#1c5a83']])).notes;
check(badNotes.length === 3 && badNotes.map(n => n.row).join() === '2,3,4' &&
  /^the color "1c5a83" is not a color the browser can read, so the layer is drawn in an automatic color$/.test(badNotes[0].reason),
  'checklist notes: each manifest row with an unreadable color named', badNotes);
// The branded PNGs: the shared point with a shape draws that outline, without one CVI's circle as before.
const bbox = { WSDA: fbox.WSDA };
bbox.window = bbox;
vm.createContext(bbox);
vm.runInContext(read('shared/brand.js'), bbox, { filename: 'brand.js' });
vm.runInContext(read('shared/branded.js'), bbox, { filename: 'branded.js' });
const BRD = bbox.WSDA.branded;
check(/^<circle /.test(BRD.circle(10, 10, 3, 0.5, '#382513', 1, '#ffffff')) &&
  /^<circle /.test(BRD.circle(10, 10, 3, 0.5, '#382513', 1, '#ffffff', 'circle')),
  'marks: a PNG point without a shape, or a circle, is CVI\'s circle');
const pngStar = BRD.circle(10, 10, 3, 0.5, '#522348', 1, '#ffffff', 'star');
check(pngStar.startsWith('<path d="' + FAC.markPath('star', 10, 10, BRD.pointRadius(3, 0.5))) &&
  pngStar.includes('fill="#522348"') && pngStar.includes('stroke="#ffffff"'),
  'marks: a PNG point with a shape uses the same outline at the same radius');
// The legend column: a side-by-side row of size circles keeps its height in a box too short for
// every row, so its largest circle stays under the heading above; a divider's line sits 6 points above the next row.
{
  const head = { text: 'ANIMALS / PREMISES', pt: 8 };
  const row = { across: [{ size: 3, stroke: 1, fill: '#888888', opacity: 0.5, label: '561' },
    { size: 12, stroke: 1, fill: '#888888', opacity: 0.5, label: '41,333' }], labelPt: 7 };
  const stacked = Array.from({ length: 6 }, (x, i) => ({ circle: { size: 4, stroke: 0.8, fill: '#1c5a83', opacity: 1 },
    label: 'Row ' + i, labelPt: 8 }));
  const col = BRD.legendColumn(stacked.concat([{ rule: true }, head, row]), { bottom: 0.1, minH: 0.05, maxH: 0.12 });
  const svgY = (col.parts.match(/<text [^>]*y="([\d.]+)"[^>]*>ANIMALS \/ PREMISES</) || [])[1];
  const big = col.circles.find(c => c.label === '41,333');
  // svgY is the heading's baseline; a slash reaches about 0.1 of its size below it.
  check(col.squeezed && big && svgY && big.y - big.r >= Number(svgY) + 8 * 0.1,
    'legend: a squeezed column keeps the side-by-side size row whole, under its heading', [col.squeezed, big, svgY]);
  const one = BRD.legendColumn([{ rule: true }, head], { bottom: 0.5, minH: 0.01, maxH: 0.5 });
  const lineY = Number((one.parts.match(/<line [^>]*y1="([\d.]+)"/) || [])[1]);
  const textY = Number((one.parts.match(/<text [^>]*y="([\d.]+)"/) || [])[1]);
  // textY is the heading's baseline; its row starts (0.65 + 0.358) of its size above that.
  // The markup rounds to 0.01 point.
  check(textY - (0.65 + 0.358) * 8 - lineY >= 6 - 0.02, 'legend: 6 points between a divider and the heading under it',
    [lineY, textY]);
}
// Every place a facility layer is drawn uses the mark (the browser suite checks them as drawn).
const src = rel => fs.readFileSync(path.join(SITE, rel), 'utf8');
textCheck(/markLayer\(POINT\(i\)/.test(src('shared/facilitymap.js')) && /FAC_LAYER = \(l, i\) => root\.CVIWA\.map\.markLayer/
  .test(src('cvi/app/focusmap.js')) && /markLayer\('lookup_fac'/.test(src('cvi/app/lookupmap.js')),
  'marks: the three live maps draw facilities with markLayer');
textCheck(/F\.markElement\(l, 18\)/.test(src('shared/facility-ui.js')) && (src('infrastructure/app.js')
  .match(/markElement\(l, 18\)/g) || []).length === 2 && /markElement\(l, 18\)/.test(src('cvi/app/ui.js')),
  'marks: the layer lists, the legends and the count cards show the mark');

// ── 8. "Show as table": each chart kind's numbers, from hand-made charts with known values ────────
const cbox = {};
cbox.window = cbox;
vm.createContext(cbox);
vm.runInContext(fs.readFileSync(path.join(SITE, 'cvi', 'app', 'charts.js'), 'utf8'), cbox, { filename: 'charts.js' });
const CHT = cbox.CVIWA.charts;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let t = CHT.table({ id: 'species', kind: 'bars', title: 'Animals by species group', subtitle: null, empty: null,
  bars: [{ label: 'Cattle', value: 12345 }, { label: 'Swine', value: 7.5 }] }, 'animals', 'wa');
check(same(t.head, ['Species group', 'Animals']) && same(t.rows, [['Cattle', '12,345'], ['Swine', '7.5']]) &&
  same(t.numeric, [false, true]) && t.caption === 'Animals by species group', 'tables: bars (species)', t);
t = CHT.table({ id: 'corridors', kind: 'bars', title: 'Top movement corridors', empty: null,
  bars: [{ label: 'WA  →  OR', value: 3 }] }, 'records', 'flow');
check(same(t.head, ['Corridor', 'CVI records']) && same(t.rows, [['WA → OR', '3']]), 'tables: bars (corridors)', t);
t = CHT.table({ id: 'top_places', kind: 'bars_by_direction', title: 'Top counties by animal volume', empty: null,
  groups: [{ label: 'King', total: 30, bars: [{ series: 'Inbound', value: 10 }, { series: 'Outbound', value: 20 }] },
    { label: 'Yakima', total: 5, bars: [{ series: 'Outbound', value: 5 }] }] }, 'animals', 'wa');
check(same(t.head, ['County', 'Inbound', 'Outbound', 'Total']) &&
  same(t.rows, [['King', '10', '20', '30'], ['Yakima', '—', '5', '5']]), 'tables: bars by direction (a missing ' +
  'direction shown as a dash)', t);
check(CHT.table({ id: 'top_places', kind: 'bars_by_direction', title: 'x', empty: null, groups: [] }, 'animals', 'flow')
  .head[0] === 'State', 'tables: National Flow names states');
t = CHT.table({ id: 'top_premises', kind: 'bars_by_panel', title: 'Top premises', empty: null,
  panels: [{ name: 'Importers (Inbound)', bars: [{ label: 'P1', value: 4 }] },
    { name: 'Exporters (Outbound)', bars: [{ label: 'P2', value: 2 }] }] }, 'cvis', 'focus');
check(same(t.head, ['Role', 'Premises', 'Unique CVIs']) &&
  same(t.rows, [['Importers (Inbound)', 'P1', '4'], ['Exporters (Outbound)', 'P2', '2']]), 'tables: bars by panel', t);
t = CHT.table({ id: 'over_time', kind: 'lines', title: 'Animal volume over time', empty: null,
  periods: ['2024 Q1', '2024 Q2'], series: [{ name: 'Inbound', values: [1, 0] }, { name: 'Outbound', values: [2000, 3] }] },
'animals', 'wa');
check(same(t.head, ['Period', 'Inbound', 'Outbound']) &&
  same(t.rows, [['2024 Q1', '1', '2,000'], ['2024 Q2', '0', '3']]), 'tables: lines (one row per period)', t);
t = CHT.table({ id: 'emerging', kind: 'change', title: 'Emerging vs cooling',
  subtitle: 'Change in animals: 2024 Q1  →  2024 Q2', empty: null,
  bars: [{ label: 'King', value: 12 }, { label: 'Pierce', value: -1500 }] }, 'animals', 'wa');
check(same(t.head, ['County', 'Change in animals']) && same(t.rows, [['King', '+12'], ['Pierce', '−1,500']]) &&
  t.caption === 'Emerging vs cooling (Change in animals: 2024 Q1 → 2024 Q2)' && same(t.numeric, [false, true]),
'tables: change (signed, the periods in the caption)', t);
t = CHT.table({ id: 'species', kind: 'bars', title: 'Animals by species group', empty: 'No species data' }, 'animals', 'wa');
check(t.empty === 'No species data' && !t.rows.length, 'tables: an empty chart gives its message, no rows', t);
textCheck(/tableToggle\(id\)/.test(src('cvi/app/ui.js')) && /aria-expanded/.test(src('cvi/app/ui.js')) &&
  /CH\.table\(c, st\.chartMeasure, st\.view\)/.test(src('cvi/app/ui.js')), 'tables: every chart card has the toggle');

// ── 9. The Stats text: hand-made rows with known answers ───────────────────────────────────────
// The quarters written "Q1, Q2"; Unique CVIs; the note when WA-to-WA movements count at both ends; the change from the
// previous quarter (or the same quarter last year, as the charts' "Compare with"). The rest stays CVI's text (the S7
// unit suite compares it with CVI's after taking these out).
const sbox = {};
sbox.window = sbox;
vm.createContext(sbox);
for (const f of ['csv.js', 'master.js', 'scaling.js', 'summary.js', 'charts.js', 'exports.js']) {
  vm.runInContext(src('cvi/app/' + f), sbox, { filename: f });
}
const EXS = sbox.CVIWA.exports, SRC_ROW = sbox.CVIWA.master.SOURCE_ROW;
const statsRow = (o, i) => Object.assign({ CVI: 'C' + i, 'Species.Group': 'Cattle', 'Reporting.Year': 2024,
  'Reporting.Quarter': 'Q1', Movement: 'Inbound', 'Total.Animals': 10, 'Origin.State': 'OR', 'Dest.State': 'WA',
  'Origin.County': 'N/A', 'Dest.County': 'King' }, o);
// Q1: one import of 10 animals (CVI C1). Q2: one import of 25 (C2) and one WA-to-WA movement of 10 (C3), which the
// loader gives as two rows with one source row number, both drawn when both directions are picked.
const statsRows = [statsRow({}, 1), statsRow({ 'Reporting.Quarter': 'Q2', 'Total.Animals': 25 }, 2),
  statsRow({ 'Reporting.Quarter': 'Q2', 'Origin.State': 'WA', 'Origin.County': 'Yakima', [SRC_ROW]: 7 }, 3),
  statsRow({ 'Reporting.Quarter': 'Q2', Movement: 'Outbound', 'Origin.State': 'WA', 'Origin.County': 'Yakima',
    [SRC_ROW]: 7 }, 3)];
const statsF = { species: ['Cattle'], years: [2024], quarters: ['Q2', 'Q1'], direction: ['Inbound', 'Outbound'] };
const statsNow = new Date(2026, 9, 15, 9, 30, 0);
let st9 = EXS.statsLines('wa', statsF, statsRows, [], statsNow);
const after = (lines, head, n) => {
  const i = lines.indexOf(head);
  return i < 0 ? null : lines.slice(i + 1, i + 1 + n);
};
check(st9.includes('  Quarters:  Q1, Q2'), 'stats: the quarters written "Q1, Q2" in order', st9);
check(same(after(st9, 'SUMMARY', 7), ['  Total records:    4', '  Total animals:    45', '  Unique CVIs:      3',
  '  Total records counts each WA-to-WA movement twice, once at',
  '  each end (Inbound and Outbound): 1 movement here.', '  Total animals counts it once.', '']),
'stats: Unique CVIs and the WA-to-WA note under the totals', after(st9, 'SUMMARY', 7));
check(same(after(st9, 'CHANGE FROM THE PREVIOUS QUARTER (2024 Q1 to 2024 Q2)', 3),
  ['  Total animals:    10 to 35 (+25, +250.0%)', '  Unique CVIs:      1 to 2 (+1, +100.0%)', '']),
'stats: the change from the previous quarter (WA-to-WA once; distinct CVIs)', st9);
check(st9.indexOf('ANIMALS BY SPECIES') > st9.findIndex(l => l.startsWith('CHANGE FROM')),
  'stats: the change comes before CVI\'s ANIMALS BY SPECIES');
check(st9.every(l => l.length <= 64), 'stats: no line wider than the 64-character rule',
  st9.filter(l => l.length > 64));
// Large counts: 7-digit totals. WA State's change line is 64 characters and stays one line; County
// Focus's longer label would make it 72, so the difference goes on a second line under the counts.
{
  const bigRows = [statsRow({ 'Total.Animals': 1234567 }, 1),
    statsRow({ 'Reporting.Quarter': 'Q2', 'Total.Animals': 9876543 }, 2)];
  const bigF = Object.assign({}, statsF, { direction: ['Inbound'] });
  const bigWa = EXS.statsLines('wa', bigF, bigRows, [], statsNow);
  const bigFocus = EXS.statsLines('focus', Object.assign({}, bigF, { direction: 'combined', counties: ['King'] }),
    bigRows, [], statsNow);
  const head = 'CHANGE FROM THE PREVIOUS QUARTER (2024 Q1 to 2024 Q2)';
  check(same(after(bigWa, head, 1), ['  Total animals:    1,234,567 to 9,876,543 (+8,641,976, +700.0%)']),
    'stats: a 64-character change line with 7-digit counts stays one line', after(bigWa, head, 2));
  check(same(after(bigFocus, head, 2), ['  Total animal activity:    1,234,567 to 9,876,543',
    '                            (+8,641,976, +700.0%)']),
  'stats: a wider change line (County Focus, 7-digit counts) puts the difference under the counts', after(bigFocus, head, 3));
  check(bigWa.concat(bigFocus).every(l => l.length <= 64), 'stats: no line wider than 64 characters with 7-digit counts',
    bigWa.concat(bigFocus).filter(l => l.length > 64));
}
// One direction only: the WA-to-WA movement drawn once, so no note.
st9 = EXS.statsLines('wa', Object.assign({}, statsF, { direction: ['Inbound'] }),
  statsRows.filter(r => r.Movement === 'Inbound'), [], statsNow);
check(!st9.some(l => /WA-to-WA/.test(l)) && st9.includes('  Total records:    3'),
  'stats: no note when each WA-to-WA movement is drawn once', st9);
// Two movements counted twice; County Focus names its own total.
const twoTwice = statsRows.concat([statsRow({ 'Reporting.Quarter': 'Q2', 'Origin.State': 'WA', [SRC_ROW]: 8 }, 4),
  statsRow({ 'Reporting.Quarter': 'Q2', Movement: 'Outbound', 'Origin.State': 'WA', [SRC_ROW]: 8 }, 4)]);
st9 = EXS.statsLines('focus', Object.assign({}, statsF, { direction: 'combined', counties: ['King'] }), twoTwice, [],
  statsNow);
check(st9.includes('  each end (Inbound and Outbound): 2 movements here.') &&
  st9.includes('  Total animal activity counts them once.') &&
  st9.includes('  Total animal activity:    10 to 45 (+35, +350.0%)'), 'stats: County Focus wording, two movements', st9);
// The same quarter last year: in the selected years, or a message.
st9 = EXS.statsLines('wa', Object.assign({}, statsF, { compare: 'last_year' }), statsRows, [], statsNow);
check(same(after(st9, 'CHANGE FROM THE SAME QUARTER LAST YEAR', 1), ['  2023 Q2 is not in the selected years.']),
  'stats: the same quarter last year outside the selected years', st9);
const lastYearRows = statsRows.concat([statsRow({ 'Reporting.Year': 2023, 'Reporting.Quarter': 'Q2',
  'Total.Animals': 70 }, 5), statsRow({ 'Reporting.Year': 2023, 'Reporting.Quarter': 'Q2', 'Total.Animals': 0 }, 5)]);
st9 = EXS.statsLines('wa', Object.assign({}, statsF, { years: [2023, 2024], compare: 'last_year' }), lastYearRows, [],
  statsNow);
check(same(after(st9, 'CHANGE FROM THE SAME QUARTER LAST YEAR (2023 Q2 to 2024 Q2)', 2),
  ['  Total animals:    70 to 35 (-35, -50.0%)', '  Unique CVIs:      1 to 2 (+1, +100.0%)']),
'stats: the same quarter last year (a fall written with a minus)', st9);
// One quarter only; no CVI column; a period with no animals before.
st9 = EXS.statsLines('wa', Object.assign({}, statsF, { quarters: ['Q1'] }), statsRows.slice(0, 1), [], statsNow);
check(same(after(st9, 'CHANGE FROM THE PREVIOUS QUARTER', 1), ['  Needs two or more quarters with data.']),
  'stats: one quarter, a message', st9);
const noCvi = statsRows.map(r => {
  const c = Object.assign({}, r);
  delete c.CVI;
  return c;
});
st9 = EXS.statsLines('wa', statsF, noCvi, [], statsNow);
check(st9.includes('  Unique CVIs:      none (the file has no CVI column)') &&
  !st9.some(l => /^  Unique CVIs: .* to /.test(l)), 'stats: without a CVI column, said so and no CVI change', st9);
st9 = EXS.statsLines('wa', statsF, [statsRow({ 'Total.Animals': 0 }, 1)].concat(statsRows.slice(1)), [], statsNow);
check(st9.includes('  Total animals:    0 to 35 (+35)'), 'stats: no percentage when the earlier quarter had none',
  st9);
textCheck(/compare: st\.view === 'flow' \? 'previous' : st\.chartCompare/.test(src('cvi/app/ui.js')),
  'stats: Preview Stats follows the charts\' "Compare with" (National Flow: the previous quarter)');

// ── 10. Help notes and the glossary ──────────────────────────────────────────────────────────────
// Every "?" note: its hover text and its shown note the same words; written plainly (no shouted words, no shorthand
// such as "~", "=", "≤" or "a/b"). The glossary: written once in brand.js, a holder at the end of every page's footer.
const unescape = t => t.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const ACRONYMS = new Set(['CVI', 'WSDA', 'PNG', 'ZIP', 'GIF', 'CSV', 'YYYY']);
let helpCount = 0;
for (const page of ['cvi/index.html', 'infrastructure/index.html']) {
  const html = src(page);
  const re = /<button[^>]*data-help="([^"]+)"[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    helpCount++;
    const key = m[1];
    const title = unescape((/title="([^"]*)"/.exec(m[0]) || [])[1] || '');
    const note = new RegExp('<p class="help-note" id="help-' + key + '" hidden>([^<]*)</p>').exec(html);
    check(note && unescape(note[1]) === title && title.length > 0, 'help: ' + page + ' ' + key + ': hover text and note agree');
    check(/aria-expanded="false"/.test(m[0]) && new RegExp('aria-controls="help-' + key + '"').test(m[0]),
      'help: ' + page + ' ' + key + ': the button names its note and says it is closed');
    const plain = title.replace(/\(for example [^)]*\)/g, '');
    const shouted = (plain.match(/\b[A-Z]{3,}\b/g) || []).filter(w => !ACRONYMS.has(w));
    check(!shouted.length, 'help: ' + page + ' ' + key + ': no shouted words', shouted);
    check(!/~|≤|≥| = |\b[a-z]+\/[a-z]+\b/.test(plain), 'help: ' + page + ' ' + key + ': no shorthand', plain);
  }
}
// CH: five more on the CVI page (Show counties as, Measure, Shading classes; Show states as, Shading classes).
// Also WA State's Display Mode (its warning had been hover text only) and County Focus's "Group nearby premises".
check(helpCount === 56, 'help: 42 notes on the CVI page and 14 on the Infrastructure dashboard', helpCount);
const gbox = { document: null };
gbox.window = gbox;
vm.createContext(gbox);
vm.runInContext(read('shared/brand.js'), gbox, { filename: 'brand.js' });
const GL = gbox.WSDA.brand.GLOSSARY;
// CH: "Shaded map (choropleth)" added.
check(same(GL.map(g => g[0]), ['CVI', 'Premises', 'WA-to-WA', 'Bundle', 'Shaded map (choropleth)']) &&
  GL.every(g => g[1].length > 40), 'glossary: the five terms, each explained', GL.map(g => g[0]));
check(/Certificate of Veterinary Inspection/.test(GL[0][1]) && /twice/.test(GL[2][1]) && /once/.test(GL[2][1]) &&
  /bundle\.json/.test(GL[3][1]), 'glossary: CVI spelled out, WA-to-WA counted twice and once, bundle.json named');
for (const page of ['index.html', 'cvi/index.html', 'infrastructure/index.html']) {
  const foot = (/<footer class="foot">([\s\S]*?)<\/footer>/.exec(src(page)) || [])[1] || '';
  check(/<div data-wsda-glossary><\/div>\s*$/.test(foot), 'glossary: ' + page + ' has the holder at the end of its footer');
}
textCheck(/querySelectorAll\('\[data-wsda-glossary\]'\)/.test(src('shared/brand.js')), 'glossary: brand.js fills every holder');
// The tab icon: WSDA's own site icon (agr.wa.gov /content/icons/favicon.ico, fetched once on 2026-10-16 with
// permission), byte for byte: its SHA-256 written out here, and its 16, 32 and 48 px images.
const ico = Buffer.from(gbox.WSDA.brand.FAVICON.dataUrl.split(',')[1], 'base64');
check(crypto.createHash('sha256').update(ico).digest('hex') === '431f7371f542d0474b2005c8d5c9ac42f351c54d28ee5f8f6a2bd8765bdbd67f'
  && ico.length === 15086 && /^data:image\/x-icon;base64,/.test(gbox.WSDA.brand.FAVICON.dataUrl),
'favicon: agr.wa.gov\'s icon, byte for byte (SHA-256)');
const icoSizes = [];
for (let i = 0; i < ico.readUInt16LE(4); i++) icoSizes.push(ico[6 + 16 * i]);
check(same(icoSizes.sort((x, y) => x - y), [16, 32, 48]), 'favicon: 16, 32 and 48 px images', icoSizes);
textCheck(/\n    setFavicon\(root\.document\);\n/.test(src('shared/brand.js')), 'favicon: brand.js gives it to every page');
// Every "?" on the Infrastructure dashboard opens its note (the handler once listened inside the Export section only).
textCheck(/document\.addEventListener\('click', e => \{\s*const b = e\.target\.closest && e\.target\.closest\('button\.tip\[data-help\]'\)/
  .test(src('infrastructure/app.js')), 'help: the Infrastructure dashboard answers every "?" on the page');

console.log('UI unit: ' + pass + '/' + (pass + fail) + ' passed (' + PAIRS.length + ' color pairs, ' + tints.length +
  ' tints, ' + sheets.reduce((n, s) => n + s.list.length, 0) + ' style rules; ' + textChecks +
  ' of the checks only search source text)' + (fail ? '\n  ' + failures.join('\n  ') : ''));
process.exitCode = fail ? 1 : 0;
