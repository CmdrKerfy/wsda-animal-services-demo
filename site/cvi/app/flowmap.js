/* MapLibre rendering of the National Flow map, after CVI shiny/modules/mod_maps.R output$flow_map (the live Flow map):
 * opening view (-96, 39.5) at zoom 3.6 on a globe (mapgl's default, as CVI), navigation control top
 * left, screenshot top right, state lines (#888888, 0.6 px, opacity 0.6), the flow lines (widest first, round caps and
 * joins, hover raises the opacity) with CVI's tooltips, and the state abbreviations at the centers (not AK or HI).
 * Created only when the National Flow view is first chosen. What to draw comes from flow.js (pure).
 * Deliberate differences: offline only: light gray states from the bundled Census outlines
 * on the page background (CVI: CARTO Positron tiles), and no request of any kind: every request MapLibre would make is
 * refused before it is sent. The camera stays on filter and style changes (CVI rebuilds the map and snaps back unless
 * browsing). A fit button under the zoom buttons returns to the opening view (as Map Style's "Fit to Lower 48" on the
 * page). State labels and lines are switched live. Labels are HTML markers, so no glyph file is fetched. Labels that
 * would overlap are hidden as on CVI's map (its symbol layer's default), rechecked whenever the map moves; the larger
 * state's label is the one kept (CVI keeps whichever comes first in its data); a label whose point is
 * on the far side of the globe is hidden too. The screenshot is saved straight from the click with a message, its
 * picture carrying the labels shown on the map and the Census boundary credit.
 * Shaded states (CH; not in CVI): setShade() fills each state in its class's color (choropleth.js) in place of the
 * lines, under white state lines; a state with no movements keeps the land gray;
 * Washington white with a dark outline, the hub; while states are picked in a chart the others are dimmed and the
 * picked ones outlined; hover gives the state's animals by species.
 * Alaska and Hawaii (not in CVI): an inset box for each with movements, over
 * the map's top left beside the zoom buttons (flowinsets.js, geo/us-insets.js), shaded or land gray with the state's
 * name and animals; on the Lines map their lines run straight from Washington's anchor to the state's center in its
 * box, drawn again as the map moves. Hover and the screenshot treat them as the map's own states and lines. */
(function (root) {
  'use strict';
  const F = () => root.CVIWA.flow;
  const SOURCE = 'lines_source', LAYER = 'flow_lines';
  // CH: the shaded states' source and layers; Washington's outline and the picked states' outline.
  const SHADE_SOURCE = 'state_shade_source', SHADE_LAYER = 'state-fill', SHADE_OUTLINE = 'state-outline';
  const SHADE_DIM = 0.2;
  const WA_HUB = { fill: '#ffffff', line: '#1c5a83', width: 2 };
  const PICKED_LINE = { color: '#ffffff', width: 3 };   // choropleth.js OUTLINE
  const SHADED_LINES = { color: '#ffffff', width: 0.8, opacity: 1 };
  const LABEL_PAD = 2;   // px around each label, as MapLibre's default text-padding

  // The map's style, complete and inline: the background, the land and state lines from the bundled outlines, and the
  // empty flow-line layer that draw() fills.
  function style(states) {
    const L = F().STATE_LINES;
    return { version: 8, projection: { type: F().VIEW.projection }, sources: {
      state_lines_source: { type: 'geojson', data: states.states },
      [SOURCE]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#f8f9fa' } },
      { id: 'us-land', type: 'fill', source: 'state_lines_source', paint: { 'fill-color': '#ececec', 'fill-opacity': 1 } },
      { id: 'state-lines', type: 'line', source: 'state_lines_source', layout: { visibility: 'visible' },
        paint: { 'line-color': L.color, 'line-width': L.width, 'line-opacity': L.opacity } },
      { id: LAYER, type: 'line', source: SOURCE, layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': 0.8 } }] };
  }

  // CVI's tooltip HTML as page elements: only the <strong>, </strong> and <br/> that CVI's text uses become markup;
  // everything else (state codes and species names from the file) is text.
  function tooltipNode(html) {
    const box = root.document.createElement('div');
    let cur = box;
    String(html).split(/(<strong>|<\/strong>|<br\/>)/).forEach(part => {
      if (part === '<strong>') { const s = root.document.createElement('strong'); box.appendChild(s); cur = s; }
      else if (part === '</strong>') cur = box;
      else if (part === '<br/>') box.appendChild(root.document.createElement('br'));
      else if (part) cur.appendChild(root.document.createTextNode(part));
    });
    return box;
  }

  // data: { states: geo/us-states.js, centers: geo/state-centers.js }
  function create(container, data, onReady, onError) {
    const V = F().VIEW;
    let st = null;
    const map = new root.maplibregl.Map({
      container, style: style(data.states), center: V.center, zoom: V.zoom,
      attributionControl: { compact: true, customAttribution: data.states.attribution },
      // Offline only: nothing is ever requested (the style is complete and inline); anything asked for is refused.
      transformRequest: url => {
        if (st) st.blocked.push(String(url));
        const e = new Error('Blocked a request: the National Flow map is offline.'); e.refused = true; throw e;
      }
    });
    st = { map, data, labels: [], labelsVisible: true, linesVisible: true, hover: null, ready: false, failed: false,
      pending: null, drawn: [], drawnAll: [], insetLines: [], opacity: 0.8, hoverOpacity: 1, blocked: [] };
    const fail = () => { if (st.failed) return; st.failed = true; if (onError) onError(); };
    map.on('error', e => { if (!(e && e.error && e.error.refused)) fail(); });
    map.on('webglcontextlost', fail);
    map.addControl(new root.maplibregl.NavigationControl(), 'top-left');
    const zoomOut = map.getContainer().querySelector('.maplibregl-ctrl-top-left .maplibregl-ctrl-zoom-out');
    if (zoomOut) zoomOut.after(fitButton(st));   // in the zoom group, above the compass (as the WA map)
    map.addControl(screenshotControl(st), 'top-right');
    map.on('load', () => {
      if (st.failed) return;
      try {
        F().stateLabels(data.centers).forEach(l => {
          const el = root.document.createElement('div'); el.className = 'state-label'; el.textContent = l.abbr;
          st.labels.push(new root.maplibregl.Marker({ element: el }).setLngLat([l.lon, l.lat]).addTo(map));
        });
        // Placement order: the larger state first (ties in file order).
        const area = F().stateAreas(data.states);
        st.labelOrder = st.labels.map((m, i) => i).sort((i, j) => ((area.get(st.labels[j].getElement().textContent) || 0)
          - (area.get(st.labels[i].getElement().textContent) || 0)) || (i - j)).map(i => st.labels[i]);
        st.labelSize = new Map();
        map.on('move', () => { placeLabels(st); renderInsets(st); });
        map.on('resize', () => { placeLabels(st); renderInsets(st); });
        const popup = new root.maplibregl.Popup({ closeButton: false, closeOnClick: false });
        st.popup = popup;
        const unhover = () => {
          if (st.hover !== null) map.setFeatureState({ source: SOURCE, id: st.hover }, { hover: false });
          st.hover = null;
        };
        st.clearHover = () => { map.getCanvas().style.cursor = ''; unhover(); popup.remove(); };
        // The line on top under the pointer: its tooltip, and its opacity raised (CVI's hover_options).
        map.on('mousemove', e => {
          const fs = map.queryRenderedFeatures(e.point, { layers: [LAYER] });
          // CH: on the shaded map, the state under the pointer (Washington and states without movements have none).
          if (!fs.length && st.shade) {
            const hit = map.queryRenderedFeatures(e.point, { layers: [SHADE_LAYER] }).find(f => f.properties.tip);
            if (!hit) { st.clearHover(); return; }
            map.getCanvas().style.cursor = 'pointer';
            popup.setLngLat(e.lngLat).setDOMContent(tooltipNode(hit.properties.tip)).addTo(map);
            st.lastTooltip = hit.properties.tip;   // test hook
            return;
          }
          if (!fs.length) { if (st.hover !== null) st.clearHover(); return; }
          map.getCanvas().style.cursor = 'pointer';
          const f = fs[0];
          if (st.hover !== f.id) { unhover(); st.hover = f.id; map.setFeatureState({ source: SOURCE, id: f.id }, { hover: true }); }
          popup.setLngLat(e.lngLat).setDOMContent(tooltipNode(f.properties.tooltip)).addTo(map);
          st.lastTooltip = f.properties.tooltip;   // test hook
        });
        map.getCanvas().addEventListener('mouseleave', () => st.clearHover());
        st.ready = true;
        applyLabels(st); setLines(st, st.linesVisible); renderInsets(st);
        if (st.pending) { const p = st.pending; st.pending = null; draw(st, p); }
        if (st.pendingShade) { st.pendingShade = false; setShade(st, st.shade); }
        if (onReady) onReady(st);
      } catch (e) { fail(); }
    });
    return st;
  }

  // The lines' opacity: the hovered line at hoverOpacity, the others at opacity. While states are highlighted (a
  // state picked in a chart), the other states' lines are drawn at DIM_OPACITY, as the WA map dims the
  // counties outside the spotlight.
  const DIM_OPACITY = 0.10;
  function linePaint(st) {
    const base = ['case', ['boolean', ['feature-state', 'hover'], false], st.hoverOpacity, st.opacity];
    if (!st.highlight || !st.highlight.length) return base;
    return ['case', ['in', ['get', 'state'], ['literal', st.highlight]], base, DIM_OPACITY];
  }
  // states: the states to highlight, or null for none.
  function setHighlight(st, states) {
    st.highlight = states && states.length ? states.slice() : null;
    if (st.ready && !st.failed) { st.map.setPaintProperty(LAYER, 'line-opacity', linePaint(st)); renderInsets(st); }
  }

  // d: flow.draw() (null: nothing drawn). Lines in drawing order, each with its color, width (times the multiplier)
  // and tooltip; the layer at d.opacity, the hovered line at d.hoverOpacity.
  function draw(st, d) {
    if (st.failed) return;
    if (!st.ready) { st.pending = d || { lines: [], opacity: st.opacity, hoverOpacity: st.hoverOpacity }; return; }
    st.clearHover();
    const all = d ? d.lines : [];
    // The lines to Alaska and Hawaii end in their inset boxes (drawn by renderInsets), the others on the map.
    // Test hook: every line in flow.draw()'s order, wherever it is drawn.
    st.drawnAll = all.map(a => ({ state: a.state, species_group: a.species_group, color: a.color, width: a.width,
      tooltip: a.tooltip }));
    st.insetLines = all.filter(a => insetState(st, a.state));
    const lines = all.filter(a => !insetState(st, a.state));
    const features = lines.map((a, k) => ({ type: 'Feature', id: k + 1, geometry: { type: 'LineString', coordinates: a.coords },
      properties: { state: a.state, species_group: a.species_group, color: a.color, width: a.width, tooltip: a.tooltip } }));
    if (d) { st.opacity = d.opacity; st.hoverOpacity = d.hoverOpacity; }
    st.map.getSource(SOURCE).setData({ type: 'FeatureCollection', features });
    st.map.setPaintProperty(LAYER, 'line-opacity', linePaint(st));
    st.drawn = features;
    renderInsets(st);
  }

  // CH: shade: { states: [{ code, color, none, tip, dim, picked }], opacity } fills the states in place of the lines
  // (the page draws no line then), or null. The state lines turn white while shaded. The fill's source and layers
  // exist only while shaded (over the land, under the state lines; the outline over them), so the Lines map is as
  // before.
  function setShade(st, shade) {
    st.shade = shade || null;
    st.shadeDrawn = shade ? shade.states.slice() : [];   // test hook
    if (!st.ready || st.failed) { st.pendingShade = true; return; }
    const map = st.map;
    const L = F().STATE_LINES, lines = shade ? SHADED_LINES : L;
    map.setPaintProperty('state-lines', 'line-color', lines.color);
    map.setPaintProperty('state-lines', 'line-width', lines.width);
    map.setPaintProperty('state-lines', 'line-opacity', lines.opacity);
    if (!shade) {
      [SHADE_OUTLINE, SHADE_LAYER].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
      if (map.getSource(SHADE_SOURCE)) map.removeSource(SHADE_SOURCE);
      renderInsets(st);
      return;
    }
    if (!map.getSource(SHADE_SOURCE)) {
      map.addSource(SHADE_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: SHADE_LAYER, type: 'fill', source: SHADE_SOURCE,
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.8 } }, 'state-lines');
      map.addLayer({ id: SHADE_OUTLINE, type: 'line', source: SHADE_SOURCE, filter: ['has', 'outline'],
        paint: { 'line-color': ['get', 'outline'], 'line-width': ['get', 'outlineWidth'] } }, LAYER);
    }
    const features = st.data.states.states.features.map(f => {
      const code = f.properties.code;
      const s = shade.states.find(x => x.code === code);
      const props = { code };
      if (code === 'WA') Object.assign(props, { color: WA_HUB.fill, solid: true, outline: WA_HUB.line,
        outlineWidth: WA_HUB.width });
      else if (s && !s.none) Object.assign(props, { color: s.color, tip: s.tip, dim: !!s.dim });
      else return null;
      if (s && s.picked) Object.assign(props, { outline: PICKED_LINE.color, outlineWidth: PICKED_LINE.width });
      return { type: 'Feature', geometry: f.geometry, properties: props };
    }).filter(Boolean);
    map.getSource(SHADE_SOURCE).setData({ type: 'FeatureCollection', features });
    map.setPaintProperty(SHADE_LAYER, 'fill-opacity', ['case', ['boolean', ['get', 'solid'], false], 1,
      ['boolean', ['get', 'dim'], false], SHADE_DIM, Number(shade.opacity)]);
    renderInsets(st);
  }

  // ── Alaska and Hawaii ─────────────────────────────────────────────────────────────────────────────────────────
  const INSET_LIVE = { x: 50, y: 10, height: 84, gap: 8, title: 18, pad: 4, font: 12.5 };
  const INSET_BOX = { fill: '#ffffff', opacity: 0.92, line: '#adb5bd' };
  const SVGNS = 'http://www.w3.org/2000/svg';
  // Whether a state is drawn in an inset box (Alaska or Hawaii) on this map.
  const insetState = (st, code) => !!(st.data.insets && root.CVIWA.flowinsets &&
    root.CVIWA.flowinsets.CODES.indexOf(String(code).toUpperCase()) >= 0);
  // What the boxes show now, in the map container's pixels: { boxes: [{ code, name, x, y, w, h, d, anchor, value,
  // fill, fillOpacity, stroke, outline, tip }], lines: [{ state, d, color, width, opacity, tooltip }] }.
  function insetModel(st) {
    const IN = root.CVIWA.flowinsets;
    if (!IN || !st.data.insets || !st.ready) return { boxes: [], lines: [] };
    const shaded = new Map((st.shade ? st.shade.states : []).filter(x => !x.none).map(x => [x.code, x]));
    const lines = st.shade ? [] : st.insetLines;
    const codes = IN.present([...shaded.keys()].concat(lines.map(a => a.state)));
    const L = F().STATE_LINES;
    const boxes = IN.layout(st.data.insets, codes, INSET_LIVE).map(b => {
      const s = shaded.get(b.code);
      const value = s ? s.value : IN.totalOf(lines, b.code);
      return Object.assign(b, { value,
        fill: s ? s.color : '#ececec',
        fillOpacity: s ? (s.dim ? SHADE_DIM : Number(st.shade.opacity)) : 1,
        stroke: st.shade ? SHADED_LINES : st.linesVisible ? L : null,
        outline: s && s.picked ? PICKED_LINE : null,
        tip: s ? s.tip : null });
    });
    const at = new Map(boxes.map(b => [b.code, b.anchor]));
    const q = st.map.project(F().WA_ANCHOR);
    const dim = st.highlight && st.highlight.length ? new Set(st.highlight) : null;
    const drawn = lines.filter(a => at.has(String(a.state).toUpperCase())).map((a, i) => {
      const end = at.get(String(a.state).toUpperCase());
      return { state: a.state, i, d: 'M' + q.x.toFixed(1) + ' ' + q.y.toFixed(1) + 'L' + end[0].toFixed(1) + ' ' +
        end[1].toFixed(1), color: a.color, width: a.width, tooltip: a.tooltip,
        opacity: dim && !dim.has(a.state) ? DIM_OPACITY : st.insetHover === i ? st.hoverOpacity : st.opacity };
    });
    return { boxes, lines: drawn };
  }
  // The boxes over the map: an SVG layer above the canvas (under the map's own controls); only the outlines and lines
  // take the pointer.
  function renderInsets(st) {
    if (!st.ready || st.failed) return;
    const m = insetModel(st);
    st.insetsDrawn = m;   // test hook
    let layer = st.insetLayer;
    if (!layer) {
      layer = root.document.createElementNS(SVGNS, 'svg');
      layer.setAttribute('class', 'flow-insets');
      layer.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:1;overflow:hidden';
      layer.addEventListener('mousemove', e => insetHover(st, e));
      layer.addEventListener('mouseout', e => { if (!layer.contains(e.relatedTarget)) insetUnhover(st); });
      st.map.getContainer().appendChild(layer);
      st.insetLayer = layer;
    }
    layer.textContent = '';
    // A new SVG element with the given attributes.
    const el = (name, attrs) => {
      const n = root.document.createElementNS(SVGNS, name);
      for (const k of Object.keys(attrs)) n.setAttribute(k, attrs[k]);
      return n;
    };
    for (const b of m.boxes) {
      layer.appendChild(el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: INSET_BOX.fill,
        'fill-opacity': INSET_BOX.opacity, stroke: INSET_BOX.line, 'stroke-width': 1 }));
      const shape = el('path', { d: b.d, fill: b.fill, 'fill-opacity': b.fillOpacity, 'stroke-linejoin': 'round' });
      if (b.stroke) { shape.setAttribute('stroke', b.stroke.color); shape.setAttribute('stroke-width', b.stroke.width);
        shape.setAttribute('stroke-opacity', b.stroke.opacity); }
      if (b.tip) { shape.style.pointerEvents = 'visiblePainted'; shape.style.cursor = 'pointer'; shape.dataset.tip = b.tip; }
      layer.appendChild(shape);
      if (b.outline) layer.appendChild(el('path', { d: b.d, fill: 'none', stroke: b.outline.color,
        'stroke-width': b.outline.width }));
      const ty = b.y + INSET_LIVE.title / 2 + 5;
      const name = el('text', { x: b.x + INSET_LIVE.pad + 1, y: ty, 'font-size': INSET_LIVE.font, 'font-weight': 'bold',
        fill: '#222222' });
      name.textContent = b.name;
      layer.appendChild(name);
      if (b.value !== null) {
        const v = el('text', { x: b.x + b.w - INSET_LIVE.pad - 1, y: ty, 'font-size': INSET_LIVE.font,
          'text-anchor': 'end', fill: '#222222' });
        v.textContent = root.CVIWA.scaling.comma(root.CVIWA.scaling.rRound(b.value));
        layer.appendChild(v);
      }
    }
    for (const ln of m.lines) {
      const p = el('path', { d: ln.d, fill: 'none', stroke: ln.color, 'stroke-width': ln.width, 'stroke-opacity': ln.opacity,
        'stroke-linecap': 'round' });
      p.style.pointerEvents = 'visibleStroke'; p.style.cursor = 'pointer';
      p.dataset.tip = ln.tooltip; p.dataset.i = ln.i;
      layer.appendChild(p);
    }
  }
  // Hover on an inset outline or line: the same tooltip as a state or a line, a line's opacity raised.
  function insetHover(st, e) {
    const t = e.target, tip = t && t.dataset ? t.dataset.tip : null;
    if (!tip) { insetUnhover(st); return; }
    const r = st.map.getContainer().getBoundingClientRect();
    const i = t.dataset.i === undefined ? null : Number(t.dataset.i);
    if (st.insetHover !== i) { st.insetHover = i; renderInsets(st); }
    st.popup.setLngLat(st.map.unproject([e.clientX - r.left, e.clientY - r.top])).setDOMContent(tooltipNode(tip)).addTo(st.map);
    st.lastTooltip = tip;   // test hook
  }
  // The inset hover ended: the tooltip removed and the hovered line's opacity back to normal.
  function insetUnhover(st) {
    if (st.popup) st.popup.remove();
    if (st.insetHover !== null && st.insetHover !== undefined) { st.insetHover = null; renderInsets(st); }
  }
  // The boxes and lines drawn into the screenshot as shown (k: canvas pixels per CSS pixel).
  function drawInsets(st, g, k) {
    const m = insetModel(st);
    g.save();
    g.scale(k, k);
    g.lineJoin = 'round'; g.lineCap = 'round';
    for (const b of m.boxes) {
      g.globalAlpha = INSET_BOX.opacity; g.fillStyle = INSET_BOX.fill; g.fillRect(b.x, b.y, b.w, b.h);
      g.globalAlpha = 1; g.strokeStyle = INSET_BOX.line; g.lineWidth = 1; g.strokeRect(b.x, b.y, b.w, b.h);
      const path = new root.Path2D(b.d);
      g.globalAlpha = b.fillOpacity; g.fillStyle = b.fill; g.fill(path);
      if (b.stroke) { g.globalAlpha = b.stroke.opacity; g.strokeStyle = b.stroke.color; g.lineWidth = b.stroke.width;
        g.stroke(path); }
      if (b.outline) { g.globalAlpha = 1; g.strokeStyle = b.outline.color; g.lineWidth = b.outline.width; g.stroke(path); }
      g.globalAlpha = 1; g.fillStyle = '#222222'; g.textBaseline = 'alphabetic';
      const ty = b.y + INSET_LIVE.title / 2 + 5, family = root.getComputedStyle(root.document.body).fontFamily;
      g.font = 'bold ' + INSET_LIVE.font + 'px ' + family; g.textAlign = 'left'; g.fillText(b.name, b.x + INSET_LIVE.pad + 1, ty);
      if (b.value !== null) {
        g.font = INSET_LIVE.font + 'px ' + family; g.textAlign = 'right';
        g.fillText(root.CVIWA.scaling.comma(root.CVIWA.scaling.rRound(b.value)), b.x + b.w - INSET_LIVE.pad - 1, ty);
      }
    }
    for (const ln of m.lines) {
      g.globalAlpha = ln.opacity; g.strokeStyle = ln.color; g.lineWidth = ln.width; g.stroke(new root.Path2D(ln.d));
    }
    g.restore();
    st.lastInsets = m.boxes.map(b => b.code);   // test hook
  }

  // Every state label hidden or shown as the switch says, then the shown ones placed again.
  function applyLabels(st) {
    st.labels.forEach(m => m.getElement().classList.toggle('hidden', !st.labelsVisible)); placeLabels(st);
  }
  // Which labels have room: in placement order, a label is shown unless its box (plus LABEL_PAD) overlaps one already
  // shown or its point is on the far side of the globe; the others get the class "collided" (kept in place, not shown).
  function placeLabels(st) {
    if (!st.ready || !st.labelsVisible || !st.labelOrder) return;
    const map = st.map, tr = map.transform, boxes = [];
    st.labelOrder.forEach(m => {
      const el = m.getElement();
      let size = st.labelSize.get(m);
      // 0 while the view is hidden
      if (!size || !size[0]) { size = [el.offsetWidth, el.offsetHeight]; st.labelSize.set(m, size); }
      let show = !(tr && typeof tr.isLocationOccluded === 'function' && tr.isLocationOccluded(m.getLngLat()));
      if (show && size[0]) {
        const q = map.project(m.getLngLat()), w = size[0] / 2 + LABEL_PAD, h = size[1] / 2 + LABEL_PAD;
        const b = [q.x - w, q.y - h, q.x + w, q.y + h];
        if (boxes.some(o => o[0] < b[2] && b[0] < o[2] && o[1] < b[3] && b[1] < o[3])) show = false;
        else boxes.push(b);
      }
      el.classList.toggle('collided', !show);
    });
  }
  // Whether a label is on the map now (neither switched off nor hidden for overlapping).
  const labelShown = m => !m.getElement().classList.contains('hidden') && !m.getElement().classList.contains('collided');
  function setLabels(st, visible) { st.labelsVisible = !!visible; if (st.ready) applyLabels(st); }
  // The state outlines ("State lines") switched on or off, the inset boxes drawn again.
  function setLines(st, visible) {
    st.linesVisible = !!visible;
    if (st.ready && !st.failed) {
      st.map.setLayoutProperty('state-lines', 'visibility', visible ? 'visible' : 'none'); renderInsets(st);
    }
  }
  // The map's current center, zoom, bearing and pitch.
  const camera = st => ({ center: st.map.getCenter(), zoom: st.map.getZoom(), bearing: st.map.getBearing(),
    pitch: st.map.getPitch() });
  // The opening view (CVI's center and zoom; "Fit to Lower 48" and the house button).
  function fitView(st) { st.map.jumpTo({ center: F().VIEW.center, zoom: F().VIEW.zoom, bearing: 0, pitch: 0 }); }

  // Screenshot (CVI's add_screenshot_control: map-screenshot.png, controls left out): the map's pixels from a frame
  // drawn on the spot, the state labels drawn on top as the map shows them, and the boundary credit at the bottom right.
  function capture(st) {
    if (!st.ready || st.failed) throw new Error('The map is not ready.');
    const map = st.map, L = F().STATE_LABELS;
    map.redraw();
    const src = map.getCanvas(), out = root.document.createElement('canvas');
    out.width = src.width; out.height = src.height;
    const g = out.getContext('2d'), k = src.width / src.clientWidth;
    g.drawImage(src, 0, 0);
    g.font = (L.size * k) + 'px ' + root.getComputedStyle(root.document.body).fontFamily;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    placeLabels(st);
    st.lastLabels = [];   // test hook: the labels drawn (those shown on the map)
    (st.labelsVisible ? st.labels.filter(labelShown) : []).forEach(m => {
      const q = map.project(m.getLngLat()), x = q.x * k, y = q.y * k, t = m.getElement().textContent;
      if (x < 0 || y < 0 || x > out.width || y > out.height) return;
      g.strokeStyle = L.halo; g.lineWidth = 2 * L.haloWidth * k; g.strokeText(t, x, y);
      g.fillStyle = L.color; g.fillText(t, x, y);
      st.lastLabels.push(t);
    });
    drawInsets(st, g, k);
    st.lastAttribution = attributionText(st);
    root.CVIWA.map.drawAttribution(g, out, k, st.lastAttribution);
    return out;
  }
  // The screenshot's credit line: the map's attribution text, with the Census boundary credit added when it is missing.
  function attributionText(st) {
    const el = st.map.getContainer().querySelector('.maplibregl-ctrl-attrib-inner'), own = st.data.states.attribution;
    const t = el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
    return t.indexOf(own) >= 0 ? t : (t ? t + ' | ' + own : own);
  }
  function screenshot(st) {   // the picture as a PNG blob (tests)
    return new Promise((resolve, reject) => {
      try { capture(st).toBlob(b => (b ? resolve(b) : reject(new Error('The picture could not be made.'))), 'image/png'); }
      catch (e) { reject(e); }
    });
  }
  // The camera button (top right) as a MapLibre control: a click saves map-screenshot.png and says so.
  function screenshotControl(st) {
    let box = null;
    return {
      onAdd() {
        box = root.document.createElement('div'); box.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        const b = root.document.createElement('button');
        b.type = 'button'; b.className = 'map-screenshot'; b.title = 'Capture screenshot'; b.setAttribute('aria-label', 'Capture screenshot');
        b.innerHTML = root.CVIWA.icons ? root.CVIWA.icons.camera : '';
        b.addEventListener('click', () => {
          const say = msg => { if (st.notify) st.notify(msg); };
          try {
            const blob = root.CVIWA.map.savePng(capture(st));
            st.lastScreenshot = { bytes: blob.size, at: Date.now() };   // test hook
            say('map-screenshot.png was handed to your browser to save (usually your Downloads folder).');
          } catch (e) { say('Screenshot not saved: ' + ((e && e.message) || String(e))); }
        });
        box.appendChild(b); return box;
      },
      onRemove() { if (box) box.remove(); box = null; }
    };
  }
  // The house button under the zoom buttons: back to the opening view.
  function fitButton(st) {
    const b = root.document.createElement('button');
    b.type = 'button'; b.className = 'map-fit'; b.title = 'Fit to Lower 48'; b.setAttribute('aria-label', 'Fit to Lower 48');
    b.innerHTML = root.CVIWA.icons ? root.CVIWA.icons.house : '';
    b.addEventListener('click', () => { if (st.ready && !st.failed) fitView(st); });
    return b;
  }

  root.CVIWA = root.CVIWA || {};
  root.CVIWA.flowmap = { create, draw, renderInsets, INSET_LIVE, setHighlight, setShade, SHADE_LAYER, SHADE_OUTLINE,
    SHADE_DIM, WA_HUB, DIM_OPACITY, setLabels, setLines, camera, fitView, screenshot, attributionText, tooltipNode,
    placeLabels, LAYER, SOURCE };
})(typeof window !== 'undefined' ? window : globalThis);
