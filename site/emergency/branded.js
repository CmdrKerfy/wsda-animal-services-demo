/* Emergency Response's branded PNG (E1b): the map picture for a briefing, 11 x 8.5 in at 200 or 300 dpi, on the
 * shared branded page (site/shared/branded.js).
 *
 * A copy of Premise Lookup's branded proximity page: site/cvi/app/brandedmaps.js proximity() (lines 2775 to 3119,
 * v2.0) with the helpers it does not export or that change (proximityPanelRows, proximityPanelParts, keyLines,
 * proximityKeyColumn, proximityInset and the shape sizes, lines 2364 to 2768; touchesBox and boxesMeet, lines 441 to
 * 448). Each piece keeps its shape, so a
 * later fix to the original can be carried over. The helpers brandedmaps.js exports are called unchanged (the page
 * loads it, with shared/branded.js, tiles.js and labels.js, as the Infrastructure page does). The copy's changes:
 *   - the title from the type ("HPAI RESPONSE MAP", "NEW WORLD SCREWWORM RESPONSE MAP"), the period line
 *     "Detected between ... and ...", the meta line naming the zones in both units and "As of" the window's end;
 *   - the panel "POSITIVES" in place of "QUERY SITES": one row per positive with zones (or per zone-file zone), its
 *     count the sites inside its zones, its lines the county and the days since the last positive (in place of CVI's
 *     matched origins and destinations);
 *   - each positive in its status color (CVI: one red bullseye), past ones hollow and faded (only when shown), added
 *     points in the page's pick color; the rings in the type's colors (CVI: three ring colors by radius), past rings
 *     gray and dashed, a zone file's zones in the live map's zone color; the key's ring rows "Infection zone (3 km)"
 *     in both units (the page's first), the key's layer rows with their counts in a right-hand column under "SITES
 *     INSIDE" (CVI: "Layer: 8 inside" after the name); in the panel each row as tall as its lines, at most 1.2 times
 *     CVI's size, the days in italics, a zone's long name on up to three lines and no county line for a zone, a
 *     positive's long name drawn smaller before it is cut;
 *   - the boxes: the current positives and the sites inside, with a CVI master also the CVIs and animals matched
 *     (CVI's facilities-only page: sites, facilities and layers); the panel's footer one row, "Positives with a site
 *     inside: 6 of 6" (CVI: three); with a master, the CVI premises with an origin or a destination in a zone drawn
 *     hollow (CVI: filled dots), under "CVI PREMISES" in the key with the CVI tab's years;
 *   - a facilities-only input (no CVI query fields); the backgrounds Default and the tile backgrounds (the Streets,
 *     population and county-page branches are left out); no facility names (no control asks for them);
 *   - the sensitive-data line above the source line; the file name emergency_<type>_YYYY-MM-DD.png.
 *
 * page(input, styleOpts?) -> { model, parts, style }. input: { type, positives: [{ name, lat, lon, color, status,
 * past }] (the positives shown), added: [{ name, lat, lon }] (points added on the map), sites (the prepared ring or
 * zone sites: the current positives with zones and the added points), pastSites (the past positives' rings, when
 * drawn), zonesMode, zoneName, rings, unit, result (rules.js inside()'s, or null), layers ({ key: { label, pngLabel,
 * color, shape } }), days (rules.js daysSince for sites), window ({ start, end }), current (the current positives'
 * count), cvi ({ cvis, animals, matched (the CVI query's matched rows, with hitOrigin and hitDest), years } or null), counties (GeoJSON features), date, background, synthetic }.
 * title(type) -> the page's title; fileName(type, date) -> "emergency_hpai_2026-10-22.png". Pure: branded.svg() and
 * branded.png() make the picture. */
(function (root) {
  'use strict';
  const B = () => root.WSDA.branded;
  const BM = () => root.CVIWA.brandedmaps;
  const S = () => root.CVIWA.scaling;
  const E = () => root.WSDA.emergencyRules;

  const RING_OPACITY = 0.2;
  const ZONE_COLOR = '#cb181d';   // a zone file's zones, as on the live map (app.js drawMap)
  const PAST = '#737373';         // past positives' rings, as on the live map (map.js)
  const PICK = '#c0392b';         // points added on the map (map.js)
  const CVI_ORIGIN = '#F0A06E';   // a CVI premises that is a movement's origin in a zone (brandedmaps.js PROX.origin)
  const CVI_DEST = '#1C9CD9';     // ... its destination in a zone (PROX.dest)
  const PAST_OPACITY = 0.55;
  const PANEL_H = 0.46;
  // The least size of the panel's rows (against CVI's) that the key may take room down to.
  const PANEL_FLOOR_SCL = 0.85;
  const TEAL = '#245566', BLUE = '#1c5a83', GOLD = '#c8842c';
  const SENSITIVE = 'Shows positive premises\' locations: handle as sensitive data and share only with authorized responders.';
  const SOURCE = 'Data: positives and facility layers as loaded · County boundaries: U.S. Census Bureau';
  const SOURCE_CVI = 'Data: positives and facility layers as loaded, WSDA Animal Services CVI records · County ' +
    'boundaries: U.S. Census Bureau';

  // "HPAI RESPONSE MAP": the type's title (types.js gives a type without one its name in capitals).
  const title = type => type.title;
  // emergency_hpai_2026-10-22.png, the local date.
  function fileName(type, date) {
    const d = date || new Date();
    const two = n => String(n).padStart(2, '0');
    return 'emergency_' + type.id + '_' + d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + '.png';
  }
  // A distance as the page writes it: "3 km", "1.86 mi".
  const distance = (d, unit) => String(Number(Number(d).toFixed(2))) + ' ' + E().UNITS[unit || 'km'].label;
  // A ring's distance in both units, the unit shown on the page first: { shown: "3 km", other: "1.9 mi" }; the other
  // turned from the exact km, to one decimal.
  function bothUnits(d, unit) {
    const u = unit || 'km', o = u === 'mi' ? 'km' : 'mi';
    const x = E().fromKm(E().toKm(d, u), o);
    return { shown: distance(d, u), other: String(Number(x.toFixed(1))) + ' ' + E().UNITS[o].label };
  }

  // ── Copied from brandedmaps.js (lines 441 to 448) ──
  // A circle { x, y, r } touching a box; two boxes meeting.
  const touchesBox = (c, b) => {
    const dx = c.x - Math.max(b.x0, Math.min(c.x, b.x1));
    const dy = c.y - Math.max(b.y0, Math.min(c.y, b.y1));
    return dx * dx + dy * dy < c.r * c.r;
  };
  // Whether two boxes ({ x0, x1, y0, y1 }) overlap.
  const boxesMeet = (a, b) => Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);

  // ── Copied from brandedmaps.js (lines 2389 to 2406): the shapes' sizes and the site's bullseye ──
  const shapeFs = (size, stroke) => size * B().textPt(1) + stroke * (96 / 25.4) / 2;
  const bullseyeR = (size, stroke) => 0.375 * shapeFs(size, stroke) * 1.1;
  const bullseyeReach = (size, stroke) => 1.16 * bullseyeR(size, stroke);
  const shapeHeight = (shape, size, stroke) => (shape === 'bullseye' ? 2 * bullseyeReach(size, stroke)
    : 0.375 * shapeFs(size, stroke) * (shape === 22 ? 2 * 0.886226925452758 : shape === 23 ? 2 * 1.2533141373155
      : shape === 24 ? 1.55512030155621 + 0.77756015077811 : 2));
  // A positive's bullseye in its status color (CVI's siteMark is always red); a past one hollow (no middle dot) and
  // faded.
  function positiveMark(x, y, size, stroke, color, past) {
    const BR = B(), r = bullseyeR(size, stroke);
    const fade = past ? ' opacity="' + PAST_OPACITY + '"' : '';
    return '<circle cx="' + BR.num(x) + '" cy="' + BR.num(y) + '" r="' + BR.num(r) + '" fill="#ffffff" stroke="' +
      BR.esc(color) + '" stroke-width="' + BR.num(0.32 * r) + '"' + fade + '/>' + (past ? '' : '<circle cx="' +
      BR.num(x) + '" cy="' + BR.num(y) + '" r="' + BR.num(0.34 * r) + '" fill="' + BR.esc(color) + '"/>');
  }

  // ── Copied from brandedmaps.js (lines 2466 to 2546, proximityPanelRows in the page's style): the panel's rows ──
  // rows: [{ name, count (sites inside its zones), county (null for a zone), days (text, or null) }]. At most 8 rows,
  // the most sites inside first (ties in the order given), each cut with "…" to the column. Each row is as tall as
  // its lines (CVI's rows are one height): the name and count, the county, then the days (where CVI writes the
  // matched origins and destinations). A row without a county line (a zone) takes a long name onto up to three lines
  // at the row's size, so two zone names are not cut alike; a positive's long name is drawn smaller, down to the
  // smallest rows' size, before it is cut. The rows' size follows CVI's (from the space per row), at most 1.2 (CVI's
  // 1.5 made two rows shout), drawn smaller together only when the rows do not fit. word: "positive" or "zone", for
  // the note of the rows not listed; footerRows: the footer's rows (3 by default). panelH: the panel's height (a page
  // fraction, PANEL_H by default; less when the key needs the room): the title band, the column labels and the footer
  // keep their size, the rows get what is left. needAt(scl): the page height the panel needs with its rows at scl.
  const PANEL_ROWS = 8;
  const MIN_SCL = 0.72, MAX_SCL = 1.2;
  function panelRows(rows, width, word, footerRows, panelH) {
    const BR = B();
    const u = (panelH || PANEL_H) / PANEL_H;   // the panel's height against PANEL_H; the bands below are PANEL_H's
    const hdrH = 0.085 / u;
    const colKeyY = 1 - hdrH - 0.018 / u;
    // The footer's top: CVI's 0.24 holds three footer rows; fewer rows give the panel's rows the room.
    const bands = 0.05 + 0.064 * (footerRows === undefined ? 3 : footerRows);
    const footTop = bands / u;
    const rowsTop = colKeyY - 0.03 / u;
    const panelPt = (panelH || PANEL_H) * BR.H;   // a panel fraction is this many points
    const order = rows.map((r, i) => i);
    order.sort((a, b) => (rows[b].count || 0) - (rows[a].count || 0) || a - b);
    const n = rows.length;
    const showN = Math.min(n, PANEL_ROWS);
    const listed = order.slice(0, showN);
    const threeLine = listed.some(i => rows[i].days);
    const left = n - showN;
    const more = left ? left + ' more ' + word + (left === 1 ? '' : 's') + ' not listed (ranked by sites inside)' : null;
    const fixed = (0.085 + 0.018 + 0.03 + bands + (more ? 0.045 : 0)) * PANEL_H;
    const out = { rows: [], order: listed, more, empty: n === 0, threeLine, hdrH, colKeyY, footTop, rowsTop, u,
      needAt: s => fixed + (showN ? listed.reduce((t, idx) => t + rowAt(idx, s).height, 0) / BR.H : 0.08 * PANEL_H) };
    if (!showN) return out;
    const avail = rowsTop - footTop - (more ? 0.045 / u : 0);
    // The column: from the name's start (0.05) to the count's left edge, 6 points apart.
    const room = (0.96 - 0.05) * width;
    // A text cut with "…" to fit room points at pt.
    const fitTo = (t, pt, roomPt, bold) => {
      if (BR.textWidth(t, pt, bold) <= roomPt) return t;
      const ch = Array.from(t);
      const k = BM().longestFitting(ch.length, j => BR.textWidth(ch.slice(0, j).join('') + '…', pt, bold) <= roomPt);
      return ch.slice(0, k).join('') + '…';
    };
    // Words onto at most max lines of roomPt, the last cut with "…" when they do not all fit.
    const wrap = (t, pt, roomPt, max) => {
      const words = t.split(/\s+/), lines = [];
      let i = 0;
      while (i < words.length && lines.length < max) {
        let k = i + 1;
        while (k < words.length && BR.textWidth(words.slice(i, k + 1).join(' '), pt, true) <= roomPt) k++;
        lines.push(words.slice(i, lines.length === max - 1 ? words.length : k).join(' '));
        i = lines.length === max ? words.length : k;
      }
      return lines.map(l => fitTo(l, pt, roomPt, true));
    };
    // One row at a scale: its lines ({ text, pt, kind }) with their middles below the row's top, and its height
    // (points): the first line's middle 0.75 of its size down, the next 1.15 times the two lines' half sizes apart, 0.5
    // of the last line's size under it.
    const rowAt = (idx, scl) => {
      const r = rows[idx];
      const count = S().comma(r.count || 0);
      const nameRoom = room - BR.textWidth(count, BR.textPt(3.2 * scl), true) - 6;
      const full = String(r.name || word + ' ' + (idx + 1));
      let nameSize = 3.1 * scl;
      let names = [full];
      const fullPt = BR.textPt(nameSize);
      if (BR.textWidth(full, fullPt, true) > nameRoom) {
        if (!r.county) names = wrap(full, fullPt, nameRoom, 3);
        else {
          nameSize = Math.max(3.1 * MIN_SCL, 3.1 * scl * nameRoom / BR.textWidth(full, fullPt, true));
          names = [fitTo(full, BR.textPt(nameSize), nameRoom, true)];
        }
      }
      const namePt = BR.textPt(nameSize), subPt = BR.textPt(2.5 * scl);
      const lines = names.map(t => ({ text: t, pt: namePt, kind: 'name' }))
        .concat(r.county ? [{ text: fitTo(String(r.county), subPt, room), pt: subPt, kind: 'county' }] : [])
        .concat(r.days ? [{ text: fitTo(r.days, subPt, room), pt: subPt, kind: 'days' }] : []);
      let at = 0;
      lines.forEach((l, k) => {
        at += k ? 0.575 * (lines[k - 1].pt + l.pt) : 0.75 * l.pt;
        l.at = at;
      });
      return { idx, r, count, nameSize, scl, lines, height: at + 0.5 * lines[lines.length - 1].pt };
    };
    let scl = Math.max(MIN_SCL, Math.min(MAX_SCL, Math.min(threeLine ? 0.150 : 0.130, avail * u / showN) / 0.085));
    let laid = listed.map(idx => rowAt(idx, scl));
    const total = list => list.reduce((t, x) => t + x.height, 0) / panelPt;
    while (total(laid) > avail && scl > MIN_SCL) {
      scl = Math.max(MIN_SCL, scl - 0.02);
      laid = listed.map(idx => rowAt(idx, scl));
    }
    Object.assign(out, { scl });
    let top = rowsTop;
    laid.forEach(x => {
      const y = l => top - l.at / panelPt;
      const of = kind => x.lines.filter(l => l.kind === kind);
      const county = of('county')[0], days = of('days')[0];
      out.rows.push({ site: x.idx, name: of('name')[0].text, names: of('name').map(l => l.text), nameSize: x.nameSize,
        nameY: y(of('name')[0]), nameYs: of('name').map(y), count: x.count, countSize: 3.2 * x.scl,
        subLeft: county ? county.text : null, subSize: 2.5 * x.scl, subY: county ? y(county) : null,
        days: days ? days.text : null, daysY: days ? y(days) : null, height: x.height / panelPt });
      top -= x.height / panelPt;
    });
    return out;
  }

  // ── Copied from brandedmaps.js (lines 2547 to 2585): the panel, titled POSITIVES ──
  function panelParts(p, panel, keyLabel, footer) {
    const BR = B();
    const parts = [BR.box(p)];
    const hang = pt => 0.358 * pt;
    parts.push(BR.rect(p.u(0), p.v(1), p.u(1) - p.u(0), p.v(1 - panel.hdrH) - p.v(1), TEAL));
    parts.push(BR.text('POSITIVES', p.u(0.5), p.v(1 - panel.hdrH / 2), { pt: BR.textPt(3.4), color: '#ffffff',
      bold: true, anchor: 'middle' }));
    const keyPt = BR.textPt(2.5);
    parts.push(BR.text('Positive', p.u(0.05), p.v(panel.colKeyY) + hang(keyPt), { pt: keyPt, color: '#999999' }));
    parts.push(BR.text(keyLabel, p.u(0.96), p.v(panel.colKeyY) + hang(keyPt), { pt: keyPt, color: '#999999',
      anchor: 'end' }));
    for (const r of panel.rows) {
      r.names.forEach((t, k) => parts.push(BR.text(t, p.u(0.05), p.v(r.nameYs[k]), { pt: BR.textPt(r.nameSize),
        color: '#1f2933', bold: true })));
      parts.push(BR.text(r.count, p.u(0.96), p.v(r.nameY), { pt: BR.textPt(r.countSize), color: '#1c5a83', bold: true,
        anchor: 'end' }));
      if (r.subLeft) parts.push(BR.text(r.subLeft, p.u(0.05), p.v(r.subY), { pt: BR.textPt(r.subSize), color: '#7a8691' }));
      // The days in italics, so the name and count lead.
      if (r.days) parts.push(BR.text(r.days, p.u(0.05), p.v(r.daysY), { pt: BR.textPt(r.subSize), color: '#7a8691', italic: true }));
    }
    if (panel.more) {
      parts.push(BR.text(panel.more, p.u(0.5), p.v(panel.footTop + 0.02 / panel.u), { pt: BR.textPt(2.7), color: '#888888',
        italic: true, anchor: 'middle' }));
    }
    if (panel.empty) {
      parts.push(BR.text('No positives with zones', p.u(0.5), p.v((panel.rowsTop + panel.footTop) / 2),
        { pt: BR.textPt(3.0), color: '#888888', anchor: 'middle' }));
    }
    parts.push(BR.line(p.u(0.06), p.v(panel.footTop - 0.005 / panel.u), p.u(0.94), p.v(panel.footTop - 0.005 / panel.u), '#bbbbbb',
      BR.linePt(0.3)));
    // A label too long to sit beside its value is wrapped onto two lines, the value centered beside them (the page's
    // footer label "Positives with a site inside" ran into "6 of 6").
    footer.forEach(([label, value], i) => {
      const y = p.v(panel.footTop - (0.050 + i * 0.064) / panel.u);
      const labelPt = BR.textPt(3.4), valuePt = BR.textPt(3.9);
      const room = p.u(0.94) - p.u(0.06) - BR.textWidth(value, valuePt, true) - 8;
      const words = label.split(' ');
      let lines = [label];
      if (BR.textWidth(label, labelPt) > room && words.length > 1) {
        let k = 1;
        while (k < words.length - 1 && BR.textWidth(words.slice(0, k + 1).join(' '), labelPt) <= room) k++;
        lines = [words.slice(0, k).join(' '), words.slice(k).join(' ')];
      }
      lines.forEach((t, k) => parts.push(BR.text(t, p.u(0.06), y + (k - (lines.length - 1) / 2) * labelPt * 1.2,
        { pt: labelPt, color: '#555555' })));
      parts.push(BR.text(value, p.u(0.94), y, { pt: valuePt, color: '#1f2933', bold: true, anchor: 'end' }));
    });
    return parts.join('');
  }

  // The MAP KEY's items, top to bottom ({ type: 'header' | 'subheader' | 'row', glyph, label }), as CVI's
  // proximityKeyItems: one row per status among the positives drawn, the past positives, the added points, one row per
  // ring with its distance in the unit shown (or the zone file's), the past rings, then the facility layers.
  function keyItems(o) {
    const items = [{ type: 'header', label: 'MAP KEY' }];
    const bullseye = (color, past) => ({ shape: 'bullseye', size: 4.5, stroke: 0.9, fill: color, past: !!past });
    o.statuses.forEach(s => items.push({ type: 'row', glyph: bullseye(s.color), label: s.label + ' positive' }));
    o.pastColors.forEach(c => items.push({ type: 'row', glyph: bullseye(c, true), label: 'Past positive' }));
    if (o.added) items.push({ type: 'row', glyph: bullseye(PICK), label: 'Added point' });
    const ring = (color, label, dashed) => items.push({ type: 'row', glyph: { shape: 22, size: 6, stroke: 0.9,
      fill: color, opacity: dashed ? 0.05 : RING_OPACITY, border: color }, label });
    if (o.zonesMode) ring(ZONE_COLOR, 'Zone (from file)');
    else {
      o.rings.forEach(r => {
        const b = bothUnits(r.distance, o.unit);
        ring(r.color, r.label + ' (' + b.shown + ' / ' + b.other + ')');
        // Two lines in the key: the ring's name, then its distance in both units.
        items[items.length - 1].lines = [r.label, b.shown + ' / ' + b.other];
      });
    }
    if (o.pastRings) ring(PAST, 'Past positives\' rings', true);
    // With a CVI master: the premises a matched movement left from or went to inside a zone, each count on the right.
    if (o.cvi) {
      items.push({ type: 'subheader', label: 'CVI PREMISES' + (o.cvi.years ? ', ' + o.cvi.years : '') });
      const end = (color, label, n) => items.push({ type: 'row', glyph: { shape: 21, size: 4, stroke: 1.4, fill: '#ffffff',
        opacity: 1, border: color }, label, count: S().comma(n) });
      end(CVI_ORIGIN, 'Origin in a zone', o.cvi.origins);
      end(CVI_DEST, 'Destination in a zone', o.cvi.dests);
    }
    // The layers' sites drawn are the sites inside, so the heading says so and each row has its count on the right.
    if (o.facilities.length) {
      items.push({ type: 'subheader', label: 'SITES INSIDE' });
      o.facilities.forEach(l => items.push({ type: 'row', glyph: { shape: 21, size: 4, stroke: 0.8, fill: l.color,
        opacity: 1, border: '#ffffff', mark: l.shape }, label: l.label, count: S().comma(l.n),
      facility: { label: l.label, n: l.n } }));
    }
    return items;
  }
  // A key row's mark as SVG: a circle, a positive's bullseye, or another ggplot2 shape.
  const drawGlyph = (g, x, y) => (g.shape === 21 ? B().circle(x, y, g.size, g.stroke, g.fill, g.opacity, g.border, g.mark)
    : g.shape === 'bullseye' ? positiveMark(x, y, g.size, g.stroke, g.fill, g.past)
      : BM().shapeMark(g.shape, x, y, g.size, g.stroke, g.fill, g.opacity, g.border));

  // ── Copied from brandedmaps.js (lines 2669 to 2744): the key's lines and its column ──
  // A key label as one line, or as words wrapped onto up to three lines that fit the box beside the mark; a word too
  // long for a line, or a fourth line, is cut with "…".
  // less: points kept free at the right (a row's count).
  function keyLines(label, pt, less) {
    const BR = B();
    const room = (BR.px(BR.LAYOUT.gutterW) - 10) * (1 - 0.28) - 4 - (less || 0);
    if (BR.textWidth(label, pt) <= room) return label;
    const cut = t => {
      const ch = Array.from(t);
      const k = BM().longestFitting(ch.length, j => BR.textWidth(ch.slice(0, j).join('') + '…', pt) <= room);
      return ch.slice(0, k).join('') + '…';
    };
    const lines = [];
    let cur = '';
    for (const word of label.split(/\s+/)) {
      const next = cur ? cur + ' ' + word : word;
      if (BR.textWidth(next, pt) <= room) cur = next;
      else {
        if (cur) lines.push(cur);
        cur = BR.textWidth(word, pt) <= room ? word : cut(word);
      }
    }
    if (cur) lines.push(cur);
    return lines.length > 3 ? lines.slice(0, 2).concat([cut(lines.slice(2).join(' '))]) : lines;
  }
  // The legend column by size: each row as tall as its mark, the box growing up to maxH. The facility layers stay in
  // one column while their rows can be drawn at MIN_KEY_SQUEEZE of their height or more; else the key lists the layers
  // with the most facilities, as many as fit, and "and N more layers (see the CSV export)".
  // Changed from the copy: a row drawn closer stays as tall as its label's lines (CVI's 0.6 alone let a name on two
  // lines run into the next row once the past positives' and the rings' rows took the room); and before listing fewer
  // layers, the layers' rows are tried in smaller text (KEY_TEXT_STEPS of the key's text size).
  const MIN_KEY_SQUEEZE = 0.6;
  const KEY_TEXT_STEPS = [1, 0.9, 0.8];
  // legendColumn's lines are labelPt * 1.15 apart; its rows are as tall as max(mark, lines * labelPt * 1.2) + ROW_GAP (2).
  const LINE_STEP = 1.15, ROW_LINE = 1.2, ROW_GAP = 2;
  function keyColumn(items, y, minH, maxH) {
    const BR = B();
    const labelPt = BR.textPt(3.0);
    const markHeight = g => {
      const reach = g.mark ? root.WSDA.facilities.MARK_EXTENT[g.mark] || 1 : 1;
      return g.shape === 21 ? 2 * BR.pointRadius(g.size, g.stroke) * reach : shapeHeight(g.shape, g.size, g.stroke);
    };
    // A row's count, bold at the key's right edge (the box's u(0.94): its margin is 5 points), drawn with its mark.
    const right = BR.px(BR.LAYOUT.gutterX) + 5 + 0.94 * (BR.px(BR.LAYOUT.gutterW) - 10);
    const countOf = (it, yy, pt) => (it.count === undefined ? '' : BR.text(it.count, right, yy, { pt, color: BLUE,
      bold: true, anchor: 'end' }));
    // A row at its text size (pt: the key's, or smaller for the layers when the key is crowded).
    const rowOf = (it, pt) => ({ sample: { height: markHeight(it.glyph), draw: (x, yy) => drawGlyph(it.glyph, x, yy) +
      countOf(it, yy, pt) }, x: 0.14, labelX: 0.28, labelPt: pt, label: it.lines || keyLines(it.label, pt,
      it.count === undefined ? 0 : BR.textWidth(it.count, pt, true) + 6) });
    const head = it => (it.type === 'header' ? [{ text: it.label, pt: BR.textPt(3.2), color: '#222222', bold: true }]
      : [{ gap: 3 }, { rule: { color: '#bbbbbb', width: 0.3, x0: 0.06, x1: 0.94 } },
        { text: it.label, pt: BR.textPt(3.2), color: '#222222', bold: true }]);
    const facilities = items.filter(it => it.facility);
    const lineCount = label => (Array.isArray(label) ? label.length : 1);
    // The least a facility row may be drawn at: its label's lines, as a share of its full height.
    const textShare = (it, pt) => {
      const r = rowOf(it, pt), n = lineCount(r.label);
      return n * LINE_STEP * pt / (Math.max(r.sample.height, n * ROW_LINE * pt) + ROW_GAP);
    };
    const readable = c => c.fits || c.squeeze >= c.least;
    const build = (mode, shownFacilities, scale) => {
      const pt = labelPt * (scale || 1), entries = [];
      items.forEach(it => {
        if (it.type !== 'row') entries.push(...head(it));
        // The rows above the facility layers (positives, rings, CVI premises) keep their height and text size.
        else if (!it.facility) entries.push(Object.assign(rowOf(it, labelPt), { keep: true }));
      });
      shownFacilities.forEach(it => entries.push(rowOf(it, pt)));
      const more = facilities.length - shownFacilities.length;
      if (more > 0) {
        entries.push({ text: 'and ' + S().comma(more) + ' more layer' + (more === 1 ? '' : 's'), pt: 7.5, color: '#666666',
          italic: true }, { text: '(see the CSV export)', pt: 7.5, color: '#666666', italic: true });
      }
      const col = BR.legendColumn(entries, { bottom: y, minH, maxH: Math.max(minH, maxH) });
      const sampled = entries.filter(e => e.sample);
      return { parts: col.parts, height: col.height, fits: col.fits, box: col.box, mode,
        rows: col.circles.map((c, i) => Object.assign({ lines: lineCount(sampled[i].label), pt: sampled[i].labelPt }, c)),
        shown: shownFacilities.map(it => it.facility.label), squeeze: col.squeeze, overlap: col.overlap, textScale: scale || 1,
        least: Math.max(MIN_KEY_SQUEEZE, ...shownFacilities.map(it => textShare(it, pt))) };
    };
    if (!facilities.length) return build('one', facilities);
    for (const scale of KEY_TEXT_STEPS) {
      const key = build('one', facilities, scale);
      if (readable(key)) return key;
    }
    // The most facilities first (the registry's order among equals), as many as fit, at the smallest text.
    const least = KEY_TEXT_STEPS[KEY_TEXT_STEPS.length - 1];
    const ranked = facilities.slice().sort((a, b) => b.facility.n - a.facility.n
      || facilities.indexOf(a) - facilities.indexOf(b));
    const k = BM().longestFitting(ranked.length - 1, j => readable(build('top', ranked.slice(0, j), least)));
    return build('top', ranked.slice(0, k), least);
  }

  // ── Copied from brandedmaps.js (lines 2746 to 2768): the WA inset, the positives in their colors ──
  function inset(counties, marks, at) {
    const BR = B();
    const I = BM().INSET;
    const pos = at || { x: BR.LAYOUT.mapW - I.w - I.gap, y: I.y };
    const p = BR.panel(pos.x, pos.y, I.w, I.h, 0);
    const pad = 2;
    const fit = BR.fitMercator(BR.bounds(counties), { left: p.left + pad, top: p.top + pad, width: p.width - 2 * pad,
      height: p.height - 2 * pad });
    const parts = [BR.rect(p.left, p.top, p.width, p.height, '#ffffff', '#aab4bb', BR.linePt(0.5))];
    for (const f of counties) {
      parts.push('<path d="' + BR.pathData(f.geometry, fit.project) + '" fill="#e8eaed" stroke="#ffffff" stroke-width="' +
        BR.num(BR.linePt(0.25)) + '"/>');
    }
    // Only the positives inside the inset's Washington frame (one in Oregon would fall below the box).
    const inside = ([x, y]) => x >= p.left && x <= p.left + p.width && y >= p.top && y <= p.top + p.height;
    const placed = marks.map(m => ({ m, xy: fit.project(m.lon, m.lat) })).filter(q => inside(q.xy));
    placed.forEach(({ m, xy }) => parts.push(positiveMark(xy[0], xy[1], 1.6, 0.4, m.color, m.past)));
    return { parts: parts.join(''), marks: placed.map(q => q.xy) };
  }

  // The rings drawn: each ring site's bands (proximity.bandShapes, CVI's geodesic disks and annuli) in its ring's
  // color, matched by distance through rules.js toKm as the live map does (map.js zoneFeatures).
  function ringShapes(sites, rings, unit, color) {
    const PX = root.WSDA.proximity;
    return [].concat(...sites.map(s => PX.bandShapes(s).map(f => {
      let i = rings.findIndex(r => E().toKm(r.distance, unit) === f.properties.outerKm);
      if (i < 0) i = rings.length - 1;
      return { geometry: f.geometry, km: f.properties.bandKm, color: color || rings[i].color, site: s.id };
    })));
  }

  // The map's box (brandedmaps.js proximityExtent, lines 2426 to 2457): the zones' box and every positive drawn,
  // widened 10% on each side, at least 0.15 degrees each way.
  function extentOf(features, points) {
    const b = { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity };
    const add = (lon, lat) => {
      b.west = Math.min(b.west, lon); b.east = Math.max(b.east, lon);
      b.south = Math.min(b.south, lat); b.north = Math.max(b.north, lat);
    };
    for (const f of features) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) for (const c of poly[0]) add(c[0], c[1]);
    }
    points.forEach(q => add(q.lon, q.lat));
    if (!Number.isFinite(b.west)) Object.assign(b, { west: -124.8, east: -116.9, south: 45.5, north: 49.0 });
    const padX = (b.east - b.west) * 0.10;
    const padY = (b.north - b.south) * 0.10;
    const e = { west: b.west - padX, east: b.east + padX, south: b.south - padY, north: b.north + padY };
    const MIN_SPAN = 0.15;
    if (e.east - e.west < MIN_SPAN) {
      const c = (e.west + e.east) / 2;
      e.west = c - MIN_SPAN / 2;
      e.east = c + MIN_SPAN / 2;
    }
    if (e.north - e.south < MIN_SPAN) {
      const c = (e.south + e.north) / 2;
      e.south = c - MIN_SPAN / 2;
      e.north = c + MIN_SPAN / 2;
    }
    return e;
  }

  function page(input, styleOpts) {
    const BR = B();
    const R = E();
    const style = BR.styleOf(styleOpts);
    const L = BR.LAYOUT;
    const type = input.type;
    const unit = input.unit || 'km';
    const rings = input.rings || [];
    const sites = input.sites || [];
    const positives = input.positives || [];
    const added = input.added || [];
    const result = input.result || null;
    const bg = BM().backgroundOf(input);
    const theme = root.WSDA.tiles ? root.WSDA.tiles.THEMES[bg ? bg.theme : 'standard'] : null;

    // Strings.
    const pageTitle = title(type);
    const win = input.window || {};
    const period = { prefix: 'Detected between', value: win.start && win.end
      ? R.dayLabel(win.start) + ' and ' + R.dayLabel(win.end) : 'all dates' };
    const zonesText = input.zonesMode ? 'Zones: ' + (input.zoneName || 'from a zone file')
      : 'Zones: ' + rings.map(r => { const b = bothUnits(r.distance, unit); return r.label + ' ' + b.shown + ' (' + b.other + ')'; })
        .join(', ');
    const meta = { left: zonesText, right: (win.end ? 'As of ' + R.dayLabel(win.end) + ' · ' : '') + BR.updated(input.date) };

    // The sites inside: one per layer, place and name (however many zones hold it), in the layers' order.
    const facLayers = [];
    if (result) {
      for (const s of result.layers) {
        const l = (input.layers || {})[s.key] || {};
        const seen = new Set();
        const points = [];
        result.rows.filter(r => r.layer === s.key).forEach(r => {
          const k = r.lat + ',' + r.lon + ',' + r.name;
          if (seen.has(k)) return;
          seen.add(k);
          points.push({ name: r.name, lat: r.lat, lon: r.lon });
        });
        if (points.length) facLayers.push({ key: s.key, label: l.pngLabel || l.label || s.label, color: l.color || s.color,
          shape: l.shape, points });
      }
    }
    const facTotal = result ? result.total : 0;
    // The layers are listed in the key, so no box counts them.
    const boxes = [{ label: 'Current positives', value: S().comma(input.current || 0), color: TEAL },
      { label: 'Sites inside', value: S().comma(facTotal), color: BLUE }].concat(input.cvi
      ? [{ label: 'CVIs in or out', value: S().comma(input.cvi.cvis), color: GOLD }, { label: 'Animals moved',
        value: S().comma(input.cvi.animals), color: TEAL }] : []);

    // The panel's rows: each site (a positive with zones, an added point, or a zone-file zone), its county and the days
    // since the last positive in its zones, counted by the sites inside them.
    // A zone has no county line: it may cross counties, and its center's county would mislead.
    const daysOf = new Map((input.days || []).map(d => [d.site, d.days]));
    const insideBy = new Map();
    if (result) {
      result.rows.forEach(r => {
        if (!insideBy.has(r.site)) insideBy.set(r.site, new Set());
        insideBy.get(r.site).add(r.layer + '\r' + r.lat + '\r' + r.lon + '\r' + r.name);
      });
    }
    const daysText = days => (days === null || days === undefined ? null
      : days + (days === 1 ? ' day' : ' days') + ' since last positive');
    const rowsIn = sites.map(s => ({ name: s.name, count: insideBy.has(s.id) ? insideBy.get(s.id).size : 0,
      county: input.zonesMode ? null : BM().siteCounty(s, input.counties), days: daysText(daysOf.get(s.id)) }));
    // The footer: how many of the rows have a site inside (the sites inside are in a box, the layers in the key).
    const footer = [[(input.zonesMode ? 'Zones' : 'Positives') + ' with a site inside',
      S().comma(rowsIn.filter(r => r.count > 0).length) + ' of ' + S().comma(rowsIn.length)]];
    const panelOf = h => panelRows(rowsIn, BR.px(L.gutterW), input.zonesMode ? 'zone' : 'positive', footer.length, h);

    // The key.
    const statuses = [];
    positives.filter(p => !p.past).forEach(p => {
      if (!statuses.some(s => s.label === p.status)) statuses.push({ label: p.status, color: p.color });
    });
    const pastColors = [...new Set(positives.filter(p => p.past).map(p => p.color))].slice(0, 1);
    const pastSites = input.pastSites || [];
    // The CVI premises (Premise Lookup's matched endpoints, brandedmaps.js lines 2862 to 2868): each matched row's
    // origin or destination that fell in a zone, with usable coordinates, each spot once.
    const ends = (flag, side) => {
      const seen = new Set();
      return ((input.cvi && input.cvi.matched) || []).filter(r => r[flag]).map(r => ({
        lat: root.WSDA.proximity.number(r[side + '.Lat']), lon: root.WSDA.proximity.number(r[side + '.Long']) }))
        .filter(q => q.lat !== null && q.lon !== null && Math.abs(q.lat) <= 90 && Math.abs(q.lon) <= 180)
        .filter(q => !seen.has(q.lat + ',' + q.lon) && seen.add(q.lat + ',' + q.lon));
    };
    const cviOrigins = ends('hitOrigin', 'Origin'), cviDests = ends('hitDest', 'Dest');
    const items = keyItems({ statuses, pastColors, added: added.length > 0, zonesMode: !!input.zonesMode,
      zoneName: input.zoneName, rings, unit, pastRings: pastSites.length > 0,
      cvi: input.cvi ? { years: input.cvi.years || null, origins: cviOrigins.length, dests: cviDests.length } : null,
      facilities: facLayers.map(l => ({ label: l.label, color: l.color, shape: l.shape, n: l.points.length })) });

    // ── Drawing ──
    const ringParts = input.zonesMode ? [] : ringShapes(sites.filter(s => !s.zone), rings, unit);
    const pastParts = ringShapes(pastSites, rings, unit, PAST);
    const zoneParts = sites.filter(s => s.zone).map(s => ({ geometry: s.zone, km: 0, color: ZONE_COLOR, site: s.id, zone: true }));
    const marksIn = positives.map(p => ({ name: p.name, lat: p.lat, lon: p.lon, color: p.color, past: !!p.past }))
      .concat(added.map(p => ({ name: p.name, lat: p.lat, lon: p.lon, color: PICK, past: false })));
    const extent = extentOf(ringParts.concat(pastParts, zoneParts), marksIn);
    const mapH = L.statY - BM().BAND_PAD;
    const corrected = BM().aspectCorrect(extent, L.mapW, mapH);
    const mapPanel = BR.panel(0, 0, L.mapW, mapH, 0);
    const fit = BR.fitMercator(extent, mapPanel);
    const P = (lon, lat) => fit.project(lon, lat);
    const counties = input.counties;
    const mapParts = [];
    // The land: every county (neighbors' context kept); over a tile background no land fill, white county lines.
    if (!bg) {
      for (const c of counties) {
        mapParts.push('<path d="' + BR.pathData(c.geometry, P) + '" fill="#e8e8e8" stroke="#8a8a8a" stroke-width="' +
          BR.num(BR.linePt(0.4)) + '" stroke-linejoin="round"/>');
      }
    } else {
      for (const c of counties) {
        mapParts.push('<path d="' + BR.pathData(c.geometry, P) + '" fill="none" stroke="#ffffff" stroke-width="' +
          BR.num(BR.linePt(0.5)) + '" stroke-linejoin="round"/>');
      }
    }
    // The past rings first (under the current ones), gray and dashed; then the zones, outer rings first so an inner
    // ring's outline is on top.
    for (const r of pastParts.slice().sort((a, b) => b.km - a.km)) {
      mapParts.push('<path d="' + BR.pathData(r.geometry, P) + '" fill="' + PAST + '" fill-opacity="0.05" fill-rule="evenodd" ' +
        'stroke="' + PAST + '" stroke-opacity="0.8" stroke-width="' + BR.num(BR.linePt(0.6)) + '" stroke-dasharray="3 2" ' +
        'stroke-linejoin="round"/>');
    }
    const drawn = ringParts.slice().sort((a, b) => b.km - a.km).concat(zoneParts);
    for (const r of drawn) {
      mapParts.push('<path d="' + BR.pathData(r.geometry, P) + '" fill="' + r.color + '" fill-opacity="' + RING_OPACITY +
        '" fill-rule="evenodd" stroke="' + r.color + '" stroke-width="' + BR.num(BR.linePt(0.7)) + '" stroke-linejoin="round"/>');
    }
    const facilities = facLayers.map(l => Object.assign({}, l, { points: l.points.map(q => {
      const [x, y] = P(q.lon, q.lat);
      return Object.assign({}, q, { x, y, r: BR.pointRadius(3.0, 0.5) });
    }) }));
    for (const l of facilities) {
      for (const q of l.points) mapParts.push(BR.circle(q.x, q.y, 3.0, 0.5, l.color, 1, '#ffffff', l.shape));
    }
    // The CVI premises over the sites inside, hollow so they are not taken for a layer's sites.
    const cviPoints = cviOrigins.map(q => Object.assign({ color: CVI_ORIGIN, end: 'origin' }, q))
      .concat(cviDests.map(q => Object.assign({ color: CVI_DEST, end: 'destination' }, q))).map(q => {
        const [x, y] = P(q.lon, q.lat);
        return Object.assign(q, { x, y, r: BR.pointRadius(4.0, 1.4) });
      });
    cviPoints.forEach(q => mapParts.push(BR.circle(q.x, q.y, 4.0, 1.4, '#ffffff', 1, q.color)));
    // The positives over the sites inside: the past ones first, so a current positive at the same spot is on top.
    const marks = marksIn.map(m => {
      const [x, y] = P(m.lon, m.lat);
      return Object.assign({}, m, { x, y, r: bullseyeReach(6.0, 1.0) });
    });
    marks.filter(m => m.past).concat(marks.filter(m => !m.past))
      .forEach(m => mapParts.push(positiveMark(m.x, m.y, 6.0, 1.0, m.color, m.past)));

    // Names: the positives' beside their marks, clear of the other marks (CVI: bold, 3.4, #222222 on a white halo).
    const LB = root.WSDA.labels;
    const area = { x0: mapPanel.left + 2, x1: mapPanel.left + mapPanel.width - 2, y0: mapPanel.top + 2,
      y1: mapPanel.top + mapPanel.height - 2 };
    const sitePt = BR.textPt(3.4);
    const markBoxes = marks.map(m => ({ x: m.x, y: m.y, r: m.r }))
      .concat(facilities.flatMap(l => l.points.map(q => ({ x: q.x, y: q.y, r: q.r }))), cviPoints.map(q => ({ x: q.x, y: q.y, r: q.r })));
    const names = marks.filter(m => m.name).map(m => ({ lines: [String(m.name)], x: m.x, y: m.y, r: m.r }));
    const places = style.darkNames ? LB.place(names, markBoxes, [], area, sitePt, [])
      : names.map(n => ({ x: n.x, y: n.y, box: BM().nameBox(n.lines[0], n.x, n.y, sitePt), leader: null, free: false }));
    // On Satellite the theme's light names on a dark halo (dark names could not be read).
    const lightNames = !!bg && bg.theme === 'satellite';
    const nameStyle = { pt: sitePt, color: lightNames ? theme.label : '#222222', bold: true, anchor: 'middle',
      halo: { color: bg ? theme.labelFill : '#ffffff', opacity: bg ? theme.labelFillAlpha : 0.78, width: 2 * 0.30 * sitePt } };
    places.forEach((at, i) => {
      if (at.leader) mapParts.push(BR.line(at.leader.x1, at.leader.y1, at.leader.x2, at.leader.y2, '#888888', BR.linePt(0.25)));
      mapParts.push(BR.text(names[i].lines[0], at.x, at.y, nameStyle));
    });

    // The inset's corner: the first of the bottom right, bottom left, top left and top right that covers no mark or
    // name; with none clear, the one covering the fewest.
    const corners = BM().insetCorners(mapH);
    const insetAt = Object.assign({}, corners[0], { covers: null });
    if (style.insetCorner) {
      const nameBoxes = places.map(q => q.box);
      const hitsAt = (x, y) => {
        const b = BM().insetBox({ x, y });
        return markBoxes.filter(c => touchesBox(c, b)).length + nameBoxes.filter(q => boxesMeet(q, b)).length;
      };
      const scored = corners.map(({ corner, x, y }) => ({ corner, x, y, covers: hitsAt(x, y) }));
      const pick = scored.find(c => c.covers === 0) || scored.slice().sort((a, b) => a.covers - b.covers)[0];
      Object.assign(insetAt, pick, { scores: scored.map(c => ({ corner: c.corner, covers: c.covers })) });
    }
    const insetParts = inset(counties, marksIn, insetAt);
    const insetAtBox = BM().insetBox(insetAt);
    // The scale bar under the key, from the page's own projection (km above, miles below).
    const midLat = (extent.south + extent.north) / 2;
    const panelLonDeg = (mapPanel.width / fit.scale) * 180 / Math.PI;
    const mapKm = panelLonDeg * 111.320 * Math.cos(midLat * Math.PI / 180);
    const scale = BR.scaleBarSpec((L.gutterW / L.mapW) * mapKm);
    const SB_H = 0.058;
    const SB_GAP = 0.012;
    const lgY = scale ? 0.045 + SB_H + SB_GAP : 0.045;
    // The key and the panel share the column under the scale bar: the key takes the room it needs while the panel keeps
    // its rows at PANEL_FLOOR_SCL of CVI's size or more; the panel takes the rest, at most PANEL_H.
    const panelBottom = 1 - L.headerH - 0.020, shared = panelBottom - 0.008 - lgY;
    const key = keyColumn(items, lgY, 0, Math.max(shared - PANEL_H, shared - panelOf().needAt(PANEL_FLOOR_SCL)));
    const panelH = Math.min(PANEL_H, shared - key.height);
    const panelY = panelBottom - panelH;
    const panel = panelOf(panelH);
    // A tile background covers the whole map, so its mask is the map's own box.
    const corner = (x, y) => fit.unproject(x, y);
    const panelFeature = { geometry: { type: 'Polygon', coordinates: [[corner(mapPanel.left, mapPanel.top),
      corner(mapPanel.left + mapPanel.width, mapPanel.top),
      corner(mapPanel.left + mapPanel.width, mapPanel.top + mapPanel.height),
      corner(mapPanel.left, mapPanel.top + mapPanel.height), corner(mapPanel.left, mapPanel.top)]] } };
    const panelBox = BR.panel(L.gutterX, panelY, L.gutterW, panelH, 0);

    const source = input.cvi ? SOURCE_CVI : SOURCE;
    const sensitive = BR.text(SENSITIVE, BR.px(0.005), BR.py(0.026), { pt: 6.5, italic: true,
      color: style.darkerGrays ? '#555555' : '#777777', halo: { color: '#ffffff', opacity: 0.78, width: 2 } });
    const parts = [
      BR.clipped('em-map', mapPanel, mapParts.join('')),
      BR.header(pageTitle, style),
      BR.metaRow(meta.left, meta.right, style),
      BR.statRow([period], []),
      BR.valueBoxes(boxes, 0.46, L.statY - 0.024, L.mapW - 0.46, 0.044),
      panelParts(panelBox, panel, 'Sites inside', footer),
      key.parts,
      insetParts.parts,
      scale ? BR.scaleBar(scale, L.gutterX, 0.045, L.gutterW, SB_H) : '',
      BR.logo(),
      sensitive,
      BR.footnote(source, bg ? bg.attribution : null, style, input.synthetic)
    ];
    const model = {
      view: 'emergency', type: type.id, title: pageTitle, titleSize: BR.titleSize(pageTitle), meta,
      stats: { left: [period], right: [] }, boxes, panel, panelY, panelH, panelKey: 'Sites inside', footer, keyItems: items,
      keyY: lgY, keyHeight: key.height, keyRows: key.rows, keyFits: key.fits, keyMode: key.mode,
      keySqueeze: key.squeeze === undefined ? 1 : key.squeeze, keyShown: key.shown || null, keyTextScale: key.textScale || 1, unit,
      cviPremises: cviPoints.map(q => ({ end: q.end, lat: q.lat, lon: q.lon, x: q.x, y: q.y })),
      extent, corrected, scale, mapKm, mapPanel: { left: mapPanel.left, top: mapPanel.top, width: mapPanel.width,
        height: mapPanel.height },
      positives: marks.map(m => ({ name: m.name, x: m.x, y: m.y, lon: m.lon, lat: m.lat, color: m.color, past: m.past })),
      names: places.map((p, i) => ({ name: names[i].lines[0], at: p })),
      rings: drawn.map(r => ({ km: r.km, zone: !!r.zone, color: r.color, site: r.site })),
      pastRings: pastParts.map(r => ({ km: r.km, site: r.site, color: r.color })),
      facilities: facilities.map(l => ({ key: l.key, label: l.label, color: l.color, shape: l.shape,
        points: l.points.map(q => ({ name: q.name, lon: q.lon, lat: q.lat, x: q.x, y: q.y })) })),
      insetPositives: insetParts.marks.length, inset: { corner: insetAt.corner, covers: insetAt.covers, box: insetAtBox,
        scores: insetAt.scores || null },
      background: bg ? input.background : 'standard', underlay: BM().underlayOf(input, mapPanel, fit, [panelFeature], 10),
      basemap: bg ? bg.attribution : null, theme: bg ? bg.theme : 'standard',
      sensitive: SENSITIVE, source: style.sourceLine ? source : null, fileName: fileName(type, input.date)
    };
    return { model, parts, style };
  }

  root.WSDA = root.WSDA || {};
  root.WSDA.emergencyBranded = { page, title, fileName, keyItems, keyColumn, SENSITIVE, RING_OPACITY, ZONE_COLOR,
    PAST, PICK, CVI_ORIGIN, CVI_DEST };
})(typeof window !== 'undefined' ? window : globalThis);
