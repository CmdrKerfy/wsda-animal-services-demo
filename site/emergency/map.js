/* The Emergency Response map: a map kind of the shared map (CVI's map.js create, as Infrastructure's facilitymap.js
 * and Premise Lookup's lookupmap.js are), so basemaps, the request gate, contrast, credits, neighboring regions,
 * population context, the fit button and the screenshot are the shared map's; Washington's land and county lines lie
 * under it. Adapted from site/cvi/app/lookupmap.js, v1.1 (its sources and layers, the hover and Pick on map), with
 * the Emergency page's own marks.
 *
 * What it draws (the page gives it, data below): the zones, as rings around the positives (each ring between its
 * distance and the one inside it, in its ring's color) or as a zone file's polygons; the sites of the ticked layers
 * outside the zones, small and faded; the sites inside the zones, in their layer's mark; the positives on top, in
 * their status color (a closed positive hollow, a positive without zones smaller); the spot picked with "Add a point
 * on the map" (a hollow ring). Hover: one line for the mark on top under the pointer, set as text (file values are
 * never read as HTML). The view fits the zones (else the positives) after each new set of files or zones.
 *
 * create(container, geo, onReady, onError) -> the map's state (map.js create with this kind)
 * draw(st, data, fit) -> draws data: { zones: [GeoJSON Feature with properties { color, label }], positives: [{ lat,
 *   lon, label, color, closed, withZones }], inside and outside: [{ lat, lon, label, shape, color }], bounds: [west,
 *   south, east, north] or null }; fit: true fits the view to the bounds
 * setPicking(st, on, onPick) -> while on, a click on the map calls onPick(lon, lat), with a crosshair cursor
 * setPick(st, [lon, lat] | null) -> marks the picked spot
 * zoneFeatures(sites, rings, n) -> the ring shapes of ring sites (proximity.bandShapes), each with its ring's color
 *   and label; polygonFeatures(zones, color) -> a zone file's polygons as features */
(function (root) {
  'use strict';
  const M = () => root.CVIWA.map;
  const SRC = { zones: 'em_zones', outside: 'em_outside', inside: 'em_inside', positives: 'em_positives',
    pick: 'em_pick' };
  // What the hover looks at, topmost first: the positives over the sites inside over the others.
  const POINT_LAYERS = ['em_positives', 'em_inside', 'em_outside'];
  const PICK = '#c0392b';
  const empty = () => ({ type: 'FeatureCollection', features: [] });
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const marks = list => ({ type: 'FeatureCollection', features: list.map((p, i) => ({ type: 'Feature', id: i + 1,
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: { label: p.label, mark: M().markId(p.shape || 'circle', p.color) } })) });
  const dots = list => ({ type: 'FeatureCollection', features: list.map((p, i) => ({ type: 'Feature', id: i + 1,
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: { label: p.label, color: p.color, fill: p.closed ? '#ffffff' : p.color, radius: p.withZones ? 7 : 5 } })) });

  const KIND = {
    isOwn: id => /^em_/.test(String(id)),
    scaleCorner: 'bottom-left',   // the legend covers the bottom right
    hoverLayers: () => POINT_LAYERS,
    sources(st) {
      const d = st.em || {};
      return Object.assign({}, M().WA_KIND.sources(st), {
        [SRC.zones]: { type: 'geojson', data: d.zones || empty() },
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
        M().markLayer('em_outside', SRC.outside, ['get', 'mark'], { size: 0.7, opacity: 0.35 }),
        M().markLayer('em_inside', SRC.inside, ['get', 'mark'], { size: 1, opacity: 1 }),
        { id: 'em_positives', type: 'circle', source: SRC.positives, paint: { 'circle-color': ['get', 'fill'],
          'circle-radius': ['get', 'radius'], 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2.5 } },
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
    st.em = { zones: empty(), outside: empty(), inside: empty(), positives: empty(), pick: empty() };
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
      outside: marks(d.outside || []),
      inside: marks(d.inside || []),
      positives: dots(d.positives || []),
      pick: st.em.pick
    };
    // The marks' pictures first, so the marks show as soon as the map has drawn.
    (d.outside || []).concat(d.inside || []).forEach(p => M().addMark(st.map, p.shape || 'circle', p.color));
    Object.keys(SRC).forEach(k => { if (st.map.getSource(SRC[k])) st.map.getSource(SRC[k]).setData(st.em[k]); });
    st.bounds = d.bounds || null;
    st.drawn = { zones: st.em.zones.features.length, outside: st.em.outside.features.length,
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

  // One tooltip for the mark on top under the pointer; a click while picking gives the spot to the page.
  function attach(st) {
    const map = st.map;
    const tip = new root.maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: '320px' });
    st.clearHover = () => { map.getCanvas().style.cursor = ''; tip.remove(); st.hoverLabel = null; };
    map.on('mousemove', e => {
      if (st.switching) return;
      const layers = POINT_LAYERS.filter(id => map.getLayer(id));
      const f = layers.length ? map.queryRenderedFeatures(e.point, { layers })[0] : null;
      if (!f) { st.clearHover(); return; }
      map.getCanvas().style.cursor = st.picking ? '' : 'default';
      st.hoverLabel = f.properties.label;   // test hook
      tip.setLngLat(e.lngLat).setHTML(esc(f.properties.label)).addTo(map);
    });
    map.getCanvas().addEventListener('mouseleave', () => st.clearHover());
    map.on('click', e => {
      if (st.switching) return;
      if (st.picking && st.onPick) st.onPick(e.lngLat.lng, e.lngLat.lat);
    });
  }

  // The ring shapes of ring sites, in their ring's color: each ring between its distance and the one inside it.
  function zoneFeatures(sites, rings, n) {
    const P = root.WSDA.proximity;
    return sites.flatMap(s => P.bandShapes(s, n || 120).map(f => {
      const ring = rings.find(r => r.distance === f.properties.outerKm) || rings[rings.length - 1];
      f.properties = Object.assign({}, f.properties, { color: ring.color, label: ring.label });
      return f;
    }));
  }

  // A zone file's polygons as features in one color.
  function polygonFeatures(zones, color) {
    return zones.map((z, i) => ({ type: 'Feature', id: i + 1, geometry: z.geometry,
      properties: { color, label: z.name } }));
  }

  root.WSDA = root.WSDA || {};
  root.WSDA.emergencyMap = { create, draw, fit, setPicking, setPick, zoneFeatures, polygonFeatures, KIND, SRC };
})(typeof window !== 'undefined' ? window : globalThis);
