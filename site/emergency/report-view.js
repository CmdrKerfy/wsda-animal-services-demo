/* Emergency Response, the Report view (2.9, E2): the update as it prints, letter-size pages made from the whole
 * positives file on the report's date (every row and every kind, whatever the "Animals" ticks and the time views),
 * counted by report.js and worded from the type's report words (types/hpai.js). The pages are the look agreed for the
 * update: the status banner and six tiles, the map of soft dots beside the cases by county, the detections by month,
 * commercial and backyard, this year's detections, the key messages as cards with the livestock card from the data,
 * the hotline and the alternate-format line at every page's foot.
 *
 * The pages flow: each block goes on the page it starts on, or the next when it does not fit; this year's detections
 * past the first rows are listed at the end. Printing uses the browser's own print ("Print / Save as PDF"); the print
 * styles in index.html hide everything but the pages, and the print window's title names the file "HPAI update
 * YYYY-MM-DD.pdf".
 *
 * WSDA.emergencyReportView.draw(box, { read, type, date, counties, labels, choices }) draws the pages into box (its
 *   .rp-sheets) and returns { figures, words, pages }; read is the whole file's read (app.js state.readAll), counties
 *   the county shapes and labels their label points (geo/wa-counties.js), choices the form's (report-form.js choices):
 *   report.js wording's, iconStyle ('filled' or 'outline', the cards' icons; Filled when left out), mapLook ('dots' or
 *   'counties', the map's look; soft dots when left out), note (a line under Washington's figures), messages (the key
 *   messages; the type's own when left out), page { note, hotline, online, alternate } (the title's line and the foot;
 *   the type's own when left out), draft (true: the DRAFT mark on every page) and page2 (2.9: page 2's typed
 *   figures, USDA's pictures, the box and the lists, report-form.js's; no page 2 when left out). The icons are
 *   message-icons.js's.
 * fit(box) scales the pages to the box's width; title(type, date) the print window's title. draw's result also has
 *   cards: where each key message's card printed and how many lines it takes (cardsOf, below).
 * parts: the map's outlines and shades, the month chart (with Figures' clear columns), the commercial and backyard
 *   bars, the table and a tile, for Figures (report-figures.js) to draw with.
 * Kept for the tests: last, the figures, words and page count of the last drawing. */
(function (root) {
  'use strict';
  const RP = root.WSDA.emergencyReport, MI = root.WSDA.emergencyMessageIcons;
  const BR = root.WSDA.brand && root.WSDA.brand.COLORS || {};
  // BLUE the commercial flocks, BG the backyard ones: a lighter blue-green than the brand's, so the two print apart on a
  // black-and-white printer (2.9).
  const TEAL = BR.darkTeal || '#245566', BLUE = BR.darkBlue || '#1c5a83', BG = '#54b5c6', CRIMSON = '#ca3014', GRAY = '#999999';
  const FIRST_ROWS = 6, MORE_ROWS = 10;   // this year's detections on page 1; then ten rows a block, at the end
  const esc = t => String(t === null || t === undefined ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = n => n.toLocaleString('en-US');
  const link = (l, words) => '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(words || l.label) + '</a>';

  // ---- The map: Washington's counties, one soft dot per case inside its county ----
  const MAP_W = 360;
  let shapes = null;   // the county outlines as SVG paths, worked out once
  function countyShapes(counties, labels) {
    if (shapes) return shapes;
    const all = counties.flatMap(f => f.geometry.coordinates.flat(2));
    const x0 = Math.min(...all.map(p => p[0])), x1 = Math.max(...all.map(p => p[0]));
    const y0 = Math.min(...all.map(p => p[1])), y1 = Math.max(...all.map(p => p[1]));
    const kx = Math.cos((y0 + y1) / 2 * Math.PI / 180), k = MAP_W / ((x1 - x0) * kx), H = Math.round((y1 - y0) * k);
    const px = p => [(p[0] - x0) * kx * k, (y1 - p[1]) * k];
    // A corner within half a pixel of the last one kept is left out (the outlines are finer than the page shows).
    const ring = r => {
      const out = [];
      for (const p of r) {
        const q = px(p), last = out[out.length - 1];
        if (!last || Math.abs(q[0] - last[0]) + Math.abs(q[1] - last[1]) > 0.5) out.push(q);
      }
      return 'M' + out.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join('L') + 'Z';
    };
    shapes = {
      W: MAP_W, H, px,
      paths: counties.map(f => f.geometry.coordinates.map(poly => poly.map(ring).join('')).join('')),
      labels: (labels || []).map(l => ({ name: l.name, at: px([l.lon, l.lat]) }))
    };
    return shapes;
  }
  // The map's look: soft dots (the default), or the counties shaded by their cases in fixed steps.
  const SHADES = [[1, '1', '#d2dee6'], [2, '2 to 3', '#93b4cb'], [4, '4 to 7', '#4f86ab'], [8, '8 or more', '#1c5a83']];
  const shadeOf = n => { let c = '#fbfaf6'; for (const [from, , color] of SHADES) if (n >= from) c = color; return c; };
  function mapSvg(f, counties, labels, look) {
    const s = countyShapes(counties, labels), shaded = look === 'counties';
    const cases = new Map(f.counties.filter(c => c.washington).map(c => [c.county, c.cases]));
    const names = counties.map(x => x.properties.name);
    let g = s.paths.map((d, i) => '<path d="' + d + '" fill="' + (shaded ? shadeOf(cases.get(names[i]) || 0) : '#fbfaf6') +
      '" stroke="#8a8a8a" stroke-width="0.6"' + (shaded ? ' data-cases="' + (cases.get(names[i]) || 0) + '"' : '') + '/>').join('');
    g += s.labels.map(l => '<text x="' + l.at[0].toFixed(1) + '" y="' + l.at[1].toFixed(1) + '" font-size="6.5" text-anchor="middle"' +
      ' fill="' + (shaded && (cases.get(l.name) || 0) >= 4 ? '#fff' : '#666') + '" letter-spacing="0.5">' + esc(l.name.toUpperCase()) + '</text>').join('');
    let key = '', under = '';
    // The shades' key under the map, as the chart's (inside, it would cover the coast's counties).
    if (shaded) {
      under = '<div class="rp-key"><span>Cases:</span>' + SHADES.map(([, words, color]) => '<span><i style="background:' + color +
        ';outline:0.5px solid #888"></i>' + words + '</span>').join('') + '</div>';
    } else {
      // The past cases first, so an active dot is drawn over them. No zone rings: a dot is not at its case's point, and
      // an active row without a point has no zone (the outbreak map's link, under the map, shows the real ones).
      const dots = RP.spread(f, counties);
      for (const d of dots.filter(x => !x.active).concat(dots.filter(x => x.active))) {
        const [x, y] = s.px([d.lon, d.lat]);
        g += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="6" fill="' + (d.active ? CRIMSON : '#777') + '" fill-opacity="' +
          (d.active ? 0.75 : 0.35) + '" filter="url(#rp-soft)"' + (d.active ? ' data-active="1"' : '') + '/>';
      }
      if (f.active) key = '<g font-size="8.5" fill="#333"><circle cx="10" cy="' + (s.H - 26) + '" r="4.5" fill="' + CRIMSON +
        '" fill-opacity=".7"/><text x="19" y="' + (s.H - 23) + '">Active</text><circle cx="10" cy="' + (s.H - 12) +
        '" r="4.5" fill="#777" fill-opacity=".35"/><text x="19" y="' + (s.H - 9) + '">Past</text></g>';
    }
    return '<svg class="rp-map" viewBox="0 0 ' + s.W + ' ' + s.H + '" role="img" aria-label="Map of Washington\'s counties, ' +
      (shaded ? 'shaded by their cases' : 'one dot per case placed within its county') + '"><defs><filter id="rp-soft"><feGaussianBlur stdDeviation="1.4"/></filter></defs>' +
      g + key + '</svg>' + under;
  }

  // ---- Detections by month: commercial and backyard flocks, every other row gray ----
  // hits (Figures, on screen only): each month also gets a clear column over its whole height, data-month, for its
  // hover and its click; the month picked (pick, YYYY-MM) shaded.
  function monthChart(f, hits, pick) {
    const W = 470, H = 118, L = 22, B = 18, n = f.byMonth.length;
    if (!n) return '<p class="rp-none">No dated detections yet.</p>';
    const tot = m => m.commercial + m.backyard + m.other, max = Math.max(1, ...f.byMonth.map(tot));
    const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000].find(v => v * 4 >= max) || 1000;
    const top = Math.ceil(max / step) * step, h = H - B - 8, bw = (W - L) / n, y = v => H - B - v / top * h;
    let g = '';
    for (let v = 0; v <= top; v += step) {
      g += '<line x1="' + L + '" x2="' + W + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" stroke="#e2e8ea"/>' +
        '<text x="' + (L - 4) + '" y="' + (y(v) + 3).toFixed(1) + '" font-size="8.5" text-anchor="end" fill="#666">' + v + '</text>';
    }
    f.byMonth.forEach((m, i) => {
      const x = (L + i * bw + 0.6).toFixed(1), w = Math.max(0.8, bw - 1.2).toFixed(1);
      let base = 0;
      for (const [v, color] of [[m.backyard, BG], [m.commercial, BLUE], [m.other, GRAY]]) {
        if (v) g += '<rect x="' + x + '" y="' + y(base + v).toFixed(1) + '" width="' + w + '" height="' + (v / top * h).toFixed(1) +
          '" fill="' + color + '" data-month="' + m.month + '"/>';
        base += v;
      }
      if (m.month.endsWith('-01') || i === 0) {
        const xt = L + i * bw;
        g += '<line x1="' + xt.toFixed(1) + '" x2="' + xt.toFixed(1) + '" y1="' + (H - B) + '" y2="' + (H - B + 4) + '" stroke="#999"/>' +
          '<text x="' + (xt + 2).toFixed(1) + '" y="' + (H - 4) + '" font-size="9" fill="#444">' + m.month.slice(0, 4) + '</text>';
      }
    });
    g += '<line x1="' + L + '" x2="' + W + '" y1="' + (H - B) + '" y2="' + (H - B) + '" stroke="#999"/>';
    if (hits) {
      f.byMonth.forEach((m, i) => {
        const n = m.commercial + m.backyard + m.other;
        g += '<rect class="rp-hit' + (m.month === pick ? ' sel' : '') + '" x="' + (L + i * bw).toFixed(1) + '" y="4" width="' + bw.toFixed(1) +
          '" height="' + (H - B - 4) + '" data-month="' + m.month + '"' + (n ? ' tabindex="0" role="button" aria-label="' +
          RP.monthName(m.month) + ': ' + n + (n === 1 ? ' detection' : ' detections') + '"' : '') + '/>';
      });
    }
    const others = f.byMonth.some(m => m.other);
    return '<svg class="rp-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Detections by month">' + g + '</svg>' +
      '<div class="rp-key"><span><i style="background:' + BLUE + '"></i>Commercial</span><span><i style="background:' + BG +
      '"></i>Backyard</span>' + (others ? '<span><i style="background:' + GRAY + '"></i>Other</span>' : '') + '</div>';
  }

  // ---- Commercial and backyard: the flocks and their birds ----
  function splitBars(f, type) {
    const fl = f.flocks;
    if (!fl.commercial && !fl.backyard) return '<p class="rp-none">No commercial or backyard flocks yet.</p>';
    // data-split names the bar for Figures' hover.
    const bar = (label, a, b, words, key) => {
      const pa = Math.round(a / ((a + b) || 1) * 100);
      return '<div class="rp-split" data-split="' + key + '"><b>' + label + '</b><div class="rp-bar"><i style="width:' + pa + '%;background:' + BLUE +
        '"></i><i style="flex:1;background:' + BG + '"></i></div><div class="rp-ends"><span>Commercial <b>' + words(a) + '</b> (' + pa +
        '%)</span><span>Backyard <b>' + words(b) + '</b> (' + (100 - pa) + '%)</span></div></div>';
    };
    const fb = fl.birds, word = type.kinds[0].label;
    const rest = fl.others.map(([w, n]) => n + ' ' + w).concat(fl.untyped ? [fl.untyped + ' without a type'] : []);
    return bar('Flocks', fl.commercial, fl.backyard, fmt, 'flocks') + bar(word + ' affected', fb.commercial, fb.backyard, RP.short, 'animals') +
      (fb.commercial > fb.backyard && fl.commercial < fl.backyard ? '<div class="rp-src">A few commercial flocks hold most of the ' +
        esc(type.kinds[0].word) + '.</div>' : '') +
      (rest.length ? '<div class="rp-src">Not in the bars: ' + esc(rest.join(', ')) + '.</div>' : '');
  }

  // ---- This year's detections ----
  // The same columns in every block of the table, so the blocks read as one table.
  const COLS = '<colgroup><col style="width:12%"><col style="width:18%"><col style="width:14%"><col style="width:18%"><col style="width:22%">' +
    '<col style="width:16%"></colgroup>';
  const HEAD = '<tr><th>Confirmed</th><th>County</th><th>Flock size</th><th>Flock type</th><th>Animals</th><th>Status</th></tr>';
  const tableOf = (rows, head) => '<table class="rp-dt">' + COLS + (head ? HEAD : '') + rows.map(row).join('') + '</table>';
  const row = r => {
    const t = r.flockType.toLowerCase();
    return '<tr><td>' + RP.dateTable(r.detected) + '</td><td>' + esc(r.county === RP.COUNTY_NOT_GIVEN ? 'Not given' : r.county) +
      '</td><td>' + esc(r.size || '–') + '</td><td>' + (r.flockType ? '<span class="rp-ft" style="background:' +
      (t === 'commercial' ? BLUE : t === 'backyard' ? BG : GRAY) + '"></span>' + esc(r.flockType) : '–') + '</td><td>' + esc(r.species || '–') +
      '</td><td><span class="rp-pill' + (r.active ? ' act' : '') + '">' + (r.active ? 'Active' : 'Released') + '</span></td></tr>';
  };

  // ---- Small parts ----
  const tile = t => '<div class="rp-tile' + (t.active ? ' act' : '') + '"><div class="l">' + esc(t.label) + '</div><div class="v">' +
    esc(t.value) + '</div>' + (t.sub ? '<div class="s">' + esc(t.sub) + '</div>' : '') + '</div>';
  // Each card's icon in a soft circle, the brand's gold, grass green, light blue and orange in turn (k, the card's place).
  const card = (icon, style, headline, body, highlight, m, k) => '<div class="rp-card' + (highlight ? ' hl' : '') + '" data-m="' + m + '">' +
    '<span class="rp-ic a' + (k % 4) + '">' + MI.svg(icon, style, 22) + '</span>' +
    '<div><b class="h">' + esc(headline) + '</b>' + body + '</div></div>';
  const h3 = (title, small) => '<h3>' + esc(title) + (small ? '<small>' + small + '</small>' : '') + '</h3>';

  // ---- Page 2 (2.9): national, USDA's three maps as staff's pictures, Washington's wild birds,
  // testing with WADDL's lists and the "Report sick birds" box, the resources. A value is report-form.js's as it
  // prints, or null: "not filled", never last month's.
  const NF = '<span class="rp-nf">not filled</span>';
  const val = (v, more) => v === null || v === undefined ? NF : esc(v) + (more || '');
  const linkOr = l => l.url ? link(l) : '<span>' + esc(l.label) + '</span>';
  const source = url => url ? link({ url, label: 'Data source' }) : 'Data source';
  function page2Blocks(p, hot) {
    const n = p.nat, wl = p.wild, t = p.tests, out = [];
    const both = (a, b) => a === null || b === null ? '' : a + ' commercial · ' + b + ' backyard';
    const tile2 = (label, value, sub) => '<div class="rp-tile"><div class="l">' + esc(label) + '</div><div class="v">' + value + '</div>' +
      (sub ? '<div class="s">' + sub + '</div>' : '') + '</div>';
    const plural = (v, one, more) => v === null ? '' : v + ' ' + (v === '1' ? one : more);
    out.push(h3('National (USDA)', 'as of ' + val(n.asOf) + ' · ' + source(n.source)) + '<div class="rp-tiles">' +
      tile2('Birds affected', val(n.birds, 'M'), 'since 2022') + tile2('Flocks', val(n.flocks), esc(both(n.commercial, n.backyard))) +
      tile2('States', val(n.states), n.territories === null ? '' : 'and ' + esc(plural(n.territories, 'territory', 'territories'))) +
      tile2('Flocks, 30 days', val(n.flocks30), esc(both(n.c30, n.b30))) + tile2('Birds, 30 days', val(n.birds30, 'M'), 'in those flocks') +
      tile2('Livestock, 30 days', val(n.lvCases), n.lvStates === null ? '' : 'cases in ' + esc(plural(n.lvStates, 'state', 'states'))) + '</div>' +
      '<div class="rp-src">Regional confirmations in the last 30 days: ' + val(n.regional30) + ' flocks, ' + val(n.lvRegional) + ' livestock. ' +
      'Testing and genetic sequencing information: ' + (n.sequencing ? link({ url: n.sequencing, label: 'USDA\'s page' }) : 'USDA\'s page') + '.</div>');
    const frame = (title, line, src, pic) => '<figure><figcaption>' + esc(title) + '</figcaption><div class="sub">' + line + '</div><div class="rp-pic">' +
      (pic ? '<img src="' + esc(pic) + '" alt="USDA\'s map: ' + esc(title) + '">' : '<span class="rp-nf">no picture added</span>') + '</div><div class="sub">' +
      source(src) + '</div></figure>';
    out.push(h3('States with detections, last 30 days', 'USDA\'s maps') + '<div class="rp-maps">' +
      frame('Domestic flocks', 'Last reported detection: ' + val(n.lastFlock), n.source, p.maps.flocks) +
      frame('Domestic livestock', 'Last new confirmed case: ' + val(n.lastLivestock), n.lvSource, p.maps.livestock) +
      frame('Wild birds', 'Samples collected ' + val(wl.window), wl.source, p.maps.wild) + '</div>');
    const none = (v, ticked) => ticked ? 'None' : val(v);
    const sub = (v, ticked) => ticked ? 'no detections reported' : 'detections';
    out.push(h3('Washington: wild birds and wild mammals', source(wl.source)) + '<div class="rp-tiles t3">' +
      tile2('Wild birds since 2021', val(wl.since), 'detections') + tile2('Wild birds, last 30 days', none(wl.d30, wl.d30None), sub(wl.d30, wl.d30None)) +
      tile2('Wild mammals, last 30 days', none(wl.m30, wl.m30None), sub(wl.m30, wl.m30None)) + '</div>');
    // The tests by category, largest first, "Not specified" last in gray; a category not filled says so.
    const other = c => /^not specified$/i.test(c.name);
    const cats = t.cats.filter(c => !other(c)).sort((a, b) => b.value - a.value).concat(t.cats.filter(other));
    const max = Math.max(1, ...cats.map(c => c.value)), L = 122, BW = 135;
    const bars = cats.length ? '<svg class="rp-bars" viewBox="0 0 300 ' + (cats.length * 13 + 4) + '" role="img" aria-label="HPAI tests by category">' + cats.map((c, i) => {
      const filled = typeof c.n === 'number', wv = filled ? Math.max(1, c.value / max * BW) : 0;
      return '<text x="' + (L - 6) + '" y="' + (11 + i * 13) + '" font-size="9" text-anchor="end" fill="#333">' + esc(c.name.length > 24 ? c.name.slice(0, 23) + '…' : c.name) + '</text>' +
        '<rect x="' + L + '" y="' + (2 + i * 13) + '" width="' + wv.toFixed(1) + '" height="11" fill="' + (other(c) ? '#b8b8b8' : TEAL) + '"/>' +
        '<text x="' + (L + wv + 4).toFixed(1) + '" y="' + (11 + i * 13) + '" font-size="9.5" font-weight="700" fill="' + (filled ? '#222' : '#9a3b00') + '">' +
        (filled ? fmt(c.n) : c.n === null ? 'not filled' : esc(c.n)) + '</text>';
    }).join('') + '</svg>' : '<p class="rp-none">No categories typed.</p>';
    const group = g => '<div><b>' + esc(g.name) + '</b>' + g.links.map(linkOr).join('') + '</div>';
    const call = p.call.map((c, i) => '<b>' + esc(c.headline) + '</b><span>' + esc(c.text) + (c.link ? ' ' + (c.link.url ? link(c.link) : esc(c.link.label)) + '.' : '') + '</span>' +
      (i === 0 && (hot.name || hot.number) ? '<div class="ph">' + esc(hot.name) + ' <span>' + esc(hot.number) + '</span></div>' : '')).join('');
    out.push(h3('Testing (WADDL)', 'as of ' + val(t.asOf)) + '<p class="rp-p">' + esc(t.intro) + ' There have been over <b>' + val(t.total) +
      '</b> HPAI PCR tests run for Washington since ' + esc(t.since) + '.</p><div class="rp-test"><div><div class="rp-cap">HPAI testing by category</div>' + bars + '</div>' +
      '<div class="rp-res waddl">' + p.testingLists.map(group).join('') + '</div><div class="rp-call">' + call + '</div></div>');
    out.push(h3('Resources') + '<div class="rp-res r3">' + p.resources.map(group).join('') + '</div>');
    return out.map(html => ({ html, start: html, p2: true }));
  }

  // The blocks of the pages, in order; each group starts a new page.
  function blocks(f, w, type, counties, labels, ch) {
    const rp = type.report, style = ch.iconStyle, note = String(ch.note || '').trim();
    const banner = '<div class="rp-banner' + (w.banner.active ? ' act' : '') + '"><span class="dot"></span><div><b>' +
      esc(w.banner.headline) + '</b><span>' + esc(w.banner.line) + '</span></div></div>';
    const tiles = '<div class="rp-tiles">' + w.tiles.map(tile).join('') + '</div><div class="rp-src">' + esc(w.source) +
      (w.also.length ? ' Also since ' + w.since + ': ' + esc(w.also.join(' · ')) + '.' : '') + '</div>' +
      (note ? '<div class="rp-note-p"><b>Note:</b> ' + esc(note) + '</div>' : '');
    const rest = f.counties.filter(c => !c.washington);
    const max = Math.max(1, ...f.counties.map(c => c.cases));
    const clist = f.counties.map(c => '<div' + (c.washington ? '' : ' class="out"') + '><span>' + esc(c.county === RP.COUNTY_NOT_GIVEN
      ? 'Not given' : c.county) + '</span><i style="width:' + (c.cases / max * 100).toFixed(1) + '%"></i><em>' + fmt(c.cases) + '</em></div>').join('');
    // The outbreak map's line under the county list, as the update has it beside its map (the list's column is the
    // shorter one, so page 1 keeps room for the key messages).
    const mapRow = '<div class="rp-row"><div>' + h3('Where the cases have been', ch.mapLook === 'counties' ? 'counties shaded by their cases'
      : 'a dot per case, within its county') + mapSvg(f, counties, labels, ch.mapLook) + '</div>' +
      '<div>' + h3('Cases by county', fmt(f.cases) + ' in all') + (f.counties.length ? '<div class="rp-clist">' + clist + '</div>' : '<p class="rp-none">No cases.</p>') +
      (rest.length ? '<div class="rp-src">' + esc(rest.map(c => c.county === RP.COUNTY_NOT_GIVEN ? 'Not given: no county and no map point in the table'
        : c.county + ': not a Washington county').join('; ')) + '.</div>' : '') +
      '<div class="rp-under">Access the ' + link(rp.map) + ' for surveillance areas. ' + esc(w.zones) + '</div></div></div>';
    const span = f.byMonth.length ? RP.dateLong(f.byMonth[0].month + '-01').replace(/ 1,/, '') + ' to ' +
      RP.dateLong(f.byMonth[f.byMonth.length - 1].month + '-01').replace(/ 1,/, '') : '';
    const chartRow = '<div class="rp-row r2"><div>' + h3('Detections by month', esc(span)) + monthChart(f) + '</div><div>' +
      h3('Commercial and backyard', 'since ' + w.since) + splitBars(f, type) + '</div></div>';
    const first = f.thisYear.slice(0, FIRST_ROWS), later = f.thisYear.slice(FIRST_ROWS);
    const table = h3(f.year + ' detections', esc(RP.SIZE_LINE)) + (first.length ? tableOf(first, true)
      : '<p class="rp-none">No detections in ' + f.year + ' so far.</p>') +
      (later.length ? '<div class="rp-more">and ' + later.length + ' more, listed at the end of this update</div>' : '');
    // The key messages, two to a row, the livestock card from the data last.
    // The form's messages (report-form.js choices), or the type's own; a link without an address the browser opens
    // prints as its words.
    const cards = (ch.messages || rp.messages).map((m, i) => card(m.icon, style, m.headline, esc(m.text) +
      (m.link ? ' ' + (m.link.url ? link(m.link) : esc(m.link.label)) + '.' : ''), m.highlight, i, i));
    const lv = w.livestock;
    if (lv) {
      cards.push(card('droplet', style, lv.headline, esc(lv.text) + ' Washington state has <b>' + esc(lv.stage) + '</b> status under the ' +
        link(rp.milkLink) + '. ' + esc(lv.stageText) + lv.others.map(o => '<span class="rp-also">' + esc(o) + '</span>').join(''), lv.highlight, 'lv', cards.length));
    }
    const rows = [];
    for (let i = 0; i < cards.length; i += 2) rows.push('<div class="rp-cards">' + cards.slice(i, i + 2).join('') + '</div>');
    if (rows.length) rows[0] = h3('Key messages') + rows[0];
    // This year's detections past the first rows follow the key messages, MORE_ROWS a block, so they fill each page; the
    // first block, and a block that starts a page, has the heading and the column names (start).
    const more = [], again = h3(f.year + ' detections, continued', esc(RP.SIZE_LINE));
    for (let i = 0; i < later.length; i += MORE_ROWS) {
      const part = later.slice(i, i + MORE_ROWS), start = again + tableOf(part, true);
      more.push(i ? { html: tableOf(part, false), start, cont: true } : start);
    }
    // Page 2 after the key messages; this year's detections past page 1's rows stay at the end, as page 1
    // says.
    const p2 = ch.page2 ? page2Blocks(ch.page2, (ch.page && ch.page.hotline) || rp.hotline) : [];
    return [[banner, tiles, mapRow, chartRow, table].concat(rows, p2, more)];
  }

  // ---- The pages: each block on the current page, or the next when it does not fit ----
  // The title's line and the foot are the form's (choices.page), or the type's own; a part left empty is left out of
  // its sentence. Until "Ready to send" (choices.draft), each page carries a DRAFT mark over it, which takes no room,
  // so the draft's pages are the sent update's.
  function flow(sheets, groups, type, date, ch) {
    const rp = type.report, pg = ch.page || {}, logo = root.WSDA.brand && root.WSDA.brand.LOGO.dataUrl || '';
    const note = pg.note !== undefined ? pg.note : rp.note, hot = pg.hotline || rp.hotline, online = pg.online || rp.online;
    const alternate = pg.alternate !== undefined ? pg.alternate : rp.alternate;
    const head = '<div class="rp-head"><img src="' + logo + '" alt="Washington State Department of Agriculture"><div class="t"><b>' +
      esc(rp.title) + '</b>' + (note ? '<span>' + esc(note) + '</span>' : '') + '</div><div class="d">' + RP.dateLong(date) +
      '<small class="pg"></small></div></div>';
    const call = hot.name || hot.number ? 'Call ' + (hot.name ? 'the ' + esc(hot.name) + (hot.number ? ', ' : '') : '') +
      (hot.number ? '<b>' + esc(hot.number) + '</b>' : '') + ', or report' : 'Report';
    const foot = '<div class="rp-foot"><div class="hot">' + (hot.ask ? '<b>' + esc(hot.ask) + '</b> ' : '') + call + ' online at ' +
      (online.url ? link(online) : esc(online.label)) + '</div>' + (alternate ? '<div>' + esc(alternate) + '</div>' : '') + '</div>';
    const mark = ch.draft ? '<div class="rp-draft" aria-hidden="true">DRAFT</div><div class="rp-draft-tag">Draft: not yet ready to send</div>' : '';
    sheets.replaceChildren();
    const newPage = () => {
      const p = root.document.createElement('div');
      p.className = 'rp-page';
      p.innerHTML = head + '<div class="rp-body"></div>' + foot + mark;
      sheets.appendChild(p);
      return p.querySelector('.rp-body');
    };
    // A block that runs past the page's foot starts the next page (9 px: the last block's own bottom margin). A block
    // is its HTML, or { html, start, cont } for one drawn as start when it begins a page, and as html right under the
    // block before it (cont: no gap between them).
    for (const group of groups) {
      let body = newPage();
      for (const x of group) {
        const item = typeof x === 'string' ? { html: x, start: x } : x;
        const b = root.document.createElement('div');
        const first = !body.children.length;
        b.className = 'rp-blk' + (item.cont && !first ? ' cont' : '') + (item.p2 ? ' rp-p2' : '');
        b.innerHTML = first ? item.start : item.html;
        if (item.cont && !first) body.lastElementChild.classList.add('joined');
        body.appendChild(b);
        if (body.scrollHeight - 9 > body.clientHeight && body.children.length > 1) {
          b.remove();
          if (item.cont) body.lastElementChild.classList.remove('joined');
          body = newPage();
          b.className = 'rp-blk' + (item.p2 ? ' rp-p2' : '');
          b.innerHTML = item.start;
          body.appendChild(b);
        }
      }
    }
    const all = sheets.querySelectorAll('.rp-page');
    all.forEach((p, i) => { p.querySelector('.pg').textContent = 'Page ' + (i + 1) + ' of ' + all.length; });
    return all.length;
  }

  // The pages scaled to the box's width (at most their own size), and the box as tall as they are.
  function fit(box) {
    const sheets = box.querySelector('.rp-sheets'), avail = box.clientWidth, k = Math.min(1, avail / 816);
    if (!avail) return;
    sheets.style.transform = 'scale(' + k + ')';
    box.style.height = Math.ceil(sheets.scrollHeight * k) + 'px';
  }

  // Where each card printed and how many lines its words take (for the form's line counts): { m (the message's index
  // among those printed, or 'lv' for the livestock card), page, row (one number per row of two cards), lines }.
  function cardsOf(sheets) {
    const out = [];
    let row = 0;
    sheets.querySelectorAll('.rp-page').forEach((p, pi) => p.querySelectorAll('.rp-cards').forEach(r => {
      row++;
      r.querySelectorAll('.rp-card').forEach(c => {
        const body = c.lastElementChild, lh = parseFloat(root.getComputedStyle(body).lineHeight) || 14.5;
        out.push({ m: c.dataset.m === 'lv' ? 'lv' : +c.dataset.m, page: pi + 1, row, lines: Math.max(1, Math.round(body.offsetHeight / lh)) });
      });
    }));
    return out;
  }

  const api = { last: null };
  function draw(box, o) {
    const f = RP.figures(o.read, o.date, o.counties);
    const ch = o.choices || {}, words = RP.wording(f, o.type, ch, o.counties.length);
    const pages = flow(box.querySelector('.rp-sheets'), blocks(f, words, o.type, o.counties, o.labels, ch), o.type, o.date, ch);
    fit(box);
    api.last = { figures: f, words, pages, cards: cardsOf(box.querySelector('.rp-sheets')) };
    return api.last;
  }
  const title = (type, date) => type.id.toUpperCase() + ' update ' + date;

  // The parts Figures (report-figures.js) draws with, so the screen and the pages look alike.
  const parts = { countyShapes, SHADES, shadeOf, monthChart, splitBars, tableOf, tile, CRIMSON };
  root.WSDA.emergencyReportView = Object.assign(api, { draw, fit, title, parts });
})(window);
