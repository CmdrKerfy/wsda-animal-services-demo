/* The National Flow time-series GIF (S9 with S10): one branded Flow page per period, drawn by the same
 * code as the branded PNG (brandedmaps.flow), written by the page's own GIF writer (shared/gif.js).
 *
 * As CVI's render_branded_flow_map_gif (CVI shiny/R/static_map_renderer.R 2379-2525, "SMR"): frames by year
 * ("2024", each with every picked quarter) or by year and quarter ("2024-Q1"), in order; an empty period is skipped;
 * with no frame left, CVI's error. Each frame is 11 x 8.5 in at 150 dpi (1650 x 1275 pixels), with its own title,
 * totals and Top 3 States. CVI's file name CVI_Flow_TimeSeries_{years}_{DIRECTION}.gif (mod_maps.R 6938-6940).
 *
 * Deliberate differences:
 *   frames use the view's settings (scaling, classes, width, opacity, state lines, palette, species, and the chart
 *       filters as on the branded PNG); CVI's frames use its defaults (SMR 2477-2492 passes none of them)
 *   one legend and one width scale computed over all frames, so a width means the same animals in every frame
 *       (OPTIONS.sharedScale)
 *   a period strip under the map: every frame's label, the current one marked (OPTIONS.periodStrip)
 *   the last frame held 2.4 s before the loop starts again (CVI: 0.8 s for every frame) (OPTIONS.holdLast)
 * The last three are options (OPTIONS, all on); CVI_OPTIONS turns them off for the tests.
 *
 * WA State and County Focus: the same GIF on the two other views, each frame a full branded page of that view drawn
 * by its PNG's code. CVI makes no GIF for these views, so there is no reference; the rules for them:
 *   one scale across frames: WA State sizes every frame's county totals together (each direction apart, as the
 *       live map), County Focus groups every frame's premises with one distance and sizes every frame's groups
 *       together; one legend for the whole GIF (OPTIONS.sharedScale)
 *   names placed once, around every frame's circles together, and kept still; a frame draws only its own
 *       counties' names (OPTIONS.holdNames)
 *   the period strip and the held last frame as on National Flow, the map fitted above the strip's band (BAND) */
(function (root) {
  'use strict';
  const BM = () => root.CVIWA.brandedmaps;
  const FL = () => root.CVIWA.flow;
  const BR = () => root.WSDA.branded;

  const DPI = 150;               // CVI's GIF: dpi = 150 (mod_maps.R 6960)
  const DELAY = 80;              // 0.8 s per frame, in hundredths of a second (mod_maps.R 6959)
  const LAST_DELAY = 240;        // the last frame's hold, 2.4 s
  const OPTIONS = { sharedScale: true, periodStrip: true, holdLast: true, holdNames: true };
  const CVI_OPTIONS = { sharedScale: false, periodStrip: false, holdLast: false, holdNames: false };
  const BAND = 0.075;            // the strip's band on WA State and County Focus: the line at 0.050, its labels above
  // County Focus's strip keeps this far from its WA inset: it ends before an inset at the bottom right and starts
  // after one at the bottom left; with the inset at the top it runs the full width (inset: the page model's inset).
  const INSET_GAP = 0.025;
  // Where the period strip starts and ends on the page, { x0, x1 } as fractions of the page.
  function stripSpan(view, inset) {
    if (view !== 'focus' || !inset || inset.corner === 'top left' || inset.corner === 'top right') {
      return { x0: STRIP.x0, x1: STRIP.x1 };
    }
    if (inset.corner === 'bottom left') return { x0: inset.x + inset.w + INSET_GAP, x1: STRIP.x1 };
    return { x0: STRIP.x0, x1: inset.x - INSET_GAP };
  }
  const NO_FRAMES = 'No frames could be rendered for the selected period range.';   // SMR 2501
  const cmpC = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  // ── Frames ──────────────────────────────────────────────────────────────────────────────────────────────────
  // CVI's frame list (SMR 2431-2448): by year, each year (sorted, once) with every picked quarter; by quarter, each
  // year and each picked quarter (sorted, once), year first. Each: { years, quarters, label }.
  function frameSpecs(years, quarters, by) {
    const ys = [...new Set(years.map(Number))].sort((a, b) => a - b);
    if (by === 'year') return ys.map(y => ({ years: [y], quarters: quarters.slice(), label: String(y) }));
    const qs = [...new Set(quarters)].sort(cmpC);
    const out = [];
    for (const y of ys) {
      for (const q of qs) out.push({ years: [y], quarters: [q], label: y + '-' + q });
    }
    return out;
  }
  // The frames with lines: each spec's own filters (the view's, with the frame's year and quarters; f.keep, a period
  // chart filter of several periods, still applies) and its lines; specs with none are skipped (SMR 2473). Returns
  // { specs, frames: [{ label, f, lines }], skipped: [labels] }.
  function frames(loaded, f, by, centers) {
    const specs = frameSpecs(f.years, f.quarters, by);
    const out = [];
    const skipped = [];
    for (const s of specs) {
      const ff = Object.assign({}, f, { years: s.years, quarters: s.quarters });
      const lines = FL().lines(loaded, ff, centers);
      if (lines && lines.length) out.push({ label: s.label, f: ff, lines });
      else skipped.push(s.label);
    }
    return { specs, frames: out, skipped };
  }

  // ── The period strip ────────────────────────────────────────────────────────────────────────────────────────
  // Under the map, above the source line: a thin line with a dot per frame, the current frame's dot larger in WSDA
  // Dark Blue with its label in bold. Every label is shown when they fit; otherwise each year's first frame is named
  // by its year, and labels that would touch the current one are left out. span: where the strip starts and ends,
  // { x0, x1 } as fractions of the page (stripSpan: County Focus keeps it off its WA inset); the page's width by
  // default.
  const STRIP = { y: 0.050, x0: 0.030, x1: 0.740, pt: 7, color: '#666666', mark: '#1c5a83' };
  // Each frame's dot position and the labels drawn (null for a label left out), with whether every label fits.
  function stripPlaces(labels, current, span) {
    const B = BR();
    const n = labels.length;
    const x0 = B.px(span ? span.x0 : STRIP.x0);
    const x1 = B.px(span ? span.x1 : STRIP.x1);
    const xs = labels.map((_, i) => (n === 1 ? x0 : x0 + i * (x1 - x0) / (n - 1)));
    const widest = Math.max(...labels.map(l => B.textWidth(l, STRIP.pt, true)));
    const fit = n === 1 || (x1 - x0) / (n - 1) >= widest + 4;
    const shown = labels.map((label, i) => {
      if (i === current) return { text: label, x: xs[i], current: true };
      if (fit) return { text: label, x: xs[i], current: false };
      const year = label.split('-')[0];
      const first = i === 0 || labels[i - 1].split('-')[0] !== year;
      return first ? { text: year, x: xs[i], current: false } : null;
    });
    // A label is drawn centered on its dot, kept inside the strip's ends.
    const box = s => {
      const w = B.textWidth(s.text, STRIP.pt, s.current);
      const left = Math.max(x0 - 4, Math.min(x1 + 4 - w, s.x - w / 2));
      return { left, right: left + w };
    };
    const cur = box(shown[current]);
    return {
      xs, fit,
      labels: shown.map(s => {
        if (!s) return null;
        const b = box(s);
        if (!s.current && b.right + 3 > cur.left && b.left - 3 < cur.right) return null;
        return Object.assign(s, b);
      })
    };
  }
  // The period strip as SVG for one frame (current: its index), with the places it used.
  function strip(labels, current, span) {
    const B = BR();
    const places = stripPlaces(labels, current, span);
    const y = B.py(STRIP.y);
    const parts = [];
    if (labels.length > 1) {
      parts.push(B.line(places.xs[0], y, places.xs[places.xs.length - 1], y, '#bbbbbb', 0.8));
    }
    places.xs.forEach((x, i) => {
      if (i === current) return;
      parts.push('<circle cx="' + B.num(x) + '" cy="' + B.num(y) + '" r="2" fill="#bbbbbb"/>');
    });
    const cx = places.xs[current];
    parts.push('<circle cx="' + B.num(cx) + '" cy="' + B.num(y) + '" r="3.6" fill="' + STRIP.mark +
      '" stroke="#ffffff" stroke-width="0.8"/>');
    for (const s of places.labels) {
      if (!s) continue;
      parts.push(B.text(s.text, s.left, y - 9, { pt: STRIP.pt, bold: s.current,
        color: s.current ? STRIP.mark : STRIP.color }));
    }
    return { svg: parts.join(''), places };
  }

  // ── Pages ───────────────────────────────────────────────────────────────────────────────────────────────────
  // The frames ready to draw: { count, labels, page(i) }. page(i) builds frame i's branded Flow page when asked, so
  // the GIF draws one page at a time (building all pages at the click would hold the page and its memory). The
  // shared scale is worked out once here. input: as brandedmaps.flow's (universe, title, date,
  // states, highlights, highlight) plus stateLines; styleOpts: the page frame's style; opts: OPTIONS by default.
  // Each page's model gets frame: { label, index, of, delay } and, with the strip, strip: { labels shown, current }.
  function prepare(fr, input, styleOpts, opts) {
    const o = Object.assign({}, OPTIONS, opts || {});
    const labels = fr.frames.map(x => x.label);
    const scale = o.sharedScale && fr.frames.length
      ? BM().flowScale([].concat(...fr.frames.map(x => x.lines.map(a => a.total_animals))), fr.frames[0].f)
      : undefined;
    // CH: shaded states take one set of classes from every frame's state totals (a color means the same number in
    // every frame).
    const shade = input.shade && o.sharedScale && fr.frames.length
      ? Object.assign({}, input.shade, { cls: root.CVIWA.choropleth.stateClasses(fr.frames.map(x => x.lines),
        input.shade.method, input.shade.nBins, fr.frames[0].f.direction) })
      : input.shade;
    // The Alaska and Hawaii boxes of every frame drawn in each frame, so the layout holds still.
    const IN = root.CVIWA.flowinsets;
    const insets = IN ? IN.present([].concat(...fr.frames.map(x => x.lines.map(a => a.state)))) : undefined;
    // Frame i's branded page, with its frame label, delay and period strip.
    const page = i => {
      const x = fr.frames[i];
      const built = BM().flow(Object.assign({}, input, { lines: x.lines, scale, shade, insets,
        f: Object.assign({}, x.f, { lines: input.stateLines }) }), styleOpts);
      const last = i === labels.length - 1;
      built.model.frame = { label: x.label, index: i, of: labels.length,
        delay: o.holdLast && last && labels.length > 1 ? LAST_DELAY : DELAY };
      if (o.periodStrip) {
        const s = strip(labels, i);
        // Drawn before the logo, as the page's last region.
        built.parts.splice(built.parts.length - 1, 0, s.svg);
        built.model.strip = { current: x.label,
          labels: s.places.labels.filter(Boolean).map(l => ({ text: l.text, current: l.current })) };
      }
      return built;
    };
    // shadeCls: the classes every frame shares on a shaded map (export_params.json).
    return { count: labels.length, labels, page, shadeCls: shade && shade.cls || null };
  }
  // Every page at once (the tests).
  function pages(fr, input, styleOpts, opts) {
    const p = prepare(fr, input, styleOpts, opts);
    return p.labels.map((_, i) => p.page(i));
  }

  // ── WA State and County Focus ───────────────────────────────────────────────────────────────────────────────
  // A view's frames: CVI's frame list, each frame with its own rows (build(ff): WA State's county rows or County
  // Focus's premises, as the export draws them), empty periods skipped. Returns { specs, frames: [{ label, f, rows
  // }], skipped }.
  function viewFrames(f, by, build) {
    const specs = frameSpecs(f.years, f.quarters, by);
    const out = [];
    const skipped = [];
    for (const s of specs) {
      const ff = Object.assign({}, f, { years: s.years, quarters: s.quarters });
      const rows = build(ff);
      if (rows && rows.length) out.push({ label: s.label, f: ff, rows });
      else skipped.push(s.label);
    }
    return { specs, frames: out, skipped };
  }
  // WA State's frames (each with its county rows) and County Focus's frames (each with its premises).
  const waFrames = (master, f, by) => viewFrames(f, by, ff => root.CVIWA.aggregate.build(master.rows,
    Object.assign({}, ff, { hasSpecies: master.hasSpecies })));
  const focusFrames = (master, f, by) => viewFrames(f, by, ff => root.CVIWA.focus.build(master, ff).premises);

  // WA State's shared scale: every frame's county totals sized together, each direction apart as the live map does
  // (or the combined totals), so a total gets the same radius in every frame. Returns the frames with their rows
  // sized and { rMin, rMax, values: { all, Inbound, Outbound, Total } } for the page (sizes and legend).
  function waScale(frames, f) {
    const S = root.CVIWA.scaling;
    const sized = frames.map(x => x.rows.map(r => Object.assign({}, r)));
    const byDirection = new Map();
    sized.forEach(rows => rows.forEach(r => {
      if (!byDirection.has(r.direction)) byDirection.set(r.direction, []);
      byDirection.get(r.direction).push(r);
    }));
    const values = { all: [].concat(...sized.map(rows => rows.map(r => r.total_animals))) };
    for (const [direction, rows] of byDirection) {
      values[direction] = rows.map(r => r.total_animals);
      const radii = S.computeRadius(values[direction], f.scaling, 4, 48, f.nBins);
      rows.forEach((r, i) => { r.radius_px = radii[i]; });
    }
    const radii = [].concat(...sized).map(r => r.radius_px).filter(x => x !== null && !Number.isNaN(x));
    let rMin = Infinity;
    let rMax = -Infinity;
    for (const r of radii) {
      rMin = Math.min(rMin, r);
      rMax = Math.max(rMax, r);
    }
    return { frames: frames.map((x, k) => Object.assign({}, x, { rows: sized[k] })), scale: { rMin, rMax, values } };
  }
  // County Focus's shared scale: one grouping distance from every frame's premises, then every frame's groups sized
  // together. Returns the frames with their groups and { rMin, rMax, values (every group total), distance }.
  function focusScale(frames, f) {
    const S = root.CVIWA.scaling;
    const distance = BM().groupDistance([].concat(...frames.map(x => x.rows)));
    const groups = frames.map(x => BM().groupPremises(x.rows, f.scaling, f.nBins, distance));
    const values = [].concat(...groups.map(g => g.map(c => c.total_animals)));
    const radii = S.computeRadius(values, f.scaling || 'log', 4, 24, f.nBins);
    let k = 0;
    groups.forEach(g => g.forEach(c => { c.radius_px = radii[k++]; }));
    let rMin = Infinity;
    let rMax = -Infinity;
    for (const r of radii) {
      rMin = Math.min(rMin, r);
      rMax = Math.max(rMax, r);
    }
    return { frames: frames.map((x, i) => Object.assign({}, x, { grouped: groups[i] })),
      scale: { rMin, rMax, values, distance } };
  }
  // Every frame's circles in page points, the largest at each place kept: what the names are placed around, the
  // same for every frame.
  function obstacles(view, inputs, style) {
    const keep = new Map();
    for (const input of inputs) {
      const drawn = view === 'wa' ? BM().waLayout(input).drawn : BM().focusLayout(input, style).drawn;
      for (const c of drawn) {
        const key = view === 'wa' ? c.county + '\r' + c.direction : Math.round(c.x * 100) + ',' + Math.round(c.y * 100);
        if (!keep.has(key) || keep.get(key).r < c.r) keep.set(key, c);
      }
    }
    return [...keep.values()].sort((a, b) => b.r - a.r);
  }
  // The frames ready to draw, as prepare's: { count, labels, page(i) }, the shared scale and the names' places
  // worked out once here. view: 'wa' or 'focus'; fr: waFrames' or focusFrames'; input: as brandedmaps.wa's or
  // .focus's, without rows or premises, plus frameF (fields added to each frame's filters: County Focus's opacity
  // and hideCircles) and highlightOf (County Focus: a frame's premises to its chart highlight); styleOpts: the page
  // frame's style; opts: OPTIONS by default. Also { scale, obstacles } for the tests.
  function prepareView(view, fr, input, styleOpts, opts) {
    const o = Object.assign({}, OPTIONS, opts || {});
    const labels = fr.frames.map(x => x.label);
    let frames = fr.frames;
    let scale;
    if (o.sharedScale && frames.length) {
      const f0 = frames[0].f;
      const shared = view === 'wa' ? waScale(frames, f0) : focusScale(frames, f0);
      frames = shared.frames;
      scale = shared.scale;
    }
    // CH: shaded counties take one set of classes from every frame's values, so a color means the same number in
    // every frame (in place of the circles' shared scale; the names are every county's, the same in every frame).
    let shade = input.shade;
    if (view === 'wa' && shade && o.sharedScale && frames.length) {
      shade = Object.assign({}, shade, { cls: root.CVIWA.choropleth.countyClasses(frames.map(x => x.rows),
        shade.measure, shade.method, shade.nBins, frames[0].f.direction) });
    }
    const band = o.periodStrip ? BAND : undefined;
    // County Focus: when any frame groups premises, every frame keeps room for the grouping note (a steady legend).
    const notePad = view === 'focus' && o.sharedScale && frames.some(x => x.grouped && x.grouped.length < x.rows.length);
    // County Focus: the legend's room up to the lowest Top box of every frame (brandedmaps.focus's topY).
    let legendTop;
    if (view === 'focus' && o.sharedScale) {
      const L = BR().LAYOUT;
      legendTop = Math.min(...frames.map(x => 1 - L.headerH - 0.020 - BM().focusTop(x.rows).height));
    }
    // WA State, with the page's rules (shared scale; CVI's options keep each frame its period's PNG): the Top 3 box
    // split in two (Inbound, Outbound) in every frame when any frame has both directions, so
    // the box keeps its size and titles from frame to frame (a frame without one direction shows that list
    // empty).
    const topSplit = view === 'wa' && o.sharedScale ? frames.some(x => {
      const d = new Set(x.rows.map(r => r.direction));
      return d.has('Inbound') && d.has('Outbound') && !d.has('Total');
    }) : undefined;
    // One frame's input for the branded page: the view's input with that frame's rows and the shared scale.
    const frameInput = x => {
      const f = Object.assign({}, x.f, input.frameF || {});
      if (view === 'wa') return Object.assign({}, input, { rows: x.rows, f, scale, band, shade, topSplit });
      return Object.assign({}, input, { premises: x.rows, grouped: x.grouped, f, scale, band, notePad, legendTop,
        highlight: input.highlightOf ? input.highlightOf(x.rows) : input.highlight });
    };
    const style = BR().styleOf(styleOpts);
    const held = o.holdNames && frames.length && !(view === 'wa' && shade)
      ? obstacles(view, frames.map(frameInput), style) : undefined;
    // Frame i's branded page, with its frame label, delay and period strip.
    const page = i => {
      const x = frames[i];
      const one = Object.assign(frameInput(x), { obstacles: held });
      const built = view === 'wa' ? BM().wa(one, styleOpts) : BM().focus(one, styleOpts);
      const last = i === labels.length - 1;
      built.model.frame = { label: x.label, index: i, of: labels.length,
        delay: o.holdLast && last && labels.length > 1 ? LAST_DELAY : DELAY };
      if (o.periodStrip) {
        const s = strip(labels, i, stripSpan(view, built.model.inset));
        built.parts.push(s.svg);
        built.model.strip = { current: x.label, left: Math.min(...s.places.labels.filter(Boolean).map(l => l.left)),
          right: Math.max(...s.places.labels.filter(Boolean).map(l => l.right)),
          labels: s.places.labels.filter(Boolean).map(l => ({ text: l.text, current: l.current })) };
      }
      return built;
    };
    return { count: labels.length, labels, page, scale, obstacles: held, shadeCls: shade && shade.cls || null };
  }

  // CVI's file name (mod_maps.R 6938-6940, .yr_label 6347-6350).
  const fileName = f => 'CVI_Flow_TimeSeries_' + BM().yearLabel(f.years) + '_' + String(f.direction).toUpperCase() +
    '.gif';
  // The two other views' names, in CVI's pattern (their PNGs' names with "TimeSeries" and the years):
  // CVI_County_Map_TimeSeries_{years}_{INB+OUT}.gif, CVI_CountyFocus_TimeSeries_{directions}_{counties}_{years}.gif.
  function fileNameView(view, f) {
    if (view === 'wa') {
      return 'CVI_County_Map_TimeSeries_' + BM().yearLabel(f.years) + '_' +
        f.direction.map(d => d.slice(0, 3).toUpperCase()).join('+') + '.gif';
    }
    const clean = s => s.replace(/[^A-Za-z0-9]/g, '');
    const dirs = f.direction === 'inbound' ? 'Inbound' : f.direction === 'outbound' ? 'Outbound' : 'Inbound-Outbound';
    const cty = f.counties.length <= 3
      ? clean(f.counties.slice().sort((a, b) => String(a).localeCompare(String(b), 'en')).join('-'))
      : f.counties.length + 'Counties';
    return 'CVI_CountyFocus_TimeSeries_' + dirs + '_' + cty + '_' + BM().yearLabel(f.years) + '.gif';
  }
  // The frame size: 11 x 8.5 in at 150 dpi.
  const size = () => BR().pixelSize(DPI);

  // ── The file ────────────────────────────────────────────────────────────────────────────────────────────────
  // The frames (prepare's) built, drawn and written one by one. o.onFrame(i, n, label) before each frame (1-based, as
  // CVI's progress) and o.onPage(i, built) after each page is built (0-based); o.canceled() is asked after each step
  // and once more at the end, and a true answer stops with a CanceledError. The browser gets a moment
  // between frames, so the page stays usable. Returns { blob, frames: [{ label, delay, colors, exact }] }.
  class CanceledError extends Error {
    constructor() {
      super('The time-series GIF was canceled.');
      this.name = 'CanceledError';
    }
  }
  const pause = () => new Promise(resolve => root.setTimeout(resolve, 0));
  async function encode(built, o) {
    const opts = o || {};
    const stop = () => {
      if (opts.canceled && opts.canceled()) throw new CanceledError();
    };
    if (!built.count) throw new Error(NO_FRAMES);
    const px = size();
    const w = root.WSDA.gif.writer(px.width, px.height);
    const done = [];
    for (let i = 0; i < built.count; i++) {
      stop();
      if (opts.onFrame) opts.onFrame(i + 1, built.count, built.labels[i]);
      await pause();
      stop();
      const page = built.page(i);
      if (opts.onPage) opts.onPage(i, page);
      const image = await BR().pixels(BR().svg(page.parts, px), px);
      stop();
      const q = w.frame(image.data, page.model.frame.delay);
      done.push({ label: page.model.frame.label, delay: page.model.frame.delay, colors: q.colors, exact: q.exact });
    }
    const blob = new root.Blob([w.finish()], { type: 'image/gif' });
    stop();
    return { blob, frames: done };
  }

  root.CVIWA = root.CVIWA || {};
  root.CVIWA.timeseries = {
    frameSpecs, frames, prepare, pages, strip, stripPlaces, fileName, size, encode, CanceledError,
    viewFrames, waFrames, focusFrames, waScale, focusScale, obstacles, prepareView, fileNameView,
    DPI, DELAY, LAST_DELAY, OPTIONS, CVI_OPTIONS, NO_FRAMES, STRIP, BAND, stripSpan
  };
})(typeof window !== 'undefined' ? window : globalThis);
