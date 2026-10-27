/* The Emergency page's charts, drawn as SVG markup by pure functions (the Node unit suite calls them). One form for
 * now, stacked columns over time ("Positives over time"); E2's chart view is meant to add its forms here.
 *
 * Copied from site/cvi/app/chartsvg.js, v2.0: esc, Arial's text widths (WIDTHS, textWidth) and ggplot2's axis
 * breaks (labeling::extended with its scores, and valueAxis's expanded range), unchanged so a fix there can be carried
 * over. valueAxis keeps whole-number breaks only (the charts count positives) and labels them with thousands commas.
 * The columns, the key and the axis labels are this file's own.
 *
 * columns(chart, opts) -> SVG markup
 *   chart: { title (the text alternative), none (the hover of an empty column, "no positives"),
 *     series: [{ key, label (in the hover: "3 current"), name (in the key: "Current"), fill, stroke, outline (drawn
 *       hollow), opacity }] (bottom to top; also the key's order, which shows only the series counted somewhere),
 *     columns: [{ label ("Week of Oct 4, 2026"), tick ("Oct 4"), values: { key: count }, picked, click }] }
 *   opts: { width, height } in pixels.
 * Each column is one target over its whole height (so a thin column is easy to point at): data-col (its place),
 * data-hover ("Week of Oct 4, 2026: 3 current, 1 past"), data-click (its click's hint) and, as a keyboard button,
 * role button and an aria-label with both. The picked column has a bar under it and is the one keyboard stop
 * (tabindex 0; the page moves it with the arrow keys). */
(function (root) {
  'use strict';

  // ── Copied from site/cvi/app/chartsvg.js, v2.0 ────────────────────────────────────────────────────────────
  const FONT = 'Arial, Helvetica, sans-serif';
  const esc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // Arial's advance widths (1/1000 em) for printable ASCII from the space; other characters count as a digit,
  // and arrows as a full em.
  const WIDTHS = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  // A text's width in pixels at font size px, from those widths (bold about 7% wider).
  function textWidth(s, px, bold) {
    let w = 0;
    for (const ch of String(s)) {
      const c = ch.codePointAt(0);
      w += c >= 32 && c <= 126 ? WIDTHS[c - 32] : c === 0x2192 || c === 0x2212 ? 1000 : 556;
    }
    return (w / 1000) * px * (bold ? 1.07 : 1);
  }

  // labeling::extended (Talbot, Lin and Hanrahan), as scales::extended_breaks() calls it with 5 breaks wanted.
  const EPS = 2.220446049250313e-16 * 100;
  const Q = [1, 5, 2, 2.5, 4, 3], WEIGHTS = [0.25, 0.2, 0.5, 0.05];
  const rmod = (a, b) => ((a % b) + b) % b;   // R's %%
  function simplicity(q, j, lmin, lmax, lstep) {
    const i = Q.indexOf(q) + 1;
    const m = rmod(lmin, lstep);
    const v = (m < EPS || lstep - m < EPS) && lmin <= 0 && lmax >= 0 ? 1 : 0;
    return 1 - (i - 1) / (Q.length - 1) - j + v;
  }
  const simplicityMax = (q, j) => 1 - Q.indexOf(q) / (Q.length - 1) - j + 1;
  function coverage(dmin, dmax, lmin, lmax) {
    const range = dmax - dmin;
    return 1 - 0.5 * ((dmax - lmax) ** 2 + (dmin - lmin) ** 2) / ((0.1 * range) ** 2);
  }
  function coverageMax(dmin, dmax, span) {
    const range = dmax - dmin;
    if (span <= range) return 1;
    const half = (span - range) / 2;
    return 1 - 0.5 * (2 * half * half) / ((0.1 * range) ** 2);
  }
  function density(k, m, dmin, dmax, lmin, lmax) {
    const r = (k - 1) / (lmax - lmin), rt = (m - 1) / (Math.max(lmax, dmax) - Math.min(dmin, lmin));
    return 2 - Math.max(r / rt, rt / r);
  }
  const densityMax = (k, m) => (k >= m ? 2 - (k - 1) / (m - 1) : 1);
  // The breaks for data from dmin to dmax with about m breaks wanted: the best scoring evenly spaced set.
  function extended(dmin, dmax, m) {
    if (dmax - dmin < EPS) return [dmin];
    const w = WEIGHTS;
    let best = { score: -2 };
    for (let j = 1; j < Infinity; j++) {
      let stop = false;
      for (const q of Q) {
        const sm = simplicityMax(q, j);
        if (w[0] * sm + w[1] + w[2] + w[3] < best.score) { stop = true; break; }
        for (let k = 2; k < Infinity; k++) {
          const dm = densityMax(k, m);
          if (w[0] * sm + w[1] + w[2] * dm + w[3] < best.score) break;
          const delta = (dmax - dmin) / (k + 1) / j / q;
          for (let z = Math.ceil(Math.log10(delta)); z < Infinity; z++) {
            const step = j * q * Math.pow(10, z);
            const cm = coverageMax(dmin, dmax, step * (k - 1));
            if (w[0] * sm + w[1] * cm + w[2] * dm + w[3] < best.score) break;
            const minStart = Math.floor(dmax / step) * j - (k - 1) * j;
            const maxStart = Math.ceil(dmin / step) * j;
            for (let start = minStart; start <= maxStart; start++) {
              const lmin = start * (step / j), lmax = lmin + step * (k - 1);
              const score = w[0] * simplicity(q, j, lmin, lmax, step) + w[1] * coverage(dmin, dmax, lmin, lmax)
                + w[2] * density(k, m, dmin, dmax, lmin, lmax) + w[3];
              if (score > best.score) best = { lmin, lmax, lstep: step, score };
            }
          }
        }
      }
      if (stop) break;
    }
    const out = [];
    for (let x = best.lmin; x <= best.lmax + best.lstep * 1e-10; x += best.lstep) out.push(x);
    return out;
  }
  // A count axis as ggplot2 draws it: the range expanded by its multipliers and the breaks computed on that range and
  // kept inside it; here only whole-number breaks, labeled with thousands commas.
  function valueAxis(lo, hi, expandLo, expandHi) {
    if (hi - lo < EPS) { lo -= 0.5; hi += 0.5; }   // scales::expand_range() for a zero-width range
    const span = hi - lo;
    const from = lo - expandLo * span, to = hi + expandHi * span;
    const breaks = extended(from, to, 5).map(b => (Math.abs(b) < span * 1e-12 ? 0 : b))
      .filter(b => b >= from - span * 1e-10 && b <= to + span * 1e-10)
      .map(b => Math.round(b * 1e9) / 1e9).filter(b => Number.isInteger(b));
    return { from, to, breaks, labels: breaks.map(b => b.toLocaleString('en-US')) };
  }

  // ── This file's own ─────────────────────────────────────────────────────────────────────────────────────────
  const INK = { text: '#333333', axis: '#666666', grid: '#ebebeb', picked: '#1c5a83', surface: '#ffffff' };
  const PX = { axis: 11, key: 11.5 }, MAX_COLUMN = 24;
  const num = x => String(Math.round(x * 100) / 100);
  const attrs = a => Object.keys(a).filter(n => a[n] !== null && a[n] !== undefined)
    .map(n => ' ' + n + '="' + (typeof a[n] === 'number' ? num(a[n]) : esc(a[n])) + '"').join('');

  // A column's hover: its label and its nonzero counts, in the series' order ("Week of Oct 4, 2026: 3 current, 1 past").
  function hoverOf(chart, col) {
    const parts = chart.series.filter(s => col.values[s.key] > 0)
      .map(s => col.values[s.key].toLocaleString('en-US') + ' ' + s.label);
    return col.label + ': ' + (parts.length ? parts.join(', ') : chart.none || 'none');
  }

  // The key: one row of swatches and labels, wrapped onto more rows when it does not fit. Returns its height.
  function key(out, series, width) {
    const sw = 11, gap = 14, rowH = PX.key + 6;
    let x = 0, y = 0;
    for (const s of series) {
      const name = s.name || s.label, w = sw + 5 + textWidth(name, PX.key);
      if (x > 0 && x + w > width) { x = 0; y += rowH; }
      out.push('<rect' + attrs(swatch(s, x, y + 1, sw, sw)) + '/>');
      out.push('<text' + attrs({ x: x + sw + 5, y: y + PX.key - 1, 'font-size': PX.key, fill: INK.text }) + '>' + esc(name) + '</text>');
      x += w + gap;
    }
    return y + rowH + 4;
  }
  // A series' mark: filled, or hollow with its outline kept inside the box.
  function swatch(s, x, y, w, h) {
    if (!s.outline) return { x, y, width: w, height: h, fill: s.fill, opacity: s.opacity };
    const sw = Math.min(1.5, w / 2, h / 2);
    return { x: x + sw / 2, y: y + sw / 2, width: Math.max(0, w - sw), height: Math.max(0, h - sw), fill: INK.surface,
      stroke: s.stroke, 'stroke-width': sw, opacity: s.opacity };
  }

  function columns(chart, opts) {
    const width = Math.max(120, Math.round(opts.width)), height = Math.max(100, Math.round(opts.height || 170));
    const out = [];
    const cols = chart.columns, n = cols.length;
    const keyH = key(out, chart.series.filter(s => cols.some(c => c.values[s.key] > 0)), width);
    const totals = cols.map(c => chart.series.reduce((t, s) => t + (c.values[s.key] || 0), 0));
    const ax = valueAxis(0, Math.max(1, ...totals), 0, 0.05);
    const left = Math.ceil(Math.max(...ax.labels.map(l => textWidth(l, PX.axis)))) + 6, right = 4;
    const top = keyH + 2, bottom = height - (PX.axis + 8);
    const plotW = width - left - right, slot = plotW / Math.max(1, n);
    const y = v => bottom - (v - ax.from) / (ax.to - ax.from) * (bottom - top);
    // The grid and the count labels.
    ax.breaks.forEach((b, i) => {
      out.push('<line' + attrs({ x1: left, x2: width - right, y1: y(b), y2: y(b), stroke: INK.grid, 'stroke-width': 1 }) + '/>');
      out.push('<text' + attrs({ x: left - 4, y: y(b) + PX.axis * 0.35, 'font-size': PX.axis, fill: INK.axis,
        'text-anchor': 'end' }) + '>' + esc(ax.labels[i]) + '</text>');
    });
    // The columns, at most 24 pixels wide, each series stacked on the one before with a 1-pixel surface gap.
    const bw = Math.max(1, Math.min(slot - 2, slot * 0.8, MAX_COLUMN));
    cols.forEach((c, i) => {
      const x = left + i * slot + (slot - bw) / 2;
      let at = 0;
      for (const s of chart.series) {
        const v = c.values[s.key] || 0;
        if (!v) continue;
        const y0 = y(at), y1 = y(at + v), gap = at > 0 ? 1 : 0;
        out.push('<rect' + attrs(swatch(s, x, y1, bw, Math.max(0.5, y0 - y1 - gap))) + '/>');
        at += v;
      }
    });
    out.push('<line' + attrs({ x1: left, x2: width - right, y1: bottom, y2: bottom, stroke: INK.axis, 'stroke-width': 1 }) + '/>');
    // The axis labels: every k-th column's, k as small as keeps them apart; the picked column's always, the labels
    // near it left out.
    const widest = Math.max(0, ...cols.map(c => textWidth(c.tick, PX.axis)));
    const every = Math.max(1, Math.ceil((widest + 8) / slot));
    const picked = cols.findIndex(c => c.picked);
    const tickAt = i => {
      const w = textWidth(cols[i].tick, PX.axis);
      return Math.min(Math.max(left + (i + 0.5) * slot, w / 2), width - w / 2);
    };
    cols.forEach((c, i) => {
      const own = i === picked;
      if (!own && (i % every || (picked >= 0 && Math.abs(i - picked) < every))) return;
      out.push('<text' + attrs({ x: tickAt(i), y: height - 3, 'font-size': PX.axis, fill: own ? INK.text : INK.axis,
        'font-weight': own ? 'bold' : null, 'text-anchor': 'middle' }) + '>' + esc(c.tick) + '</text>');
    });
    if (picked >= 0) {
      out.push('<rect' + attrs({ class: 'chart-picked', x: left + picked * slot, y: bottom + 1, width: slot, height: 3,
        fill: INK.picked }) + '/>');
    }
    // The targets, over everything: the whole slot from the key to the axis labels.
    cols.forEach((c, i) => {
      const hover = hoverOf(chart, c);
      out.push('<rect' + attrs({ class: 'chart-col', 'data-col': i, x: left + i * slot, y: top, width: slot,
        height: height - top, fill: 'transparent', role: 'button', tabindex: i === (picked >= 0 ? picked : n - 1) ? '0' : '-1',
        'aria-label': c.click ? hover + '. ' + c.click : hover, 'aria-current': i === picked ? 'true' : null,
        'data-hover': hover, 'data-click': c.click || null }) + '/>');
    });
    return '<svg xmlns="http://www.w3.org/2000/svg"' + attrs({ width, height, viewBox: '0 0 ' + width + ' ' + height,
      role: 'group', 'aria-label': chart.title, 'font-family': FONT }) + '>' + out.join('') + '</svg>';
  }

  root.WSDA = root.WSDA || {};
  root.WSDA.emergencyChart = { columns, hoverOf, textWidth, extended, valueAxis };
})(typeof window !== 'undefined' ? window : globalThis);
