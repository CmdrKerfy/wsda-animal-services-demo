/* The Emergency Response map: a map kind of the shared map (CVI's map.js create, as Infrastructure's facilitymap.js
 * and Premise Lookup's lookupmap.js are), so basemaps, the request gate, contrast, credits, neighboring regions,
 * population context, the fit button and the screenshot are the shared map's; Washington's land and county lines lie
 * under it. Adapted from site/cvi/app/lookupmap.js, v1.1 (its sources and layers, the hover and Pick on map), with
 * the Emergency page's own marks.
 *
 * What it draws (the page gives it, data below): the zones, as rings around the positives (each ring between its
 * distance and the one inside it, in its ring's color) or as a zone file's polygons; the past positives' rings, when
 * asked for, gray and dashed; the sites of the ticked layers outside the zones, small and faded; the sites inside the
 * zones, in their layer's mark; the positives on top, each in its animal's shape and its status color with a white
 * halo and a dark outline (a past positive hollow and faded, a positive without zones smaller); the spot picked with "Add a point on the map" (a hollow ring);
 * 2.6: with the tick "CVI movements", the CVI premises with a matched movement's origin or destination in a zone,
 * a ring in the end's color (the map picture's) on a white halo, over the sites (a site at the same spot shows inside it);
 * 2.6: a zone drawn on the map with a dashed outline (a zone file's solid), and the drawing's sketch on top (draw.js:
 * the shape so far faintly filled, its sides, the side to the pointer dashed, the corners and the edit handles; in
 * the kind's sources, so it comes back after a background change). Hover, set as text
 * (file values are never read as HTML): every positive under the pointer (marks can share a spot); else the site on
 * top; each with its name in bold, then its other lines. Else every zone under the pointer, smallest ring first,
 * under its positive's name (named once, in bold), each with its days since the last positive; then the "as of"
 * line. Never wider than the screen; none while drawing or editing (st.drawing, set by draw.js). The view fits what is drawn (the zones, the past zones and the positives shown),
 * with the legend's width kept clear, when the page asks.
 *
 * create(container, geo, onReady, onError) -> the map's state (map.js create with this kind)
 * draw(st, data, fit) -> draws data: { zones and pastZones: [GeoJSON Feature with properties { color, label, zid }],
 *   zoneTips: for each zid, [{ km, head, text }] (the hover's lines for that zone, each under its heading head, the
 *   positive's name, or '' for none), tipFoot (the hover's last line, the "as of" date), positives: [{ lat, lon, label (lines split by "\n"), color, past, withZones, shape (rules.js animalShapeOf), shapes (rules.js animalShapesOf: a mixed positive's marks side by side; shape when left out) }], inside and outside:
 *   [{ lat, lon, label (lines split by "\n"), shape, color }], cvi: [{ lat, lon, label, color, r (the ring's radius) }] (2.6), bounds: [west, south, east, north] or null,
 *   shared: { at: { head, lines } } (2.9: the cases sharing a map point, for the hover; a positive's shared, how many
 *   cases share its point, draws the badge, and its sharedAt names its entry) }; fit: true fits the view to the
 *   bounds
 * viewBounds(zones, pastZones, positives) -> the bounds that take in all of them, or null
 * setPicking(st, on, onPick) -> while on, a click on the map calls onPick(lon, lat), with a crosshair cursor
 * setPick(st, [lon, lat] | null) -> marks the picked spot
 * setSketch(st, features) -> the drawing's sketch: features with properties { kind: 'fill' | 'side' | 'next' | 'mid' |
 *   'corner', color, r (a corner's radius) }
 * hoverAt(st, point) (as st.hoverAt) -> the hover at a point of the screen, or null: { items: [{ head, lines }],
 *   foot, points, shared } (foot the "as of" line under the zones, else ''; points true for positives or a site;
 *   shared, for positives at a point with more than one case, [{ head, lines }], in a gold-edged box)
 * zoneFeatures(sites, rings, n, unit) -> the ring shapes of ring sites (proximity.bandShapes), each with its ring's
 *   color, label, site and ring number; the ring distances in unit ("km" or "mi"), turned into km by rules.js toKm;
 *   polygonFeatures(zones, color) -> zone polygons as features (drawn true for a zone drawn on the map) */
(function (root) {
  'use strict';
  const M = () => root.CVIWA.map;
  const SRC = { zones: 'em_zones', pastZones: 'em_past_zones', outside: 'em_outside', inside: 'em_inside',
    positives: 'em_positives', pick: 'em_pick', draw: 'em_draw', cvi: 'em_cvi' };
  // What the hover looks at, topmost first: the positives over the CVI premises over the sites inside over the
  // others; then the zones.
  const POINT_LAYERS = ['em_positives', 'em_cvi', 'em_inside', 'em_outside'];
  const ZONE_LAYERS = ['em_zone_fill', 'em_past_fill'];
  const PICK = '#c0392b', PAST = '#737373', SKETCH = '#1c5a83';
  const isDrawn = ['==', ['get', 'drawn'], true];
  const sketchKind = k => ['==', ['get', 'kind'], k];
  const empty = () => ({ type: 'FeatureCollection', features: [] });
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const marks = list => ({ type: 'FeatureCollection', features: list.map((p, i) => ({ type: 'Feature', id: i + 1,
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: { label: p.label, mark: M().markId(p.shape || 'circle', p.color) } })) });
  const hollow = list => ({ type: 'FeatureCollection', features: list.map((p, i) => ({ type: 'Feature', id: i + 1,
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { label: p.label, color: p.color, r: p.r || 10 } })) });
  const dots = list => ({ type: 'FeatureCollection', features: list.map((p, i) => ({ type: 'Feature', id: i + 1,
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: { label: p.label, mark: positiveId(p), opacity: p.past ? 0.55 : 1, lon: p.lon, lat: p.lat, at: p.sharedAt || '' } })) });

  // A positive's mark (2.4): its animal's shape (rules.js animalShapeOf) filled in its status
  // color, with a white halo and a near-black outline, half larger than the circle before (radius 7 with zones, else
  // 5); a past one white inside with an edge in its status color, faded by the layer. A positive naming more than one
  // kind (2.8, rules.js animalShapesOf) gets each kind's shape side by side, the row centered on its spot. Drawn at
  // twice the size for sharp edges; made again when a basemap's new style asks for it.
  // 2.9: a premises detected more than once (cases at the same map point) has a small dark teal badge
  // at the mark's top right with how many cases share the point (9+ past nine), whatever the dates shown.
  const OUTLINE = '#1a1a1a', HALO = 2, LARGER = 1.5, BADGE = '#245566', BADGE_R = 5.5;
  const shapesOf = p => (p.shapes && p.shapes.length ? p.shapes : [p.shape || 'circle']);
  const positiveId = p => 'em-positive:' + shapesOf(p).join('+') + ':' + (p.past ? 'past' : 'now') + ':' +
    (p.withZones ? 'zones' : 'none') + ':' + (p.shared > 1 ? p.shared : 1) + ':' + p.color;
  function positiveImage(shapes, past, withZones, color, shared) {
    // With a badge the picture has room around it on every side, so the mark stays centered on its spot.
    const k = 2, r = (withZones ? 7 : 5) * LARGER, pad = shared > 1 ? BADGE_R + 1 : 0, half = Math.ceil(r + 5 + 2 * HALO + pad);
    const step = 2 * (r + 1.25) + 2;   // one shape's width and a little room before the next
    const c = root.document.createElement('canvas');
    c.width = (2 * half + (shapes.length - 1) * step) * k;
    c.height = 2 * half * k;
    const g = c.getContext('2d');
    g.scale(k, k);
    g.lineJoin = 'round';
    shapes.forEach((shape, i) => {
      const path = new root.Path2D(root.WSDA.facilities.markPath(shape, half + i * step, half, r + 1.25));
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1.6 + 2 * HALO;
      g.stroke(path);
      g.fillStyle = past ? '#ffffff' : color;
      g.fill(path);
      if (past) {
        g.strokeStyle = color;
        g.lineWidth = 3;
        g.stroke(path);
      }
      g.strokeStyle = OUTLINE;
      g.lineWidth = past ? 1 : 1.6;
      g.stroke(path);
    });
    if (shared > 1) {
      const x = half + (shapes.length - 1) * step + r * 0.8, y = half - r * 0.8;
      g.beginPath();
      g.arc(x, y, BADGE_R, 0, 2 * Math.PI);
      g.fillStyle = BADGE;
      g.fill();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1.2;
      g.stroke();
      g.fillStyle = '#ffffff';
      g.font = '700 ' + (shared > 9 ? 6.5 : 8) + 'px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(shared > 9 ? '9+' : String(shared), x, y + 0.5);
    }
    return g.getImageData(0, 0, c.width, c.height);
  }
  function addPositive(map, id) {
    const m = /^em-positive:([a-z+-]+):(past|now):(zones|none):(\d+):(.+)$/.exec(id);
    if (m && !map.hasImage(id)) map.addImage(id, positiveImage(m[1].split('+'), m[2] === 'past', m[3] === 'zones', m[5], +m[4]), { pixelRatio: 2 });
  }

  // The CVI premises' size by the zoom: 0.4 of full at the state's view (zoom 6 and out), full from zoom 10 in.
  const CVI_ZOOM = [6, 0.4, 10, 1];
  const cviSize = full => ['interpolate', ['linear'], ['zoom'], CVI_ZOOM[0], ['*', full, CVI_ZOOM[1]], CVI_ZOOM[2], ['*', full, CVI_ZOOM[3]]];

  const KIND = {
    isOwn: id => /^em_/.test(String(id)),
    scaleCorner: 'bottom-left',   // the legend covers the bottom right
    hoverLayers: () => POINT_LAYERS.concat(ZONE_LAYERS),
    sources(st) {
      const d = st.em || {};
      return Object.assign({}, M().WA_KIND.sources(st), {
        [SRC.zones]: { type: 'geojson', data: d.zones || empty() },
        [SRC.pastZones]: { type: 'geojson', data: d.pastZones || empty() },
        [SRC.outside]: { type: 'geojson', data: d.outside || empty() },
        [SRC.inside]: { type: 'geojson', data: d.inside || empty() },
        [SRC.positives]: { type: 'geojson', data: d.positives || empty() },
        [SRC.pick]: { type: 'geojson', data: d.pick || empty() },
        [SRC.draw]: { type: 'geojson', data: d.draw || empty() },
        [SRC.cvi]: { type: 'geojson', data: d.cvi || empty() }
      });
    },
    layers(st) {
      return M().WA_KIND.layers(st).concat([
        { id: 'em_zone_fill', type: 'fill', source: SRC.zones,
          paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.16 } },
        { id: 'em_zone_line', type: 'line', source: SRC.zones, filter: ['!', isDrawn],
          paint: { 'line-color': ['get', 'color'], 'line-width': 2 } },
        { id: 'em_zone_dash', type: 'line', source: SRC.zones, filter: isDrawn,
          paint: { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-dasharray': [3, 2] } },
        { id: 'em_past_fill', type: 'fill', source: SRC.pastZones, paint: { 'fill-color': PAST, 'fill-opacity': 0.05 } },
        { id: 'em_past_line', type: 'line', source: SRC.pastZones,
          paint: { 'line-color': PAST, 'line-width': 1.5, 'line-opacity': 0.8, 'line-dasharray': [3, 2] } },
        M().markLayer('em_outside', SRC.outside, ['get', 'mark'], { size: 0.7, opacity: 0.35 }),
        M().markLayer('em_inside', SRC.inside, ['get', 'mark'], { size: 1, opacity: 1 }),
        // A CVI premises: a ring in its end's color on a white halo, so it shows over a site and the shading; small at
        // the state's view, where many can lie close together, and full size from a county's view in (CVI_ZOOM).
        { id: 'em_cvi_halo', type: 'circle', source: SRC.cvi, paint: { 'circle-radius': cviSize(['get', 'r']), 'circle-opacity': 0,
          'circle-stroke-color': '#ffffff', 'circle-stroke-width': cviSize(6) } },
        { id: 'em_cvi', type: 'circle', source: SRC.cvi, paint: { 'circle-radius': cviSize(['get', 'r']), 'circle-opacity': 0,
          'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': cviSize(3.5) } },
        M().markLayer('em_positives', SRC.positives, ['get', 'mark'], { size: 1, opacity: ['get', 'opacity'] }),
        { id: 'em_pick', type: 'circle', source: SRC.pick, paint: { 'circle-radius': 9, 'circle-color': '#ffffff',
          'circle-opacity': 0.35, 'circle-stroke-color': PICK, 'circle-stroke-width': 2.5 } },
        { id: 'em_draw_fill', type: 'fill', source: SRC.draw, filter: sketchKind('fill'),
          paint: { 'fill-color': SKETCH, 'fill-opacity': 0.1 } },
        { id: 'em_draw_side', type: 'line', source: SRC.draw, filter: sketchKind('side'),
          paint: { 'line-color': SKETCH, 'line-width': 2.5 } },
        { id: 'em_draw_next', type: 'line', source: SRC.draw, filter: sketchKind('next'),
          paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [2, 1.5] } },
        { id: 'em_draw_mid', type: 'circle', source: SRC.draw, filter: sketchKind('mid'), paint: { 'circle-radius': 4,
          'circle-color': '#ffffff', 'circle-opacity': 0.9, 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 1.5 } },
        { id: 'em_draw_corner', type: 'circle', source: SRC.draw, filter: sketchKind('corner'), paint: { 'circle-radius': ['get', 'r'],
          'circle-color': '#ffffff', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2.5 } }
      ]);
    },
    draw: (st, d) => draw(st, d, false),
    attach: st => attach(st)
  };

  // Makes the Emergency map in the container: the shared map with this kind's layers, empty until files are loaded.
  function create(container, geo, onReady, onError) {
    const st = M().create(container, geo, onReady, onError, KIND);
    st.em = { zones: empty(), pastZones: empty(), outside: empty(), inside: empty(), positives: empty(), pick: empty(),
      draw: empty(), cvi: empty(), tips: [], tipFoot: '' };
    st.onFit = () => fit(st);
    M().setLines(st, true);
    return st;
  }

  // Draws the page's data on the map, or keeps it until the map is ready (or done switching its background).
  function draw(st, d, fitView) {
    if (st.failed) return;
    if (!st.ready || st.switching) { st.pending = { d }; st.fitPending = st.fitPending || !!fitView; return; }
    st.last = { d };
    st.clearHover();
    st.em = {
      zones: { type: 'FeatureCollection', features: d.zones || [] },
      pastZones: { type: 'FeatureCollection', features: d.pastZones || [] },
      outside: marks(d.outside || []),
      inside: marks(d.inside || []),
      positives: dots(d.positives || []),
      cvi: hollow(d.cvi || []),
      pick: st.em.pick,
      draw: st.em.draw,
      tips: d.zoneTips || [],
      tipFoot: d.tipFoot || '',
      shared: d.shared || {}
    };
    // The marks' pictures first, so the marks show as soon as the map has drawn.
    (d.outside || []).concat(d.inside || []).forEach(p => M().addMark(st.map, p.shape || 'circle', p.color));
    (d.positives || []).forEach(p => addPositive(st.map, positiveId(p)));
    Object.keys(SRC).forEach(k => { if (st.map.getSource(SRC[k])) st.map.getSource(SRC[k]).setData(st.em[k]); });
    st.bounds = d.bounds || null;
    st.drawn = { zones: st.em.zones.features.length, pastZones: st.em.pastZones.features.length,
      outside: st.em.outside.features.length,
      inside: st.em.inside.features.length, positives: st.em.positives.features.length, cvi: st.em.cvi.features.length };   // test hook
    if (fitView || st.fitPending) { st.fitPending = false; fit(st); }
  }

  // The view: what is drawn (viewBounds), else Washington. The legend's width is kept clear on the right (st.legendWidth,
  // set by the page: 0 when the legend is not over the map), so no positive sits under it. The edge of 60 pixels keeps
  // a mark at the edge (about 20 pixels from its middle to a square's corner) clear of the map's buttons (about 40).
  const EDGE = 60;
  function fit(st) {
    if (!st.ready || st.failed) return;
    const right = EDGE + (st.legendWidth ? st.legendWidth() : 0);
    if (st.bounds) st.map.fitBounds([[st.bounds[0], st.bounds[1]], [st.bounds[2], st.bounds[3]]],
      { padding: { top: EDGE, bottom: EDGE, left: EDGE, right }, maxZoom: 11, animate: false });
    else M().fitView(st);
  }

  // The box the view takes in (2.4): every zone and past zone drawn and every positive shown, as [west, south, east,
  // north], or null when nothing is.
  function viewBounds(zones, pastZones, positives) {
    let b = null;
    const grow = (lon, lat) => {
      b = b ? [Math.min(b[0], lon), Math.min(b[1], lat), Math.max(b[2], lon), Math.max(b[3], lat)] : [lon, lat, lon, lat];
    };
    zones.concat(pastZones).forEach(f => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates)
      .forEach(poly => poly[0].forEach(([lon, lat]) => grow(lon, lat))));
    positives.forEach(p => grow(p.lon, p.lat));
    return b;
  }

  // ── Add a point on the map (Premise Lookup's Pick on map) ──
  function setPicking(st, on, onPick) {
    st.picking = !!on;
    st.onPick = onPick || null;
    st.map.getContainer().classList.toggle('picking', st.picking);
  }
  // Marks the point picked on the map ([lon, lat]), or clears the mark when there is none.
  function setPick(st, lonlat) {
    st.em.pick = lonlat ? { type: 'FeatureCollection', features: [{ type: 'Feature', id: 1,
      geometry: { type: 'Point', coordinates: lonlat }, properties: {} }] } : empty();
    if (st.ready && !st.failed && st.map.getSource(SRC.pick)) st.map.getSource(SRC.pick).setData(st.em.pick);
  }

  // The drawing's sketch (draw.js), kept for a background change.
  function setSketch(st, features) {
    st.em.draw = { type: 'FeatureCollection', features: features || [] };
    if (st.ready && !st.failed && st.map.getSource(SRC.draw)) st.map.getSource(SRC.draw).setData(st.em.draw);
  }

  // The hover under a point of the screen: every positive there; else the site on top; each its label's first line
  // as the heading. Else every zone there, smallest ring first, grouped under their positive's name, then the "as
  // of" line. Null when nothing is there.
  function hoverAt(st, point) {
    const map = st.map;
    const query = ids => {
      const layers = ids.filter(id => map.getLayer(id));
      return layers.length ? map.queryRenderedFeatures(point, { layers }) : [];
    };
    const points = query(POINT_LAYERS);
    const item = label => { const lines = String(label).split('\n'); return { head: lines[0], lines: lines.slice(1) }; };
    if (points.length) {
      // A CVI premises' ring (2.6): every end at that spot, then the site under it, so the ring hides no site.
      if (points[0].layer.id === 'em_cvi') {
        const ends = [...new Set(points.filter(f => f.layer.id === 'em_cvi').map(f => String(f.properties.label)))];
        const site = points.find(f => f.layer.id !== 'em_cvi');
        return { items: ends.concat(site ? [String(site.properties.label)] : []).map(item), foot: '', points: true };
      }
      if (points[0].layer.id !== 'em_positives') return { items: [item(points[0].properties.label)], foot: '', points: true };
      const ps = points.filter(f => f.layer.id === 'em_positives');
      const labels = [...new Set(ps.map(f => String(f.properties.label)))];
      // A map point with more than one case (2.9): a box naming each case at it, with its dates.
      const shared = [...new Set(ps.map(f => String(f.properties.at || '')).filter(at => st.em.shared[at]))].map(at => st.em.shared[at]);
      return Object.assign({ items: labels.map(item), foot: '', points: true }, shared.length ? { shared } : {});
    }
    const lines = new Map();
    for (const f of query(ZONE_LAYERS)) {
      for (const t of st.em.tips[f.properties.zid] || []) {
        const key = t.head + '\r' + t.text;
        if (!lines.has(key)) lines.set(key, t);
      }
    }
    if (!lines.size) return null;
    const sorted = [...lines.values()].sort((a, b) => a.km - b.km || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
    const groups = new Map();
    for (const t of sorted) {
      if (!groups.has(t.head)) groups.set(t.head, []);
      groups.get(t.head).push(t.text);
    }
    const out = { items: [...groups].map(([head, rows]) => ({ head, lines: rows })), foot: st.em.tipFoot, points: false };
    const context = pcItems(st, point);
    if (context.length) out.context = context;
    return out;
  }

  // The population layers under the pointer, for the zone hover (outside the zones the shared map's own hover shows
  // them): a city's limits or else a place (one outline), and the tract's density; population.js writes the lines.
  const PC_HOVER = [['cities', 'pc-cities-fill'], ['places', 'pc-places-fill'], ['density', 'pc-density']];
  function pcItems(st, point) {
    const PN = root.WSDA && root.WSDA.population, on = st.pc && st.pc.on;
    if (!PN || !on) return [];
    const out = [];
    for (const [layer, id] of PC_HOVER) {
      if (!on[layer] || !st.map.getLayer(id) || (layer === 'places' && out.length)) continue;
      const f = st.map.queryRenderedFeatures(point, { layers: [id] })[0];
      if (!f) continue;
      const lines = PN.hoverLines(layer, f.properties);
      out.push({ head: lines[0], lines: lines.slice(1) });
    }
    return out;
  }

  // The hover as HTML, every value escaped: each item's heading in bold over its lines; the positives and sites
  // apart by a thin line, the zones' groups by a small gap; the "as of" line in gray; the population lines last,
  // under a thin line.
  function hoverHtml(hover) {
    const html = it => '<div class="tip-item">' + (it.head ? '<strong>' + esc(it.head) + '</strong>' +
      (it.lines.length ? '<br>' : '') : '') + it.lines.map(esc).join('<br>') + '</div>';
    return hover.items.map(html).join(hover.points ? '<hr>' : '') +
      (hover.shared ? hover.shared.map(s => '<div class="tip-shared">' + esc(s.head) + '<br>' + s.lines.map(esc).join('<br>') + '</div>').join('') : '') +
      (hover.foot ? '<div class="tip-foot">' + esc(hover.foot) + '</div>' : '') +
      (hover.context ? '<hr>' + hover.context.map(html).join('') : '');
  }

  // One tooltip for what is under the pointer; a click while picking gives the spot to the page.
  function attach(st) {
    const map = st.map;
    // Never wider than the screen: on a phone the map is narrower than 320 pixels.
    const tip = new root.maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: 'min(320px, calc(100vw - 48px))' });
    st.clearHover = () => { map.getCanvas().style.cursor = ''; tip.remove(); st.hoverLabel = null; };
    st.hoverAt = point => hoverAt(st, point);   // test hook: the lines a hover there shows
    map.on('mousemove', e => {
      if (st.switching) return;
      if (st.drawing) { st.clearHover(); return; }
      const hover = hoverAt(st, e.point);
      if (!hover) { st.clearHover(); return; }
      map.getCanvas().style.cursor = st.picking ? '' : 'default';
      const text = it => [it.head].concat(it.lines).join('\n');
      st.hoverLabel = hover.items.map(text).concat((hover.shared || []).map(text), hover.foot || [], (hover.context || []).map(text))
        .join('\n\n');   // test hook
      tip.setLngLat(e.lngLat).setHTML(hoverHtml(hover)).addTo(map);
    });
    map.getCanvas().addEventListener('mouseleave', () => st.clearHover());
    map.on('styleimagemissing', e => addPositive(map, e.id));
    map.on('click', e => {
      if (st.switching) return;
      if (st.picking && st.onPick) st.onPick(e.lngLat.lng, e.lngLat.lat);
    });
  }

  // The ring shapes of ring sites, in their ring's color: each ring between its distance and the one inside it.
  // Each feature also says its site (the site's place in sites) and its ring (the ring's place in rings).
  function zoneFeatures(sites, rings, n, unit) {
    const P = root.WSDA.proximity, toKm = root.WSDA.emergencyRules.toKm;
    return sites.flatMap((s, site) => P.bandShapes(s, n || 120).map(f => {
      let ring = rings.findIndex(r => toKm(r.distance, unit) === f.properties.outerKm);
      if (ring < 0) ring = rings.length - 1;
      f.properties = Object.assign({}, f.properties, { color: rings[ring].color, label: rings[ring].label, site, ring });
      return f;
    }));
  }

  // Zone polygons as features in one color; a zone drawn on the map (2.6) marked drawn, for its dashed outline.
  function polygonFeatures(zones, color) {
    return zones.map((z, i) => ({ type: 'Feature', id: i + 1, geometry: z.geometry,
      properties: { color, label: z.name, drawn: z.source === 'drawn' } }));
  }

  root.WSDA = root.WSDA || {};
  root.WSDA.emergencyMap = { create, draw, fit, viewBounds, setPicking, setPick, setSketch, hoverAt, zoneFeatures, polygonFeatures,
    KIND, SRC };
})(typeof window !== 'undefined' ? window : globalThis);
