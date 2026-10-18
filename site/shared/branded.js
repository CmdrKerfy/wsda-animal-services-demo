/* The branded page frame shared by the branded map exports (S9): the CVI page's three maps, the Infrastructure
 * dashboard's Facilities map and, later, Premise Lookup (S11). Structural parity with CVI's branded PNGs: the same
 * page size, regions, strings, numbers and colors as CVI's renderer (CVI shiny/R/static_map_renderer.R, "SMR" below),
 * drawn the browser's way. The page is built as vector
 * SVG in points (an 11 x 8.5 in page is 792 x 612 pt), so the same drawing gives the 200 dpi and 300 dpi PNGs.
 *
 * Positions follow CVI's cowplot layout: fractions of the page with the origin at the bottom left. Text sizes
 * follow ggplot2: a geom_text size is in millimeters (textPt converts), cowplot's draw_label size is in points.
 * Label widths come from Arial's advance widths (no measuring), so Node gives the same layout as the browser.
 *
 * The deliberate differences from CVI are options, on by default; CVI_STYLE keeps CVI's look for the tests:
 *   agencyName   "WASHINGTON STATE DEPARTMENT OF AGRICULTURE" above "ANIMAL SERVICES" in the header
 *   darkerGrays  small gray text darkened (Last Updated #777777 to #555555, footnote #888888 to #666666)
 *   legendBySize the legend's sample circles spaced by their size, so they never overlap
 *   darkNames    map names near-black #222222 in place of CVI's gray #8a8a8a
 *   sizingLine   a line at the bottom of the legend naming how circles are sized
 *   sourceLine   a source line at the bottom left of every page (CVI shows a footnote only over tiles)
 *   headerGap    the header's text row moved right by 0.015 of the page, so about 18 points (CVI: 6) separate the
 *                logo from "ANIMAL SERVICES"
 *   groupedAtCenter County Focus groups drawn at their animal-weighted center, nudged apart by direction, as
 *                CVI's code intends (its PNG draws them at the biggest premises' point)
 *   speciesKey   a species color key on the National Flow legend (CVI's PNG colors lines by species without one)
 *   flowLegendAsMap National Flow's legend line widths as the map draws those values (CVI sizes the tiers
 *                against each other)
 *   activityPeriodOnly the Facilities Report caption names a period only when CVI activity is drawn (CVI names
 *                the activity pickers' period even when activity is off)
 *   densityCountLabels the Facilities Density classes labeled by the counts they hold ("1", "2", "3 – 4"; CVI
 *                labels Fisher's in-between breaks rounded, so its labels overlap: "1 – 2", "2 – 2", "4 – 4")
 *   clusterCountLabels the Facilities Locations "Cluster size" legend shows every size drawn, labeled by the
 *                counts its circles hold (CVI labels the rounded in-between breaks and drops repeats)
 *   clusterSizeByCount the Locations circles sized by their class's largest count, area in proportion (CVI
 *                spaces the classes' sizes evenly from 3 to 15)
 *   sitesPanel   S11: Premise Lookup's QUERY SITES panel lists at most 8 sites ranked by matches, every name at one
 *                size, cut with "…" to the column (CVI: up to 12 rows, long names shrunk)
 *   insetCorner  S11: Premise Lookup's WA inset goes to the first map corner clear of sites, points and names (CVI:
 *                always the bottom right); County Focus's, to the first corner clear of the focus counties' land,
 *                circles, markers and names
 *   compactTop   CH: WA State's Top 3 box with one list (one direction or Combined) half as tall, its rows as close
 *                as the two-direction box's (CVI: the one list spread over the full box)
 *   flowTop      National Flow's Top States box sized to its rows (3, or 5 for a Top 5), as close as WA State's
 *                compact box; the page shows a Top 5 (CVI: the top 3 spread over a box 0.21 of the page tall; null
 *                keeps CVI's)
 * Three Facilities differences are not options here: a Density map whose populated counties all have one count gets
 * one class, the CVI activity circles take the dashboard's palette (both in infrastructure/branded.js), and the
 * dashboard's own control decides when Density applies. The inset's focus color is a style value (insetFocus).
 * svg() and the drawing helpers are pure; png() needs a browser. */
(function (root) {
  'use strict';

  // ── Page and layout (CVI's) ─────────────────────────────────────────────────────────────────────────────────
  const PAGE = { widthIn: 11, heightIn: 8.5 };               // every branded PNG (SMR 2850-2852)
  const REPORT_PAGE = { widthIn: 6.5, heightIn: 3.3 };        // Facilities' "Report" style (SMR 3534-3539)
  const W = PAGE.widthIn * 72;                                // 792 pt
  const H = PAGE.heightIn * 72;                               // 612 pt
  const DPI = { standard: 200, high: 300 };                   // CVI's 200 dpi; High is a deliberate difference
  // SMR 3129-3136: header bar, map width, the right gutter, the meta and stat rows, the logo's box.
  const LAYOUT = {
    headerH: 0.092,
    mapW: 0.770,
    gutterX: 0.788,
    gutterW: 0.205,
    metaY: 1 - 0.092 - 0.022,
    statY: 1 - 0.092 - 0.058,
    logoX: 0.005,
    logoW: 0.130
  };
  const DEFAULTS = { agencyName: true, darkerGrays: true, insetFocus: '#1c5a83', legendBySize: true,
    darkNames: true, sizingLine: true, sourceLine: true, headerGap: true, groupedAtCenter: true,
    speciesKey: true, flowLegendAsMap: true, activityPeriodOnly: true, densityCountLabels: true,
    clusterCountLabels: true, clusterSizeByCount: true, sitesPanel: true, insetCorner: true, compactTop: true,
    flowTop: 5 };
  const CVI_STYLE = { agencyName: false, darkerGrays: false, insetFocus: '#1f77b4', legendBySize: false,
    darkNames: false, sizingLine: false, sourceLine: false, headerGap: false, groupedAtCenter: false,
    speciesKey: false, flowLegendAsMap: false, activityPeriodOnly: false, densityCountLabels: false,
    clusterCountLabels: false, clusterSizeByCount: false, sitesPanel: false, insetCorner: false, compactTop: false,
    flowTop: null };
  const HEADER_SHIFT = 0.015;   // headerGap
  const TEAL = '#245566';
  const FONT = 'Arial, Helvetica, sans-serif';
  const AGENCY = 'WASHINGTON STATE DEPARTMENT OF AGRICULTURE';

  // ── ggplot2's units ─────────────────────────────────────────────────────────────────────────────────────────
  const MM_PT = 72.27 / 25.4;      // ggplot2's .pt: millimeters to points
  const STROKE = 96 / 25.4;        // ggplot2's .stroke
  const textPt = size => size * MM_PT;
  // A ggplot2 linewidth (mm) as a line width in points (grid's lwd 1 is 1/96 inch).
  const linePt = linewidth => linewidth * MM_PT * 72 / 96;
  // A ggplot2 point of shape 21 (a filled circle with a border): grid draws it with a radius of 0.375 times its
  // font size, which ggplot2 sets to size * .pt + stroke * .stroke / 2; the border's lwd is stroke * .stroke / 2.
  const pointRadius = (size, stroke) => 0.375 * (size * MM_PT + stroke * STROKE / 2);
  const pointBorder = stroke => stroke * STROKE / 2 * 72 / 96;

  // ── Text ────────────────────────────────────────────────────────────────────────────────────────────────────
  // Text from the data, escaped for SVG markup; control characters XML forbids are removed (as chartsvg.js).
  // Control characters are dropped; so are the bidirectional controls, which could show a name reversed.
  const esc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  // Arial's advance widths (1/1000 em) for printable ASCII from the space, regular and bold (Arial's metrics are
  // Helvetica's). Other characters count as a digit; dashes and the ellipsis as their own widths.
  const WIDTHS = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  const WIDTHS_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
  const SPECIAL = { 0x2013: 556, 0x2014: 1000, 0x2026: 1000, 0x2192: 1000 };
  // A text's width in points at a font size, from the widths above.
  function textWidth(s, pt, bold) {
    const table = bold ? WIDTHS_BOLD : WIDTHS;
    let w = 0;
    for (const ch of String(s)) {
      const c = ch.codePointAt(0);
      w += c >= 32 && c <= 126 ? table[c - 32] : SPECIAL[c] || 556;
    }
    return (w / 1000) * pt;
  }

  // ── Page coordinates ────────────────────────────────────────────────────────────────────────────────────────
  // CVI's fractions (origin bottom left) as SVG points (origin top left).
  const px = f => f * W;
  const py = f => (1 - f) * H;
  // A region of the page (CVI's x, y, width, height fractions) with an inner margin in points, as a ggplot2 panel
  // with coord_cartesian(xlim = c(0, 1), ylim = c(0, 1), expand = FALSE): u and v place a point inside it.
  function panel(x, y, width, height, marginPt) {
    const m = marginPt || 0;
    const left = px(x);
    const top = py(y + height);
    const w = px(width);
    const h = height * H;
    return {
      left, top, width: w, height: h,
      u: f => left + m + f * (w - 2 * m),
      v: f => top + m + (1 - f) * (h - 2 * m)
    };
  }

  const num = x => String(Math.round(x * 100) / 100);
  // One line of text, centered vertically on y as ggplot2's vjust = 0.5 (Arial's capitals are 0.716 em tall).
  // o: pt, color, bold, italic, anchor ('start', 'middle' or 'end'), halo { color, opacity, width }, spacing.
  function text(s, x, y, o) {
    const pt = o.pt;
    const attrs = ['x="' + num(x) + '"', 'y="' + num(y + 0.358 * pt) + '"', 'font-size="' + num(pt) + '"',
      'fill="' + esc(o.color) + '"'];
    if (o.bold) attrs.push('font-weight="bold"');
    if (o.italic) attrs.push('font-style="italic"');
    if (o.anchor && o.anchor !== 'start') attrs.push('text-anchor="' + o.anchor + '"');
    if (o.spacing) attrs.push('letter-spacing="' + num(o.spacing) + '"');
    if (o.halo) {
      attrs.push('stroke="' + esc(o.halo.color) + '"', 'stroke-opacity="' + o.halo.opacity + '"',
        'stroke-width="' + num(o.halo.width) + '"', 'stroke-linejoin="round"', 'paint-order="stroke"');
    }
    return '<text ' + attrs.join(' ') + '>' + esc(s) + '</text>';
  }
  // Colors are written through esc(): a facility manifest's color is text from a file.
  function rect(x, y, w, h, fill, stroke, strokeWidth) {
    return '<rect x="' + num(x) + '" y="' + num(y) + '" width="' + num(w) + '" height="' + num(h) + '" fill="' +
      esc(fill) + '"' + (stroke ? ' stroke="' + esc(stroke) + '" stroke-width="' + num(strokeWidth) + '"' : '') + '/>';
  }
  function line(x1, y1, x2, y2, color, width) {
    return '<line x1="' + num(x1) + '" y1="' + num(y1) + '" x2="' + num(x2) + '" y2="' + num(y2) +
      '" stroke="' + esc(color) + '" stroke-width="' + num(width) + '"/>';
  }
  // A ggplot2 shape-21 point: fill (with its opacity), white or colored border. Given a facility layer's shape (UI
  // pass), the same size, fill and border in that shape (facilities.js markPath; a circle stays a circle).
  function circle(x, y, size, stroke, fill, fillOpacity, border, shape) {
    if (shape && shape !== 'circle') {
      return '<path d="' + root.WSDA.facilities.markPath(shape, x, y, pointRadius(size, stroke)) + '" fill="' +
        esc(fill) + '" fill-opacity="' + num(fillOpacity) + '" stroke="' + esc(border) + '" stroke-width="' +
        num(pointBorder(stroke)) + '" stroke-linejoin="round"/>';
    }
    return '<circle cx="' + num(x) + '" cy="' + num(y) + '" r="' + num(pointRadius(size, stroke)) + '" fill="' +
      esc(fill) + '" fill-opacity="' + num(fillOpacity) + '" stroke="' + esc(border) + '" stroke-width="' +
      num(pointBorder(stroke)) + '"/>';
  }
  // A white box with CVI's gray border (plot.background fill white, color #bbbbbb, linewidth 0.4).
  const box = p => rect(p.left, p.top, p.width, p.height, '#ffffff', '#bbbbbb', linePt(0.4));

  // ── Header (SMR 1648-1679), logo (SMR 3123-3126, 3185-3188) ─────────────────────────────────────────────────
  // The title's size steps down by its length (SMR 1651-1655).
  function titleSize(title) {
    const n = Array.from(title).length;
    return n > 95 ? 2.9 : n > 80 ? 3.4 : n > 65 ? 3.9 : n > 50 ? 4.3 : 4.6;
  }
  // The teal header band: "ANIMAL SERVICES | title", with the agency name above it when the style asks (agencyName).
  function header(title, style) {
    const h = LAYOUT.headerH * H;
    const servicesPt = textPt(4.6);
    const shift = style.headerGap ? HEADER_SHIFT : 0;
    const servicesRight = px(0.295 + shift);
    // agencyName moves "ANIMAL SERVICES | title" a little down to make room for the agency name above it.
    const rowY = style.agencyName ? h * 0.58 : h * 0.5;
    const parts = [rect(0, 0, W, h, TEAL)];
    if (style.agencyName) {
      const left = servicesRight - textWidth('ANIMAL SERVICES', servicesPt, true);
      parts.push(text(AGENCY, left, h * 0.25, { pt: 6.5, color: '#ffffff', spacing: 0.6 }));
    }
    parts.push(text('ANIMAL SERVICES', servicesRight, rowY, { pt: servicesPt, color: '#ffffff', bold: true,
      anchor: 'end' }));
    parts.push(text('|', px(0.305 + shift), rowY, { pt: textPt(5), color: '#ffffff', anchor: 'middle' }));
    parts.push(text(title, px(0.315 + shift), rowY, { pt: textPt(titleSize(title)), color: '#ffffff', bold: true }));
    return parts.join('');
  }
  // The logo, kept in proportion and centered in CVI's box (rasterGrob's default), drawn last as CVI does.
  function logo() {
    const L = root.WSDA.brand.LOGO;
    const h = LAYOUT.headerH * H;
    return '<image x="' + num(px(LAYOUT.logoX)) + '" y="' + num(h * 0.06) + '" width="' + num(px(LAYOUT.logoW)) +
      '" height="' + num(h * 0.88) + '" preserveAspectRatio="xMidYMid meet" href="' + L.dataUrl + '"/>';
  }

  // ── Meta and stat rows ──────────────────────────────────────────────────────────────────────────────────────
  // "Data Range: …" on the left, "Last Updated: MM/DD/YYYY" on the right of the map area (SMR 3155-3160).
  function metaRow(left, right, style) {
    const y = py(LAYOUT.metaY);
    return text(left, px(0.01), y, { pt: 9, color: '#555555' }) +
      text(right, px(LAYOUT.mapW - 0.005), y, { pt: 9, color: style.darkerGrays ? '#555555' : '#777777',
        italic: true, anchor: 'end' });
  }
  // "Last Updated: MM/DD/YYYY" for a date (CVI prints today's date).
  function updated(date) {
    const d = date || new Date();
    const two = n => String(n).padStart(2, '0');
    return 'Last Updated: ' + two(d.getMonth() + 1) + '/' + two(d.getDate()) + '/' + d.getFullYear();
  }
  // The stat row (13 pt, bold prefix and plain value): `left` items placed from the left edge, `right` items placed
  // from the map's right edge leftward (the last item is rightmost), with CVI's gaps (WA State's by default, SMR
  // 3138-3152; gaps: { same, next } as page fractions). CVI places them with fixed per-character widths; the page
  // uses Arial's widths.
  function statRow(left, right, gaps) {
    const y = py(LAYOUT.statY);
    const pt = 13;
    const gapSame = px(gaps ? gaps.same : 0.006);
    const gapNext = px(gaps ? gaps.next : 0.022);
    const parts = [];
    let x = px(0.01);
    for (const s of left) {
      parts.push(text(s.prefix, x, y, { pt, color: '#222222', bold: true }));
      x += textWidth(s.prefix, pt, true) + gapSame;
      parts.push(text(s.value, x, y, { pt, color: '#222222' }));
      x += textWidth(s.value, pt) + gapNext;
    }
    let r = px(LAYOUT.mapW - 0.010);
    for (const s of right.slice().reverse()) {
      parts.push(text(s.value, r, y, { pt, color: '#222222', anchor: 'end' }));
      r -= textWidth(s.value, pt) + gapSame;
      parts.push(text(s.prefix, r, y, { pt, color: '#222222', bold: true, anchor: 'end' }));
      r -= textWidth(s.prefix, pt, true) + gapNext;
    }
    return parts.join('');
  }

  // ── Gutter boxes ────────────────────────────────────────────────────────────────────────────────────────────
  // A ranked box's section, as CVI's draw_section (SMR 2763-2789): a colored header row, one row per entry (label
  // left, value right), a divider and a bold Total row; rh = h / (n + 2). p is the box's panel (margin 0). Text
  // sizes (ggplot2's) are WA State's unless s.titleSize and s.rowSize say otherwise (Flow: 3.6 and 3.2).
  function rankSection(p, s) {
    const n = s.rows.length;
    const rh = s.height / (n + 2);
    const pt = textPt(s.rowSize || 3.3);
    const parts = [rect(p.u(0), p.v(s.top), p.u(1) - p.u(0), p.v(s.top - rh) - p.v(s.top), s.color)];
    parts.push(text(s.title, p.u(0.5), p.v(s.top - rh / 2), { pt: textPt(s.titleSize || 3.4), color: '#ffffff',
      bold: true,
      anchor: 'middle' }));
    s.rows.forEach((r, i) => {
      const y = p.v(s.top - rh - (i + 0.5) * rh);
      parts.push(text(r.label, p.u(0.10), y, { pt, color: '#222222' }));
      parts.push(text(r.value, p.u(0.90), y, { pt, color: '#222222', anchor: 'end' }));
    });
    // No total row when the values do not add up (s.total null: animals per square mile).
    if (s.total === null) return parts.join('');
    const divider = s.top - rh - n * rh;
    parts.push(line(p.u(0.06), p.v(divider), p.u(0.94), p.v(divider), '#bbbbbb', linePt(0.3)));
    parts.push(text('Total', p.u(0.10), p.v(divider - rh / 2), { pt, color: '#222222', bold: true }));
    parts.push(text(s.total, p.u(0.90), p.v(divider - rh / 2), { pt, color: '#222222', bold: true,
      anchor: 'end' }));
    return parts.join('');
  }

  // ── The legend column (a deliberate difference: legendBySize) ───────────────────────────────────────────────
  // A legend box at the gutter's bottom whose entries are stacked from the top down. Entries:
  //   { text, pt, color, bold, italic }        one centered line
  //   { circle: { size, stroke, fill, opacity }, label, labelPt }   a sample circle with its label on the right
  //   { bar: { width, color }, label, labelPt }  a sample line (width in points) with its label on the right
  //   { rule: true }                           a thin divider (or { rule: { color, width, x0, x1 } })
  //   { sample: { height, draw(x, y) }, label, labelPt }   any other sample (draw returns its markup at x, y)
  //   { across: [{ size, stroke, fill, opacity, label }], labelPt }   sample circles side by side, bottoms lined up,
  //                                            each label under its circle (for a box too short for a column)
  // Circle and line rows may give x (the sample's place) and labelX (the label's), as fractions of the box. A label
  // may be a list of lines, stacked and centered on the row.
  //   { flex: true }                           a space that takes an equal share of the height left over
  //   { gap: points }                          a fixed space (under a heading whose first row would sit too close)
  // Each circle or line row is as tall as its sample plus a small gap, so samples never overlap (legendBySize; CVI
  // spaces its rows evenly and large samples overlap). The box is at least o.minH high (CVI's height, a page fraction)
  // and grows up to o.maxH. When even o.maxH is too small, the rows are drawn closer by one factor (`squeezed`), and
  // `overlap` says whether any two neighboring samples then touch. o: bottom, minH, maxH (page fractions); x (the box's
  // left, by default the gutter's), width (by default the gutter's), frame (branded.frame() of another page size). A
  // row may ask a least height (minH, points), kept only while every row fits. Returns the box's height, its markup and
  // each circle's place.
  const ROW_GAP = 2;
  // A divider's row, 8 points: the line 2 points from its top, so 6 points clear below it (a heading right under a
  // divider needs room; the line was in the middle, 4 points each side). The row's height is unchanged, so no legend's
  // layout changes.
  const RULE_H = 8;
  const RULE_AT = 2;
  const RULE_EXTRA = 6;
  const MARGIN = 5;
  function legendColumn(entries, o) {
    const acrossH = e => Math.max(...e.across.map(c => 2 * pointRadius(c.size, c.stroke))) + e.labelPt * 1.4;
    const reach = c => (c.shape && root.WSDA.facilities ? root.WSDA.facilities.MARK_EXTENT[c.shape] || 1 : 1);
    const sample = e => (e.circle ? 2 * pointRadius(e.circle.size, e.circle.stroke) * reach(e.circle) : e.bar ? e.bar.width
      : e.sample ? e.sample.height : e.across ? acrossH(e) : null);
    const labelLines = e => (Array.isArray(e.label) ? e.label.length : 1);
    const fr = o.frame || { panel, H };
    let least = true;
    const height = e => (e.text !== undefined ? e.pt * 1.3
      : e.gap !== undefined ? e.gap
      : sample(e) !== null ? Math.max(sample(e), e.labelPt * 1.2 * labelLines(e), least && e.minH || 0) + ROW_GAP
        : e.rule ? RULE_H : 0);
    const isRow = e => sample(e) !== null;
    const fixed = entries.filter(e => !isRow(e)).reduce((s, e) => s + height(e), 0);
    let rows = entries.filter(isRow).reduce((s, e) => s + height(e), 0);
    let needed = fixed + rows + 2 * MARGIN + 2;
    if (needed > o.maxH * fr.H && entries.some(e => e.minH)) {
      least = false;
      rows = entries.filter(isRow).reduce((s, e) => s + height(e), 0);
      needed = fixed + rows + 2 * MARGIN + 2;
    }
    const boxH = Math.max(o.minH * fr.H, Math.min(o.maxH * fr.H, needed));
    // Spare height is shared by the flex spaces and the gaps between neighboring sample rows (as CVI spreads its
    // rows over the box), so rows stay at least as far apart as their sizes need.
    const between = entries.filter((e, i) => i > 0 && isRow(e) && isRow(entries[i - 1])).length;
    // A divider with a heading under it takes a share too, at most RULE_EXTRA points.
    const underRule = (e, i) => e.rule && entries[i + 1] && entries[i + 1].text !== undefined;
    const flex = entries.filter(e => e.flex).length + between + entries.filter(underRule).length;
    const spare = boxH - needed;
    // Rows drawn closer only when the tallest box is still too small.
    // A side-by-side row of size samples keeps its height (squeezed, its largest circle would reach into the heading
    // above it), as does a row marked `keep`; the other rows are drawn closer instead.
    const keeps = e => e.across || e.keep;
    const keptRows = entries.filter(keeps).reduce((t, e) => t + height(e), 0);
    const squeezable = rows - keptRows;
    const squeeze = spare < 0 && squeezable > 0 ? Math.max(0, (squeezable + spare) / squeezable) : 1;
    const flexH = spare > 0 ? spare / Math.max(1, flex) : 0;
    const p = fr.panel(gutterXOf(o), o.bottom, o.width === undefined ? LAYOUT.gutterW : o.width, boxH / fr.H, MARGIN);
    const parts = [box(p)];
    const placed = [];
    let y = p.top + MARGIN + 1;
    entries.forEach((e, i) => {
      if (i > 0 && isRow(e) && isRow(entries[i - 1])) y += flexH;
      if (i > 0 && underRule(entries[i - 1], i - 1)) y += Math.min(flexH, RULE_EXTRA);
      if (e.flex) {
        y += flexH;
        return;
      }
      const h = isRow(e) && !keeps(e) ? height(e) * squeeze : height(e);
      const mid = y + h / 2;
      if (e.text !== undefined) {
        parts.push(text(e.text, p.u(0.5), mid, { pt: e.pt, color: e.color, bold: e.bold, italic: e.italic,
          anchor: 'middle' }));
      } else if (e.circle) {
        const c = e.circle;
        parts.push(circle(p.u(e.x === undefined ? 0.22 : e.x), mid, c.size, c.stroke, c.fill, c.opacity, '#ffffff',
          c.shape));
        parts.push(text(e.label, p.u(e.labelX === undefined ? 0.42 : e.labelX), mid, { pt: e.labelPt,
          color: '#444444' }));
        placed.push({ x: p.u(e.x === undefined ? 0.22 : e.x), y: mid, r: pointRadius(c.size, c.stroke), label: e.label });
      } else if (e.bar) {
        parts.push('<line x1="' + num(p.u(0.06)) + '" y1="' + num(mid) + '" x2="' + num(p.u(0.40)) + '" y2="' +
          num(mid) + '" stroke="' + esc(e.bar.color) + '" stroke-width="' + num(e.bar.width) +
          '" stroke-linecap="round"/>');
        // The label starts past the line's round cap, so a thick line never runs into it.
        const labelX = Math.max(p.u(0.46), p.u(0.40) + e.bar.width / 2 + 3);
        parts.push(text(e.label, labelX, mid, { pt: e.labelPt, color: '#444444' }));
        placed.push({ x: p.u(0.23), y: mid, r: e.bar.width / 2, label: e.label, labelX, capX: p.u(0.40) + e.bar.width / 2 });
      } else if (e.across) {
        // Slots as wide as each circle or its label, 4 points apart, the row centered in the box.
        const items = e.across.map(c => {
          const r = pointRadius(c.size, c.stroke);
          return Object.assign({ r, slot: Math.max(2 * r, textWidth(c.label, e.labelPt) + 2) }, c);
        });
        const total = items.reduce((t, c) => t + c.slot, 0) + 4 * (items.length - 1);
        let x = p.u(0.5) - total / 2;
        const base = y + h - ROW_GAP - e.labelPt * 1.4;
        for (const c of items) {
          const cx = x + c.slot / 2;
          parts.push(circle(cx, base - c.r, c.size, c.stroke, c.fill, c.opacity, '#ffffff'));
          parts.push(text(c.label, cx, base + e.labelPt * 0.75, { pt: e.labelPt, color: '#444444', anchor: 'middle' }));
          placed.push({ x: cx, y: base - c.r, r: c.r, label: c.label, across: true });
          x += c.slot + 4;
        }
              } else if (e.sample) {
        parts.push(e.sample.draw(p.u(e.x === undefined ? 0.22 : e.x), mid));
        const lines = Array.isArray(e.label) ? e.label : [e.label];
        lines.forEach((t, k) => parts.push(text(t, p.u(e.labelX === undefined ? 0.42 : e.labelX),
          mid + (k - (lines.length - 1) / 2) * e.labelPt * 1.15, { pt: e.labelPt, color: '#444444' })));
        placed.push({ x: p.u(e.x === undefined ? 0.22 : e.x), y: mid, r: e.sample.height / 2, label: lines.join(' ') });
      } else if (e.rule) {
        const r = e.rule === true ? { color: '#dddddd', width: 0.4, x0: 0.08, x1: 0.92 } : e.rule;
        parts.push(line(p.u(r.x0), y + RULE_AT, p.u(r.x1), y + RULE_AT, r.color, linePt(r.width)));
      }
      y += h;
    });
    // Did any two neighboring samples end up touching (only possible when the rows were drawn closer)?
    const overlap = placed.some((c, i) => i > 0 && Math.hypot((c.x || 0) - (placed[i - 1].x || 0),
      c.y - placed[i - 1].y) < c.r + placed[i - 1].r - 1e-9);
    return { height: boxH / fr.H, parts: parts.join(''), circles: placed, overlap, squeezed: squeeze < 1, squeeze,
      fits: spare >= 0, least, box: { left: p.left, top: p.top, width: p.width, height: p.height } };
  }
  // A legend box's left edge: o.x, else the gutter's.
  const gutterXOf = o => (o.x === undefined ? LAYOUT.gutterX : o.x);

  // ── Another page size (Facilities' Report style) ───────────────────────────────────────────────────────────
  // The page helpers for a page of any size: px and py turn page fractions into points, panel places a region.
  function frame(page) {
    const fw = page.widthIn * 72;
    const fh = page.heightIn * 72;
    const fpx = f => f * fw;
    const fpy = f => (1 - f) * fh;
    function fpanel(x, y, width, height, marginPt) {
      const m = marginPt || 0;
      const left = fpx(x);
      const top = fpy(y + height);
      const w = fpx(width);
      const h = height * fh;
      return {
        left, top, width: w, height: h,
        u: f => left + m + f * (w - 2 * m),
        v: f => top + m + (1 - f) * (h - 2 * m)
      };
    }
    return { page, W: fw, H: fh, px: fpx, py: fpy, panel: fpanel };
  }

  // ── The Facilities tile grid (.build_facilities_topline_grid, SMR 80-117) ──────────────────────────────────
  // One colored tile per entry ({ label, value, color }), six to a row, rows from the top and the last row
  // left-aligned; the value bold (ggplot2 size 3.8) over the label (2.8), both white; labels longer than 16
  // characters cut to 15 and "...". x, y, width, height: the grid's region as page fractions.
  function tileGrid(tiles, x, y, width, height, ncol) {
    const n = tiles.length;
    if (!n) return { parts: '', rows: 0, tiles: [] };
    const cols = Math.max(1, Math.min(ncol || 6, n));
    const rows = Math.ceil(n / cols);
    const gapX = 0.012;
    const gapY = 0.16;
    const w = (1 - gapX * (cols - 1)) / cols;
    const h = (1 - gapY * (rows - 1)) / rows;
    const p = panel(x, y, width, height, 0);
    // A name longer than 16 characters cut to 15 and "...".
    const cut = s => (Array.from(String(s)).length > 16 ? Array.from(String(s)).slice(0, 15).join('') + '...' : String(s));
    const parts = [];
    const placed = [];
    tiles.forEach((t, i) => {
      const x0 = (i % cols) * (w + gapX);
      const yTop = 1 - Math.floor(i / cols) * (h + gapY);
      const label = cut(t.label);
      parts.push(rect(p.u(x0), p.v(yTop), p.u(x0 + w) - p.u(x0), p.v(yTop - h) - p.v(yTop), t.color || TEAL));
      parts.push(text(String(t.value), p.u(x0 + w / 2), p.v(yTop - h + h * 0.62), { pt: textPt(3.8),
        color: '#ffffff', bold: true, anchor: 'middle' }));
      parts.push(text(label, p.u(x0 + w / 2), p.v(yTop - h + h * 0.26), { pt: textPt(2.8), color: '#ffffff',
        anchor: 'middle' }));
      placed.push({ label, value: String(t.value), color: t.color || TEAL, x: p.u(x0), y: p.v(yTop),
        width: p.u(x0 + w) - p.u(x0), height: p.v(yTop - h) - p.v(yTop) });
    });
    return { parts: parts.join(''), rows, tiles: placed };
  }

  // ── Value boxes (County Focus and, later, Premise Lookup; SMR 46-70) ──────────────────────────────────────────
  // Tiles side by side in a region of the page (x, y, width, height as page fractions): each a colored box with its
  // value (bold, ggplot2 size 5.2) over its label (2.7), both white; a gap of 0.035 of the region between tiles.
  function valueBoxes(stats, x, y, width, height) {
    const p = panel(x, y, width, height, 0);
    const n = stats.length;
    const gap = 0.035;
    const w = (1 - gap * (n - 1)) / n;
    const parts = [];
    stats.forEach((s, i) => {
      const x0 = i * (w + gap);
      parts.push(rect(p.u(x0), p.v(1), p.u(x0 + w) - p.u(x0), p.v(0) - p.v(1), s.color));
      parts.push(text(s.value, p.u(x0 + w / 2), p.v(0.62), { pt: textPt(5.2), color: '#ffffff', bold: true,
        anchor: 'middle' }));
      parts.push(text(s.label, p.u(x0 + w / 2), p.v(0.26), { pt: textPt(2.7), color: '#ffffff', anchor: 'middle' }));
    });
    return parts.join('');
  }

  // ── The gutter scale bar (County Focus; SMR 181-221) ───────────────────────────────────────────────────────
  // A "nice" round number: 1, 2 or 5 times a power of ten, not above x (SMR 158-163).
  function niceRound(x) {
    if (!Number.isFinite(x) || x <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(x)));
    const f = x / p;
    return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * p;
  }
  // The bar for a gutter box whose full width shows fullKm kilometers at the map's scale: about half the box,
  // at most 74%, km above and miles below. Returns null when fullKm is not a positive number.
  function scaleBarSpec(fullKm) {
    if (!Number.isFinite(fullKm) || fullKm <= 0) return null;
    let km = niceRound(fullKm * 0.5);
    let frac = km / fullKm;
    if (frac > 0.74) {
      km = niceRound(fullKm * 0.74);
      frac = km / fullKm;
    }
    frac = Math.min(frac, 0.74);
    const mi = km * 0.621371;
    return { km, frac, kmLabel: String(km) + ' km', miLabel: (mi >= 10 ? mi.toFixed(0) : mi.toFixed(1)) + ' mi' };
  }
  // The scale bar's box (x, y, width, height as page fractions; CVI's margins 2 and 4 points), the bar centered.
  function scaleBar(spec, x, y, width, height) {
    const outer = panel(x, y, width, height, 0);
    const left = outer.left + 4;
    const top = outer.top + 2;
    const w = outer.width - 8;
    const h = outer.height - 4;
    const u = f => left + f * w;
    const v = f => top + (1 - f) * h;
    const xl = (1 - spec.frac) / 2;
    const xr = xl + spec.frac;
    const lw = linePt(0.7);
    const pt = textPt(2.5);
    return box(outer) + line(u(xl), v(0.5), u(xr), v(0.5), '#444444', lw) +
      line(u(xl), v(0.34), u(xl), v(0.66), '#444444', lw) + line(u(xr), v(0.34), u(xr), v(0.66), '#444444', lw) +
      // km sits on its line above the bar (vjust 0), miles hang below it (vjust 1).
      text(spec.kmLabel, u(0.5), v(0.76) - 0.358 * pt, { pt, color: '#444444', anchor: 'middle' }) +
      text(spec.miLabel, u(0.5), v(0.24) + 0.358 * pt, { pt, color: '#444444', anchor: 'middle' });
  }

  // Text broken into lines no wider than maxWidth points (at word breaks; a longer word keeps its own line).
  function wrapText(s, pt, maxWidth, bold) {
    const out = [];
    let cur = '';
    for (const word of String(s).split(/\s+/).filter(Boolean)) {
      const next = cur ? cur + ' ' + word : word;
      if (cur && textWidth(next, pt, bold) > maxWidth) {
        out.push(cur);
        cur = word;
      } else {
        cur = next;
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  // ── The highlighted line (MC chart filters that highlight) ─────────────────────────────────────────────────
  // "Highlighted: Spotlight: King, Pierce; Corridor: …" under the stat row, as Stats and export_params.json name the
  // chart filters; cut with "…" to the map's width.
  function highlightLine(chips) {
    if (!chips || !chips.length) return '';
    const pt = 9;
    const room = px(LAYOUT.mapW - 0.02);
    let s = 'Highlighted: ' + chips.join('; ');
    if (textWidth(s, pt) > room) {
      const chars = Array.from(s);
      while (chars.length && textWidth(chars.join('') + '…', pt) > room) chars.pop();
      s = chars.join('') + '…';
    }
    return text(s, px(0.01), py(LAYOUT.statY - 0.034), { pt, color: '#555555' });
  }

  // ── Footnote and source line (sourceLine) ───────────────────────────────────────────────────────────────────
  // CVI writes "Basemap: …" at the bottom left only when tiles are drawn (SMR 3188-3196: 6.5 pt italic #888888).
  // sourceLine puts a source line there on every page, with the basemap credit joined; darkerGrays darkens its gray.
  function footnote(source, basemap, style) {
    const parts = [];
    if (style.sourceLine && source) parts.push(source);
    if (basemap) parts.push('Basemap: ' + basemap);
    if (!parts.length) return '';
    return text(parts.join(' · '), px(0.005), py(0.008), { pt: 6.5, italic: true,
      color: style.darkerGrays ? '#666666' : '#888888' });
  }
  // The color of names on the maps (darkNames).
  const nameColor = style => (style.darkNames ? '#222222' : '#8a8a8a');

  // ── Geometry: Web Mercator (a deliberate difference) ────────────────────────────────────────────────────────
  const RAD = Math.PI / 180;
  const mercX = lon => lon * RAD;
  const mercY = lat => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));
  // A projection that fits a longitude/latitude box into a page box (points), kept in proportion and centered, as
  // ggplot2 centers a fixed-aspect panel in its region.
  function fitMercator(bounds, target) {
    const x0 = mercX(bounds.west);
    const x1 = mercX(bounds.east);
    const y0 = mercY(bounds.south);
    const y1 = mercY(bounds.north);
    const k = Math.min(target.width / (x1 - x0), target.height / (y1 - y0));
    const ox = target.left + (target.width - (x1 - x0) * k) / 2;
    const oy = target.top + (target.height - (y1 - y0) * k) / 2;
    const project = (lon, lat) => [ox + (mercX(lon) - x0) * k, oy + (y1 - mercY(lat)) * k];
    // A page point back to longitude and latitude.
    const unproject = (x, y) => [(x0 + (x - ox) / k) / RAD,
      (2 * Math.atan(Math.exp(y1 - (y - oy) / k)) - Math.PI / 2) / RAD];
    return {
      project, unproject,
      scale: k,
      box: { left: ox, top: oy, width: (x1 - x0) * k, height: (y1 - y0) * k }
    };
  }
  // A Polygon or MultiPolygon as SVG path data through a projection.
  function pathData(geometry, project) {
    const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    const out = [];
    for (const poly of polys) {
      for (const ring of poly) {
        ring.forEach((c, i) => {
          const p = project(c[0], c[1]);
          out.push((i ? 'L' : 'M') + num(p[0]) + ' ' + num(p[1]));
        });
        out.push('Z');
      }
    }
    return out.join('');
  }
  // Line parts (each a list of [lon, lat]) as SVG path data through a projection.
  function lineData(parts, project) {
    const out = [];
    for (const part of parts) {
      part.forEach((c, i) => {
        const p = project(c[0], c[1]);
        out.push((i ? 'L' : 'M') + num(p[0]) + ' ' + num(p[1]));
      });
    }
    return out.join('');
  }
  // Is a page point inside a projected Polygon or MultiPolygon (even-odd rule)?
  function insideGeometry(geometry, project, x, y) {
    const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    let inside = false;
    for (const poly of polys) {
      for (const ring of poly) {
        const pts = ring.map(c => project(c[0], c[1]));
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, yi] = pts[i];
          const [xj, yj] = pts[j];
          if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
      }
    }
    return inside;
  }
  // The longitude/latitude box of a list of GeoJSON features.
  function bounds(features) {
    const b = { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity };
    for (const f of features) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) {
        for (const c of poly[0]) {
          b.west = Math.min(b.west, c[0]);
          b.east = Math.max(b.east, c[0]);
          b.south = Math.min(b.south, c[1]);
          b.north = Math.max(b.north, c[1]);
        }
      }
    }
    return b;
  }

  // ── The WA locator inset (County Focus; SMR 4826-4847, placed at 4452-4456) ─────────────────────────────────
  // Every county light gray with white lines, the focus counties in style.insetFocus (a deliberate difference:
  // WSDA Dark Blue in place of CVI's #1f77b4), in a white box with a #aab4bb border.
  // at: { x, y } (page fractions), CVI's bottom right by default.
  function inset(counties, focusNames, style, at) {
    const p = panel(at ? at.x : LAYOUT.mapW - 0.130 - 0.008, at ? at.y : 0.030, 0.130, 0.0715, 0);
    const pad = 2;
    const fit = fitMercator(bounds(counties), { left: p.left + pad, top: p.top + pad, width: p.width - 2 * pad,
      height: p.height - 2 * pad });
    const focus = new Set(focusNames.map(n => String(n).trim().toLowerCase()));
    const parts = [rect(p.left, p.top, p.width, p.height, '#ffffff', '#aab4bb', linePt(0.5))];
    for (const f of counties) {
      const on = focus.has(String(f.properties.name).trim().toLowerCase());
      parts.push('<path d="' + pathData(f.geometry, fit.project) + '" fill="' + (on ? style.insetFocus : '#e8eaed') +
        '" stroke="#ffffff" stroke-width="' + num(linePt(on ? 0.4 : 0.25)) + '"/>');
    }
    return parts.join('');
  }

  // Map content cut to its panel, as ggplot2 clips a panel (coord_sf with expand = FALSE). id: unique in the page.
  function clipped(id, b, content) {
    return '<clipPath id="' + id + '">' + rect(b.left, b.top, b.width, b.height, '#ffffff') + '</clipPath>' +
      '<g clip-path="url(#' + id + ')">' + content + '</g>';
  }

  // ── The page ────────────────────────────────────────────────────────────────────────────────────────────────
  const styleOf = opts => Object.assign({}, DEFAULTS, opts || {});
  // The page's SVG markup from its parts (each SVG markup in page points), drawn in CVI's order: the map, the header
  // over it, the rows, the gutter boxes, then the logo. size: the PNG's pixel size (width, height).
  // With o.transparent the page has no white ground, so a background drawn first shows through (png's underlay).
  // o.page: another page size (Facilities' Report style), in inches.
  function svg(parts, size, o) {
    const page = (o && o.page) || PAGE;
    const s = size || pixelSize(DPI.standard, page);
    const pw = page.widthIn * 72;
    const ph = page.heightIn * 72;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + s.width + '" height="' + s.height +
      '" viewBox="0 0 ' + pw + ' ' + ph + '" font-family="' + FONT + '">' +
      (o && o.transparent ? '' : rect(0, 0, pw, ph, '#ffffff')) + parts.join('') + '</svg>';
  }
  // A page's size in pixels at a resolution in dots per inch.
  const pixelSize = (dpi, page) => {
    const p = page || PAGE;
    return { width: Math.round(p.widthIn * dpi), height: Math.round(p.heightIn * dpi) };
  };

  // PNG bytes with their resolution recorded: a pHYs chunk after IHDR in pixels per meter (as chartsvg.js), so Word
  // and PowerPoint place the picture at 11 x 8.5 inches. crc32 is shared/zip.js's.
  function pngWithDpi(bytes, dpi, crc32) {
    const IHDR_END = 8 + 4 + 4 + 13 + 4;
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
  // The page's SVG markup drawn by the browser into a canvas of size.width x size.height pixels on white.
  // underlay (a tile background, tiles.js): { image, box (page points), mask (SVG path data in page points),
  // pageWidth (points, for another page size) }: the image is drawn into the box first, cut to the mask, under a
  // transparent page (svg's o.transparent). Rejects with a plain message when the browser cannot draw it.
  function draw(markup, size, underlay) {
    const failure = () => new Error('The branded map picture could not be drawn.');
    return new Promise((resolve, reject) => {
      const img = new root.Image();
      const url = root.URL.createObjectURL(new root.Blob([markup], { type: 'image/svg+xml' }));
      const fail = () => {
        root.URL.revokeObjectURL(url);
        reject(failure());
      };
      img.onerror = fail;
      img.onload = () => {
        try {
          const canvas = root.document.createElement('canvas');
          canvas.width = size.width;
          canvas.height = size.height;
          // Drawn once and read once, in ordinary memory (away from the maps' WebGL drawing), as chartsvg.js.
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, size.width, size.height);
          if (underlay) {
            const k = size.width / (underlay.pageWidth || W);
            ctx.save();
            ctx.scale(k, k);
            ctx.clip(new root.Path2D(underlay.mask.join(' ')));
            const b = underlay.box;
            ctx.drawImage(underlay.image, b.left, b.top, b.width, b.height);
            ctx.restore();
          }
          ctx.drawImage(img, 0, 0, size.width, size.height);
          root.URL.revokeObjectURL(url);
          resolve(canvas);
        } catch (e) {
          fail();
        }
      };
      img.src = url;
    });
  }
  // The page as a PNG Blob, with dpi recorded in it (see draw()).
  function png(markup, size, dpi, underlay) {
    const failure = () => new Error('The branded map picture could not be drawn.');
    return draw(markup, size, underlay).then(canvas => new Promise((resolve, reject) => {
      try {
        canvas.toBlob(b => {
          if (!b) {
            reject(failure());
            return;
          }
          b.arrayBuffer().then(buf => resolve(new root.Blob([pngWithDpi(new Uint8Array(buf), dpi,
            root.WSDA.zip.crc32)], { type: 'image/png' })), () => reject(failure()));
        }, 'image/png');
      } catch (e) {
        reject(failure());
      }
    }));
  }
  // The page's pixels (ImageData: RGBA, opaque), for the time-series GIF (see draw()).
  function pixels(markup, size, underlay) {
    return draw(markup, size, underlay).then(canvas => canvas.getContext('2d').getImageData(0, 0, size.width,
      size.height));
  }

  root.WSDA = root.WSDA || {};
  root.WSDA.branded = {
    PAGE, REPORT_PAGE, W, H, DPI, LAYOUT, DEFAULTS, CVI_STYLE, AGENCY, FONT, HEADER_SHIFT, TEAL,
    textPt, linePt, pointRadius, pointBorder, textWidth, esc, num,
    px, py, panel, text, rect, line, circle, box,
    titleSize, header, logo, metaRow, updated, statRow, rankSection, legendColumn, footnote, nameColor,
    valueBoxes, tileGrid, frame, niceRound, scaleBarSpec, scaleBar, wrapText, highlightLine,
    mercX, mercY, fitMercator, pathData, lineData, insideGeometry, bounds, inset, clipped,
    styleOf, svg, pixelSize, pngWithDpi, draw, png, pixels
  };
})(typeof window !== 'undefined' ? window : globalThis);
