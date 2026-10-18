/* Drawing the CVI page's charts (S7): each chart from charts.js as SVG markup, and the same drawing as a PNG at
 * CVI's export sizes. Structural parity with CVI's ggplot2 charts: the same bars, order, labels,
 * colors, titles and messages; sizes follow ggplot2's theme_minimal in points (12 pt text on the page, 14 pt in an
 * export PNG, as CVI's), turned into pixels at 96 dpi on the page (Shiny's renderPlot) and 150 dpi in a PNG (CVI's
 * ggsave); the value axis has ggplot2's breaks
 * (labeling::extended on the expanded range). Fonts and spacing are close to CVI's, not pixel-identical.
 *
 * Five chart forms: bars, bars by direction, bars in two panels (top premises), lines, change bars, and the
 * heatmap (export and Preview Charts only). svg() is pure (a string; Node tests use it); png() needs a browser.
 * On the page every mark carries its exact value (data-hover, read by the page's hover box, and aria-label for
 * screen readers); marks a click filters by are keyboard buttons (data-pick; MC chart filters), and on the WA State map
 * a county's button is S7's click-to-spotlight (data-spot). */
(function (root) {
  'use strict';
  const C = () => root.CVIWA.charts;

  // ── Text ───────────────────────────────────────────────────────────────────────────────────────────────────
  const FONT = 'Arial, Helvetica, sans-serif';   // CVI's PNG renderer uses Arial
  // Text from the file, escaped for SVG markup. Control characters (other than tab, line feed and carriage return)
  // are removed: XML forbids them, and an export picture holding one would not load.
  const esc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // Arial's advance widths (1/1000 em) for printable ASCII from the space; other characters count as a digit,
  // and arrows as a full em. Used to make room for labels; the browser measures nothing here, so Node gives the
  // same layout as the page.
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
  // A label cut to fit a width, ending in "…".
  function fit(s, px, max) {
    if (textWidth(s, px) <= max) return s;
    let t = String(s);
    while (t.length > 1 && textWidth(t + '…', px) > max) t = t.slice(0, -1);
    return t + '…';
  }

  // ── ggplot2's numbers ─────────────────────────────────────────────────────────────────────────────────────
  // labeling::extended (Talbot, Lin and Hanrahan), as scales::extended_breaks() calls it with 5 breaks wanted.
  const EPS = 2.220446049250313e-16 * 100;
  const Q = [1, 5, 2, 2.5, 4, 3], WEIGHTS = [0.25, 0.2, 0.5, 0.05];
  const rmod = (a, b) => ((a % b) + b) % b;   // R's %%
  // The three scores the method weighs for a candidate set of breaks (simplicity, coverage and density), each with
  // its best possible value (the ...Max forms) used to stop the search early.
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
  // A continuous axis as ggplot2 draws it: the data range (with 0 for bars) expanded by its multipliers, the
  // breaks computed on that range and kept inside it, labeled as scales::comma() or with short suffixes.
  function valueAxis(lo, hi, expandLo, expandHi, short) {
    if (hi - lo < EPS) { lo -= 0.5; hi += 0.5; }   // scales::expand_range() for a zero-width range
    const span = hi - lo;
    const from = lo - expandLo * span, to = hi + expandHi * span;
    const breaks = extended(from, to, 5).map(b => (Math.abs(b) < span * 1e-12 ? 0 : b))
      .filter(b => b >= from - span * 1e-10 && b <= to + span * 1e-10);
    const labels = short ? C().shortLabels(breaks) : C().commaLabels(breaks);
    return { from, to, breaks, labels };
  }

  // ── Sizes ─────────────────────────────────────────────────────────────────────────────────────────────────
  // Points as in ggplot2's theme_minimal(base_size = 12) and CVI's chart theme (charts.R); mm sizes of geoms
  // converted with 72.27 / 25.4 points per mm.
  const PT = { title: 13, subtitle: 11, caption: 10, axis: 9.6, legend: 9.6, value: 9.1, cell: 8.5, empty: 11.9,
    margin: 5.5, gap: 2.2, key: 12 };
  // The sizes for another base size, as CVI's chart theme gives them: the title base + 1 and the subtitle base - 1
  // (charts.R); the other theme text, keys and gaps in proportion. The value labels, cell labels, gray messages and
  // the outer margin are geom or fixed sizes in ggplot2 and stay. The page draws at 12 pt (CVI's drawer); export
  // PNGs at 14 pt (CVI's export, theme_minimal(base_size = 14)).
  const SCREEN_BASE_PT = 12, EXPORT_BASE_PT = 14;
  function sizes(basePt) {
    const r = basePt / SCREEN_BASE_PT;
    return Object.assign({}, PT, { title: basePt + 1, subtitle: basePt - 1, caption: PT.caption * r,
      axis: PT.axis * r, legend: PT.legend * r, gap: PT.gap * r, key: PT.key * r });
  }
  const INK = { title: '#000000', subtitle: '#6c757d', axis: '#4d4d4d', value: '#37474f', grid: '#ebebeb',
    zero: '#adb5bd', cell: '#222222', empty: '#6c757d' };
  const SCREEN_DPI = 96, EXPORT_DPI = 150;
  // The page's chart height (CVI's drawer: 320 px); top premises taller, about 560 px, so its two panels of up to
  // 12 premises each stay readable.
  const screenHeight = chart => (chart.id === 'top_premises' ? 560 : 320);
  // CVI's export sizes at 150 dpi: 8 x 5 inches; top premises 8 x 7 (CVI's top_farms.png); the heatmaps
  // max(8, 1.6 n + 3) inches wide for n periods, the over-time chart max(8, 1.4 n + 3) (CVI's time charts). Like
  // CVI's device, a fraction of a pixel is dropped. dpi: 150 unless given (S9's High resolution: 300).
  function exportSize(chart, dpi) {
    const d = dpi || EXPORT_DPI;
    let wIn = 8, hIn = 5;
    if (chart.id === 'top_premises') hIn = 7;
    if (chart.kind === 'heatmap') wIn = Math.max(8, 1.6 * chart.columns.length + 3);
    if (chart.kind === 'lines' && chart.periods) wIn = Math.max(8, 1.4 * chart.periods.length + 3);
    return { width: Math.floor(wIn * d), height: Math.floor(hIn * d) };
  }

  // ── Drawing ───────────────────────────────────────────────────────────────────────────────────────────────
  // A drawing context: pixels per point, the parts written so far, and helpers that write SVG elements.
  function context(opts) {
    const k = (opts.dpi || SCREEN_DPI) / 72;
    const pt = sizes(opts.basePt || SCREEN_BASE_PT);
    const parts = [];
    const num = x => String(Math.round(x * 100) / 100);
    const attrs = a => Object.keys(a).filter(n => a[n] !== null && a[n] !== undefined)
      .map(n => ' ' + n + '="' + (typeof a[n] === 'number' ? num(a[n]) : esc(a[n])) + '"').join('');
    return {
      k, pt, px: points => points * k, parts, attrs,
      add: s => parts.push(s),
      rect: a => parts.push('<rect' + attrs(a) + '/>'),
      line: a => parts.push('<line' + attrs(a) + '/>'),
      text: (s, a) => parts.push('<text' + attrs(a) + '>' + esc(s) + '</text>')
    };
  }
  // The title, subtitle and (in an export) caption lines at the top; returns where the plot area starts.
  function header(g, chart, opts, width) {
    const m = g.px(g.pt.margin);
    let y = m;
    const line = (s, pt, color, bold) => {
      y += g.px(pt) * 0.95;
      g.text(fit(s, g.px(pt), width - 2 * m), { x: m, y, fill: color, 'font-size': g.px(pt),
        'font-weight': bold ? 'bold' : null });
      y += g.px(pt) * 0.35;
    };
    line(chart.title, g.pt.title, INK.title, true);
    if (chart.subtitle) line(chart.subtitle, g.pt.subtitle, INK.subtitle);
    (opts.caption ? [].concat(opts.caption) : []).forEach(c => line(c, g.pt.caption, INK.subtitle));
    return y + g.px(g.pt.margin);
  }
  // A legend row (ggplot2's legend.position = "top"): colored keys, centered.
  function legend(g, items, y, width, keyShape) {
    const fs = g.px(g.pt.legend), key = g.px(g.pt.key), gap = g.px(g.pt.gap * 2);
    const widths = items.map(it => key + gap / 2 + textWidth(it.label, fs));
    const total = widths.reduce((a, b) => a + b, 0) + gap * 2 * (items.length - 1);
    let x = (width - total) / 2;
    items.forEach((it, i) => {
      if (keyShape === 'line') {
        g.line({ x1: x, y1: y + key / 2, x2: x + key, y2: y + key / 2, stroke: it.color, 'stroke-width': g.px(1.6) });
        g.add('<circle' + g.attrs({ cx: x + key / 2, cy: y + key / 2, r: g.px(2), fill: it.color }) + '/>');
      } else {
        g.rect({ x, y, width: key, height: key, fill: it.color });
      }
      g.text(it.label, { x: x + key + gap / 2, y: y + key / 2 + fs * 0.35, fill: INK.axis, 'font-size': fs });
      x += widths[i] + gap * 2;
    });
    return y + key + g.px(g.pt.gap * 2);
  }
  // The footer line of an exported chart (the export date), bottom left.
  function footerHeight(g, opts) { return opts.footer ? g.px(g.pt.caption) * 1.6 : 0; }
  function footer(g, opts, height) {
    if (!opts.footer) return;
    g.text(opts.footer, { x: g.px(g.pt.margin), y: height - g.px(g.pt.margin), fill: INK.subtitle,
      'font-size': g.px(g.pt.caption) });
  }

  // A mark's hover text and, on the page, its screen-reader text.
  function markAttrs(opts, hover) {
    return opts.interactive ? { 'data-hover': hover, role: 'img', 'aria-label': hover } : {};
  }
  // Every how many breaks a value-axis label is written: 1, or 2 when side by side they would touch (ggplot2 lets
  // them overlap; in the page's narrow chart column they would run together).
  function labelStep(ax, px, spacing) {
    const widest = Math.max(0, ...ax.labels.map(l => textWidth(l, px)));
    return spacing > 0 && widest + px * 0.6 > spacing ? 2 : 1;
  }
  // A mark a click filters by (MC chart filters): a keyboard button around its bars and label, or around a period's
  // points. opts.pickOf(chart, mark) gives { id, on, click, spot } or null when the mark cannot be clicked; spot is
  // the Spotlight Counties value of a county on the WA State map (S7's click-to-spotlight, class chart-spot).
  function pickOpen(g, opts, chart, mark, hover) {
    const p = opts.interactive && opts.pickOf ? opts.pickOf(chart, mark) : null;
    if (!p) return null;
    const spot = p.spot === undefined ? null : p.spot;
    g.add('<g' + g.attrs({ class: spot === null ? 'chart-pick' : 'chart-pick chart-spot', 'data-pick': p.id,
      'data-spot': spot, role: 'button', tabindex: '0', 'aria-pressed': String(p.on), 'aria-label': hover + '. ' + p.click,
      'data-hover': hover, 'data-click': p.click }) + '>');
    return p;
  }
  // While values of the chart's own kind are picked, its other marks are drawn faint (as the map dims them), on the
  // page and in an exported picture (MC: exports show the charts as on screen). opts.fade(chart):
  // whether the chart's own kind has picks.
  function faded(opts, chart, mark) {
    if (!opts.pickOf || !opts.fade || !opts.fade(chart)) return false;
    const p = opts.pickOf(chart, mark);
    return !(p && p.on);
  }

  // Horizontal bars (ggplot2's coord_flip): one row per place, top to bottom as listed; rows hold one or more bars.
  // rows: [{ label, bars: [{ value, color, hover }], valueLabel, hover }]. ax: the value axis.
  function hbars(g, chart, opts, rows, box, ax, rowHover) {
    const fsAxis = g.px(g.pt.axis), fsValue = g.px(g.pt.value);
    const labelW = Math.min(box.w * 0.42, Math.max(0, ...rows.map(r => textWidth(r.label, fsAxis))));
    const left = box.x + labelW + g.px(g.pt.gap);
    // Value labels sit after their bars (ggplot2's clip = "off"); where the axis' room above the largest bar is too
    // small for them, the plot is made narrower so they stay inside the picture.
    const valueOffset = g.px(g.pt.value) * 0.34;
    const valueW = Math.max(0, ...rows.filter(r => r.valueLabel).map(r => textWidth(r.valueLabel, fsValue) + valueOffset));
    const vmax = Math.max(0, ...rows.map(r => Math.max(...r.bars.map(b => b.value))));
    const share = (vmax - ax.from) / (ax.to - ax.from);
    const room = box.w - (left - box.x);
    let plotW = valueW && share > 0 ? Math.min(room, (room - valueW) / share) : room;
    // The axis labels are centered on their lines; the plot is made narrower where the last ones would run past the
    // picture's right edge, so no label is cut off (ggplot2 lets them run out).
    ax.breaks.forEach((b, i) => {
      const at = (b - ax.from) / (ax.to - ax.from), half = textWidth(ax.labels[i], fsAxis) / 2;
      if (at > 0) plotW = Math.min(plotW, (room - half) / at);
    });
    const axisH = fsAxis * 1.3 + g.px(g.pt.gap);
    const plotH = box.h - axisH;
    const X = v => left + ((v - ax.from) / (ax.to - ax.from)) * plotW;
    const n = rows.length, unit = plotH / (n + 1.2);   // discrete axis: 0.6 units of room at each end
    const every = labelStep(ax, fsAxis, Math.abs(X(ax.breaks[1] || 0) - X(ax.breaks[0] || 0)));
    ax.breaks.forEach((b, i) => {
      g.line({ x1: X(b), y1: box.y, x2: X(b), y2: box.y + plotH, stroke: INK.grid, 'stroke-width': g.px(0.53) });
      if (i % every) return;
      g.text(ax.labels[i], { x: X(b), y: box.y + plotH + g.px(g.pt.gap) + fsAxis * 0.9, fill: INK.axis,
        'font-size': fsAxis, 'text-anchor': 'middle' });
    });
    if (chart.kind === 'change') {
      g.line({ x1: X(0), y1: box.y, x2: X(0), y2: box.y + plotH, stroke: INK.zero, 'stroke-width': g.px(1.14) });
    }
    rows.forEach((r, t) => {
      const cy = box.y + unit * (t + 1.1);   // the row's center (row 0 at the top)
      const spot = pickOpen(g, opts, chart, r.mark, rowHover(r));
      const dim = faded(opts, chart, r.mark);
      if (spot) g.rect({ x: box.x, y: cy - unit / 2, width: box.w, height: unit, fill: '#000000', 'fill-opacity': 0,
        class: 'chart-hit' });
      const band = unit * (r.width || 0.72), nb = r.slots || r.bars.length, slot = band / nb;
      r.bars.forEach((b, i) => {
        const y0 = cy - band / 2 + slot * i + (nb > 1 ? slot * 0.05 : 0);
        const h = nb > 1 ? slot * 0.9 : band;
        const x0 = X(Math.min(0, b.value)), x1 = X(Math.max(0, b.value));
        g.rect(Object.assign({ x: x0, y: y0, width: Math.max(0, x1 - x0), height: h, fill: b.color,
          'fill-opacity': dim ? 0.3 : null, class: 'chart-mark' }, spot ? {} : markAttrs(opts, b.hover)));
      });
      g.text(fit(r.label, fsAxis, labelW), { x: left - g.px(g.pt.gap), y: cy + fsAxis * 0.35, fill: INK.axis,
        'font-size': fsAxis, 'text-anchor': 'end', 'font-weight': spot && spot.on ? 'bold' : null,
        'fill-opacity': dim ? 0.5 : null });
      if (r.valueLabel) {
        const v = r.bars[0].value;
        g.text(r.valueLabel, { x: X(v) + valueOffset, y: cy + fsValue * 0.35, fill: INK.value,
          'font-size': fsValue });
      }
      if (spot) g.add('</g>');
    });
  }

  // Each chart form: given the chart, options and the plot box, writes its marks.
  function drawBars(g, chart, opts, box) {
    const values = chart.bars.map(b => b.value);
    const ax = valueAxis(0, Math.max(0, ...values), 0, 0.18);
    const rows = chart.bars.map(b => ({ label: b.label, bars: [b], valueLabel: b.valueLabel, width: 0.72, mark: b }));
    hbars(g, chart, opts, rows, box, ax, r => r.bars[0].hover);
  }
  function drawByDirection(g, chart, opts, box) {
    const top = legend(g, ['Inbound', 'Outbound'].map(d => ({ label: d, color: C().COLORS[d] })), box.y, opts.width);
    const values = [].concat(...chart.groups.map(gr => gr.bars.map(b => b.value)));
    const ax = valueAxis(0, Math.max(0, ...values), 0, 0.05);
    const slots = Math.max(...chart.groups.map(gr => gr.bars.length));
    const rows = chart.groups.map(gr => ({ label: gr.label, bars: gr.bars, slots, width: 0.74, mark: gr }));
    hbars(g, chart, opts, rows, { x: box.x, y: top, w: box.w, h: box.h - (top - box.y) }, ax,
      r => r.bars.map(b => b.hover).join('; '));
  }
  // Top premises: one titled panel of bars for each direction, stacked, their heights in proportion to their bars.
  function drawPanels(g, chart, opts, box) {
    const values = [].concat(...chart.panels.map(p => p.bars.map(b => b.value)));
    const ax = valueAxis(0, Math.max(0, ...values), 0, 0.05);
    const fs = g.px(g.pt.axis);
    const sizes = chart.panels.map(p => p.bars.length + 1.2);
    const total = sizes.reduce((a, b) => a + b, 0);
    const room = box.h - chart.panels.length * fs * 1.6;
    let y = box.y;
    chart.panels.forEach((p, i) => {
      g.text(p.name, { x: box.x + box.w / 2, y: y + fs * 1.05, fill: '#1a1a1a', 'font-size': fs, 'text-anchor': 'middle' });
      y += fs * 1.6;
      const h = room * (sizes[i] / total);
      const rows = p.bars.map(b => ({ label: b.label, bars: [b], width: 0.9, mark: b }));
      hbars(g, chart, opts, rows, { x: box.x, y, w: box.w, h }, ax, r => r.bars[0].hover);
      y += h;
    });
  }
  // Emerging vs cooling: bars from zero, green for a rise and red for a fall, with a legend of the kinds present.
  function drawChange(g, chart, opts, box) {
    const present = ['Cooling', 'Emerging'].filter(s => chart.bars.some(b => b.series === s));
    const colors = { Cooling: C().COLORS.down, Emerging: C().COLORS.up };
    const top = legend(g, present.map(s => ({ label: s, color: colors[s] })), box.y, opts.width);
    const values = chart.bars.map(b => b.value);
    const ax = valueAxis(Math.min(0, ...values), Math.max(0, ...values), 0.05, 0.05);
    const rows = chart.bars.map(b => ({ label: b.label, bars: [b], width: 0.74, mark: b }));
    hbars(g, chart, opts, rows, { x: box.x, y: top, w: box.w, h: box.h - (top - box.y) }, ax, r => r.bars[0].hover);
  }
  function drawLines(g, chart, opts, box) {
    const top = legend(g, ['Inbound', 'Outbound'].map(d => ({ label: d, color: C().COLORS[d] })), box.y, opts.width,
      'line');
    const fs = g.px(g.pt.axis);
    const values = [].concat(...chart.series.map(s => s.values));
    const ax = valueAxis(0, Math.max(0, ...values), 0, 0.08);
    const labelW = Math.max(...ax.labels.map(l => textWidth(l, fs)));
    const left = box.x + labelW + g.px(g.pt.gap);
    const plotW = box.x + box.w - left;
    const n = chart.periods.length, cos = Math.cos(35 * Math.PI / 180), sin = Math.sin(35 * Math.PI / 180);
    const longest = Math.max(...chart.periods.map(p => textWidth(p, fs)));
    const axisH = longest * sin + fs * cos + g.px(g.pt.gap);
    const plotH = box.y + box.h - top - axisH;
    const X = i => left + ((i + 1 - 0.4) / (n + 0.2)) * plotW;   // discrete positions 1..n in 0.4..n + 0.6
    const Y = v => top + plotH - ((v - ax.from) / (ax.to - ax.from)) * plotH;
    ax.breaks.forEach((b, i) => {
      g.line({ x1: left, y1: Y(b), x2: left + plotW, y2: Y(b), stroke: INK.grid, 'stroke-width': g.px(0.53) });
      g.text(ax.labels[i], { x: left - g.px(g.pt.gap), y: Y(b) + fs * 0.35, fill: INK.axis, 'font-size': fs,
        'text-anchor': 'end' });
    });
    chart.periods.forEach((p, i) => {
      g.line({ x1: X(i), y1: top, x2: X(i), y2: top + plotH, stroke: INK.grid, 'stroke-width': g.px(0.53) });
      const x = X(i), y = top + plotH + g.px(g.pt.gap) + fs * 0.7;
      g.text(p, { x, y, fill: INK.axis, 'font-size': fs, 'text-anchor': 'end',
        transform: 'rotate(-35 ' + Math.round(x * 100) / 100 + ' ' + Math.round(y * 100) / 100 + ')' });
    });
    if (!chart.pointsOnly) chart.series.forEach(s => {
      const pts = s.values.map((v, i) => Math.round(X(i) * 100) / 100 + ',' + Math.round(Y(v) * 100) / 100).join(' ');
      g.add('<polyline' + g.attrs({ points: pts, fill: 'none', stroke: s.color, 'stroke-width': g.px(1.9),
        'stroke-linejoin': 'round' }) + '/>');
    });
    // The points, series by series. A period a click filters by is a button on top of them: an invisible column over
    // the period with the hover text of all its points (they then carry none of their own). Otherwise each point
    // carries its own hover text and a larger invisible target.
    const radius = g.px(chart.pointsOnly ? 3.4 : 2.3);
    const column = plotW / (n + 0.2);
    const pickAt = chart.periods.map(p => (opts.interactive && opts.pickOf ? opts.pickOf(chart, p) : null));
    // Why the points cannot be clicked (MC: while browsing or comparing), shown under their hover text.
    const hint = opts.interactive && opts.noPick ? opts.noPick(chart) : null;
    chart.series.forEach(s => s.values.forEach((v, i) => {
      g.add('<circle' + g.attrs(Object.assign({ cx: X(i), cy: Y(v), r: radius, fill: s.color,
        'fill-opacity': faded(opts, chart, chart.periods[i]) ? 0.3 : null, class: 'chart-mark' },
      pickAt[i] ? {} : markAttrs(opts, s.hover[i]), pickAt[i] ? {} : { 'data-click': hint })) + '/>');
    }));
    chart.periods.forEach((p, i) => {
      if (pickAt[i]) {
        pickOpen(g, opts, chart, p, chart.series.map(s => s.hover[i]).join('; '));
        g.rect({ x: X(i) - column / 2, y: top, width: column, height: plotH, fill: '#000000', 'fill-opacity': 0,
          class: 'chart-hit' });
        g.add('</g>');
      } else if (opts.interactive) {
        chart.series.forEach(s => {
          g.add('<circle' + g.attrs({ cx: X(i), cy: Y(s.values[i]), r: g.px(6), fill: '#000000', 'fill-opacity': 0,
            class: 'chart-hit', 'data-hover': s.hover[i], 'data-click': hint }) + '/>');
        });
      }
    });
  }
  // The heatmap's fill: ggplot2's scale_fill_gradient from #eef5fb to WSDA Dark Blue #1c5a83, mixed in CIE Lab
  // (scales::seq_gradient_pal), over the range of the cells.
  function lab(hex) {
    const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const [r, g2, b] = [1, 3, 5].map(i => lin(parseInt(hex.slice(i, i + 2), 16)));
    const xyz = [(0.4124 * r + 0.3576 * g2 + 0.1805 * b) / 0.95047, 0.2126 * r + 0.7152 * g2 + 0.0722 * b,
      (0.0193 * r + 0.1192 * g2 + 0.9505 * b) / 1.08883];
    const f = t => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    const [fx, fy, fz] = xyz.map(f);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  // The hex color of a CIE Lab color (the reverse of lab).
  function hexOfLab(L, a, b) {
    const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    const inv = t => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
    const [x, y, z] = [inv(fx) * 0.95047, inv(fy), inv(fz) * 1.08883];
    const rgb = [3.2406 * x - 1.5372 * y - 0.4986 * z, -0.9689 * x + 1.8758 * y + 0.0415 * z,
      0.0557 * x - 0.2040 * y + 1.0570 * z];
    const gam = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
    return '#' + rgb.map(c => Math.round(Math.min(1, Math.max(0, gam(c))) * 255).toString(16).padStart(2, '0')).join('');
  }
  const LOW = lab('#eef5fb'), HIGH = lab('#1c5a83');
  // The fill at t from 0 (the lowest cell) to 1 (the highest), mixed in CIE Lab.
  function gradient(t) {
    return hexOfLab(...LOW.map((v, i) => v + (HIGH[i] - v) * Math.min(1, Math.max(0, t))));
  }
  function drawHeatmap(g, chart, opts, box) {
    const fs = g.px(g.pt.axis), fsCell = g.px(g.pt.cell);
    const values = chart.cells.map(c => c.value);
    const lo = Math.min(...values), hi = Math.max(...values);
    const t = v => (hi > lo ? (v - lo) / (hi - lo) : 0.5);
    const barW = g.px(g.pt.key * 1.2), legendW = barW + g.px(g.pt.gap * 2) +
      Math.max(textWidth(C().MEASURES[opts.measure || 'animals'].title, fs), ...valueAxis(lo, hi, 0, 0, true).labels
        .map(l => textWidth(l, fs) + barW + g.px(g.pt.gap * 2)));
    const labelW = Math.min(box.w * 0.3, Math.max(...chart.rows.map(r => textWidth(r, fs))));
    const left = box.x + labelW + g.px(g.pt.gap);
    const plotW = box.x + box.w - legendW - g.px(g.pt.gap * 4) - left;
    const plotH = box.h - fs * 1.3 - g.px(g.pt.gap);
    const nx = chart.columns.length, ny = chart.rows.length;
    const ux = plotW / (nx + 0.2), uy = plotH / (ny + 0.2);
    const X = i => left + ux * (i + 0.1), Y = j => box.y + uy * (j + 0.1);   // a cell's top left (row 0 at the top)
    chart.columns.forEach((c, i) => g.text(c, { x: X(i) + ux / 2, y: box.y + plotH + g.px(g.pt.gap) + fs * 0.9,
      fill: INK.axis, 'font-size': fs, 'text-anchor': 'middle' }));
    chart.rows.forEach((r, j) => g.text(fit(r, fs, labelW), { x: left - g.px(g.pt.gap), y: Y(j) + uy / 2 + fs * 0.35,
      fill: INK.axis, 'font-size': fs, 'text-anchor': 'end' }));
    chart.cells.forEach(cell => {
      const i = chart.columns.indexOf(cell.column), j = chart.rows.indexOf(cell.row);
      g.rect(Object.assign({ x: X(i), y: Y(j), width: ux, height: uy, fill: gradient(t(cell.value)), stroke: '#ffffff',
        'stroke-width': g.px(1.07), class: 'chart-mark' }, markAttrs(opts, cell.hover)));
      g.text(cell.label, { x: X(i) + ux / 2, y: Y(j) + uy / 2 + fsCell * 0.35, fill: INK.cell, 'font-size': fsCell,
        'text-anchor': 'middle' });
    });
    // The color bar (ggplot2's guide_colorbar): the measure's name, the gradient and its breaks.
    const lx = box.x + box.w - legendW, ly = box.y + plotH / 2 - g.px(g.pt.key * 5) / 2, lh = g.px(g.pt.key * 5);
    g.text(C().MEASURES[opts.measure || 'animals'].title, { x: lx, y: ly - g.px(g.pt.gap * 2), fill: INK.axis,
      'font-size': fs });
    const gid = (opts.idPrefix || 'c') + '-grad';
    const stops = [0, 0.25, 0.5, 0.75, 1].map(s => '<stop offset="' + s + '" stop-color="' + gradient(1 - s) + '"/>');
    g.add('<defs><linearGradient id="' + esc(gid) + '" x1="0" y1="0" x2="0" y2="1">' + stops.join('') +
      '</linearGradient></defs>');
    g.rect({ x: lx, y: ly, width: barW, height: lh, fill: 'url(#' + gid + ')' });
    const ax = valueAxis(lo, hi, 0, 0, true);
    ax.breaks.forEach((b, i) => {
      const y = ly + lh - t(b) * lh;
      g.text(ax.labels[i], { x: lx + barW + g.px(g.pt.gap * 2), y: y + fs * 0.35, fill: INK.axis, 'font-size': fs });
    });
  }

  const FORMS = { bars: drawBars, bars_by_direction: drawByDirection, bars_by_panel: drawPanels, change: drawChange,
    lines: drawLines, heatmap: drawHeatmap };

  // The SVG markup of a chart. opts: { width, height (pixels; default the page's height), dpi (96 on the page,
  // 150 for a PNG), basePt (the text's base size: 12 on the page, 14 for a PNG), interactive (hover values,
  // screen-reader text and click buttons), pickOf and fade (the chart filters' buttons and faint marks; see pickOpen
  // and faded), measure (the heatmap's legend), caption and footer (export lines), idPrefix (unique ids on the page) }.
  function svg(chart, opts) {
    const o = Object.assign({ dpi: SCREEN_DPI }, opts);
    const width = o.width, height = o.height || screenHeight(chart);
    o.width = width;
    const g = context(o);
    const top = header(g, chart, o, width);
    const m = g.px(g.pt.margin);
    const box = { x: m, y: top, w: width - 2 * m, h: height - top - m - footerHeight(g, o) };
    if (chart.empty) {
      g.text(chart.empty, { x: width / 2, y: top + (height - top) / 2, fill: INK.empty, 'font-size': g.px(g.pt.empty),
        'text-anchor': 'middle' });
    } else {
      FORMS[chart.kind](g, chart, o, box);
    }
    footer(g, o, height);
    // The text alternative: the title, subtitle and gray message. On the page it is the group's label (a <title>
    // would also show as the browser's own tooltip over the page's hover box); in a picture it is its <title>.
    const label = chart.title + (chart.subtitle ? '. ' + chart.subtitle : '') + (chart.empty ? '. ' + chart.empty : '');
    return '<svg xmlns="http://www.w3.org/2000/svg"' + g.attrs({ width, height, viewBox: '0 0 ' + width + ' ' + height,
      role: o.interactive ? 'group' : 'img', 'aria-label': label, 'font-family': FONT, 'data-chart': chart.id }) + '>' +
      (o.interactive ? '' : '<title>' + esc(label) + '</title>') +
      '<rect width="100%" height="100%" fill="#ffffff"/>' + g.parts.join('') + '</svg>';
  }

  // PNG bytes with their resolution recorded: a pHYs chunk right after the IHDR chunk, in pixels per meter (150 dpi
  // is 5,905, the value in CVI's ggsave PNGs), so Word and PowerPoint place the picture at its intended size (the
  // browser's canvas writes no resolution). crc32 is shared/zip.js's.
  function pngWithDpi(bytes, dpi, crc32) {
    const IHDR_END = 8 + 4 + 4 + 13 + 4;   // signature, then IHDR's length, type, 13 data bytes and CRC
    const ppm = Math.floor(dpi / 0.0254);
    const chunk = new Uint8Array(4 + 4 + 9 + 4);
    const v = new DataView(chunk.buffer);
    v.setUint32(0, 9);
    chunk.set([0x70, 0x48, 0x59, 0x73], 4);   // "pHYs"
    v.setUint32(8, ppm);
    v.setUint32(12, ppm);
    chunk[16] = 1;   // unit: the meter
    v.setUint32(17, crc32(chunk.subarray(4, 17)) >>> 0);
    const out = new Uint8Array(bytes.length + chunk.length);
    out.set(bytes.subarray(0, IHDR_END), 0);
    out.set(chunk, IHDR_END);
    out.set(bytes.subarray(IHDR_END), IHDR_END + chunk.length);
    return out;
  }

  // The chart as a PNG Blob at CVI's export size (or opts.width x opts.height), drawn by the browser from the SVG
  // at 150 dpi with 14 pt text (or opts.dpi and opts.basePt), with that resolution recorded in the file. With
  // opts.dpi alone the size follows it (the same inches, more pixels). Rejects
  // with a plain message when the browser cannot draw it.
  function png(chart, opts) {
    const size = exportSize(chart, opts && opts.dpi);
    const o = Object.assign({ width: size.width, height: size.height, dpi: EXPORT_DPI, basePt: EXPORT_BASE_PT }, opts,
      { interactive: false });
    const markup = svg(chart, o);
    return new Promise((resolve, reject) => {
      const img = new root.Image();
      const url = root.URL.createObjectURL(new root.Blob([markup], { type: 'image/svg+xml' }));
      const fail = () => { root.URL.revokeObjectURL(url); reject(new Error('The chart picture could not be drawn.')); };
      img.onerror = fail;
      img.onload = () => {
        try {
          const canvas = root.document.createElement('canvas');
          canvas.width = o.width;
          canvas.height = o.height;
          // A canvas kept in ordinary memory, not on the graphics card: it is drawn once and read once, and this keeps
          // the work away from the maps' WebGL drawing.
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, o.width, o.height);
          ctx.drawImage(img, 0, 0, o.width, o.height);
          root.URL.revokeObjectURL(url);
          canvas.toBlob(b => {
            if (!b) { reject(new Error('The chart picture could not be drawn.')); return; }
            b.arrayBuffer().then(buf => resolve(new root.Blob([pngWithDpi(new Uint8Array(buf), o.dpi, root.WSDA.zip.crc32)],
              { type: 'image/png' })), () => reject(new Error('The chart picture could not be drawn.')));
          }, 'image/png');
        } catch (e) {
          fail();
        }
      };
      img.src = url;
    });
  }

  root.CVIWA = root.CVIWA || {};
  root.CVIWA.chartsvg = { svg, png, pngWithDpi, exportSize, screenHeight, textWidth, extended, valueAxis, gradient, sizes,
    SCREEN_DPI, EXPORT_DPI, SCREEN_BASE_PT, EXPORT_BASE_PT };
})(typeof window !== 'undefined' ? window : globalThis);
