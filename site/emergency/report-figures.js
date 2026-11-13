/* Emergency Response, the Report view's "Figures" (2.9, E2): page 1's figures on screen, full width, for reading, not
 * printing: the fallback should the ArcGIS Dashboard not be available. Internal only: the map shows each case at its
 * own place, which the printed update never does, so Figures is never printed (index.html's print styles).
 *
 * The figures are report.js's on the report's date, as the printed pages count them (every row, mapped or not), and
 * drawn with the pages' own parts (report-view.js parts), so the screen and the update always agree. What Figures
 * adds:
 *   - only what the data says: the banner's line is the wording that fits the data, never the form's typed wording;
 *   - a hover on every tile, county, month and bar, and on each place on the map, saying its number and how it is
 *     counted (report.js hover); the keyboard's focus shows the same;
 *   - a click (or Enter) on a county or a month narrows the table to its cases; again, or the "×" beside its name,
 *     gives the whole of this year's detections back;
 *   - the map's switch "Places | Counties" (Places first): each case at its place, crimson when active with its
 *     zones around it (the type's rings); or the
 *     counties shaded by their cases, as the printed choice, a click on a county listing its cases;
 *   - on a phone the month chart scrolls sideways inside its frame, the latest months shown first.
 *
 * WSDA.emergencyReportFigures.draw(box, { read, type, date, counties, labels }) draws into box (#rp-fig-body) and
 *   returns { figures, words, pick, look, listed }; reset() puts the pick and the map's look back (a new file); refit()
 *   brings the month chart's latest months into view again (the window's width changed).
 * Kept for the tests: last, the last drawing's result. */
(function (root) {
  'use strict';
  const RP = root.WSDA.emergencyReport, RV = root.WSDA.emergencyReportView, P = RV.parts;
  const esc = t => String(t === null || t === undefined ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = n => n.toLocaleString('en-US');

  const api = { last: null };
  let pick = null, look = 'places', drawn = null, tips = [];

  // A hover's words as the page writes them: the head in bold, then its number, then each line under it.
  const tipHtml = t => '<b>' + esc(t.head) + '</b>' + (t.text ? ': ' + esc(t.text) : '') + t.lines.map(l => '<br>' + esc(l)).join('');
  const tipOf = t => { tips.push(t); return ' data-tip="' + (tips.length - 1) + '"'; };
  const h3 = (title, small) => '<h3>' + esc(title) + (small ? '<small>' + small + '</small>' : '') + '</h3>';

  // ---- The map: Places (each case at its place) or Counties (shaded by their cases) ----
  function mapSvg(f, o) {
    const s = P.countyShapes(o.counties, o.labels), shaded = look === 'counties';
    const byName = new Map(f.counties.filter(c => c.washington).map(c => [c.county, c]));
    const names = o.counties.map(x => x.properties.name);
    let g = s.paths.map((d, i) => {
      const c = byName.get(names[i]), n = c ? c.cases : 0;
      if (!shaded) return '<path d="' + d + '" fill="#fbfaf6" stroke="#8a8a8a" stroke-width="0.6"/>';
      const hit = n ? ' data-county="' + esc(names[i]) + '" tabindex="0" role="button" aria-label="' + esc(names[i]) + ': ' + n + (n === 1 ? ' case' : ' cases') + '"' : '';
      const tip = c ? tipOf(RP.hover.county(f, c, !!(pick && pick.county === c.county)))
        : tipOf({ head: names[i], text: 'no cases since ' + (f.byMonth.length ? f.byMonth[0].month.slice(0, 4) : f.year), lines: [] });
      return '<path d="' + d + '" fill="' + P.shadeOf(n) + '" stroke="' + (pick && pick.county === names[i] ? '#245566' : '#8a8a8a') +
        '" stroke-width="' + (pick && pick.county === names[i] ? 2 : 0.6) + '"' + hit + tip + '/>';
    }).join('');
    g += s.labels.map(l => '<text x="' + l.at[0].toFixed(1) + '" y="' + l.at[1].toFixed(1) + '" font-size="6.5" text-anchor="middle" fill="' +
      (shaded && (byName.get(l.name) || { cases: 0 }).cases >= 4 ? '#fff' : '#666') + '" letter-spacing="0.5" pointer-events="none">' +
      esc(l.name.toUpperCase()) + '</text>').join('');
    let key;
    if (shaded) {
      key = '<div class="rp-key"><span>Cases:</span>' + P.SHADES.map(([, words, color]) => '<span><i style="background:' + color +
        ';outline:0.5px solid #888"></i>' + words + '</span>').join('') + '</div>';
    } else {
      // Each active place's zones, the type's own rings (dashed, under the marks), as the live map draws them; a
      // degree of latitude is 111.32 km.
      const all = RP.places(f), zones = o.type.zones.source === 'rings' ? o.type.zones.rings : [];
      const perKm = Math.abs(s.px([0, 1])[1] - s.px([0, 0])[1]) / 111.32 * (o.type.zones.unit === 'mi' ? 1.609344 : 1);
      for (const p of all.filter(x => x.active)) {
        const [x, y] = s.px([p.lon, p.lat]);
        g += zones.slice().reverse().map(z => '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (z.distance * perKm).toFixed(1) +
          '" fill="' + z.color + '" fill-opacity="0.08" stroke="' + z.color + '" stroke-width="0.8" stroke-dasharray="2.5 1.5" class="rp-zone" pointer-events="none"/>').join('');
      }
      for (const p of all) {
        const [x, y] = s.px([p.lon, p.lat]);
        g += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (p.active ? 4.2 : 3.6) + '" fill="' + (p.active ? P.CRIMSON : '#555') +
          '" fill-opacity="' + (p.active ? 0.95 : 0.85) + '" stroke="#fff" stroke-width="0.8" class="rp-place"' + (p.active ? ' data-active="1"' : '') +
          ' data-cases="' + p.cases.length + '"' + tipOf(RP.hover.place(p)) + '/>';
      }
      key = '<div class="rp-key"><span><i class="pt act"></i>Active</span><span><i class="pt"></i>Closed</span>' +
        (f.noPoint ? '<span>' + f.noPoint + (f.noPoint === 1 ? ' case' : ' cases') + ' without a map point: in the counts, not on the map</span>' : '') + '</div>';
    }
    return '<svg class="rp-map" viewBox="0 0 ' + s.W + ' ' + s.H + '" role="img" aria-label="Map of Washington\'s counties, ' +
      (shaded ? 'shaded by their cases' : 'each case at its place') + '">' + g + '</svg>' + key;
  }

  // ---- The cases by county, the most first; a click narrows the table ----
  function countyList(f) {
    const max = Math.max(1, ...f.counties.map(c => c.cases));
    return f.counties.map(c => {
      const on = !!(pick && pick.county === c.county), word = c.county === RP.COUNTY_NOT_GIVEN ? 'Not given' : c.county;
      return '<div class="' + (c.washington ? '' : 'out') + (on ? ' sel' : '') + '" data-county="' + esc(c.county) + '" tabindex="0" role="button"' +
        ' aria-pressed="' + on + '"' + tipOf(RP.hover.county(f, c, on)) + '><span>' + esc(word) + '</span><i style="width:' +
        (c.cases / max * 100).toFixed(1) + '%"></i><em>' + fmt(c.cases) + '</em></div>';
    }).join('');
  }

  function draw(box, o) {
    const f = RP.figures(o.read, o.date, o.counties);
    // Only what the data says: the wording that fits the data (no typed status, no note).
    const w = RP.wording(f, o.type, {}, o.counties.length);
    if (pick && pick.month && !f.byMonth.some(m => m.month === pick.month)) pick = null;   // a month past the date moved back
    if (pick && pick.county && !f.counties.some(c => c.county === pick.county)) pick = null;
    tips = [];
    const banner = '<div class="rp-banner' + (w.banner.active ? ' act' : '') + '"><span class="dot"></span><div><b>' +
      esc(w.banner.headline) + '</b><span>' + esc(w.banner.line) + '</span></div></div>';
    const tiles = '<div class="rp-tiles">' + w.tiles.map((t, i) => P.tile(t).replace('<div class="rp-tile', '<div tabindex="0"' +
      tipOf(RP.hover.tile(f, o.type, w, i, o.counties.length)) + ' class="rp-tile')).join('') + '</div>';
    const lst = RP.picked(f, pick);
    const span = f.byMonth.length ? RP.monthName(f.byMonth[0].month) + ' to ' + RP.monthName(f.byMonth[f.byMonth.length - 1].month) : '';
    const n = f.byMonth.length, chart = P.monthChart(f, true, pick && pick.month).replace('<svg class="rp-chart"',
      '<div class="rp-fig-scroll"><svg class="rp-chart" style="min-width:' + (n * 9 + 30) + 'px"').replace('</svg>', '</svg></div>')
      // Each month's clear column takes its hover (the bars under it have none).
      .replace(/<rect class="rp-hit[^>]*? data-month="(\d{4}-\d{2})"/g, (all, ym) =>
        all + tipOf(RP.hover.month(f, f.byMonth.find(x => x.month === ym), !!(pick && pick.month === ym))));
    const split = P.splitBars(f, o.type).replace(/<div class="rp-split" data-split="(\w+)"/g, (all, k) => all + ' tabindex="0"' +
      tipOf(RP.hover.split(f, o.type, k)));
    const lookSwitch = '<span class="rp-look" role="group" aria-label="The map shows"><button type="button" class="btn" data-look="places" aria-pressed="' +
      (look === 'places') + '">Places</button><button type="button" class="btn" data-look="counties" aria-pressed="' + (look === 'counties') + '">Counties</button></span>';
    const chip = lst.chip ? '<button type="button" class="rp-chip" data-clear="1" aria-label="Show every ' + f.year + ' detection">' + esc(lst.chip) +
      ' <span aria-hidden="true">×</span></button>' : '';
    const count = (lst.of === null ? lst.rows.length : lst.rows.length + ' of ' + lst.of) + ' · ' + RP.SIZE_LINE;
    box.innerHTML =
      '<div class="rp-panel">' + banner + tiles + '<div class="rp-src">' + esc(w.source) + '</div></div>' +
      '<div class="rp-grid"><div class="rp-panel" id="rp-fig-map"><h3>Where the cases have been' + lookSwitch + '</h3>' + mapSvg(f, o) +
        '<div class="rp-src">' + (look === 'places' ? 'Each case at its place in the table (internal; never printed).' : 'Click a county to list its cases.') + '</div></div>' +
      '<div class="rp-panel" id="rp-fig-counties">' + h3('Cases by county', fmt(f.cases) + ' in all · click a county') +
        (f.counties.length ? '<div class="rp-clist">' + countyList(f) + '</div>' : '<p class="rp-none">No cases.</p>') + '</div></div>' +
      '<div class="rp-panel rp-row r2"><div>' + h3('Detections by month', esc(span)) + chart + '</div><div>' +
        h3('Commercial and backyard', 'since ' + w.since) + split + '</div></div>' +
      '<div class="rp-panel" id="rp-fig-table"><h3>' + esc(lst.heading) + chip + '<small>' + esc(count) + '</small></h3>' +
        // The pages' table without its fixed columns, so a phone's narrower table (two columns left out) sizes itself.
        (lst.rows.length ? P.tableOf(lst.rows, true).replace(/<colgroup>.*?<\/colgroup>/, '') : '<p class="rp-none">' + esc(lst.none) + '</p>') +
        (lst.chip ? '<div class="rp-more">Click ' + (pick.month ? 'the month' : 'the county') + ' again, or the × beside its name, to list every ' +
          f.year + ' detection.</div>' : '') + '</div>';
    const scroll = box.querySelector('.rp-fig-scroll');
    if (scroll) scroll.scrollLeft = scroll.scrollWidth;
    drawn = { box, o };
    api.last = { figures: f, words: w, pick, look, listed: lst };
    return api.last;
  }
  const again = () => { if (drawn) draw(drawn.box, drawn.o); };

  // ---- The hover box: one at a time, under the pointer, or under the figure the keyboard's focus is on ----
  function showTip(fig, el, x, y) {
    const t = tips[+el.dataset.tip], box = fig.querySelector('.rp-tipbox');
    if (!t || !box) return;
    box.innerHTML = tipHtml(t);
    box.hidden = false;
    box.style.left = '0px';   // measured at the frame's left, at its own width (by the right edge it would wrap narrower)
    const r = fig.getBoundingClientRect();
    if (x === undefined) {
      const e = el.getBoundingClientRect();
      x = e.left + Math.min(e.width, 40);
      y = e.bottom;
    }
    let left = x - r.left + 12;
    if (left + box.offsetWidth > fig.clientWidth - 4) left = Math.max(4, x - r.left - box.offsetWidth - 12);
    box.style.left = left + 'px';
    box.style.top = (y - r.top + 14) + 'px';
  }
  const hideTip = fig => { const box = fig.querySelector('.rp-tipbox'); if (box) box.hidden = true; };

  // The figure under a click or a key: a county (the list's or the shaded map's), a month, the chip or the map's look.
  function act(target) {
    const el = target.closest('[data-county], [data-month], [data-clear], [data-look]');
    if (!el) return false;
    if (el.dataset.look) {
      if (look === el.dataset.look) return true;
      look = el.dataset.look;
    } else if (el.dataset.clear) pick = null;
    else if (el.dataset.county !== undefined) pick = pick && pick.county === el.dataset.county ? null : { county: el.dataset.county };
    else {
      const m = el.dataset.month;
      if (!el.hasAttribute('tabindex')) return true;   // a month without detections
      pick = pick && pick.month === m ? null : { month: m };
    }
    const focus = el.dataset.county !== undefined ? '[data-county="' + el.dataset.county.replace(/"/g, '\\"') + '"]'
      : el.dataset.month ? '[data-month="' + el.dataset.month + '"]' : el.dataset.look ? '[data-look="' + el.dataset.look + '"]' : null;
    again();
    // The keyboard's place kept on the figure clicked (the chip's goes back to the table).
    const back = focus && drawn.box.querySelector(focus);
    if (back && root.document.activeElement === root.document.body) back.focus({ preventScroll: true });
    return true;
  }

  // Wired once, on the Figures frame (#rp-figures): the drawing inside it is made again at each change.
  function wire(fig) {
    fig.addEventListener('pointerover', e => {
      const el = e.target.closest('[data-tip]');
      if (el && fig.contains(el)) showTip(fig, el, e.clientX, e.clientY);
    });
    fig.addEventListener('pointermove', e => {
      const el = e.target.closest('[data-tip]');
      if (el) showTip(fig, el, e.clientX, e.clientY);
      else hideTip(fig);
    });
    fig.addEventListener('pointerleave', () => hideTip(fig));
    fig.addEventListener('focusin', e => {
      const el = e.target.closest('[data-tip]');
      if (el) showTip(fig, el);
      else hideTip(fig);
    });
    fig.addEventListener('focusout', () => hideTip(fig));
    fig.addEventListener('click', e => { if (act(e.target)) hideTip(fig); });
    fig.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const el = e.target.closest('[data-county], [data-month]');
      if (!el) return;
      e.preventDefault();
      act(el);
    });
  }

  const reset = () => { pick = null; look = 'places'; };
  // The month chart's latest months in view again after the window's width changes.
  const refit = () => { const el = drawn && drawn.box.querySelector('.rp-fig-scroll'); if (el) el.scrollLeft = el.scrollWidth; };

  root.WSDA.emergencyReportFigures = Object.assign(api, { draw, wire, reset, refit });
})(window);
