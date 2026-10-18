/* Infrastructure kind for the existing shared map adapter (CVIWA.map): no second map engine.
 * Each selected facility layer is one clustered GeoJSON source with a point layer and a cluster layer, drawn
 * above the optional CVI activity circles. Map features carry only the row ID, the name and the display text.
 * Hover shows a facility's name, or a cluster's count and up to 15 names; clicking a facility opens its
 * screened details (facility-details.js); clusters have no click action. Cluster counts are page elements
 * placed with collision checks against county names and each other, and drawn into the screenshot. */
(function (root) {
  'use strict';
  const SRC = i => 'infra_src_' + i;
  const POINT = i => 'infra_point_' + i;
  const CLUSTER = i => 'infra_cluster_' + i;
  const isOwn = id => /^infra_/.test(id);
  const layerIndex = id => Number(id.split('_').pop());
  // Cluster radius by point count (CVI's facility cluster steps).
  const radius = ['step', ['get', 'point_count'], 14, 10, 18, 50, 24, 200, 32];
  const MAX_NAMES = 15;

  // A layer's points as a GeoJSON FeatureCollection carrying only the row ID, name and display text.
  function collection(l) {
    return {
      type: 'FeatureCollection',
      features: l.points.map((p, i) => ({
        type: 'Feature',
        id: i,
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { row_id: p.id, ref_name: p.name, ref_display: p.display }
      }))
    };
  }

  // One clustered GeoJSON source per selected facility layer.
  function facilitySources(st) {
    const out = {};
    (st.facilityLayers || []).forEach((l, i) => {
      out[SRC(i)] = { type: 'geojson', data: collection(l), cluster: true, clusterRadius: 40, clusterMaxZoom: 22 };
    });
    return out;
  }

  // The point layer and the cluster layer for each selected facility layer.
  function facilityLayers(st) {
    return (st.facilityLayers || []).flatMap((l, i) => [
      // A facility in its layer's mark (UI pass); a cluster stays a circle in the layer's color, under its count.
      root.CVIWA.map.markLayer(POINT(i), SRC(i), root.CVIWA.map.markId(l.shape, l.color),
        { filter: ['!', ['has', 'point_count']] }),
      { id: CLUSTER(i), type: 'circle', source: SRC(i), filter: ['has', 'point_count'],
        paint: { 'circle-color': l.color, 'circle-radius': radius, 'circle-opacity': 0.92,
          'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } }
    ]);
  }

  // The map kind the shared adapter calls when it builds or restores the style. hoverLayers: the facility and CVI
  // activity layers, which the population layers' hover leaves to this kind.
  const KIND = {
    isOwn,
    hoverLayers: st => (st.facilityLayers || []).flatMap((l, i) => [POINT(i), CLUSTER(i)])
      .concat(root.CVIWA.map.LAYERS.map(l => l[0])),
    sources: st => Object.assign({}, root.CVIWA.map.WA_KIND.sources(st), facilitySources(st)),
    layers: st => root.CVIWA.map.WA_KIND.layers(st).concat(facilityLayers(st)),
    draw: (st, result) => draw(st, result),
    attach,
    capture
  };

  // A map of the Infrastructure kind, made by the shared map adapter.
  function create(container, geo, onReady, onError) {
    return root.CVIWA.map.create(container, geo, onReady, onError, KIND);
  }

  // result: facilities.select() output. Draws the CVI activity (st.activityData) and then the facility layers,
  // the layer with the most points at the bottom (registry order for ties).
  function draw(st, result) {
    st.last = { d: result, opts: {} };
    if (!st.ready || st.switching) {
      st.pending = st.last;
      return;
    }
    const last = st.last;
    root.CVIWA.map.draw(st, st.activityData || [],
      st.activityOptions || { palette: 'WSDA Default', opacity: 0.6, amounts: [] });
    st.last = last;   // style restoration belongs to the Infrastructure kind, including its facility result
    st.clearHover();
    // Details close when their row is filtered out or the files are replaced.
    const alive = new Set(result.rowIds);
    if (st.clickPopup && (!alive.has(st.popupId) || st.revision !== result.revision)) {
      st.clickPopup.remove();
      st.clickPopup = null;
    }
    st.revision = result.revision;

    const layers = result.layers.slice().sort((a, b) => b.count - a.count);
    const map = st.map, signature = JSON.stringify(layers.map(l => [l.key, l.color, l.shape]));
    if (signature !== st.facilitySignature) {
      // Different layers or marks: remove the old sources and layers and add new ones.
      (st.facilityLayers || []).forEach((l, i) => {
        for (const id of [POINT(i), CLUSTER(i)]) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        if (map.getSource(SRC(i))) map.removeSource(SRC(i));
      });
      st.facilityLayers = layers;
      st.facilitySignature = signature;
      Object.entries(facilitySources(st)).forEach(([id, source]) => map.addSource(id, source));
      layers.forEach(l => root.CVIWA.map.addMark(map, l.shape, l.color));
      facilityLayers(st).forEach(layer => map.addLayer(layer));
    } else {
      st.facilityLayers = layers;
      layers.forEach((l, i) => map.getSource(SRC(i)).setData(collection(l)));
    }
    st.result = result;
    st.drawSerial = (st.drawSerial || 0) + 1;
    placeCounts(st);
  }

  function text(tag, value) {
    const e = document.createElement(tag);
    e.textContent = value;
    return e;
  }

  // A cluster's hover: the layer, the true count, then the first names (leaves arrive later from MapLibre).
  function clusterElement(layer, count, leaves) {
    const box = document.createElement('div');
    box.append(text('strong', layer.liveLabel), text('div', count.toLocaleString('en-US') + ' facilities'));
    const names = (leaves || []).map(f => f.properties.ref_display).filter(Boolean).slice(0, 15);
    names.forEach(n => box.append(text('div', n)));
    if (names.length && count > names.length) {
      box.append(text('em', '...first ' + names.length + ' of ' + count.toLocaleString('en-US') + ' shown'));
    }
    return box;
  }

  // Wire the facility hover tips, click details and cluster count layer to the map.
  function attach(st) {
    const map = st.map;
    const tip = new root.maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: '340px',
      className: 'facility-tip' });
    st.hoverToken = 0;
    st.hoverKey = null;
    st.clearHover = () => {
      st.hoverToken++;
      st.hoverKey = null;
      tip.remove();
      map.getCanvas().style.cursor = '';
      if (st.hover) {
        if (map.getSource(st.hover.source)) map.setFeatureState(st.hover, { hover: false });
        st.hover = null;
      }
    };
    const ownIds = () => (st.facilityLayers || []).flatMap((l, i) => [POINT(i), CLUSTER(i)])
      .filter(id => map.getLayer(id));
    const hit = point => {
      const ids = ownIds();
      return ids.length ? map.queryRenderedFeatures(point, { layers: ids })[0] : null;
    };

    // Hover over a CVI activity circle (no facility under the pointer): its county, direction and animals.
    function hoverActivity(e) {
      const LAYERS = root.CVIWA.map.LAYERS;
      const activity = map.queryRenderedFeatures(e.point, { layers: LAYERS.map(l => l[0]) })[0];
      if (!activity) return;
      const p = activity.properties, box = document.createElement('div');
      st.hover = { source: LAYERS.find(l => l[0] === activity.layer.id)[1], id: activity.id };
      map.setFeatureState(st.hover, { hover: true });
      map.getCanvas().style.cursor = 'pointer';
      box.append(text('strong', p.county), text('div', p.direction + ': ' + p.amount + ' animals'));
      tip.setLngLat(e.lngLat).setDOMContent(box).addTo(map);
    }

    // A cluster's names arrive asynchronously; a reply is dropped when the hover, the drawing or the files
    // changed in the meantime.
    function hoverCluster(f, layer, i, key) {
      const token = ++st.hoverToken, serial = st.drawSerial, revision = st.revision;
      const count = Number(f.properties.point_count);
      tip.setDOMContent(clusterElement(layer, count, [])).addTo(map);
      const stale = () => st.hoverToken !== token || st.hoverKey !== key || st.drawSerial !== serial
        || st.revision !== revision || st.switching;
      const source = map.getSource(SRC(i));
      Promise.resolve(source.getClusterLeaves(Number(f.properties.cluster_id), MAX_NAMES, 0)).then(leaves => {
        if (stale()) return;
        tip.setDOMContent(clusterElement(layer, count, leaves));
      }).catch(() => {});
    }

    map.on('mousemove', e => {
      if (st.switching) return;
      const f = hit(e.point);
      if (!f) {
        st.clearHover();
        hoverActivity(e);
        return;
      }
      const i = layerIndex(f.layer.id), layer = st.facilityLayers[i], cluster = !!f.properties.point_count;
      const key = f.layer.id + ':' + (cluster ? f.properties.cluster_id : f.properties.row_id);
      map.getCanvas().style.cursor = cluster ? 'default' : 'pointer';
      tip.setLngLat(e.lngLat);
      if (key === st.hoverKey) return;
      st.hoverKey = key;
      if (cluster) {
        hoverCluster(f, layer, i, key);
      } else {
        ++st.hoverToken;
        tip.setDOMContent(text('div', f.properties.ref_display || 'Unnamed facility')).addTo(map);
      }
    });
    map.getCanvas().addEventListener('mouseleave', st.clearHover);

    map.on('click', e => {
      if (st.switching) return;
      const f = hit(e.point);
      // The topmost cluster blocks clicks on points underneath; clusters have no action.
      if (!f || f.properties.point_count) return;
      const layer = st.facilityLayers[layerIndex(f.layer.id)];
      const point = layer.points.find(p => p.id === f.properties.row_id);
      if (!point) return;
      st.clearHover();
      if (st.clickPopup) st.clickPopup.remove();
      st.popupId = point.id;
      st.clickPopup = new root.maplibregl.Popup({ closeOnClick: false, maxWidth: 'min(360px, 85vw)',
        className: 'facility-click' })
        .setLngLat([point.lon, point.lat])
        .setDOMContent(root.WSDA.facilityDetails.element(layer, point))
        .addTo(map);
      const close = st.clickPopup.getElement().querySelector('.maplibregl-popup-close-button');
      if (close) close.focus({ preventScroll: true });
    });

    st.countLayer = document.createElement('div');
    st.countLayer.className = 'facility-counts';
    map.getContainer().append(st.countLayer);
    st.countEls = new Map();
    st.placedCounts = [];
    map.on('render', () => placeCounts(st));
  }

  const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  // A screen box around an element centered on q, with 2 px to spare.
  const box = (q, w, h) => [q.x - w / 2 - 2, q.y - h / 2 - 2, q.x + w / 2 + 2, q.y + h / 2 + 2];

  // Places the cluster counts: the largest count first, each shown only where it overlaps no county name
  // and no count placed before it.
  function placeCounts(st) {
    if (!st.countEls || st.switching) return;
    const map = st.map;
    const ids = (st.facilityLayers || []).map((l, i) => CLUSTER(i)).filter(id => map.getLayer(id));
    const seen = new Map();
    if (ids.length) {
      map.queryRenderedFeatures({ layers: ids }).forEach(f => {
        const i = layerIndex(f.layer.id), key = i + ':' + f.properties.cluster_id;
        if (seen.has(key)) return;
        seen.set(key, { key, i, count: Number(f.properties.point_count),
          text: String(f.properties.point_count_abbreviated), lngLat: f.geometry.coordinates });
      });
    }
    st.countEls.forEach((e, k) => {
      if (seen.has(k)) return;
      e.remove();
      st.countEls.delete(k);
    });

    const taken = [];
    st.labels.filter(m => !m.getElement().classList.contains('hidden')).forEach(m => {
      const e = m.getElement();
      if (e.offsetWidth) taken.push(box(map.project(m.getLngLat()), e.offsetWidth, e.offsetHeight));
    });
    const order = [...seen.values()].sort((a, b) => b.count - a.count || b.i - a.i
      || a.lngLat[0] - b.lngLat[0] || a.lngLat[1] - b.lngLat[1]);
    st.placedCounts = order.map(c => {
      let e = st.countEls.get(c.key);
      if (!e) {
        e = document.createElement('div');
        e.className = 'facility-count';
        st.countLayer.append(e);
        st.countEls.set(c.key, e);
      }
      e.textContent = c.text;
      const color = st.facilityLayers[c.i].color;
      e.style.setProperty('--count-halo', color);
      e.classList.remove('collided');
      const q = map.project(c.lngLat), b = box(q, e.offsetWidth, e.offsetHeight);
      const shown = !taken.some(o => overlaps(o, b));
      if (shown) taken.push(b);
      e.classList.toggle('collided', !shown);
      e.style.transform = 'translate(' + q.x + 'px,' + q.y + 'px) translate(-50%,-50%)';
      return Object.assign(c, { x: q.x, y: q.y, shown, color });
    });
  }

  // The screenshot: the shown counts in white with their layer's color as the halo, as on screen.
  function capture(st, g, k) {
    placeCounts(st);
    g.save();
    g.font = '700 ' + 14 * k + 'px ' + root.getComputedStyle(document.body).fontFamily;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    st.placedCounts.filter(c => c.shown).forEach(c => {
      g.strokeStyle = c.color;
      g.lineWidth = 2.4 * k;
      g.strokeText(c.text, c.x * k, c.y * k);
      g.fillStyle = '#fff';
      g.fillText(c.text, c.x * k, c.y * k);
    });
    g.restore();
  }

  root.WSDA = root.WSDA || {};
  root.WSDA.facilitymap = { create, draw, KIND, collection, clusterElement, placeCounts, SRC, POINT, CLUSTER };
})(typeof window !== 'undefined' ? window : globalThis);
