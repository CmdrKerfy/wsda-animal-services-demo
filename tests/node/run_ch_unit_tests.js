#!/usr/bin/env node
'use strict';
// Shaded counties and states unit suite: site/cvi/app/choropleth.js
// and what uses it, in Node, with the page's own modules and synthetic data only. No packages.
//
// Checks:
//   areas    every county's land area in the table equals the sum of its 2020 Census tracts' ALAND
//   ramps    the chosen ColorBrewer ramps, fewer classes taken evenly from them, at most five; neighboring
//            classes and the lightest class apart from white, the hatch's ground and the land gray in every kind of
//            vision (facilities.js's simulation)
//   classes  Natural breaks are CVI's Fisher breaks and Quantile its quantiles; one class when every value is the
//            same; labels from the values each class holds; every value in the class R's cut() gives it;
//            zero or missing takes no class; per square mile is total over area
//   labels   per square mile legends: no "0" for a positive value and no label end shared by neighboring classes, in
//            every synthetic view
//   shared   Compare's two maps and the GIF's frames: one set of classes, so a value gets one color everywhere
//   pages    WA State's PNG shaded (fills, hatch, white lines, every county named, no circles, the legend, the
//            spotlight), the GIF's frames sharing classes, National Flow's PNG shaded (states, the hub, no lines),
//            the County Focus PNG's white lines (gray kept on Streets), the strip's mode, export_params.json
//   names    shaded counties matched without regard to case or spaces; the animals in counties the map does not have
//            under the legend (live and PNG) and in the Stats text
//   insets   Alaska and Hawaii on National Flow: geo/us-insets.js, flowinsets.js's layout,
//            and the PNG and GIF: a box only for a state with movements (in any GIF frame), shaded in its class's
//            color or land gray, its lines ending at its center in the box, its Top 3 badge, clear of the names
//
// Usage (repository root, after node tests/node/run_f1_unit_tests.js, which writes test-tables/):
//   node tests/node/run_ch_unit_tests.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const SITE = path.join(ROOT, 'site');
const APP = path.join(SITE, 'cvi', 'app');

const sandbox = { window: {}, console, TextEncoder, TextDecoder };
vm.createContext(sandbox);
for (const f of ['csv.js', 'master.js', 'scaling.js', 'palettes.js', 'choropleth.js', 'aggregate.js', 'chartsvg.js',
  'periods.js', 'summary.js', 'flow.js', 'flowinsets.js', 'focus.js', 'exports.js', 'charts.js', 'movement.js']) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
}
for (const f of ['zip.js', 'brand.js', 'branded.js', 'tiles.js', 'labels.js', 'facilities.js', 'gif.js']) {
  vm.runInContext(fs.readFileSync(path.join(SITE, 'shared', f), 'utf8'), sandbox, { filename: f });
}
vm.runInContext(fs.readFileSync(path.join(APP, 'brandedmaps.js'), 'utf8'), sandbox, { filename: 'brandedmaps.js' });
vm.runInContext(fs.readFileSync(path.join(APP, 'timeseries.js'), 'utf8'), sandbox, { filename: 'timeseries.js' });
for (const f of ['wa-counties.js', 'us-states.js', 'state-centers.js', 'us-insets.js', 'tracts-wa.js', 'streets-wa.js']) {
  vm.runInContext(fs.readFileSync(path.join(SITE, 'geo', f), 'utf8'), sandbox);
}
const win = sandbox.window;
const W = win.CVIWA;
const CP = W.choropleth;
const S = W.scaling;
const BM = W.brandedmaps;
const BR = win.WSDA.branded;
const TS = W.timeseries;
const FAC = win.WSDA.facilities;
const COUNTIES = win.CVIWA_GEO.counties.features;
const NAMES = COUNTIES.map(f => f.properties.name);
const STATES = win.WSDA_US_STATES.states.features;
const CENTERS = W.flow.centers(win.WSDA_STATE_CENTERS);

let passed = 0;
let failed = 0;
const failures = [];
const counts = {};
function check(ok, name, detail) {
  const part = name.split(':')[0];
  counts[part] = (counts[part] || 0) + 1;
  if (ok) {
    passed++;
  } else {
    failed++;
    failures.push(name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail).slice(0, 400)));
  }
}
// A step that throws fails its check instead of stopping the suite.
function guard(name, fn) {
  try {
    fn();
  } catch (e) {
    check(false, name + ': ran to its end', String(e && e.stack || e));
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const master = W.master.load(fs.readFileSync(path.join(ROOT, 'test-tables', 'tier_full_master.csv'), 'utf8'));
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
const waRows = (o) => W.aggregate.build(master.rows, Object.assign({ species: master.speciesChoices,
  years: master.yearChoices, quarters: QUARTERS, direction: ['Inbound', 'Outbound'], mode: 'side_by_side',
  scaling: 'log', nBins: 5, rawSpecies: [], hasSpecies: master.hasSpecies }, o || {}));
const flowF = o => Object.assign({ direction: 'inbound', species: master.speciesChoices, speciesSub: [],
  years: master.yearChoices, quarters: QUARTERS, combine: false, scaling: 'natural', nBins: 5 }, o || {});

// ── Land areas ─────────────────────────────────────────────────────────────────────────────────────────────────
guard('areas', () => {
  const byFips = new Map(COUNTIES.map(c => [c.properties.fips, c.properties.name]));
  const sums = new Map();
  for (const t of win.WSDA_TRACTS.tracts) {
    const name = byFips.get(String(t.geoid).slice(0, 5));
    if (name) sums.set(name, (sums.get(name) || 0) + t.aland / CP.SQ_M_PER_SQ_MI);
  }
  check(Object.keys(CP.LAND_SQ_MI).length === 39 && NAMES.every(n => CP.LAND_SQ_MI[n] > 0),
    'areas: a land area for each of the 39 counties', Object.keys(CP.LAND_SQ_MI).length);
  for (const n of NAMES) {
    check(Math.abs(CP.LAND_SQ_MI[n] - sums.get(n)) <= 0.05, 'areas: ' + n + ' equals its tracts\' sum',
      [CP.LAND_SQ_MI[n], sums.get(n)]);
  }
  const total = Object.values(CP.LAND_SQ_MI).reduce((a, b) => a + b, 0);
  check(Math.abs(total - 66455) < 2, 'areas: the counties add up to Washington\'s land area', total);
});

// ── Ramps ──────────────────────────────────────────────────────────────────────────────────────────────────────
guard('ramps', () => {
  check(same(CP.FIVE.Inbound, ['#c6dbef', '#6baed6', '#2171b5', '#08519c', '#08306b']) &&
    same(CP.FIVE.Outbound, ['#fdd0a2', '#fdae6b', '#fd8d3c', '#e6550d', '#a63603']) &&
    same(CP.FIVE.Combined, ['#ccebc5', '#7bccc4', '#2b8cbe', '#0868ac', '#084081']),
  'ramps: the chosen ColorBrewer ramps (Blues, Oranges, GnBu)');
  check(CP.MAX_CLASSES === 5, 'ramps: at most five classes', CP.MAX_CLASSES);
  for (const key of ['Inbound', 'Outbound', 'Combined']) {
    const five = CP.FIVE[key];
    check(same(CP.rampColors(key, 5), five), 'ramps: ' + key + ': 5 classes are the five');
    check(same(CP.rampColors(key, 4), [five[0], five[1], five[3], five[4]]), 'ramps: ' + key + ': 4 classes evenly');
    check(same(CP.rampColors(key, 3), [five[0], five[2], five[4]]), 'ramps: ' + key + ': 3 classes evenly');
    check(same(CP.rampColors(key, 2), [five[0], five[4]]), 'ramps: ' + key + ': 2 classes, the ends');
    check(same(CP.rampColors(key, 1), [five[2]]), 'ramps: ' + key + ': 1 class, the middle');
    check(same(CP.rampColors(key, 10), five), 'ramps: ' + key + ': more than 5 asked gives the five');
    for (let n = 2; n <= 5; n++) {
      const c = CP.rampColors(key, n);
      let least = Infinity;
      for (let i = 1; i < c.length; i++) least = Math.min(least, FAC.visionDifference(c[i - 1], c[i]));
      check(least >= 12, 'ramps: ' + key + ', ' + n + ' classes: neighbors at least 12 apart in every vision',
        least.toFixed(1));
    }
    for (const under of ['#ffffff', CP.HATCH.ground, '#ececec', '#e8e8e8']) {
      const d = FAC.visionDifference(five[0], under);
      check(d >= 10, 'ramps: ' + key + ': the lightest class apart from ' + under, d.toFixed(1));
    }
  }
  check(CP.rampKey(['Inbound']) === 'Inbound' && CP.rampKey(['Outbound']) === 'Outbound' &&
    CP.rampKey(['Inbound', 'Outbound']) === 'Combined' && CP.rampKey('inbound') === 'Inbound' &&
    CP.rampKey('outbound') === 'Outbound' && CP.rampKey('combined') === 'Combined', 'ramps: the direction\'s ramp');
});

// ── Classes ────────────────────────────────────────────────────────────────────────────────────────────────────
// What R's cut(include.lowest = TRUE, right = TRUE) gives a value, worked out here without the page's bincode.
function cutR(v, breaks) {
  if (v < breaks[0] || v > breaks[breaks.length - 1]) return null;
  if (v === breaks[0]) return 1;
  for (let i = 1; i < breaks.length; i++) {
    if (v <= breaks[i]) return i;
  }
  return null;
}
guard('classes', () => {
  const sets = [
    ['the full table, Total animals', [...CP.countyValues(waRows(), 'total').values()]],
    ['the full table, per square mile', [...CP.countyValues(waRows(), 'per_sq_mi').values()]],
    ['Inbound 2024 Q1', [...CP.countyValues(waRows({ direction: ['Inbound'], years: [2024], quarters: ['Q1'] }),
      'total').values()]],
    ['small integers with ties', [1, 1, 2, 3, 3, 3, 8, 9, 40, 41, 120]],
    ['three values', [5, 7, 900]],
    ['values on breaks', [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110]]
  ];
  for (const [label, vals] of sets) {
    const pos = vals.filter(v => v > 0);
    for (const method of ['natural', 'quantile']) {
      for (const n of [3, 4, 5]) {
        const tag = 'classes: ' + label + ', ' + method + ', ' + n;
        const measure = /per square mile/.test(label) ? 'per_sq_mi' : 'total';
        const cls = CP.classify(vals, method, n, 'Combined', measure);
        // The breaks, worked out here from scaling.js's Fisher and quantiles.
        const uniq = a => a.filter((v, i) => a.indexOf(v) === i);
        let want;
        const q = () => uniq(S.quantile7(pos, S.seqProbs(n + 1)));
        if (method === 'quantile') want = q();
        else {
          try {
            want = S.fisherBreaks(pos, Math.min(n, uniq(pos).length));
          } catch (e) {
            want = null;
          }
          if (!want || uniq(want).length < 2) want = q();
        }
        want = uniq(want);
        want[0] = Math.min(...pos);
        want[want.length - 1] = Math.max(...pos);
        want = uniq(want);
        check(same(cls.breaks, want), tag + ': the breaks', { got: cls.breaks, want });
        check(cls.n === want.length - 1 && cls.n <= n && cls.colors.length === cls.n, tag + ': classes and colors',
          [cls.n, cls.colors.length]);
        check(pos.every(v => cls.classOf(v) === cutR(v, cls.breaks)), tag + ': each value in the class cut() gives',
          pos.filter(v => cls.classOf(v) !== cutR(v, cls.breaks)));
        // Each class labeled by the lowest and highest value it holds. Extra digits (0 to 2) only where labels would
        // read the same: a class's own two ends, or a class's end and the next class's start (both those labels).
        const ends = cls.breaks.slice(1).map((b, k) => {
          const held = pos.filter(v => cls.classOf(v) === k + 1);
          return held.length ? [Math.min(...held), Math.max(...held)] : [cls.breaks[k], cls.breaks[k + 1]];
        });
        const reads = (v, d) => CP.format(v, measure, d);
        const num = (v, d) => Number(reads(v, d).replace(/,/g, ''));
        const fewest = same => { let x = 0; while (x < 2 && same(x)) x++; return x; };
        const own = ends.map(([a, b]) => (a === b ? 0 : fewest(x => num(a, x) >= num(b, x))));
        const edge = ends.map(([, b], k) => (k + 1 < ends.length ? fewest(x => num(b, x) >= num(ends[k + 1][0], x)) : 0));
        const extra = ends.map((e, k) => Math.max(own[k], edge[k], k ? edge[k - 1] : 0));
        const labels = cls.breaks.slice(1).map((b, k) => {
          const held = pos.filter(v => cls.classOf(v) === k + 1);
          if (!held.length) return null;
          const lo = Math.min(...held);
          const hi = Math.max(...held);
          return lo === hi ? reads(lo, extra[k]) : reads(lo, extra[k]) + ' – ' + reads(hi, extra[k]);
        });
        check(labels.every((l, k) => l === null || l === cls.labels[k]), tag + ': labels from the values held',
          { labels: cls.labels, want: labels });
        check(cls.counts.reduce((a, b) => a + b, 0) === pos.length, tag + ': every value in one class');
      }
    }
  }
  const one = CP.classify([7, 7, 7, 0, null], 'natural', 5, 'Inbound', 'total');
  check(one.single && one.n === 1 && one.classOf(7) === 1 && same(one.labels, ['7']) && one.colors.length === 1,
    'classes: one class when every value is the same', one);
  check(one.classOf(0) === null && one.classOf(null) === null && one.classOf(-3) === null && one.classOf(NaN) === null,
    'classes: zero, missing and negative take no class');
  const none = CP.classify([0, null], 'natural', 5, 'Inbound', 'total');
  check(none.n === 0 && none.classOf(5) === null, 'classes: no value above zero, no class', none.n);
  check(CP.classify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'natural', 10, 'Inbound', 'total').n <= 5,
    'classes: at most five classes even when more bins are asked');
  // Per square mile: total over area; labels with decimals.
  const rows = waRows();
  const tot = CP.countyValues(rows, 'total');
  const per = CP.countyValues(rows, 'per_sq_mi');
  check([...per].every(([c, v]) => Math.abs(v - tot.get(c) / CP.LAND_SQ_MI[c]) < 1e-9) && per.size === tot.size,
    'classes: per square mile is the total over the county\'s land area');
  check(CP.format(0.456, 'per_sq_mi') === '0.46' && CP.format(12.34, 'per_sq_mi') === '12.3' &&
    CP.format(1234.4, 'per_sq_mi') === '1,234' && CP.format(1234, 'total') === '1,234', 'classes: number formats');
  // countyValues adds both directions' rows of a county: the Combined total, as aggregate.build's "total" mode.
  const comb = CP.countyValues(waRows({ mode: 'total' }), 'total');
  check(same([...comb].sort(), [...tot].sort()), 'classes: Separate circles\' rows add up to the Combined total');
  const shaded = CP.shade(NAMES, tot, CP.classify([...tot.values()], 'natural', 5, 'Combined', 'total'));
  check(shaded.length === 39 && shaded.every(c => (c.none ? c.color === null : c.color && c.cls >= 1)),
    'classes: every county one class or No movements');
  const missing = CP.shade(['Adams', 'Nowhere'], new Map([['Adams', 0]]), one);
  check(missing.every(c => c.none && c.color === null), 'classes: a county with zero or no value has No movements');
});

// ── Shared classes (Compare and the GIF) ───────────────────────────────────────────────────────────────────────
// Every synthetic view's per square mile legend, by species, year, quarter and direction, under both
// methods: no label reads "0" for a positive value, and neighboring classes never share a label end.
guard('labels', () => {
  let views = 0;
  const bad = [];
  for (const species of master.speciesChoices.map(x => [x]).concat([master.speciesChoices])) {
    for (const year of master.yearChoices) {
      for (const q of QUARTERS) {
        for (const direction of [['Inbound'], ['Outbound'], ['Inbound', 'Outbound']]) {
          const vals = [...CP.countyValues(waRows({ species, direction, years: [year], quarters: [q] }), 'per_sq_mi')
            .values()];
          if (vals.filter(v => v > 0).length < 2) continue;
          for (const method of ['natural', 'quantile']) {
            const cls = CP.classify(vals, method, 5, 'Combined', 'per_sq_mi');
            views++;
            const parts = cls.labels.map(l => l.split(' – '));
            const zero = cls.labels.some(l => /^0(\.0+)?( |$)/.test(l) || / 0(\.0+)?$/.test(l));
            const num = t => Number(t.replace(/,/g, ''));
            const shared = parts.some((p, k) => k + 1 < parts.length && num(p[p.length - 1]) >= num(parts[k + 1][0]));
            const flat = parts.some(p => p.length === 2 && p[0] === p[1]);
            if (zero || shared || flat) bad.push({ species: species.join('+'), year, q, direction, method, labels: cls.labels });
          }
        }
      }
    }
  }
  check(views > 300 && !bad.length, 'labels: per square mile: no "0" for a positive value, no end shared by ' +
    'neighbors, in ' + views + ' synthetic views', bad.slice(0, 3));
  check(CP.format(0.000189, 'per_sq_mi') === '0.00019' && CP.format(0.05, 'per_sq_mi') === '0.05' &&
    CP.format(2.46, 'per_sq_mi') === '2.5' && CP.format(2.46, 'per_sq_mi', 1) === '2.46' &&
    CP.format(1234.5, 'per_sq_mi', 2) === '1,234.50' && CP.format(1234, 'total') === '1,234',
  'labels: two significant figures below 1, one decimal from 1, more on request, thousands marks kept');
  // Class ends on either side of a format step read in order ("99.96" then "100.4", not "100.0"
  // then "100"; "0.996" then "1.04", not "1" then "1.0").
  const step100 = CP.classify([99.96, 100.4], 'quantile', 2, 'Inbound', 'per_sq_mi').labels;
  const step1 = CP.classify([0.996, 1.04], 'quantile', 2, 'Inbound', 'per_sq_mi').labels;
  check(step100.join('|') === '99.96|100.4' && step1.join('|') === '0.996|1.04',
    'labels: ends on either side of a format step read in order', { step100, step1 });
  // Extra digits only on the labels that would read the same, at most two: here the first class's end (2.41) and the
  // second's start (2.44) both read "2.4", so those two labels get one more digit; the third keeps its normal form.
  const local = CP.classify([1.2, 2.41, 2.44, 3.1, 7.8, 8.2], 'quantile', 3, 'Inbound', 'per_sq_mi').labels;
  check(local.join('|') === '1.20 – 2.41|2.44 – 3.10|7.8 – 8.2', 'labels: extra digits only where two labels would read the same',
    local);
});

guard('shared', () => {
  const left = waRows({ years: [2024] });
  const right = waRows({ years: [2025] });
  for (const measure of ['total', 'per_sq_mi']) {
    const cls = CP.countyClasses([left, right], measure, 'natural', 5, ['Inbound', 'Outbound']);
    const lv = CP.countyValues(left, measure);
    const rv = CP.countyValues(right, measure);
    const basis = [...lv.values(), ...rv.values()];
    const want = CP.classify(basis, 'natural', 5, 'Combined', measure);
    check(same(cls.breaks, want.breaks), 'shared: Compare (' + measure + '): classes from both maps\' values');
    const own = CP.classify([...lv.values()], 'natural', 5, 'Combined', measure);
    check(!same(own.breaks, cls.breaks), 'shared: Compare (' + measure + '): differ from the left map\'s own',
      own.breaks);
    // The same value gets the same color on both maps.
    const colorOf = v => cls.colors[cls.classOf(v) - 1];
    const L = CP.shade(NAMES, lv, cls);
    const R = CP.shade(NAMES, rv, cls);
    check(L.concat(R).filter(c => !c.none).every(c => c.color === colorOf(c.value)),
      'shared: Compare (' + measure + '): one value, one color on both maps');
  }
  // The GIF: one set of classes for every frame, in each frame's page model.
  const f = { species: master.speciesChoices, years: master.yearChoices, quarters: QUARTERS,
    direction: ['Inbound', 'Outbound'], mode: 'side_by_side', scaling: 'log', nBins: 5, rawSpecies: [] };
  const fr = TS.waFrames(master, f, 'quarter');
  const prepared = TS.prepareView('wa', fr, { universe: master.speciesChoices, palette: 'WSDA Default', opacity: 0.6,
    title: '', date: new Date(2026, 9, 16), counties: COUNTIES, background: 'standard',
    shade: { measure: 'total', method: 'natural', nBins: 5, opacity: '0.8' } });
  const models = Array.from({ length: prepared.count }, (_, i) => prepared.page(i).model);
  const all = CP.countyClasses(fr.frames.map(x => x.rows), 'total', 'natural', 5, f.direction);
  check(models.length > 1 && models.every(m => same(m.shade.breaks, all.breaks) && same(m.shade.colors, all.colors)),
    'shared: GIF: every frame shaded with the classes of every frame\'s values', models.length);
  check(models.every(m => same(m.shade.legend, models[0].shade.legend)), 'shared: GIF: one legend in every frame');
  check(models.every(m => same(m.labels, NAMES.slice().sort()) || same(m.labels.slice().sort(), NAMES.slice().sort())),
    'shared: GIF: every county named in every frame');
  check(models.every(m => same(m.labelPlaces.map(l => [l.name, l.x, l.y]), models[0].labelPlaces.map(l => [l.name,
    l.x, l.y]))), 'shared: GIF: the names held still');
  check(models.every(m => !m.circles.length), 'shared: GIF: no circles in a shaded frame');
  // Flow's GIF.
  const ff = Object.assign(flowF({ combine: true }), { palette: 'Single — WSDA Blue', multiplier: '0.40', opacity: '0.8' });
  const ffr = TS.frames(master, ff, 'quarter', CENTERS);
  const fp = TS.prepare(ffr, { universe: master.speciesChoices, title: '', date: new Date(2026, 9, 16), states: STATES,
    stateLines: true, shade: { measure: 'total', method: 'natural', nBins: 5, opacity: '0.8' } });
  const fm = Array.from({ length: fp.count }, (_, i) => fp.page(i).model);
  const fall = CP.stateClasses(ffr.frames.map(x => x.lines), 'natural', 5, 'inbound');
  check(fm.length > 1 && fm.every(m => same(m.shade.breaks, fall.breaks) && !m.lines.length),
    'shared: Flow GIF: every frame shaded with the classes of every frame\'s values, no lines', fm.length);
});

// ── Pages ──────────────────────────────────────────────────────────────────────────────────────────────────────
const fillsOf = svg => {
  const out = [];
  const re = /<path d="[^"]*" fill="([^"]+)" fill-opacity="([\d.]+)" stroke="([^"]+)"/g;
  let m;
  while ((m = re.exec(svg))) out.push({ fill: m[1], opacity: Number(m[2]), stroke: m[3] });
  return out;
};
// With "Combine species" off, National Flow has a line per state and species group; a shaded state's
// value is the sum of its lines, the same as its Combine species total (every other shaded-state case combines).
guard('species', () => {
  for (const direction of ['inbound', 'outbound', 'combined']) {
    const split = W.flow.lines(master, flowF({ direction, combine: false }), CENTERS);
    const joined = W.flow.lines(master, flowF({ direction, combine: true }), CENTERS);
    const sv = CP.stateValues(split).values, jv = CP.stateValues(joined).values;
    const several = [...sv.keys()].filter(s => split.filter(a => a.state === s).length > 1);
    check(several.length >= 2 && sv.size === jv.size && [...jv].every(([s, v]) => Math.abs(sv.get(s) - v) < 1e-9),
      'species: ' + direction + ': each shaded state the sum of its species lines (' + several.length +
      ' states with two or more)', [...jv].filter(([s, v]) => Math.abs(sv.get(s) - v) >= 1e-9));
  }
});
guard('pages', () => {
  const f = { species: master.speciesChoices, years: [2024], quarters: ['Q1'], direction: ['Inbound'],
    mode: 'side_by_side', scaling: 'log', nBins: 5, rawSpecies: [] };
  const rows = W.aggregate.build(master.rows, Object.assign({}, f, { hasSpecies: master.hasSpecies }));
  const shade = { measure: 'total', method: 'natural', nBins: 5, opacity: '0.8' };
  const built = BM.wa({ rows, f, universe: master.speciesChoices, palette: 'WSDA Default', opacity: 0.6, title: '',
    date: new Date(2026, 9, 16), counties: COUNTIES, shade }, null);
  const m = built.model;
  const svg = built.parts[0];
  const cls = CP.countyClasses([rows], 'total', 'natural', 5, ['Inbound']);
  const v = CP.countyValues(rows, 'total');
  const fills = fillsOf(svg).slice(0, 39);
  check(fills.length === 39, 'pages: WA State: a fill per county', fills.length);
  const wantFills = NAMES.map(n => {
    const c = cls.classOf(v.has(n) ? v.get(n) : null);
    return c ? { fill: cls.colors[c - 1], opacity: 0.8, stroke: '#ffffff' } : { fill: 'url(#ch-hatch-wa)', opacity: 1,
      stroke: '#ffffff' };
  });
  check(same(fills, wantFills), 'pages: WA State: each county\'s fill its class color at 80%, the hatch for No ' +
    'movements, white lines', { got: fills.slice(0, 3), want: wantFills.slice(0, 3) });
  check(fills.some(x => x.fill === 'url(#ch-hatch-wa)') && /<pattern id="ch-hatch-wa"/.test(svg),
    'pages: WA State: the hatch drawn for counties with no movements');
  check(m.circles.length === 0 && !/<circle/.test(svg), 'pages: WA State: no circles on the shaded map');
  check(m.labels.length === 39, 'pages: WA State: every county named', m.labels.length);
  check(same(m.shade.breaks, cls.breaks) && m.shade.legend.title === 'TOTAL ANIMALS' &&
    m.shade.legend.subtitle === 'Inbound' && m.shade.legend.none === 'No movements', 'pages: WA State: the model\'s ' +
    'classes and legend', m.shade.legend);
  const legendSvg = built.parts[5];
  check(cls.labels.every(l => legendSvg.indexOf(l.replace(/–/g, '–')) >= 0) && /No movements/.test(legendSvg) &&
    /TOTAL ANIMALS/.test(legendSvg) && /Natural breaks, \d class/.test(legendSvg), 'pages: WA State: the legend ' +
    'drawn with each class, No movements and the classes\' line');
  // Animals per square mile in the legend title.
  const per = BM.wa({ rows, f, universe: master.speciesChoices, title: '', date: new Date(2026, 9, 16),
    counties: COUNTIES, shade: Object.assign({}, shade, { measure: 'per_sq_mi' }) }, null);
  check(per.model.shade.legend.title === 'ANIMALS PER SQ MI' && /ANIMALS PER SQ MI/.test(per.parts[5]),
    'pages: WA State: Animals per square mile named in the legend');
  // The title names the measure too; Total animals keeps CVI's title.
  check(per.model.title === 'ANIMAL IMPORTS PER SQ MI – ALL SPECIES – COUNTY DETAIL' &&
    m.title === 'TOTAL ANIMAL IMPORTS – ALL SPECIES – COUNTY DETAIL', 'pages: WA State: the title names Animals per ' +
    'square mile, as the legend', [per.model.title, m.title]);
  // Spotlight: the others dimmed, the spotlit county outlined.
  const lit = NAMES.find(n => v.has(n));
  const spot = BM.wa({ rows, f, universe: master.speciesChoices, title: '', date: new Date(2026, 9, 16),
    counties: COUNTIES, shade, spotlight: [lit] }, null);
  const sf = fillsOf(spot.parts[0]).slice(0, 39);
  check(sf.every((x, i) => (NAMES[i] === lit ? x.opacity === 0.8 : x.opacity === 0.2)), 'pages: WA State: spotlight ' +
    'dims the other counties', sf.map(x => x.opacity));
  // The spotlit county is outlined in white.
  check((spot.parts[0].match(/fill="none" stroke="#ffffff"/g) || []).length === 1, 'pages: WA State: the spotlit ' +
    'county outlined');
  // Shared classes handed in (Compare's) are used as they are.
  const given = CP.classify([1, 1000000], 'quantile', 2, 'Inbound', 'total');
  const cmp = BM.wa({ rows, f, universe: master.speciesChoices, title: '', date: new Date(2026, 9, 16),
    counties: COUNTIES, shade: Object.assign({}, shade, { cls: given }) }, null);
  check(same(cmp.model.shade.breaks, given.breaks), 'pages: WA State: Compare\'s shared classes used');
  // The movement view still takes over.
  // Without shade, the page is unchanged: circles, no shade model.
  const plain = BM.wa({ rows, f, universe: master.speciesChoices, title: '', date: new Date(2026, 9, 16),
    counties: COUNTIES }, null);
  check(plain.model.shade === null && plain.model.circles.length === rows.length, 'pages: WA State: circles unchanged ' +
    'without shading');
  // The shaded legend as tall as its rows (no longer CVI's 0.265 or 0.455 of the
  // page), and one Top 3 list in a box half as tall in the page's style (CVI's style keeps the full box).
  check(m.legendHeight < 0.265 && !m.legendOverlap, 'pages: WA State: the shaded legend as tall as ' +
    'its rows', m.legendHeight);
  const both = BM.wa({ rows: W.aggregate.build(master.rows, Object.assign({}, f, { direction: ['Inbound', 'Outbound'],
    hasSpecies: master.hasSpecies })), f: Object.assign({}, f, { direction: ['Inbound', 'Outbound'] }),
  universe: master.speciesChoices, title: '', date: new Date(2026, 9, 16), counties: COUNTIES, shade }, null);
  check(both.model.legendHeight < 0.265, 'pages: WA State: the shaded legend as tall as its rows with both ' +
    'directions (was 0.455 of the page)', both.model.legendHeight);
  const cviStyle = BM.wa({ rows, f, universe: master.speciesChoices, title: '', date: new Date(2026, 9, 16),
    counties: COUNTIES }, BR.CVI_STYLE);
  // The circles' one-list Top 3 in a half-height box (page style only); the shaded Top 5 at the same row spacing
  // (0.0285 of the page a row: 5 counties, the title and the total; with both directions also the column names).
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  check(near(m.topHeight, 0.0285 * 7) && plain.model.topHeight === 0.1425 && near(both.model.topHeight, 0.0285 * 8) &&
    cviStyle.model.topHeight === 0.285, 'pages: WA State: the Top box\'s height (circles: one Top 3 list half height, ' +
    'page style only; shaded: the Top 5 at the same row spacing)',
  [m.topHeight, plain.model.topHeight, both.model.topHeight, cviStyle.model.topHeight]);

  // Shaded with both directions: one list with In and Out, Top 5, Total first. The top five by the Combined value
  // whatever Display Mode says, each with its Total, In and Out, and a Total row; per square mile ranked by that
  // measure, its values, no Total row.
  const bothF = Object.assign({}, f, { direction: ['Inbound', 'Outbound'] });
  const bothRows = W.aggregate.build(master.rows, Object.assign({}, bothF, { hasSpecies: master.hasSpecies }));
  const circlesBoth = BM.wa({ rows: bothRows, f: bothF, universe: master.speciesChoices, title: '',
    date: new Date(2026, 9, 16), counties: COUNTIES }, null);
  const sortTop = mm => [...mm].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5);
  const tot = CP.countyValues(bothRows, 'total');
  const inV = CP.countyValues(bothRows.filter(r => r.direction === 'Inbound'), 'total');
  const outV = CP.countyValues(bothRows.filter(r => r.direction === 'Outbound'), 'total');
  const cm = x => (x === undefined ? '\u2013' : S.comma(x));
  const wantTop = sortTop(tot).map(([c, v]) => ({ label: c, values: [S.comma(v), cm(inV.get(c)), cm(outV.get(c))] }));
  const sumOf = mm => S.comma(sortTop(tot).reduce((t, [c]) => t + (mm.get(c) || 0), 0));
  check(both.model.top.length === 1 && both.model.top[0].title === 'Top 5 Counties (Combined)' &&
    same(both.model.top[0].columns, ['Total', 'In', 'Out']) && same(both.model.top[0].rows, wantTop) &&
    same(both.model.top[0].total, [sumOf(tot), sumOf(inV), sumOf(outV)]) && circlesBoth.model.top.length === 2 &&
    circlesBoth.model.top[0].rows.length === 3, 'pages: shaded Top 5: one Combined list with Total, In and Out whatever ' +
    'Display Mode says (the circles\' PNG keeps its two Top 3 lists)', { shaded: both.model.top, wantTop });
  check(/>Total<\/text>[\s\S]*>In<\/text>[\s\S]*>Out<\/text>/.test(both.parts.join('')) &&
    !/direction's top/.test(both.parts.join('')), 'pages: shaded Top 5: the column names Total, In, Out in that order; no ' +
    'note under the list');
  const perShade = Object.assign({}, shade, { measure: 'per_sq_mi' });
  const perTop = BM.wa({ rows: bothRows, f: bothF, universe: master.speciesChoices, title: '', date: new Date(2026, 9, 16),
    counties: COUNTIES, shade: perShade }, null);
  const pv = CP.countyValues(bothRows, 'per_sq_mi');
  const pIn = CP.countyValues(bothRows.filter(r => r.direction === 'Inbound'), 'per_sq_mi');
  const pOut = CP.countyValues(bothRows.filter(r => r.direction === 'Outbound'), 'per_sq_mi');
  const pf = x => (x === undefined ? '\u2013' : CP.format(x, 'per_sq_mi'));
  check(perTop.model.top[0].title === 'Top 5 per Sq Mi (Combined)' && same(perTop.model.top[0].rows,
    sortTop(pv).map(([c, v]) => ({ label: c, values: [pf(v), pf(pIn.get(c)), pf(pOut.get(c))] }))) &&
    perTop.model.top[0].total === null, 'pages: shaded per square mile Top 5 ranked by animals per square mile, with ' +
    'In and Out, no Total row', perTop.model.top);

  // National Flow.
  const lf = Object.assign(flowF({ combine: true }), { palette: 'Single — WSDA Blue', multiplier: '0.40', opacity: '0.8',
    lines: true });
  const lines = W.flow.lines(master, lf, CENTERS);
  const fb = BM.flow({ lines, f: lf, universe: master.speciesChoices, title: '', date: new Date(2026, 9, 16),
    states: STATES, shade }, null);
  const sv = CP.stateValues(lines).values;
  const scls = CP.stateClasses([lines], 'natural', 5, 'inbound');
  const sfills = fillsOf(fb.parts[0]).slice(0, STATES.length);
  const want = STATES.map(s => {
    const code = s.properties.code;
    if (code === 'WA') return { fill: '#ffffff', opacity: 1, stroke: '#ffffff' };
    const c = scls.classOf(sv.has(code) ? sv.get(code) : null);
    return c ? { fill: scls.colors[c - 1], opacity: 0.8, stroke: '#ffffff' } : { fill: '#e8e8e8', opacity: 1,
      stroke: '#ffffff' };
  });
  check(same(sfills, want), 'pages: Flow: each state\'s fill its class color, the rest land, Washington white',
    { got: sfills.slice(0, 4), want: want.slice(0, 4) });
  check(fb.model.lines.length === 0 && fb.model.shade && same(fb.model.shade.breaks, scls.breaks),
    'pages: Flow: no lines, the classes in the model');
  check(/stroke="#1c5a83"/.test(fb.parts[0]), 'pages: Flow: Washington outlined in dark blue');
  const picked = [...sv.keys()][0];
  const fh = BM.flow({ lines, f: lf, universe: master.speciesChoices, title: '', date: new Date(2026, 9, 16),
    states: STATES, shade, highlight: [picked] }, null);
  check((fh.parts[0].match(/fill="none" stroke="#ffffff"/g) || []).length === 1, 'pages: Flow: a state picked in a ' +
    'chart outlined in white');
  check(/Species added together/.test(fb.parts[5]) && /No movements/.test(fb.parts[5]), 'pages: Flow: the legend ' +
    'says the species are added together and shows No movements');
  const fplain = BM.flow({ lines, f: lf, universe: master.speciesChoices, title: '', date: new Date(2026, 9, 16),
    states: STATES }, null);
  check(fplain.model.shade === null && fplain.model.lines.length === lines.length, 'pages: Flow: lines unchanged ' +
    'without shading');

  // County Focus: white map lines on the Default background, gray kept on Streets.
  const ff = { counties: ['Yakima', 'Kittitas'], species: master.speciesChoices, rawSpecies: [], years: [2024, 2025],
    quarters: QUARTERS, direction: 'both', mode: 'overlap', scaling: 'log', nBins: 5, opacity: 0.6, hideCircles: false };
  const premises = W.focus.build(master, ff).premises;
  const fo = BM.focus({ premises, f: ff, universe: master.speciesChoices, title: '', date: new Date(2026, 9, 16),
    counties: COUNTIES, background: 'standard', streets: null }, null);
  const mapSvg = fo.parts[0];
  check(fo && !/stroke="#8a8a8a"/.test(mapSvg) && !/stroke="#d0d0d0"/.test(mapSvg) && /stroke="#ffffff"/.test(mapSvg),
    'pages: County Focus: map lines white on the Default background');
  const streets = win.WSDA_STREETS;
  const fs2 = BM.focus({ premises, f: ff, universe: master.speciesChoices, title: '', date: new Date(2026, 9, 16),
    counties: COUNTIES, background: 'vector:streets', streets }, null);
  check(/stroke="#8a8a8a"/.test(fs2.parts[0]) && /stroke="#d0d0d0"/.test(fs2.parts[0]), 'pages: County Focus: ' +
    'gray lines kept on Streets');

  // The movement page's Top 3 box half as tall in the page's
  // style, and its legend's groups named in plain words ("1st–5th busiest", not "Ranks 1–5").
  const MV = W.movement;
  check(MV.ordinal(1) === '1st' && MV.ordinal(2) === '2nd' && MV.ordinal(3) === '3rd' && MV.ordinal(4) === '4th' &&
    MV.ordinal(11) === '11th' && MV.ordinal(12) === '12th' && MV.ordinal(13) === '13th' && MV.ordinal(21) === '21st' &&
    MV.ordinal(22) === '22nd' && MV.ordinal(111) === '111th', 'pages: movement: ordinals');
  check(MV.busiestLabel(1, 5) === '1st\u20135th busiest' && MV.busiestLabel(15, 15) === '15th busiest',
    'pages: movement: the groups\' names');
  const mr = MV.rows(master, { species: master.speciesChoices, years: master.yearChoices, quarters: QUARTERS,
    rawSpecies: [] });
  const mview = MV.mapView(MV.pairs(mr.counted), MV.points(mr.counted), { cap: 10 });
  const mf = Object.assign({}, f, { direction: ['Inbound', 'Outbound'], years: master.yearChoices, quarters: QUARTERS });
  const mpage = BM.wa({ rows: waRows(), f: mf, universe: master.speciesChoices, title: '', date: new Date(2026, 9, 16),
    counties: COUNTIES, movement: { view: mview } }, null);
  const mcvi = BM.wa({ rows: waRows(), f: mf, universe: master.speciesChoices, title: '', date: new Date(2026, 9, 16),
    counties: COUNTIES, movement: { view: mview } }, BR.CVI_STYLE);
  check(mpage.model.topHeight === 0.1425 && mcvi.model.topHeight === 0.285, 'pages: movement: the Top 3 Movements ' +
    'box half as tall (page style only)', [mpage.model.topHeight, mcvi.model.topHeight]);
  const groups = mpage.model.legendLabels.filter(l => / busiest /.test(l));
  check(groups.length >= 2 && groups[0].indexOf('1st\u20135th busiest') === 0 &&
    !mpage.model.legendLabels.some(l => /\bRanks?\b/.test(l)), 'pages: movement: the legend names its groups in plain ' +
    'words', mpage.model.legendLabels);

  // The summary strip's mode and export_params.json.
  const strip = W.summary.strip(master, Object.assign({}, f, { mode: 'shaded', keep: null }), rows);
  check(JSON.stringify(strip).indexOf('Shaded counties') >= 0, 'pages: the strip names Shaded counties');
  const opts = { label: '', formats: ['csv'] };
  const plainParams = W.exports.exportParams('wa', f, opts, new Date(2026, 9, 16, 9));
  check(!/map_style|shade_/.test(plainParams), 'pages: export_params.json unchanged with circles');
  const params = W.exports.exportParams('wa', f, Object.assign({}, opts, { shade: Object.assign({ cls }, shade) }),
    new Date(2026, 9, 16, 9));
  const pj = JSON.parse(params);
  check(pj.map_style === 'shaded' && pj.shade_measure === 'total_animals' && pj.shade_classes === 'natural_breaks' &&
    pj.shade_class_count === cls.n && (cls.n === 1 ? pj.shade_breaks === cls.breaks[0] || Array.isArray(pj.shade_breaks)
      : pj.shade_breaks.length === cls.breaks.length), 'pages: export_params.json records the shaded map', pj);
  check(Object.keys(pj).indexOf('map_style') < Object.keys(pj).indexOf('exported_at'), 'pages: the shading before ' +
    'exported_at');
  // The GIF's own classes (every frame's values) are recorded with the GIF.
  const gcls = CP.classify([10, 20, 30, 40, 900], 'natural', 5, 'Combined', 'total');
  const withGif = sh => JSON.parse(W.exports.exportParams('wa', f, Object.assign({}, opts, sh, { shade: Object.assign({ cls,
    gifCls: gcls }, shade) }), new Date(2026, 9, 16, 9)));
  const pngGif = withGif({ formats: ['branded_png', 'branded_gif'] });
  const gifOnly = withGif({ formats: ['branded_gif'] });
  const csvOnly = withGif({ formats: ['csv'] });
  check(same(pngGif.shade_breaks, cls.breaks.map(b => Number(Number(b).toPrecision(6)))) && pngGif.gif_shade_class_count ===
    gcls.n && same(pngGif.gif_shade_breaks, gcls.breaks), 'pages: export_params.json: with the PNG and the GIF, the ' +
    'PNG\'s classes and the GIF\'s apart', pngGif);
  check(same(gifOnly.shade_breaks, gcls.breaks) && gifOnly.shade_class_count === gcls.n &&
    gifOnly.gif_shade_breaks === undefined, 'pages: export_params.json: with the GIF and no PNG, the GIF\'s classes',
  gifOnly);
  check(same(csvOnly.shade_breaks, pngGif.shade_breaks) && csvOnly.gif_shade_breaks === undefined,
    'pages: export_params.json: the view\'s classes when the GIF is not in the export', csvOnly);
  // A WA State GIF keeps one Top 3 layout: two lists in every frame when any frame has both
  // directions, also in a frame without Outbound rows.
  const g6f = Object.assign({}, f, { direction: ['Inbound', 'Outbound'], mode: 'side_by_side', years: [2024],
    quarters: QUARTERS });
  const g6m = Object.assign({}, master, { rows: master.rows.filter(r => !(r['Reporting.Year'] === 2024 &&
    r['Reporting.Quarter'] === 'Q1' && r.Movement && /out|export/i.test(r.Movement))) });
  const g6 = TS.prepareView('wa', TS.waFrames(g6m, g6f, 'quarter'), { universe: master.speciesChoices,
    palette: 'WSDA Default', opacity: 0.6, title: '', date: new Date(2026, 9, 16), counties: COUNTIES,
    background: 'standard' });
  const g6pages = Array.from({ length: g6.count }, (_, i) => g6.page(i).model);
  const firstDirs = new Set(TS.waFrames(g6m, g6f, 'quarter').frames[0].rows.map(r => r.direction));
  check(g6pages.length > 1 && !firstDirs.has('Outbound') && g6pages.every(mm => mm.topHeight === g6pages[0].topHeight &&
    mm.top.length === 2 && mm.top[0].title === 'Top 3 Inbound' && mm.top[1].title === 'Top 3 Outbound' &&
    mm.top[1].rows.length === 3) && g6pages[0].top[1].rows[0].label === 'No movements',
  'pages: GIF: the Top 3 box keeps two lists and its size in every frame, a frame without Outbound too',
  g6pages.map(mm => [mm.topHeight, mm.top.map(t => t.title + ':' + t.rows.length)]));
  const order = Object.keys(pngGif);
  check(order.indexOf('gif_shade_breaks') > order.indexOf('shade_breaks') && order.indexOf('gif_shade_breaks') <
    order.indexOf('exported_at'), 'pages: the GIF\'s classes after the PNG\'s, before exported_at', order);
  // The GIF's prepared pages carry the classes the export records.
  const wfr = TS.waFrames(master, Object.assign({}, f, { years: [2024], quarters: QUARTERS }), 'quarter');
  const wp = TS.prepareView('wa', wfr, { universe: master.speciesChoices, palette: 'WSDA Default', opacity: 0.6, title: '',
    date: new Date(2026, 9, 16), counties: COUNTIES, background: 'standard', shade });
  check(wp.shadeCls && same(wp.shadeCls.breaks, wp.page(0).model.shade ? wp.page(0).model.shade.breaks :
    wp.shadeCls.breaks), 'pages: the GIF hands its shared classes to the export', wp.shadeCls && wp.shadeCls.breaks);
});

// ── County names ────────────────────────────────────────────────────────────────────────────────────────────
guard('names', () => {
  check(CP.countyName('YAKIMA') === 'Yakima' && CP.countyName('  yakima ') === 'Yakima' &&
    CP.countyName('grays  harbor') === 'Grays Harbor' && CP.countyName('Walla Walla') === 'Walla Walla' &&
    CP.countyName('N/A') === null && CP.countyName('') === null && CP.countyName(null) === null,
  'names: a county matched without regard to case or spaces; others not');
  const f = { species: master.speciesChoices, years: [2024, 2025], quarters: QUARTERS, direction: ['Inbound', 'Outbound'],
    mode: 'total', scaling: 'log', nBins: 5, rawSpecies: [] };
  const rows = W.aggregate.build(master.rows, Object.assign({}, f, { hasSpecies: master.hasSpecies }));
  const yak = rows.filter(r => r.county === 'Yakima').reduce((t, r) => t + r.total_animals, 0);
  const odd = rows.map(r => Object.assign({}, r, { county: r.county === 'Yakima' ? 'YAKIMA' : r.county }))
    .concat([{ county: 'N/A', direction: 'Total', total_animals: 70 }, { county: 'Yakama Nation', direction: 'Total',
      total_animals: 900 }, { county: 'Benton County Line', direction: 'Total', total_animals: 5 },
    { county: 'Unknown', direction: 'Total', total_animals: 5 }]);
  const v = CP.countyValues(odd, 'total');
  check(v.get('Yakima') === yak && !v.has('YAKIMA'), 'names: "YAKIMA" counted as Yakima', [v.get('Yakima'), yak]);
  const sh = { measure: 'total', method: 'natural', nBins: 5, opacity: '0.8' };
  const page = BM.wa({ rows: odd, f, universe: master.speciesChoices, palette: 'WSDA Default', opacity: 0.6, title: '',
    date: new Date(2026, 9, 17), counties: COUNTIES, shade: sh }, null);
  const u = CP.unplaced(odd);
  check(u && u.animals === 980 && same(u.names, ['Yakama Nation', 'N/A', 'Benton County Line', 'Unknown']),
    'names: the animals in counties the map does not have, largest first, ties by name', u);
  const lines = CP.unplacedLines(u);
  check(same(lines, ['Not on the map: 980 animals', 'in counties named Yakama Nation, N/A, Benton County Line and 1 more']),
    'names: the legend\'s two lines', lines);
  check(CP.unplaced(rows) === null && CP.unplacedLines(null) === null, 'names: nothing when every county is on the map');
  const rec = CP.countyRecords([{ Movement: 'Inbound', 'Dest.County': 'YAKIMA', 'Origin.County': 'Lane' },
    { Movement: 'Outbound', 'Origin.County': 'Yakima', 'Dest.County': 'N/A' }, { Movement: 'Intrastate',
      'Origin.County': 'King', 'Dest.County': 'Yakima' }, { Movement: 'Inbound', 'Dest.County': 'N/A' }]);
  check(rec.get('Yakima') === 2 && rec.get('King') === 1 && rec.size === 2, 'names: CVI records per county as the ' +
    'circles place them', [...rec]);
  check(/Not on the map: 980 animals/.test(page.parts.join('')) && /in counties named Yakama Nation/.test(page.parts.join('')),
    'names: the shaded PNG\'s legend says so');
  const plain = BM.wa({ rows, f, universe: master.speciesChoices, palette: 'WSDA Default', opacity: 0.6, title: '',
    date: new Date(2026, 9, 17), counties: COUNTIES, shade: sh }, null);
  check(!/Not on the map/.test(plain.parts.join('')), 'names: no such line when every county is on the map');
  const yakFill = fillsOf(page.parts[0])[NAMES.indexOf('Yakima')];
  check(yakFill && yakFill.fill !== 'url(#ch-hatch-wa)', 'names: Yakima shaded, not hatched', yakFill);
  const stats = W.exports.statsLines('wa', Object.assign({}, f, { unplaced: lines }), [], rows, new Date(2026, 9, 17, 9));
  const text = stats.join('\n');
  const flat = text.replace(/\n\s+/g, ' ');
  const at = stats.findIndex(l => /Not on the map/.test(l));
  const mine = at < 0 ? [] : stats.slice(at, at + 2);
  check(/Not on the map: 980 animals in counties named Yakama Nation, N\/A,/.test(flat) &&
    mine.length === 2 && mine.every(l => l.length <= 64), 'names: the Stats text says so, in lines of at most 64 ' +
    'characters', { mine, flat: flat.slice(flat.indexOf('Not on'), flat.indexOf('Not on') + 90) });
});

// ── Alaska and Hawaii ───────────────────────────────────────────────────────────────────────────────────────────
// The Full tier with 40 Montana-to-Washington rows moved to Alaska and 30 Washington-to-Nevada rows to Hawaii; scale:
// Alaska's animals times this; keepQ1: 2024 Q1's Montana rows stay in Montana (a GIF frame without Alaska).
function akhiMaster(scale, keepQ1) {
  let na = 0;
  let nh = 0;
  const rows = master.rows.map(r => {
    const x = Object.assign({}, r);
    const q1 = keepQ1 && x['Reporting.Year'] === 2024 && x['Reporting.Quarter'] === 'Q1';
    if (x['Origin.State'] === 'MT' && x['Dest.State'] === 'WA' && na < 40 && !q1) {
      x['Origin.State'] = 'AK';
      if (scale && x['Total.Animals'] !== null) x['Total.Animals'] *= scale;
      na++;
    } else if (x['Origin.State'] === 'WA' && x['Dest.State'] === 'NV' && nh < 30) {
      x['Dest.State'] = 'HI';
      nh++;
    }
    return x;
  });
  return Object.assign({}, master, { rows });
}
// Is a point inside any ring (even-odd)?
function insideRings(rings, x, y) {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) {
        inside = !inside;
      }
    }
  }
  return inside;
}
guard('insets', () => {
  const IN = W.flowinsets;
  const data = win.WSDA_US_INSETS;
  check(data && same(Object.keys(data.states), ['AK', 'HI']) && /cb_2023_us_county_500k/.test(data.source) &&
    data.attribution === 'Boundaries: U.S. Census Bureau', 'insets: geo/us-insets.js holds Alaska and Hawaii from the ' +
    'pinned Census file', data && Object.keys(data.states));
  for (const code of ['AK', 'HI']) {
    const st = data.states[code];
    const pts = [].concat(...st.rings);
    check(st.rings.length > 0 && pts.every(q => q[0] >= 0 && q[0] <= 1 && q[1] >= 0 && q[1] <= 1) &&
      Math.min(...pts.map(q => q[0])) === 0 && Math.max(...pts.map(q => q[1])) === 1 && st.aspect > 1,
    'insets: ' + code + ': its outline fills a box from 0 to 1', { aspect: st.aspect, rings: st.rings.length });
  }
  check(insideRings(data.states.AK.rings, data.states.AK.anchor[0], data.states.AK.anchor[1]),
    'insets: Alaska\'s anchor (CVI\'s center) on its land', data.states.AK.anchor);
  const ha = data.states.HI.anchor;
  check(ha[0] > 0.3 && ha[0] < 1 && ha[1] > 0 && ha[1] < 1 && !insideRings(data.states.HI.rings, ha[0], ha[1]),
    'insets: Hawaii\'s anchor between its islands, at sea as CVI\'s center', ha);

  check(same(IN.present(['HI', 'wa', 'ak', null, 'OR']), ['AK', 'HI']) && same(IN.present([]), []) &&
    same(IN.present(['HI']), ['HI']), 'insets: present() keeps Alaska then Hawaii, any case');
  const o = { x: 10, y: 20, height: 60, gap: 6, title: 10, pad: 3 };
  const boxes = IN.layout(data, ['AK', 'HI'], o);
  const sh = o.height - o.title - 2 * o.pad;
  check(boxes.length === 2 && boxes.every(b => b.h === 60 && b.y === 20) &&
    Math.abs(boxes[0].w - (sh * data.states.AK.aspect + 2 * o.pad)) < 1e-9 &&
    Math.abs(boxes[1].x - (boxes[0].x + boxes[0].w + o.gap)) < 1e-9, 'insets: both boxes as tall, each as wide as its ' +
    'outline, side by side (the Alaska box as tall as Hawaii\'s)', boxes.map(b => [b.x, b.w, b.h]));
  check(boxes.every(b => b.anchor[0] > b.shape.x && b.anchor[0] < b.shape.x + b.shape.w &&
    b.anchor[1] > b.shape.y && b.anchor[1] < b.shape.y + b.shape.h && /^M[\d.]+ [\d.]+L/.test(b.d)),
  'insets: each anchor inside its outline\'s rectangle; outlines as path data');
  check(IN.totalOf([{ state: 'AK', total_animals: 5 }, { state: 'ak', total_animals: null },
    { state: 'HI', total_animals: 2 }, { state: 'AK', total_animals: 7 }], 'AK') === 12 &&
    IN.totalOf([{ state: 'HI', total_animals: 2 }], 'AK') === null, 'insets: totalOf sums a state\'s lines');

  // The PNG: shaded and Lines.
  const ak = akhiMaster();
  const lf = Object.assign(flowF({ direction: 'combined', combine: true }), { palette: 'Single — WSDA Blue',
    multiplier: '1.0', opacity: '0.8', lines: true });
  const lines = W.flow.lines(ak, lf, CENTERS);
  const shade = { method: 'natural', nBins: 5, opacity: '0.8' };
  const page = extra => BM.flow(Object.assign({ lines, f: lf, universe: ak.speciesChoices, title: '',
    date: new Date(2026, 9, 17), states: STATES }, extra), null);
  const sp = page({ shade });
  const sv = CP.stateValues(lines).values;
  const cls = CP.stateClasses([lines], 'natural', 5, 'combined');
  check(same(sp.model.insets.map(b => b.code), ['AK', 'HI']) && sp.model.insets.every(b => b.value === sv.get(b.code) &&
    b.fill === cls.colors[cls.classOf(sv.get(b.code)) - 1]), 'insets: shaded PNG: a box for each, in its class\'s ' +
    'color, with its animals', sp.model.insets);
  const ins = sp.model.insets;
  check(ins.every(b => fillsOf(sp.parts[0]).some(x => x.fill === b.fill && x.opacity === 0.8 && x.stroke === '#ffffff')),
    'insets: shaded PNG: the outlines drawn at the fill opacity with white lines');
  const L = BR.LAYOUT;
  const top = BR.py(L.statY - 0.034);
  const wa = BM.flow({ lines, f: lf, universe: ak.speciesChoices, title: '', date: new Date(2026, 9, 17),
    states: STATES.filter(s => s.properties.code === 'WA') }, null);
  const hub = wa.model.anchor;
  const hubY = BR.fitMercator({ west: -128, east: -65, south: 24, north: 53 },
    BR.panel(0, 0, L.mapW, 1 - L.headerH, 0)).project(-120.5, 49.0)[1];
  check(ins.every(b => b.y > top && b.y + b.h < hubY && b.x > 0) && ins[0].x + ins[0].w < ins[1].x,
    'insets: PNG: the boxes under the stat row and the "Highlighted:" line, above Washington, side by side',
  { top, hubY, boxes: ins.map(b => [b.x, b.y, b.w, b.h]) });
  check(sp.model.labels.every(l => !ins.some(b => l.x > b.x && l.x < b.x + b.w && l.y > b.y && l.y < b.y + b.h)),
    'insets: PNG: no state name under a box');
  const lp = page({});
  const hubPt = BR.fitMercator({ west: -128, east: -65, south: 24, north: 53 },
    BR.panel(0, 0, L.mapW, 1 - L.headerH, 0)).project(hub[0], hub[1]);
  const seg = b => 'M' + BR.num(hubPt[0]) + ' ' + BR.num(hubPt[1]) + 'L' + BR.num(b.anchor[0]) + ' ' + BR.num(b.anchor[1]) + '"';
  check(same(lp.model.insets.map(b => b.code), ['AK', 'HI']) && lp.model.insets.every(b => b.fill === '#e8e8e8') &&
    lp.model.insets.every(b => lp.parts[0].indexOf(seg(b)) >= 0), 'insets: Lines PNG: the boxes in land gray and ' +
    'each line from Washington\'s anchor to the state\'s center in its box', lp.model.insets.map(seg));
  check(lp.model.lines.filter(l => l.state === 'AK' || l.state === 'HI').length === 2 &&
    (lp.parts[0].match(/<path d="M[\d.]+ [\d.]+L[\d.]+ [\d.]+" fill="none"/g) || []).length === 2,
  'insets: Lines PNG: only the two inset lines are straight (the others keep their arcs)');
  const hp = page({ shade, highlight: ['AK'] });
  const dimmed = page({ shade, highlight: ['OR'] });
  check((hp.parts[0].match(/fill="none" stroke="#ffffff"/g) || []).length === 1 &&
    fillsOf(dimmed.parts[0]).filter(x => x.fill === ins[0].fill && x.opacity === 0.2).length >= 1,
  'insets: shaded PNG: Alaska picked in a chart outlined in white; another state picked dims it');
  const none = BM.flow({ lines: W.flow.lines(master, lf, CENTERS), f: lf, universe: master.speciesChoices, title: '',
    date: new Date(2026, 9, 17), states: STATES, shade }, null);
  check(same(none.model.insets, []), 'insets: no box without Alaska or Hawaii movements');
  const big = akhiMaster(40);
  const bl = W.flow.lines(big, lf, CENTERS);
  const bp = BM.flow({ lines: bl, f: lf, universe: big.speciesChoices, title: '', date: new Date(2026, 9, 17),
    states: STATES }, null);
  check(bp.model.top.rows[0].label === 'AK' && bp.model.badges.some(x => x.abbr === 'AK' && x.inset &&
    x.x === bp.model.insets[0].anchor[0]), 'insets: an inset state in the Top 3 gets its badge at its center',
  bp.model.badges.filter(x => x.inset));
  const saved = win.WSDA_US_INSETS;
  delete win.WSDA_US_INSETS;
  const without = page({});
  win.WSDA_US_INSETS = saved;
  check(same(without.model.insets, []) && (without.parts[0].match(/<path d="M[\d.]+ [\d.]+L[\d.]+ [\d.]+" fill="none"/g)
    || []).length === 0, 'insets: without the outlines file, no box and every line keeps its arc');

  // The GIF: the boxes of every frame in each frame.
  const akq = akhiMaster(null, true);
  const fr = TS.frames(akq, lf, 'quarter', CENTERS);
  const prep = TS.prepare(fr, { universe: akq.speciesChoices, title: '', date: new Date(2026, 9, 17), states: STATES,
    stateLines: true, shade });
  const codes = [];
  for (let i = 0; i < prep.count; i++) codes.push(prep.page(i).model.insets.map(b => b.code).join(','));
  const lacking = fr.frames.filter(x => !x.lines.some(a => a.state === 'HI') || !x.lines.some(a => a.state === 'AK'));
  check(prep.count > 1 && codes.every(c => c === 'AK,HI'), 'insets: GIF: both boxes in every frame', codes);
  check(lacking.length > 0, 'insets: GIF: the fixture has a frame without Alaska or Hawaii (the case checked)',
    lacking.length);
});

console.log(failures.slice(0, 40).map(f => 'FAIL ' + f).join('\n'));
console.log('CH unit: ' + passed + ' passed, ' + failed + ' failed ' + JSON.stringify(counts));
process.exitCode = failed ? 1 : 0;
