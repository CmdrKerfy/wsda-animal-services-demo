/* The Emergency Response map: a map kind of the shared map (CVI's map.js create, as Infrastructure's facilitymap.js
 * and Premise Lookup's lookupmap.js are), so basemaps, the request gate, contrast, credits, neighboring regions,
 * population context, the fit button and the screenshot are the shared map's; Washington's land and county lines lie
 * under it. Adapted from site/cvi/app/lookupmap.js, v1.1 (its sources and layers, the hover and Pick on map), with
 * the Emergency page's own marks.
 *
 * What it draws (the page gives it, data below): the zones, as rings around the positives (each ring between its
 * distance and the one inside it, in its ring's color) or as a zone file's polygons; the past positives' rings, when
 * asked for, gray and dashed; the sites of the ticked layers outside the zones, small and faded; the sites inside the
 * zones, in their layer's mark; the positives on top, in their status color (a past positive hollow and faded, a
 * positive without zones smaller); the spot picked with "Add a point on the map" (a hollow ring). Hover, set as text
 * (file values are never read as HTML): every positive under the pointer (marks can share a spot); else the site on
 * top; each with its name in bold, then its other lines. Else every zone under the pointer, smallest ring first,
 * under its positive's name (named once, in bold), each with its days since the last positive; then the "as of"
 * line. Never wider than the screen. The view fits the zones (else the positives) after each new set of files or
 * zones.
 *
 * create(container, geo, onReady, onError) -> the map's state (map.js create with this kind)
 * draw(st, data, fit) -> draws data: { zones and pastZones: [GeoJSON Feature with properties { color, label, zid }],
 *   zoneTips: for each zid, [{ km, head, text }] (the hover's lines for that zone, each under its heading head, the
 *   positive's name, or '' for none), tipFoot (the hover's last line, the "as of" date), positives: [{ lat, lon, label (lines split by "\n"), color, past, withZones }], inside and outside:
 *   [{ lat, lon, label (lines split by "\n"), shape, color }], bounds: [west, south, east, north] or null }; fit: true fits the view to the
 *   bounds
 * setPicking(st, on, onPick) -> while on, a click on the map calls onPick(lon, lat), with a crosshair cursor
 * setPick(st, [lon, lat] | null) -> marks the picked spot
 * hoverAt(st, point) (as st.hoverAt) -> the hover at a point of the screen, or null: { items: [{ head, lines }],
 *   foot, points } (foot the "as of" line under the zones, else ''; points true for positives or a site)
 * zoneFeatures(sites, rings, n, unit) -> the ring shapes of ring sites (proximity.bandShapes), each with its ring's
 *   color, label, site and ring number; the ring distances in unit ("km" or "mi"), turned into km by rules.js toKm;
 *   polygonFeatures(zones, color) -> a zone file's polygons as features */
(function (root) {
  'use strict';
  const M = () => root.CVIWA.map;
  const SRC = { zones: 'em_zones', pastZones: 'em_past_zones', outside: 'em_outside', inside: 'em_inside',
    positives: 'em_positives', pick: 'em_pick' };
  // What the hover looks at, topmost first: the positives over the sites inside over the others; then the zones.
  const POINT_LAYERS = ['em_positives', 'em_inside', 'em_outside'];
  const ZONE_LAYERS = ['em_zone_fill', 'em_past_fill'];
  const PICK = '#c0392b', PAST = '#737373';
  const empty = () => ({ type: 'FeatureCollection', features: [] });
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const marks = list => ({ type: 'FeatureCollection', features: list.map((p, i) => ({ type: 'Feature', id: i + 1,
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: { label: p.label, mark: M().markId(p.shape || 'circle', p.color) } })) });
  const dots = list => ({ type: 'FeatureCollection', features: list.map((p, i) => ({ type: 'Feature', id: i + 1,
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: { label: p.label, color: p.color, fill: p.past ? '#ffffff' : p.color, radius: p.withZones ? 7 : 5,
      opacity: p.past ? 0.55 : 1 } })) });

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
        [SRC.pick]: { type: 'geojson', data: d.pick || empty() }
      });
    },
    layers(st) {
      return M().WA_KIND.layers(st).concat([
        { id: 'em_zone_fill', type: 'fill', source: SRC.zones,
          paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.16 } },
        { id: 'em_zone_line', type: 'line', source: SRC.zones,
          paint: { 'line-color': ['get', 'color'], 'line-width': 2 } },
        { id: 'em_past_fill', type: 'fill', source: SRC.pastZones, paint: { 'fill-color': PAST, 'fill-opacity': 0.05 } },
        { id: 'em_past_line', type: 'line', source: SRC.pastZones,
          paint: { 'line-color': PAST, 'line-width': 1.5, 'line-opacity': 0.8, 'line-dasharray': [3, 2] } },
        M().markLayer('em_outside', SRC.outside, ['get', 'mark'], { size: 0.7, opacity: 0.35 }),
        M().markLayer('em_inside', SRC.inside, ['get', 'mark'], { size: 1, opacity: 1 }),
        { id: 'em_positives', type: 'circle', source: SRC.positives, paint: { 'circle-color': ['get', 'fill'],
          'circle-radius': ['get', 'radius'], 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2.5,
          'circle-opacity': ['get', 'opacity'], 'circle-stroke-opacity': ['get', 'opacity'] } },
        { id: 'em_pick', type: 'circle', source: SRC.pick, paint: { 'circle-radius': 9, 'circle-color': '#ffffff',
          'circle-opacity': 0.35, 'circle-stroke-color': PICK, 'circle-stroke-width': 2.5 } }
      ]);
    },
    draw: (st, d) => draw(st, d, false),
    attach: st => attach(st)
  };

  // Makes the Emergency map in the container: the shared map with this kind's layers, empty until files are loaded.
  function create(container, geo, onReady, onError) {
    const st = M().create(container, geo, onReady, onError, KIND);
    st.em = { zones: empty(), pastZones: empty(), outside: empty(), inside: empty(), positives: empty(), pick: empty(),
      tips: [], tipFoot: '' };
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
      pick: st.em.pick,
      tips: d.zoneTips || [],
      tipFoot: d.tipFoot || ''
    };
    // The marks' pictures first, so the marks show as soon as the map has drawn.
    (d.outside || []).concat(d.inside || []).forEach(p => M().addMark(st.map, p.shape || 'circle', p.color));
    Object.keys(SRC).forEach(k => { if (st.map.getSource(SRC[k])) st.map.getSource(SRC[k]).setData(st.em[k]); });
    st.bounds = d.bounds || null;
    st.drawn = { zones: st.em.zones.features.length, pastZones: st.em.pastZones.features.length,
      outside: st.em.outside.features.length,
      inside: st.em.inside.features.length, positives: st.em.positives.features.length };   // test hook
    if (fitView || st.fitPending) { st.fitPending = false; fit(st); }
  }

  // The view: the zones and positives, else Washington.
  function fit(st) {
    if (!st.ready || st.failed) return;
    if (st.bounds) st.map.fitBounds([[st.bounds[0], st.bounds[1]], [st.bounds[2], st.bounds[3]]], { padding: 40, maxZoom: 11, animate: false });
    else M().fitView(st);
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
      if (points[0].layer.id !== 'em_positives') return { items: [item(points[0].properties.label)], foot: '', points: true };
      const labels = [...new Set(points.filter(f => f.layer.id === 'em_positives').map(f => String(f.properties.label)))];
      return { items: labels.map(item), foot: '', points: true };
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
      const hover = hoverAt(st, e.point);
      if (!hover) { st.clearHover(); return; }
      map.getCanvas().style.cursor = st.picking ? '' : 'default';
      const text = it => [it.head].concat(it.lines).join('\n');
      st.hoverLabel = hover.items.map(text).concat(hover.foot || [], (hover.context || []).map(text))
        .join('\n\n');   // test hook
      tip.setLngLat(e.lngLat).setHTML(hoverHtml(hover)).addTo(map);
    });
    map.getCanvas().addEventListener('mouseleave', () => st.clearHover());
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

  // A zone file's polygons as features in one color.
  function polygonFeatures(zones, color) {
    return zones.map((z, i) => ({ type: 'Feature', id: i + 1, geometry: z.geometry,
      properties: { color, label: z.name } }));
  }

  root.WSDA = root.WSDA || {};
  root.WSDA.emergencyMap = { create, draw, fit, setPicking, setPick, hoverAt, zoneFeatures, polygonFeatures, KIND, SRC };
})(typeof window !== 'undefined' ? window : globalThis);
