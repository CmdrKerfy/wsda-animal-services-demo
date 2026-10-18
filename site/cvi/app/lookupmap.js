/* The Premise Lookup match map, after CVI's result_map in
 * shiny/modules/mod_premise_lookup.R. Made at the first query result (lookup.js loads this file then). It is a map.js
 * map of its own kind, so basemaps, the request gate, contrast, credits, the fit button and the screenshot are
 * map.js's; Washington's land and county lines are under it.
 *
 * What it draws (lookup.mapData gives it): each site's buffer bands as rings, gray by their radius among all radii
 * drawn (fill opacity 0.22, outline 1.5 px; CVI's neutral grays, so the rings do not compete with the points); the
 * matched rows' endpoints that fell inside a buffer, origins #F0A06E and destinations #1C9CD9 (radius 5, opacity 0.9,
 * white 1.2 px ring); the sites on top, #c0392b (radius 8, white 2 px ring). Hover (CVI's tooltips): an endpoint's
 * "City, ST", a site's name; a click on a site opens its name (CVI's popup). The view fits the bands (else the sites)
 * after every result, as CVI's fit_bounds.
 *
 * Deliberate differences: CVI draws this map on CARTO Positron tiles, fetched from the internet; here it is the
 * page's offline county map (no request), with the house button returning to the result's view. The county names
 * are page elements above the map, so a name whose box would cover a site or a matched point is hidden (class
 * "covered", also left out of the screenshot), checked after each result and each move; CVI's basemap names lie
 * under its points.
 *
 * Also zones (drawn as the bands are, in the inner color), the facilities inside in their layer's color
 * (radius 5, white 1.2 px ring; hover "Name (Layer)"), the spot picked with Pick on map (a hollow red ring), and a
 * small legend in the bottom left corner: the sites, origins and destinations drawn,
 * each ring radius in its color, zones, and the facility layers with their counts. The legend is a page element; the
 * screenshot draws it too, and a county name under it is hidden like one over a site.
 *
 * create(container, geo, onReady, onError, opts) -> the map's state (map.js create with this kind); opts.legend: the
 *   legend's element
 * The population layers (map.js setPopulation, switched in Premise Lookup's sidebar) get their block in
 * the legend (setPopulationLegend), drawn in the screenshot too.
 *
 * draw(st, data) -> draws data ({ bands, origins, dests, sites, facilities, legend, bounds }) and fits the view
 * setPopulationLegend(st, entries) -> the legend's population block (population.js legendEntries), the view kept
 * fit(st) -> the result's view again (the house button)
 * setPicking(st, on, onPick) -> while on, a click on the map calls onPick(lon, lat) (no site popup), crosshair cursor
 * setPick(st, [lon, lat] | null) -> marks the picked spot
 */
(function (root) {
  'use strict';
  const M = () => root.CVIWA.map;
  const SRC = { bands: 'lookup_bands', facilities: 'lookup_facilities', origins: 'lookup_origins',
    dests: 'lookup_dests', sites: 'lookup_sites', pick: 'lookup_pick' };
  // What the hover looks at, topmost first (the facilities over the sites).
  const POINT_LAYERS = ['lookup_fac', 'lookup_sites', 'lookup_dests', 'lookup_origins'];
  const ORIGIN = '#F0A06E', DEST = '#1C9CD9', SITE = '#c0392b';
  const empty = () => ({ type: 'FeatureCollection', features: [] });
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const points = (list, label) => ({ type: 'FeatureCollection', features: list.map((p, i) => ({ type: 'Feature',
    id: i + 1, geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: p.color ? { label: label(p), color: p.color, mark: M().markId(p.shape || 'circle', p.color) }
      : { label: label(p) } })) });

  const KIND = {
    isOwn: id => /^lookup_/.test(String(id)),
    hoverLayers: () => POINT_LAYERS,
    sources(st) {
      const d = st.lookup || {};
      return {
        [SRC.bands]: { type: 'geojson', data: d.bands || empty() },
        [SRC.facilities]: { type: 'geojson', data: d.facilities || empty() },
        [SRC.origins]: { type: 'geojson', data: d.origins || empty() },
        [SRC.dests]: { type: 'geojson', data: d.dests || empty() },
        [SRC.sites]: { type: 'geojson', data: d.sites || empty() },
        [SRC.pick]: { type: 'geojson', data: d.pick || empty() }
      };
    },
    layers() {
      const dot = (id, source, color, radius, opacity, ring) => ({ id, type: 'circle', source, paint: {
        'circle-color': color, 'circle-radius': radius, 'circle-opacity': opacity,
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': ring } });
      return [
        // The bands' fill and outline are stronger than CVI's (0.22, 1.5 px) so the band colors read.
        { id: 'lookup_band_fill', type: 'fill', source: SRC.bands,
          paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.35 } },
        { id: 'lookup_band_line', type: 'line', source: SRC.bands,
          paint: { 'line-color': ['get', 'color'], 'line-width': 2 } },
        dot('lookup_origins', SRC.origins, ORIGIN, 5, 0.9, 1.2),
        dot('lookup_dests', SRC.dests, DEST, 5, 0.9, 1.2),
        // A query site as a bullseye: a white-centered red ring, then its dot.
        { id: 'lookup_sites', type: 'circle', source: SRC.sites, paint: { 'circle-color': '#ffffff', 'circle-radius': 7.5,
          'circle-opacity': 1, 'circle-stroke-color': SITE, 'circle-stroke-width': 3.5 } },
        { id: 'lookup_sites_dot', type: 'circle', source: SRC.sites, paint: { 'circle-color': SITE, 'circle-radius': 3 } },
        // A facility at a site shows as a small mark on the site, in its layer's shape and color; as wide as the
        // dot it replaced.
        M().markLayer('lookup_fac', SRC.facilities, ['get', 'mark'], { size: 0.62 }),
        { id: 'lookup_pick', type: 'circle', source: SRC.pick, paint: { 'circle-radius': 9, 'circle-color': '#ffffff',
          'circle-opacity': 0.35, 'circle-stroke-color': SITE, 'circle-stroke-width': 2.5 } }
      ];
    },
    draw: (st, d) => draw(st, d),
    attach: st => attach(st),
    capture: (st, g, k) => captureLegend(st, g, k)
  };

  // Makes a match map in the container: the shared map with this kind's layers, empty until the first result.
  function create(container, geo, onReady, onError, opts) {
    const st = M().create(container, geo, onReady, onError, KIND);
    st.lookup = { bands: empty(), facilities: empty(), origins: empty(), dests: empty(), sites: empty(), pick: empty() };
    st.legendEl = (opts && opts.legend) || null;
    st.onFit = () => fit(st);
    M().setLines(st, true);
    return st;
  }

  // Draws a lookup result on the map, or keeps it until the map is ready (or done switching its background).
  function draw(st, d) {
    if (st.failed) return;
    if (!st.ready || st.switching) { st.pending = { d }; return; }
    st.last = { d };
    st.clearHover();
    if (st.sitePopup) { st.sitePopup.remove(); st.sitePopup = null; }
    st.lookup = {
      bands: { type: 'FeatureCollection', features: d.bands || [] },
      facilities: points(d.facilities || [], p => p.label),
      origins: points(d.origins || [], p => p.label),
      dests: points(d.dests || [], p => p.label),
      sites: points(d.sites || [], p => p.name),
      pick: st.lookup.pick
    };
    // The facilities' mark pictures first, so the marks can be clicked as soon as the map has drawn.
    (d.facilities || []).forEach(p => M().addMark(st.map, p.shape || 'circle', p.color));
    Object.keys(SRC).forEach(k => st.map.getSource(SRC[k]).setData(st.lookup[k]));
    st.bounds = d.bounds || null;
    renderLegend(st, d.legend || null);
    st.drawn = { bands: st.lookup.bands.features.length, origins: st.lookup.origins.features.length,
      dests: st.lookup.dests.features.length, sites: st.lookup.sites.features.length,
      facilities: st.lookup.facilities.features.length };   // test hook
    fit(st);
    clearNames(st);
  }

  // ── Pick on map ──
  function setPicking(st, on, onPick) {
    st.picking = !!on;
    st.onPick = onPick || null;
    st.map.getContainer().classList.toggle('picking', st.picking);
    if (st.picking && st.sitePopup) { st.sitePopup.remove(); st.sitePopup = null; }
  }
  // Marks the point picked on the map ([lon, lat]), or clears the mark when there is none.
  function setPick(st, lonlat) {
    st.lookup.pick = lonlat ? { type: 'FeatureCollection', features: [{ type: 'Feature', id: 1,
      geometry: { type: 'Point', coordinates: lonlat }, properties: {} }] } : empty();
    if (st.ready && !st.failed) st.map.getSource(SRC.pick).setData(st.lookup.pick);
  }

  // ── The legend ──
  // Its rows: [{ kind: 'title' | 'dot' | 'ring', label, color }], kept for the screenshot (st.legendRows).
  const LEGEND_TITLE = 'Legend';
  function legendRows(l) {
    if (!l) return [];
    const rows = [];
    if (l.sites) rows.push({ kind: 'bullseye', label: 'Site', color: SITE });
    if (l.origins) rows.push({ kind: 'dot', label: 'Origin inside a buffer', color: ORIGIN, size: 10 });
    if (l.dests) rows.push({ kind: 'dot', label: 'Destination inside a buffer', color: DEST, size: 10 });
    (l.facilities || []).forEach(f => rows.push({ kind: 'mark', label: f.label + ' (' + f.n + ')', color: f.color,
      shape: f.shape || 'circle', size: 10 }));
    if (l.rings && l.rings.length) {
      rows.push({ kind: 'title', label: 'Buffers' });
      l.rings.forEach(r => rows.push({ kind: 'ring', label: 'Within ' + r.km.toLocaleString('en-US') + ' km', color: r.color }));
    }
    if (l.zones) rows.push({ kind: 'ring', label: 'Inside a zone',
      color: (l.rings && l.rings[0] && l.rings[0].color) || '#fcb614' });
    return rows;
  }
  // The population block: its title, then each entry as the Maps side's legend shows it.
  function populationRows(entries) {
    if (!entries || !entries.length) return [];
    const rows = [{ kind: 'title', label: 'Population context' }];
    entries.forEach(e => {
      if (e.type === 'title') rows.push({ kind: 'note', label: e.label });
      else if (e.type === 'line') rows.push({ kind: 'pcline', label: e.label, dash: !!e.dash });
      else rows.push({ kind: 'pcswatch', label: e.label, color: e.color });
    });
    return rows;
  }
  // Sets the population layers' legend entries and redraws the legend.
  function setPopulationLegend(st, entries) {
    st.pcEntries = entries || [];
    renderLegend(st, st.legendData || null);
    if (st.ready && !st.failed) clearNames(st);
  }
  // Fills the legend box from the result's legend data and the population entries; hidden with no rows.
  function renderLegend(st, l) {
    const box = st.legendEl;
    st.legendData = l;
    st.legendRows = legendRows(l).concat(populationRows(st.pcEntries));   // also a test hook
    if (!box) return;
    box.replaceChildren();
    const doc = root.document;
    if (!st.legendRows.length) { box.hidden = true; return; }
    const title = doc.createElement('div');
    title.className = 'lg-title';
    title.textContent = LEGEND_TITLE;
    box.appendChild(title);
    st.legendRows.forEach(r => {
      const row = doc.createElement('div');
      if (r.kind === 'title' || r.kind === 'note') {
        row.className = r.kind === 'title' ? 'lg-title' : 'lg-note';
        row.textContent = r.label;
      } else if (r.kind === 'pcline' || r.kind === 'pcswatch') {
        row.className = 'lg-item';
        const mark = doc.createElement('span');
        mark.className = r.kind === 'pcline' ? 'lg-pc-line' + (r.dash ? ' dashed' : '') : 'lg-pc-swatch';
        if (r.kind === 'pcswatch') {
          mark.style.backgroundColor = r.color;
          mark.style.opacity = String(root.WSDA.population.DENSITY_OPACITY);
        }
        const text = doc.createElement('span');
        text.textContent = r.label;
        row.append(mark, text);
      } else if (r.kind === 'bullseye') {
        row.className = 'lg-item';
        const mark = doc.createElement('span');
        mark.className = 'lg-bullseye';
        mark.style.borderColor = r.color;
        mark.style.background = 'radial-gradient(circle, ' + r.color + ' 0 2.2px, #ffffff 2.6px)';
        const text = doc.createElement('span');
        text.textContent = r.label;
        row.append(mark, text);
      } else if (r.kind === 'mark') {
        // A facility layer's mark, as on the map.
        row.className = 'lg-item';
        const text = doc.createElement('span');
        text.textContent = r.label;
        row.append(root.WSDA.facilities.markElement(r, 18), text);
      } else {
        row.className = 'lg-item';
        const mark = doc.createElement('span');
        mark.className = r.kind === 'dot' ? 'lg-dot' : 'lg-ring';
        if (r.kind === 'dot') mark.style.backgroundColor = r.color;
        else { mark.style.borderColor = r.color; mark.style.backgroundColor = hexAlpha(r.color, 0.35); }
        const text = doc.createElement('span');
        text.textContent = r.label;
        row.append(mark, text);
      }
      box.appendChild(row);
    });
    box.hidden = false;
  }
  // A hex color as an rgba() text with opacity a.
  function hexAlpha(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ', ' + a + ')';
  }
  // The legend in the screenshot, where the page shows it (drawn from the page's own boxes, so it matches).
  function captureLegend(st, g, k) {
    const box = st.legendEl;
    if (!box || box.hidden) return;
    const frame = st.map.getContainer().getBoundingClientRect();
    const rect = el => {
      const r = el.getBoundingClientRect();
      return { x: (r.left - frame.left) * k, y: (r.top - frame.top) * k, w: r.width * k, h: r.height * k };
    };
    const b = rect(box);
    g.save();
    g.fillStyle = 'rgba(255, 255, 255, 0.92)';
    g.strokeStyle = '#ced4da';
    g.lineWidth = k;
    g.fillRect(b.x, b.y, b.w, b.h);
    g.strokeRect(b.x, b.y, b.w, b.h);
    const family = root.getComputedStyle(box).fontFamily;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    Array.from(box.children).forEach(row => {
      const r = rect(row), cs = root.getComputedStyle(row);
      if (row.className === 'lg-title' || row.className === 'lg-note') {
        g.font = (row.className === 'lg-title' ? '700 ' : 'italic ') + parseFloat(cs.fontSize) * k + 'px ' + family;
        g.fillStyle = '#2c3e50';
        g.fillText(row.textContent, r.x, r.y + r.h / 2);
        return;
      }
      const mark = row.children[0], text = row.children[1], m = rect(mark), t = rect(text);
      if (/lg-pc-line/.test(mark.className)) {
        g.beginPath();
        g.setLineDash(/dashed/.test(mark.className) ? [3 * k, 2 * k] : []);
        g.moveTo(m.x, m.y + m.h / 2);
        g.lineTo(m.x + m.w, m.y + m.h / 2);
        g.lineWidth = 1.5 * k;
        g.strokeStyle = '#737373';
        g.stroke();
        g.setLineDash([]);
      } else if (mark.className === 'lg-pc-swatch') {
        g.globalAlpha = Number(mark.style.opacity) || 1;
        g.fillStyle = mark.style.backgroundColor;
        g.fillRect(m.x, m.y, m.w, m.h);
        g.globalAlpha = 1;
      } else if (mark.className === 'lg-bullseye') {
        // The site's bullseye, as the map draws it.
        const cx = m.x + m.w / 2, cy = m.y + m.h / 2, r = m.w / 2 - 1.5 * k;
        g.beginPath();
        g.arc(cx, cy, r, 0, 2 * Math.PI);
        g.fillStyle = '#ffffff';
        g.fill();
        g.lineWidth = 3 * k;
        g.strokeStyle = SITE;
        g.stroke();
        g.beginPath();
        g.arc(cx, cy, 2.2 * k, 0, 2 * Math.PI);
        g.fillStyle = SITE;
        g.fill();
      } else if (mark.classList.contains('facility-mark-box')) {
        // A facility layer's mark, from the same outline as the page's.
        const F = root.WSDA.facilities, size = Math.min(m.w, m.h);
        const radius = (size / 2 - k) / Math.max(...Object.values(F.MARK_EXTENT));
        const path = new root.Path2D(F.markPath(mark.dataset.shape, m.x + m.w / 2, m.y + m.h / 2, radius));
        g.fillStyle = mark.dataset.color;
        g.fill(path);
        g.lineWidth = 1.2 * k;
        g.lineJoin = 'round';
        g.strokeStyle = '#ffffff';
        g.stroke(path);
      } else if (mark.className === 'lg-dot') {
        g.beginPath();
        g.arc(m.x + m.w / 2, m.y + m.h / 2, m.w / 2, 0, 2 * Math.PI);
        g.fillStyle = mark.style.backgroundColor;   // the color itself, not the shorthand
        g.fill();
        g.lineWidth = 1.5 * k;
        g.strokeStyle = '#ffffff';
        g.stroke();
      } else {
        g.fillStyle = mark.style.backgroundColor;
        g.fillRect(m.x, m.y, m.w, m.h);
        g.lineWidth = 2 * k;
        g.strokeStyle = mark.style.borderColor;
        g.strokeRect(m.x + k, m.y + k, m.w - 2 * k, m.h - 2 * k);
      }
      g.font = parseFloat(cs.fontSize) * k + 'px ' + family;
      g.fillStyle = '#2c3e50';
      g.fillText(text.textContent, t.x, t.y + t.h / 2);
    });
    g.restore();
    st.lastLegend = st.legendRows.map(r => r.label);   // test hook: the legend drawn in the screenshot
  }

  // The result's view: the bands' box (else the sites'), as CVI's fit_bounds; Washington before any result. The
  // margin keeps the box clear of the zoom and fit buttons (top left) and the screenshot button (top right).
  const FIT_PADDING = { top: 30, bottom: 30, left: 60, right: 60 };
  function fit(st) {
    if (!st.ready || st.failed) return;
    if (!st.bounds) { M().fitView(st); return; }
    const b = st.bounds;
    st.map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: FIT_PADDING, animate: false, maxZoom: 15 });
  }

  // The county names (and the population layers' names) that would cover a site or a matched point (with a 2 px
  // margin) are hidden. A name is a box centered on its point (the marker's anchor); a name hidden by zoom has no size
  // and is skipped.
  function clearNames(st) {
    const map = st.map, d = st.lookup;
    const marks = [];
    [['sites', 9], ['origins', 5], ['dests', 5], ['facilities', 5]].forEach(([key, r]) => d[key].features.forEach(f => {
      const xy = map.project(f.geometry.coordinates);
      marks.push({ x: xy.x, y: xy.y, r: r + 2 });
    }));
    // The legend's box, in the map's pixels: a name under it is hidden too.
    let legend = null;
    if (st.legendEl && !st.legendEl.hidden) {
      const f = map.getContainer().getBoundingClientRect(), r = st.legendEl.getBoundingClientRect();
      legend = { x0: r.left - f.left - 2, x1: r.right - f.left + 2, y0: r.top - f.top - 2, y1: r.bottom - f.top + 2 };
    }
    let hidden = 0;
    // The county names, and the population layers' names too (they are on at first).
    st.labels.concat(st.pcLabels || []).forEach(m => {
      const el = m.getElement();
      el.classList.remove('covered');
      const w = el.offsetWidth, h = el.offsetHeight;
      if (!w || (!marks.length && !legend)) return;
      const c = map.project(m.getLngLat());
      const x0 = c.x - w / 2, x1 = c.x + w / 2, y0 = c.y - h / 2, y1 = c.y + h / 2;
      const underLegend = legend && legend.x0 < x1 && legend.x1 > x0 && legend.y0 < y1 && legend.y1 > y0;
      if (underLegend || marks.some(p => p.x + p.r > x0 && p.x - p.r < x1 && p.y + p.r > y0 && p.y - p.r < y1)) {
        el.classList.add('covered');
        hidden++;
      }
    });
    st.namesHidden = hidden;   // test hook
  }

  // One tooltip for the point on top under the pointer (facilities, then sites over destinations over origins, the
  // drawing order); the text is set as text (file values are never read as HTML).
  function attach(st) {
    const map = st.map;
    const tip = new root.maplibregl.Popup({ closeButton: false, closeOnClick: false });
    st.clearHover = () => { map.getCanvas().style.cursor = ''; tip.remove(); st.hoverLabel = null; };
    map.on('mousemove', e => {
      if (st.switching) return;
      const layers = POINT_LAYERS.filter(id => map.getLayer(id));
      const f = map.queryRenderedFeatures(e.point, { layers })[0];
      if (!f) { st.clearHover(); return; }
      map.getCanvas().style.cursor = st.picking ? '' : f.layer.id === 'lookup_sites' ? 'pointer' : 'default';
      st.hoverLabel = f.properties.label;   // test hook
      tip.setLngLat(e.lngLat).setHTML(esc(f.properties.label)).addTo(map);
    });
    map.getCanvas().addEventListener('mouseleave', () => st.clearHover());
    map.on('moveend', () => clearNames(st));
    map.on('click', e => {
      if (st.switching) return;
      if (st.picking && st.onPick) { st.onPick(e.lngLat.lng, e.lngLat.lat); return; }   // Pick on map
      if (!map.getLayer('lookup_sites')) return;
      const f = map.queryRenderedFeatures(e.point, { layers: ['lookup_sites'] })[0];
      if (!f) return;
      if (st.sitePopup) st.sitePopup.remove();
      st.sitePopup = new root.maplibregl.Popup({ closeButton: true, closeOnClick: true })
        .setLngLat(f.geometry.coordinates).setHTML(esc(f.properties.label)).addTo(map);
      st.clickedSite = f.properties.label;   // test hook
    });
  }

  root.CVIWA = root.CVIWA || {};
  root.CVIWA.lookupmap = { create, draw, fit, setPicking, setPick, legendRows, populationRows, setPopulationLegend, KIND };
})(typeof window !== 'undefined' ? window : globalThis);
