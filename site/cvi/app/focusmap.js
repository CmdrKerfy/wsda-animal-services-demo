/* MapLibre rendering of the County Focus map, after CVI shiny/modules/mod_maps.R output$intrastate_map. Created only
 * when the County Focus view is first chosen. It is a map.js map of its own kind: Washington's land fill and county grid
 * (CVI's "wa_county_outlines": #888888, 0.8 px, opacity 0.6; "Show county outlines" switches it), the selected counties'
 * teal wash and border (CVI's "wa_focus_outline_fill" #245566 at 0.08 and "wa_focus_outline_line" #245566, 2.2 px, 0.95,
 * on whenever counties are picked), the premises in two sources, importers and exporters (CVI's add_dir_cluster), drawn
 * widest first, and the county names on top (12 px, #2c3e50, white halo; from zoom 5). What to draw comes from focus.js.
 * Basemaps, the request gate, contrast, credits, the fit button and the screenshot are map.js's.
 * Clusters (CVI's add_dir_cluster): each source clusters on its own (radius 40, up to zoom 12), so importers and
 * exporters never share a cluster. Cluster circles in the direction's color, 14 px below 10 premises, 18 from 10, 24
 * from 50, 32 from 200, at the circle opacity but at least 0.55, white 2 px ring. Single premises keep their own radius
 * and are drawn widest first within each direction (circle-sort-key = the feature id, given in drawing order:
 * clustering hands MapLibre the premises in its own index order, which would undo CVI's order(-radius_px)). So a
 * premises with a higher id is drawn over one with a lower id, and the exporters' layer over the importers'.
 * Cluster counts are page elements (CVI: map text in Open Sans Bold; here the page's own Open Sans file):
 * MapLibre's abbreviated count, 14 px bold white with a 1.2 px halo in the direction's dark color, matched to the
 * clusters drawn each time the map is drawn. Like CVI's map text, a count is hidden where it would overlap a name shown
 * on the map (the county names are on top in CVI) or a count already placed: exporters' counts before importers' (CVI's
 * layer order), larger counts first (CVI: the order of its data). The screenshot draws the counts shown.
 * Hover (CVI's tooltip and its cluster hover), one pop-up for what is on top under the pointer, built as page elements
 * (file text is never read as HTML): a premises shows CVI's tooltip lines and brightens (opacity +0.25, at most 1); a
 * cluster shows its role and premises count at once, then its animals and species once MapLibre hands over the
 * cluster's premises (getClusterLeaves). That answer is dropped if the pointer has left or moved to something else, or
 * the premises or the map's style changed meanwhile. Click on a premises: CVI's CVI table (at most 25 rows, "+N more
 * CVIs"), scrolling inside the pop-up. Clicking a cluster does nothing (as CVI). "On top" is the drawing order above
 * (MapLibre lists overlapping circles of one layer in its tile order, not by circle-sort-key).
 * Several premises under a click (a deliberate addition; CVI opens the top one only): "1 of N" with
 * the premises' role and previous/next buttons above the table, through every premises under the pointer, topmost
 * first; the buttons are grayed at the ends.
 * Facility layers (CVI's .add_overlay; the layers and their points from facilities.js): only while counties are picked,
 * the points of each switched-on layer inside the picked counties (polygon membership, no buffer), one circle layer per
 * layer in the registry's order above the premises (radius 7, the layer's color, opacity 0.95, white 2 px ring); names
 * stay on top. Hover shows the supplied name/precision as text; click reuses shared screened details. A facility on top
 * is what a click opens (CVI: the
 * topmost layer with a pop-up); the premises' "1 of N" list is for premises only.
 * Hide CVI circles takes the premises, clusters and counts off the map (and its screenshot); the rest stays.
 * Fit (CVI's fit_intrastate and the 300 ms auto-zoom): the selected counties' box widened by 0.3 degrees, fitted to the
 * map's current size (CVI flies to a center and a zoom from the box's span, 3 to 12); without counties the opening view.
 * Contrast: with Auto on a light map, CVI's colors as its map is drawn (grid #888888, teal border, labels #2c3e50); a
 * chosen style, or Auto on a dark basemap, paints the grid and the border in the boundary color and the labels in the
 * label color, as CVI's observers do, and the page keeps them (CVI's next re-render brings its first colors back). */
(function (root) {
  'use strict';
  const M = () => root.CVIWA.map;
  const DIRS = ['Inbound', 'Outbound'];
  const SEL = 'focus_sel_source', SRC = { Inbound: 'focus_src_in', Outbound: 'focus_src_out' };
  const POINTS = { Inbound: 'focus_points_in', Outbound: 'focus_points_out' };
  const CLUSTERS = { Inbound: 'focus_clusters_in', Outbound: 'focus_clusters_out' };
  const BUBBLE = { Inbound: '#1C9CD9', Outbound: '#F0A06E' }, HALO = { Inbound: '#0d4f6e', Outbound: '#7a3f17' };
  const ROLE = { Inbound: 'Importers (received)', Outbound: 'Exporters (sent)' };
  // lit_n: how many premises in a cluster are highlighted (MC chart filters); see draw().
  const CLUSTER = { cluster: true, clusterMaxZoom: 12, clusterRadius: 40,
    clusterProperties: { lit_n: ['+', ['case', ['boolean', ['get', 'lit'], true], 1, 0]] } };
  const CLUSTER_RADIUS = ['step', ['get', 'point_count'], 14, 10, 18, 50, 24, 200, 32];
  // CVI's clusters, or none while "Group nearby premises" is off.
  const grouping = st => (st.focusGrouped === false ? { cluster: false } : CLUSTER);
  const clusterOpacity = op => Math.max(0.55, op);
  const COUNT_PAD = 2;   // MapLibre's text padding around each label
  const GRID = { 'line-color': '#888888', 'line-width': 0.8, 'line-opacity': 0.6 };
  const TEAL = '#245566', LABEL = '#2c3e50';
  const empty = () => ({ type: 'FeatureCollection', features: [] });
  // The direction (Inbound or Outbound) of a premises or cluster layer.
  const dirOf = layerId => (layerId === POINTS.Inbound || layerId === CLUSTERS.Inbound ? 'Inbound' : 'Outbound');
  // The circles' opacity: op, or 0.25 more (at most 1) for the one under the pointer.
  const hoverPaint = op => ['case', ['boolean', ['feature-state', 'hover'], false], Math.min(1, op + 0.25), op];
  // While premises are highlighted (on: MC chart filters), the others and the clusters without one are drawn at
  // DIM_OPACITY, as the WA map dims the counties outside the spotlight. Without a highlight the paint is S5's.
  const DIM_OPACITY = 0.10;
  const pointPaint = (op, on) => (on ? ['case', ['boolean', ['get', 'lit'], true], hoverPaint(op), DIM_OPACITY] : hoverPaint(op));
  const clusterPaint = (op, on) => (on ? ['case', ['>', ['number', ['get', 'lit_n'], 1], 0], clusterOpacity(op), DIM_OPACITY]
    : clusterOpacity(op));
  const FAC = i => 'focus_fac_' + i, FAC_SRC = i => 'focus_fac_src_' + i, isFac = id => /^focus_fac_\d+$/.test(String(id));
  // A facility layer drawn in its mark (the layer's shape and color, from facilities.js).
  const FAC_LAYER = (l, i) => root.CVIWA.map.markLayer(FAC(i), FAC_SRC(i), root.CVIWA.map.markId(l.shape, l.color));

  const KIND = {
    labelClass: 'focus-label',
    linePaint: GRID,
    isOwn: id => /^focus_/.test(String(id)),
    hoverLayers: st => (ready(st) ? HOVER_LAYERS.concat(facIds(st)) : []),   // what map.js's population hover leaves alone
    sources(st) {
      const f = st.focus || {};
      return { [SEL]: { type: 'geojson', data: f.sel || empty() },
        [SRC.Inbound]: Object.assign({ type: 'geojson', data: { type: 'FeatureCollection', features: f.Inbound || [] } },
          grouping(st)),
        [SRC.Outbound]: Object.assign({ type: 'geojson', data: { type: 'FeatureCollection', features: f.Outbound || [] } },
          grouping(st)),
        ...Object.fromEntries((st.fac ? st.fac.layers : []).map((l, i) => [FAC_SRC(i),
          { type: 'geojson', data: facData(st, i) }])) };
    },
    layers(st) {
      const op = st.focusOpacity || 0.8, visibility = st.focusHidden ? 'none' : 'visible';
      const points = dir => ({ id: POINTS[dir], type: 'circle', source: SRC[dir], filter: ['!', ['has', 'point_count']],
        layout: { visibility, 'circle-sort-key': ['id'] }, paint: {
          'circle-color': ['get', 'color'], 'circle-radius': ['get', 'radius_px'],
          'circle-opacity': pointPaint(op, !!st.focusLit),
          'circle-stroke-width': 1.5, 'circle-stroke-color': '#ffffff', 'circle-stroke-opacity': 1.0 } });
      const clusters = dir => ({ id: CLUSTERS[dir], type: 'circle', source: SRC[dir], filter: ['has', 'point_count'],
        layout: { visibility }, paint: {
        'circle-color': BUBBLE[dir], 'circle-radius': CLUSTER_RADIUS, 'circle-opacity': clusterPaint(op, !!st.focusLit),
        'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } });
      // The premises' thin dark edge, as on the WA State map (map.js edgeLayer).
      const edge = dir => M().edgeLayer(POINTS[dir], SRC[dir], { filter: ['!', ['has', 'point_count']],
        layout: { visibility, 'circle-sort-key': ['id'] } });
      return [{ id: 'wa_focus_outline_fill', type: 'fill', source: SEL, paint: { 'fill-color': TEAL, 'fill-opacity': 0.08 } },
        { id: 'wa_focus_outline_line', type: 'line', source: SEL,
          paint: { 'line-color': (st.contrast && st.contrast.border) || TEAL, 'line-width': 2.2, 'line-opacity': 0.95 } },
        edge('Inbound'), points('Inbound'), clusters('Inbound'), edge('Outbound'), points('Outbound'), clusters('Outbound')]
        .concat((st.fac ? st.fac.layers : []).map(FAC_LAYER));
    },
    draw: (st, d, opts) => draw(st, d, opts),
    attach: st => attach(st),
    capture: (st, g, k) => captureCounts(st, g, k),
    contrast(st, c, dark) {
      const autoLabel = (st.labelStyle || 'auto') === 'auto' && !dark,
        autoLine = (st.boundaryStyle || 'auto') === 'auto' && !dark;
      return Object.assign({}, c, autoLabel ? { label: LABEL } : {},
        autoLine ? { line: GRID['line-color'], border: TEAL } : { border: c.line });
    },
    applyContrast(st) {
      if (st.map.getLayer('wa_focus_outline_line')) st.map.setPaintProperty('wa_focus_outline_line', 'line-color', st.contrast.border);
    }
  };

  // The County Focus map: the shared map (map.js) with this view's sources and layers, nothing drawn yet.
  function create(container, geo, onReady, onError) {
    const st = M().create(container, geo, onReady, onError, KIND);
    st.focus = { sel: empty(), Inbound: [], Outbound: [] };
    st.premises = { Inbound: [], Outbound: [] };
    st.fac = { layers: [], on: new Set(), picks: [], sig: '', member: null, memberKey: null };
    M().setLines(st, true);
    return st;
  }

  // d: { premises: focus.build().premises, counties: the counties picked, highlight: the premises keys to highlight
  // (crossfilter.focusHighlight; null for none) }; opts: { opacity }. The selected counties'
  // outlines, and each direction's premises in drawing order (the widest first, as CVI's order(-radius_px)). Only what
  // the map and the cluster hover need goes into the sources; the hover and the CVI table are looked up by feature id.
  function draw(st, d, opts) {
    if (st.failed) return;
    if (!st.ready || st.switching) { st.pending = { d, opts }; return; }
    st.last = { d, opts };
    st.clearHover();
    if (st.clickPopup) { st.clickPopup.remove(); st.clickPopup = null; }
    const picks = new Set(d.counties || []), ps = d.premises || [];
    const lit = p => !d.highlight || d.highlight.has(p.direction + '\r' + p.group_key);
    const sel = { type: 'FeatureCollection', features: st.geo.counties.features.filter(f => picks.has(f.properties.name)) };
    const order = M().drawOrder(ps), out = { sel, Inbound: [], Outbound: [] }, premises = { Inbound: [], Outbound: [] };
    order.forEach(i => {
      const p = ps[i];
      if (!out[p.direction]) return;
      premises[p.direction].push(p);
      out[p.direction].push({ type: 'Feature', id: out[p.direction].length + 1,
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { direction: p.direction, premises_id: p.premises_id, color: p.color, radius_px: p.radius_px,
          total_animals: p.total_animals, n_shipments: p.n_shipments, species_json: p.species_json, lit: lit(p) } });
    });
    st.focus = out; st.premises = premises;
    st.focusLit = !!d.highlight;
    st.focusOpacity = Number(opts.opacity);
    st.map.getSource(SEL).setData(sel);
    DIRS.forEach(dir => {
      st.map.getSource(SRC[dir]).setData({ type: 'FeatureCollection', features: out[dir] });
      st.map.setPaintProperty(POINTS[dir], 'circle-opacity', pointPaint(st.focusOpacity, st.focusLit));
      st.map.setPaintProperty(CLUSTERS[dir], 'circle-opacity', clusterPaint(st.focusOpacity, st.focusLit));
    });
    st.drawn = out.Inbound.concat(out.Outbound);
    st.fac.picks = (d.counties || []).slice();
    syncFacilities(st);
  }

  // ---- Facility layers ---------------------------------------------------------------------------------------------
  // layers: [{ key, color, points: [{ name, lon, lat }] }] (usable layers, in the registry's order); on: keys switched on.
  function setFacilities(st, layers, on) {
    st.fac.layers = (layers || []).map(l => Object.assign({}, l, { points: l.points || [] }));
    st.fac.on = new Set(on || []);
    syncFacilities(st);
  }
  // The points of layer i shown now: none without picked counties or with the layer off (CVI draws them only then).
  function facData(st, i) {
    const F = st.fac, l = F.layers[i];
    if (!l || !F.on.has(l.key) || !F.picks.length) return empty();
    const key = F.picks.slice().sort().join('|');
    if (F.memberKey !== key) { F.member = root.CVIWA.facilities.countyMembership(st.geo.counties, F.picks); F.memberKey = key; }
    return { type: 'FeatureCollection', features: l.points.filter(p => F.member.contains(p.lon, p.lat))
      .map((p, k) => ({ type: 'Feature', id: k + 1, geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { name: p.name, row_id: p.id, ref_display: p.display || p.name } })) };
  }
  // The map's facility layers made to match the registry (new layers on top), then each given its points.
  function syncFacilities(st) {
    if (!st.ready || st.switching || st.failed) return;
    const map = st.map, F = st.fac, sig = JSON.stringify(F.layers.map(l => [l.key, l.color, l.shape]));
    if (sig !== F.sig) {
      if (st.clickPopup) { st.clickPopup.remove(); st.clickPopup = null; }
      st.clearHover();
      for (let i = 0; map.getSource(FAC_SRC(i)); i++) {
        if (map.getLayer(FAC(i))) map.removeLayer(FAC(i)); map.removeSource(FAC_SRC(i));
      }
      F.layers.forEach((l, i) => {
        map.addSource(FAC_SRC(i), { type: 'geojson', data: empty() }); root.CVIWA.map.addMark(map, l.shape, l.color);
        map.addLayer(FAC_LAYER(l, i));
      });
      F.sig = sig;
    }
    if (st.facilityPopupId
      && !F.layers.some((l,i) => facData(st,i).features.some(f => f.properties.row_id === st.facilityPopupId))) {
      if (st.clickPopup) st.clickPopup.remove(); st.clickPopup = null; st.facilityPopupId = null;
    }
    st.clearHover();
    F.layers.forEach((l, i) => map.getSource(FAC_SRC(i)).setData(facData(st, i)));
    F.drawn = F.layers.map((l, i) => [l.key, facData(st, i).features.map(f => f.properties.name)]);   // test hook
  }

  // Hide CVI circles (CVI's hide_cvi_circles): the premises, their clusters and counts off this map (and so out of its
  // screenshot and hover); outlines, names and the summaries stay. Kept across basemap changes.
  function setHidden(st, on) {
    st.focusHidden = !!on;
    if (!st.ready || st.switching || st.failed) return;
    if (on) { st.clearHover(); if (st.clickPopup) { st.clickPopup.remove(); st.clickPopup = null; } }
    HOVER_LAYERS.concat(EDGE_LAYERS).forEach(id => {
      if (st.map.getLayer(id)) st.map.setLayoutProperty(id, 'visibility', on ? 'none' : 'visible');
    });
  }

  // "Group nearby premises": on, CVI's clusters (numbered bubbles of one size
  // until zoom 12); off, every premises drawn at its own size at any zoom. Kept across basemap changes (sources()).
  function setGrouped(st, on) {
    st.focusGrouped = !!on;
    if (!st.ready || st.switching || st.failed) return;
    st.clearHover();
    if (st.clickPopup) { st.clickPopup.remove(); st.clickPopup = null; }
    DIRS.forEach(dir => st.map.getSource(SRC[dir]).setClusterOptions({ cluster: st.focusGrouped,
      clusterMaxZoom: CLUSTER.clusterMaxZoom, clusterRadius: CLUSTER.clusterRadius }));
  }

  // Circle opacity (CVI's intra_opacity): the premises at it (hover +0.25, at most 1), clusters at it but at least 0.55.
  function setOpacity(st, op) {
    st.focusOpacity = Number(op);
    if (!st.ready || st.switching || st.failed) return;
    DIRS.forEach(dir => {
      st.map.setPaintProperty(POINTS[dir], 'circle-opacity', pointPaint(st.focusOpacity, st.focusLit));
      st.map.setPaintProperty(CLUSTERS[dir], 'circle-opacity', clusterPaint(st.focusOpacity, st.focusLit));
    });
    if (st.last) st.last.opts = Object.assign({}, st.last.opts, { opacity: op });
  }

  // ---- Pop-up contents, built as page elements ---------------------------------------------------------------------
  const el = (tag, css, text) => {
    const e = root.document.createElement(tag);
    if (css) Object.assign(e.style, css);
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const br = () => root.document.createElement('br');
  // CVI's premises tooltip (focus.js g.tooltip): role, place, CVIs, total, the shared-geocode warning, the click hint.
  function tooltipElement(t) {
    const box = el('div');
    box.append(el('strong', null, t.role), br(), t.place, br());
    if (t.cvis !== null) box.append(t.cvis, br());
    box.append(t.total);
    if (t.merged) box.append(br(), el('span', { color: '#B36B00', fontSize: '0.8em' }, t.merged_text));
    box.append(br(), el('span', { color: '#777', fontSize: '0.85em' }, t.hint));
    return box;
  }
  // CVI's cluster hover (renderPopup): role, "N premises" and, once the leaves are in, " • X animals" and the species
  // totals, largest first (each line after a line break, as CVI's).
  const fmt = n => Math.round(n).toLocaleString('en-US');
  function clusterElement(role, count, animals, spec) {
    const box = el('div', { fontSize: '14px', lineHeight: '1.45' });
    box.append(el('strong', { fontSize: '15px' }, role), br(),
      el('span', { fontSize: '14px' }, count + ' premises' + (animals === null ? '' : ' • ' + fmt(animals) + ' animals')));
    const keys = Object.keys(spec).sort((a, b) => spec[b] - spec[a]);
    if (keys.length) {
      const block = el('div', { marginTop: '5px', color: '#444', fontSize: '13px' });
      keys.forEach(k => block.append(br(), k + ': ' + fmt(spec[k])));
      box.append(block);
    }
    return box;
  }
  // The leaves' animals and species, summed as CVI's applyLeaves does.
  function sumLeaves(leaves) {
    let animals = 0;
    // File labels are dictionary keys, including names inherited by a normal JavaScript object.
    const spec = Object.create(null);
    leaves.forEach(lf => {
      const a = parseFloat(lf.properties.total_animals);
      if (!isNaN(a)) animals += a;
      const sj = lf.properties.species_json;
      if (sj) {
        try { const o = JSON.parse(sj); Object.keys(o).forEach(k => { spec[k] = (spec[k] || 0) + o[k]; }); } catch (e) { /* as CVI */ }
      }
    });
    return { animals, spec };
  }
  // CVI's premises popup (.mk_focus_popup; focus.js g.popup): the CVI / Origin / Dest / Species table, scrolling.
  function popupElement(p) {
    // Focus is 77vh tall. Leave 80px for navigation, popup padding and tip so the popup fits on either side
    // of a click at mid-map, including Safari's shorter viewport with its browser toolbar visible.
    const box = el('div', { maxHeight: 'min(240px, 30vh, calc(38.5vh - 80px))', overflow: 'auto', fontSize: '14px' }), table = el('table', { borderCollapse: 'collapse' });
    const head = el('tr', { textAlign: 'left', borderBottom: '1px solid #ccc' });
    ['CVI', 'Origin', 'Dest', 'Species'].forEach(h => head.append(el('th', { padding: '2px 10px' }, h)));
    const thead = el('thead'), tbody = el('tbody');
    thead.append(head);
    p.rows.forEach(r => {
      const tr = el('tr'); r.forEach(c => tr.append(el('td', { padding: '0 10px' }, c))); tbody.append(tr);
    });
    table.append(thead, tbody); box.append(table);
    if (p.more) box.append(el('div', { fontSize: '0.75em', color: '#777', marginTop: '3px' }, '+' + p.more + ' more CVIs'));
    return box;
  }

  // Several premises under a click: "1 of N", the role and the buttons, then CVI's table of the one shown.
  function stackElement(st, hits, onTable) {
    const box = el('div'), table = el('div');
    let i = 0;
    const bar = el('div', null), prev = el('button', null, '\u2039'), next = el('button', null, '\u203a'), label = el('span');
    bar.className = 'focus-stack';
    prev.type = next.type = 'button';
    prev.title = 'Previous premises'; next.title = 'Next premises';
    prev.setAttribute('aria-label', prev.title); next.setAttribute('aria-label', next.title);
    bar.append(prev, label, next);
    // Shows premises k of the list (kept within the ends), its role and its table.
    const show = k => {
      i = Math.max(0, Math.min(hits.length - 1, k));
      const h = hits[i], p = st.premises[h.dir][h.id - 1];
      label.textContent = (i + 1) + ' of ' + hits.length + ' \u00b7 ' + (p ? p.tooltip.role : '');
      prev.disabled = i === 0; next.disabled = i === hits.length - 1;
      table.replaceChildren(p ? popupElement(p.popup) : el('div'));
      onTable(i);
    };
    prev.addEventListener('click', () => show(i - 1));
    next.addEventListener('click', () => show(i + 1));
    if (hits.length > 1) box.append(bar);
    box.append(table);
    show(0);
    return box;
  }

  // ---- Hover, click and the count labels ---------------------------------------------------------------------------
  const HOVER_LAYERS = [POINTS.Inbound, CLUSTERS.Inbound, POINTS.Outbound, CLUSTERS.Outbound];
  const EDGE_LAYERS = [POINTS.Inbound + '-edge', POINTS.Outbound + '-edge'];
  // Whether the premises layers are on the map (not in the middle of a basemap change); the facility layers on it.
  const ready = st => !st.switching && !!st.map.getLayer(POINTS.Inbound);
  const facIds = st => (st.fac ? st.fac.layers : []).map((l, i) => FAC(i)).filter(id => st.map.getLayer(id));
  // The premises under a point, topmost first as drawn: the exporters' layer over the importers', and within a layer
  // the higher id (drawn later) first. Each premises once (MapLibre can list a point from two tiles).
  function premisesAt(st, point) {
    const seen = new Set(), hits = [];
    st.map.queryRenderedFeatures(point, { layers: [POINTS.Inbound, POINTS.Outbound] }).forEach(f => {
      const dir = dirOf(f.layer.id), key = dir + ':' + f.id;
      if (!seen.has(key)) { seen.add(key); hits.push({ dir, id: f.id }); }
    });
    return hits.sort((a, b) => (a.dir === b.dir ? b.id - a.id : a.dir === 'Outbound' ? -1 : 1));
  }
  // The feature on top among MapLibre's hits (its layer order is right; within a premises layer, the highest id).
  const topmost = fs => (fs[0].layer.id === CLUSTERS[dirOf(fs[0].layer.id)] || isFac(fs[0].layer.id) ? fs[0]
    : fs.filter(f => f.layer.id === fs[0].layer.id).reduce((a, b) => (b.id > a.id ? b : a)));
  // The map's hover tooltips, click pop-ups and cluster count labels, set up once for the map.
  function attach(st) {
    const map = st.map, Popup = root.maplibregl.Popup;
    const tip = new Popup({ closeButton: false, closeOnClick: false, maxWidth: '400px', className: 'focus-tip' });
    st.hoverKey = null; st.hoverToken = 0;
    const unhover = () => { if (st.hover) map.setFeatureState(st.hover, { hover: false }); st.hover = null; st.hoverId = null; };
    st.clearHover = () => { st.hoverToken++; st.hoverKey = null; map.getCanvas().style.cursor = ''; unhover(); tip.remove(); };
    map.on('mousemove', e => {
      if (!ready(st)) return;
      const fs = map.queryRenderedFeatures(e.point, { layers: HOVER_LAYERS.concat(facIds(st)) });
      if (!fs.length) { if (st.hoverKey) st.clearHover(); return; }
      const f = topmost(fs), fac = isFac(f.layer.id), dir = dirOf(f.layer.id), cluster = f.layer.id === CLUSTERS[dir];
      const key = fac ? f.layer.id + ':' + f.id : dir + (cluster ? ':c' + f.properties.cluster_id : ':p' + f.id);
      map.getCanvas().style.cursor = 'pointer';
      if (key !== st.hoverKey) {
        st.hoverToken++; unhover(); st.hoverKey = key;
        // CVI's tooltip: the name
        if (fac) tip.setDOMContent(el('div', null, String(f.properties.ref_display || f.properties.name || '')));
        else if (cluster) hoverCluster(st, tip, dir, f);
        else {
          const p = st.premises[dir][f.id - 1];
          st.hover = { source: SRC[dir], id: f.id }; st.hoverId = f.id;
          map.setFeatureState(st.hover, { hover: true });
          tip.setDOMContent(p ? tooltipElement(p.tooltip) : el('div'));
        }
      }
      tip.setLngLat(e.lngLat);
      if (!tip.isOpen()) tip.addTo(map);
    });
    map.getCanvas().addEventListener('mouseleave', () => st.clearHover());
    // A click on premises: the CVI table of the one on top, with "1 of N" when there are several (clusters have no
    // click action, as CVI).
    map.on('click', e => {
      if (!ready(st)) return;
      const top = map.queryRenderedFeatures(e.point, { layers: [POINTS.Inbound, POINTS.Outbound].concat(facIds(st)) });
      if (top.length && isFac(top[0].layer.id)) {   // Shared supplied details; Focus county union stays local.
        const f = topmost(top);
        if (st.clickPopup) st.clickPopup.remove();
        st.clickStack = { facility: f.layer.id + ':' + f.id };   // test hook
        const layer = st.fac.layers[Number(f.layer.id.split('_').pop())],
          point = layer.points.find(p => p.id === f.properties.row_id);
        if (!point) return;
        st.clearHover(); st.facilityPopupId = point.id;
        // Closes on a map click, as in S5 (MapLibre's default).
        st.clickPopup = new Popup({ maxWidth: 'min(360px, 85vw)', className: 'focus-click focus-fac-click' }).setLngLat(e.lngLat)
          .setDOMContent(root.WSDA.facilityDetails.element(layer, point, point.counties)).addTo(map);
        const close = st.clickPopup.getElement().querySelector('.maplibregl-popup-close-button');
        if (close) close.focus({ preventScroll: true });
        const popup = st.clickPopup;
        popup.on('close', () => { if (st.clickPopup === popup) { st.clickPopup = null; st.facilityPopupId = null; } });
        return;
      }
      const hits = premisesAt(st, e.point).filter(h => st.premises[h.dir][h.id - 1]);
      if (!hits.length) return;
      if (st.clickPopup) st.clickPopup.remove();
      st.facilityPopupId = null;
      const stack = { keys: hits.map(h => h.dir + ':' + h.id), index: 0 };   // test hook
      st.clickStack = stack;
      st.clickPopup = new Popup({ maxWidth: '400px', className: 'focus-click' }).setLngLat(e.lngLat)
        .setDOMContent(stackElement(st, hits, k => {
          stack.index = k;
          // Navigation may change table height; choose the popup anchor again for the new content.
          if (st.clickPopup) st.clickPopup.setLngLat(st.clickPopup.getLngLat());
        })).addTo(map);
    });
    const layer = root.document.createElement('div');
    layer.className = 'focus-counts';
    map.getCanvasContainer().appendChild(layer);
    st.counts = { layer, els: new Map(), sizes: new Map(), placed: [] };
    map.on('render', () => placeCounts(st));
  }
  // The role and count at once, then the leaves' sums when MapLibre hands them over, unless the hover moved on.
  function hoverCluster(st, tip, dir, f) {
    const token = st.hoverToken, count = f.properties.point_count, id = f.properties.cluster_id, src = st.map.getSource(SRC[dir]);
    tip.setDOMContent(clusterElement(ROLE[dir], count, null, {}));
    st.clusterHover = { dir, id, count, state: 'waiting' };   // test hook
    const hook = st.clusterHover;
    Promise.resolve().then(() => src.getClusterLeaves(id, count, 0)).then(leaves => {
      if (token !== st.hoverToken || st.map.getSource(SRC[dir]) !== src) { hook.state = 'discarded'; return; }
      const s = sumLeaves(leaves || []);
      tip.setDOMContent(clusterElement(ROLE[dir], count, s.animals, s.spec));
      Object.assign(hook, { state: 'shown', leaves: (leaves || []).map(l => l.properties.premises_id),
        animals: s.animals, spec: s.spec });
    }).catch(() => { hook.state = 'failed'; });
  }

  // One label per cluster drawn now, at the cluster's center. Placement: the names shown on the map first, then the
  // exporters' counts, then the importers', larger counts first; a count whose box (plus MapLibre's 2 px text padding)
  // overlaps one already placed is hidden.
  const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  function placeCounts(st) {
    const map = st.map, C = st.counts;
    if (!C) return;
    const seen = new Map();
    if (ready(st) && map.getLayer(CLUSTERS.Outbound)) {
      map.queryRenderedFeatures({ layers: [CLUSTERS.Outbound, CLUSTERS.Inbound] }).forEach(f => {
        const dir = dirOf(f.layer.id), key = dir + ':' + f.properties.cluster_id;
        if (!seen.has(key)) seen.set(key, { key, dir, count: f.properties.point_count,
          text: String(f.properties.point_count_abbreviated), lngLat: f.geometry.coordinates });
      });
    }
    C.els.forEach((e, key) => { if (!seen.has(key)) { e.remove(); C.els.delete(key); } });
    const list = [...seen.values()].sort((a, b) => (a.dir === b.dir ? 0 : a.dir === 'Outbound' ? -1 : 1) || b.count - a.count
      || a.lngLat[0] - b.lngLat[0] || a.lngLat[1] - b.lngLat[1]);
    const boxes = [];
    const box = (q, w, h) => [q.x - w / 2 - COUNT_PAD, q.y - h / 2 - COUNT_PAD, q.x + w / 2 + COUNT_PAD, q.y + h / 2 + COUNT_PAD];
    shownNames(st).forEach(m => {
      const e = m.getElement();
      if (e.offsetWidth) boxes.push(box(map.project(m.getLngLat()), e.offsetWidth, e.offsetHeight));
    });
    C.placed = list.map(c => {
      let e = C.els.get(c.key);
      if (!e) {
        e = root.document.createElement('div');
        e.className = 'focus-count focus-count-' + (c.dir === 'Inbound' ? 'in' : 'out');
        C.layer.appendChild(e); C.els.set(c.key, e);
      }
      if (e.textContent !== c.text) e.textContent = c.text;
      const q = map.project(c.lngLat);
      e.style.transform = 'translate(' + q.x + 'px, ' + q.y + 'px) translate(-50%, -50%)';
      let size = C.sizes.get(c.text);
      if (!size && e.offsetWidth) { size = [e.offsetWidth, e.offsetHeight]; C.sizes.set(c.text, size); }
      let show = true;
      if (size) {
        const b = box(q, size[0], size[1]);
        if (boxes.some(o => overlaps(o, b))) show = false; else boxes.push(b);
      }
      e.classList.toggle('collided', !show);
      return { dir: c.dir, count: c.count, text: c.text, lngLat: c.lngLat, x: q.x, y: q.y, shown: show };
    });
  }
  // The names shown on the map now: Washington's county names and the neighboring regions' (page elements).
  function shownNames(st) {
    const all = st.labels.concat(...Object.keys(st.nr.labels).map(id =>
      [st.nr.labels[id].name].concat(st.nr.labels[id].counties)));
    return all.filter(m => !m.getElement().classList.contains('hidden'));
  }
  // Screenshot: the counts shown, drawn under the names as on the map.
  function captureCounts(st, g, k) {
    placeCounts(st);
    const family = root.getComputedStyle(root.document.body).fontFamily;
    st.lastCounts = [];   // test hook: the counts drawn
    g.save();
    g.font = '700 ' + (14 * k) + 'px ' + family; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    (st.counts ? st.counts.placed : []).filter(c => c.shown).forEach(c => {
      const x = c.x * k, y = c.y * k;
      if (x < 0 || y < 0 || x > g.canvas.width || y > g.canvas.height) return;
      g.strokeStyle = HALO[c.dir]; g.lineWidth = 2 * 1.2 * k; g.strokeText(c.text, x, y);
      g.fillStyle = '#ffffff'; g.fillText(c.text, x, y);
      st.lastCounts.push(c.dir + ':' + c.text);
    });
    g.restore();
  }

  // The selected counties' box (focus.fitBox) fitted to the map's size, no further than zoom 12 (CVI's clamp); the
  // opening view without counties.
  function fitTo(st, picks) {
    if (!st.ready || st.failed) return;
    const b = picks && picks.length ? root.CVIWA.focus.fitBox(st.geo.counties, picks) : null;
    if (!b) { M().fitView(st); return; }
    st.map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 0, maxZoom: 12, animate: false });
  }

  root.CVIWA = root.CVIWA || {};
  root.CVIWA.focusmap = { create, draw, DIM_OPACITY, fitTo, setHidden, setGrouped, setOpacity, setFacilities, FAC_LAYER,
    placeCounts, tooltipElement, clusterElement, popupElement, stackElement, sumLeaves, KIND, SEL, SRC, POINTS,
    CLUSTERS, BUBBLE, HALO, ROLE, CLUSTER, CLUSTER_RADIUS, GRID, TEAL, LABEL };
})(typeof window !== 'undefined' ? window : globalThis);
