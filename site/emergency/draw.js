/* Emergency Response, 2.6, "Draw a zone": drawing a zone on the live map, and editing a drawn zone's corners. The rules (the crossing check, the live label, the set shapes'
 * corners and sizes) are rules.js's; this file holds the map's events, the sketch (map.js setSketch, the em_draw
 * layers), the label beside the pointer, the badge and the keys. The page (app.js) holds the zones, the fold and the
 * list.
 *
 * Freehand: a click for each corner; the sides so far solid, the side to the pointer dashed; a double-click, a click
 * on the first corner (drawn larger), Enter or Finish closes the shape (3 corners or more); Backspace or "Undo corner"
 * takes back the last corner; Esc or Cancel drops it. A double-click arrives as two clicks and then the double-click:
 * the first click places the corner, the second lands on it and adds nothing. A click whose side would cross another
 * places no corner, and the label says "Sides can’t cross"; a click on an earlier corner (not the first or the last)
 * lands on it exactly and is refused the same way, as sides touching. Rectangle: two clicks, opposite corners. Square and
 * circle (3b): one click places the middle (on a positive's mark, the positive's own spot); a rectangle's second click on its first does
 * nothing. While drawing or editing the map's double-click zoom is off (on again half a second after, so the
 * double-click whose first click closes a shape does not zoom), the hover is off (st.drawing, map.js) and the rings stay as a guide.
 * On a phone, with no pointer moving, the label follows the last tap.
 *
 * Editing: a round handle on each corner and a smaller one at each side's middle; dragging a corner moves it,
 * dragging a middle handle adds a corner there; the zone changes when the drag ends, and a drag that would cross
 * sides goes back; a click on a handle without moving it changes nothing. Done (or Esc, or Enter) ends it.
 *
 * create(st, hooks) -> { start(kind), finish(), undo(), cancel(), edit(zone), done(), refresh(), mode(), editing(),
 *   corners() }. st: the Emergency map's state (map.js create). kind: 'freehand', 'rectangle', 'square' or 'circle'.
 *   hooks: unit() -> 'km' | 'mi'; size() -> the square's size (the circle's radius) in that unit, or null (the page then says why);
 *   finished(corners, shape) -> true when the page made it a zone (shape: rules.js drawnZone's, or null);
 *   edited(zone, corners) -> the zone after the edit, or null; changed(mode, zone) after every change of mode;
 *   say(kind, text) a status line; label, badge: the page's two elements over the map; startButton: the fold's
 *   button (Enter on it finishes, as on the map). mode() -> null or the kind ('edit' while editing). */
(function (root) {
  'use strict';
  const E = () => root.WSDA.emergencyRules;
  const EM = () => root.WSDA.emergencyMap;
  const BLUE = '#1c5a83', RED = '#cb181d', WARN = '#ca3014';
  const HIT = 12;   // pixels: a click this near a corner is on it
  const ZOOM_BACK_MS = 500;   // the double-click zoom back on this long after drawing ends (a double-click's window)
  const CROSS = 'Sides can’t cross';
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const line = (coords, kind, color) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords },
    properties: { kind, color } });
  const dot = (c, kind, color, r) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { kind, color, r } });
  const fill = corners => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [corners.concat([corners[0]])] },
    properties: { kind: 'fill' } });
  const closed = corners => corners.concat([corners[0]]);
  const typing = t => !!(t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]'));

  function create(st, hooks) {
    const map = st.map, h = hooks;
    // mode: null, or { kind, corners, pointer, at, cross } while drawing, or { kind: 'edit', zone, corners, drag } while
    // editing. pointer: [lon, lat] of the pointer (or the last tap); cross: the label's warning is shown.
    let mode = null, zoomBack = 0;
    const near = (c, point) => { const q = map.project(c); return Math.hypot(q.x - point.x, q.y - point.y) <= HIT; };
    // A click (or the pointer) on an earlier corner, not the first or the last, lands on that corner exactly, so the
    // rules refuse it as sides touching (rules.js crossesAt), the same as a hand can see it.
    const onCorner = (c, p, point) => { for (let k = 1; k < c.length - 1; k++) if (near(c[k], point)) return c[k].slice(); return p; };
    const sketch = features => EM().setSketch(st, features);
    const unit = () => h.unit();

    // The label beside a [lon, lat], in the page's tooltip style, kept inside the map; a warning in crimson.
    function label(lines, at, warn) {
      const l = h.label;
      if (!lines || !lines.length || !at) { l.hidden = true; return; }
      l.innerHTML = lines.map(esc).join('<br>');
      l.classList.toggle('warn', !!warn);
      l.hidden = false;
      const frame = l.offsetParent || l.parentElement, f = frame.getBoundingClientRect();
      const m = map.getContainer().getBoundingClientRect(), p = map.project(at);
      const x = p.x + m.left - f.left, y = p.y + m.top - f.top;
      l.style.left = (x + 16) + 'px';
      l.style.top = (y + 14) + 'px';
      // No room on the right: on the pointer's left, or on a narrow map under it, kept inside the edges.
      if (x + 16 + l.offsetWidth > f.width - 8) {
        const left = x - 16 - l.offsetWidth;
        l.style.left = Math.max(8, left >= 8 ? left : Math.min(x - l.offsetWidth / 2, f.width - 8 - l.offsetWidth)) + 'px';
        if (left < 8) l.style.top = (y + 18) + 'px';
      }
      if (y + 14 + l.offsetHeight > f.height - 8) l.style.top = Math.max(8, y - 14 - l.offsetHeight) + 'px';
    }
    function badge(text) {
      const b = h.badge;
      b.hidden = !text;
      if (text) b.innerHTML = root.WSDA.emergencyIcons.svg('draw') + '<span>' + esc(text) + '</span>';
    }

    // ---- What the sketch and the label show ----------------------------------------------------------------------
    // The positive's mark under a screen point: its own spot (from the mark's properties: a rendered feature's geometry
    // is rounded to its tile) and its name (a square or a circle is centered on it).
    function positiveAt(point) {
      if (!map.getLayer('em_positives')) return null;
      const f = map.queryRenderedFeatures(point, { layers: ['em_positives'] })[0];
      return f ? { lonlat: [f.properties.lon, f.properties.lat], name: String(f.properties.label).split('\n')[0] } : null;
    }
    function render() {
      if (!mode) { sketch([]); label(null); return; }
      if (mode.kind === 'edit') return renderEdit();
      const c = mode.corners, p = mode.pointer, feats = [];
      if (mode.kind === 'freehand') {
        if (!c.length) { sketch([]); label(null); return; }
        const at = p || c[c.length - 1];
        const lab = E().drawLabel(c, at, unit());
        mode.cross = lab.cross;
        if (c.length >= 3 && lab.closes) feats.push(fill(c.concat([at])));
        if (c.length >= 2) feats.push(line(c, 'side', BLUE));
        if (p) feats.push(line([c[c.length - 1], p], 'next', lab.cross ? WARN : BLUE));
        c.forEach((q, i) => feats.push(dot(q, 'corner', BLUE, i === 0 ? 7 : 4)));
        sketch(feats);
        label(lab.lines, at, lab.cross);
        return;
      }
      if (mode.kind === 'rectangle') {
        const a = c[0];
        if (!a) { sketch([]); label(null); return; }
        const r = p && E().rectangleCorners(a, p);
        if (r) feats.push(fill(r), line(closed(r), 'next', BLUE));
        feats.push(dot(a, 'corner', BLUE, 5));
        sketch(feats);
        label(p ? E().rectangleLabel(a, p, unit()) : null, p || a);
        return;
      }
      // The square or the circle around the pointer, or around the positive whose mark is under it.
      const size = mode.size;
      if (!p || size === null) { sketch([]); label(null); return; }
      const on = mode.on, mid = on ? on.lonlat : p;
      const q = setCorners(mode.kind, mid, size);
      sketch([fill(q), line(closed(q), 'next', BLUE)]);
      label((mode.kind === 'circle' ? E().circleLabel : E().squareLabel)(mid, size, unit(), on ? on.name : null), mid);
    }
    function renderEdit(warn) {
      const c = mode.corners, color = warn ? WARN : RED, feats = [];
      if (mode.drag) feats.push(line(closed(c), 'next', color));
      c.forEach((q, i) => {
        const n = c[(i + 1) % c.length];
        feats.push(dot([(q[0] + n[0]) / 2, (q[1] + n[1]) / 2], 'mid', color, 4));
      });
      c.forEach(q => feats.push(dot(q, 'corner', color, 6)));
      sketch(feats);
      label(warn ? [CROSS] : null, warn ? mode.pointer : null, true);
    }

    // ---- The modes -----------------------------------------------------------------------------------------------
    function enter(next) {
      const was = mode;
      mode = next;
      st.drawing = !!mode;
      if (mode && !was) map.doubleClickZoom.disable();
      if (!mode && was) {
        const t = ++zoomBack;
        root.setTimeout(() => { if (!mode && t === zoomBack) map.doubleClickZoom.enable(); }, ZOOM_BACK_MS);
      }
      const box = map.getContainer();
      box.classList.toggle('drawing', !!mode && mode.kind !== 'edit');
      box.classList.toggle('editing', !!mode && mode.kind === 'edit');
      if (mode) st.clearHover();
      badge(!mode ? null : mode.kind === 'edit' ? 'Editing ' + mode.zone.name : 'Drawing a zone');
      render();
      h.changed(mode ? mode.kind : null, mode && mode.kind === 'edit' ? mode.zone : null);
    }
    // A square's or a circle's corners around its middle (rules.js), of the size in the box.
    const sized = kind => kind === 'square' || kind === 'circle';
    const setCorners = (kind, mid, size) => (kind === 'circle' ? E().circleCorners : E().squareCorners)(mid, size, unit());
    function start(kind) {
      const size = sized(kind) ? h.size() : null;
      if (sized(kind) && size === null) return false;
      enter({ kind, corners: [], pointer: null, cross: false, size, on: null });
      return true;
    }
    function stop() { if (mode) enter(null); }
    function cancel() { if (mode && mode.kind !== 'edit') stop(); }
    // Freehand: closed with 3 corners or more whose sides do not cross.
    function finish() {
      if (!mode || mode.kind !== 'freehand') return false;
      const c = mode.corners;
      if (c.length < E().DRAW.minCorners) {
        h.say('warn', 'A zone needs at least ' + E().DRAW.minCorners + ' corners.');
        return false;
      }
      if (!E().canClose(c)) { label([CROSS], c[0], true); return false; }
      const done = h.finished(c.slice(), null);
      if (done) stop();
      return done;
    }
    function undo() {
      if (!mode || mode.kind === 'edit' || !mode.corners.length) return;
      mode.corners.pop();
      render();
    }
    function add(p, point) {
      const m = mode;
      if (m.kind === 'freehand') {
        const c = m.corners;
        if (c.length >= E().DRAW.minCorners && near(c[0], point)) { finish(); return; }
        if (c.length && (near(c[c.length - 1], point) || near(c[0], point))) return;   // on a corner already placed
        if (c.length >= E().DRAW.maxCorners) {
          h.say('warn', 'A zone has at most ' + E().DRAW.maxCorners + ' corners: finish it, or undo a corner.');
          return;
        }
        p = onCorner(c, p, point);
        if (E().crossesAt(c, p)) { m.pointer = p; render(); return; }
        c.push(p);
        m.pointer = p;
        render();
        return;
      }
      if (m.kind === 'rectangle') {
        if (!m.corners.length) { m.corners.push(p); m.pointer = p; render(); return; }
        if (near(m.corners[0], point)) return;   // the second click of a double-click on the first corner
        const r = E().rectangleCorners(m.corners[0], p);
        if (!r) return;
        const z = E().rectangleSize(m.corners[0], p);
        if (h.finished(r, { kind: 'rectangle', eastKm: z.eastKm, northKm: z.northKm })) stop();
        return;
      }
      // The square or the circle: its size read again at the click (the box may have changed).
      const size = h.size();
      if (size === null) return;
      const on = positiveAt(point), mid = on ? on.lonlat : p;
      if (h.finished(setCorners(m.kind, mid, size), { kind: m.kind, km: E().toKm(size, unit()) })) stop();
    }

    // Editing a drawn zone (rules.js cornersOf); the zone itself changes only when a drag ends.
    function edit(zone) {
      if (mode) enter(null);
      enter({ kind: 'edit', zone, corners: E().cornersOf(zone), drag: null, pointer: null });
    }
    function done() { if (mode && mode.kind === 'edit') stop(); }
    // The handle under a screen point: { index, mid } (a corner's index, or the side's first corner's for a middle).
    function handleAt(point) {
      const c = mode.corners;
      for (let i = 0; i < c.length; i++) if (near(c[i], point)) return { index: i, mid: false };
      for (let i = 0; i < c.length; i++) {
        const n = c[(i + 1) % c.length];
        if (near([(c[i][0] + n[0]) / 2, (c[i][1] + n[1]) / 2], point)) return { index: i, mid: true };
      }
      return null;
    }
    function grab(e) {
      if (!mode || mode.kind !== 'edit' || (e.points && e.points.length > 1)) return;
      const hit = handleAt(e.point);
      if (!hit) return;
      e.preventDefault();
      map.dragPan.disable();
      const base = mode.corners.map(q => q.slice());
      let index = hit.index;
      if (hit.mid) { index = hit.index + 1; mode.corners.splice(index, 0, [e.lngLat.lng, e.lngLat.lat]); }
      mode.drag = { index, base };
      mode.pointer = [e.lngLat.lng, e.lngLat.lat];
      renderEdit();
      root.document.addEventListener('mouseup', release, { once: true });
    }
    function drag(e) {
      const d = mode && mode.drag;
      if (!d) return;
      mode.corners[d.index] = [e.lngLat.lng, e.lngLat.lat];
      mode.pointer = mode.corners[d.index];
      d.moved = true;
      renderEdit(!E().isSimple(mode.corners));
    }
    function release() {
      const d = mode && mode.drag;
      if (!d) return;
      map.dragPan.enable();
      mode.drag = null;
      // A click on a handle without a drag changes nothing (a middle handle's corner taken out again).
      if (!d.moved) { mode.corners = d.base; renderEdit(); return; }
      // The page refuses corners whose sides cross (rules.js editedZone), and the drag goes back.
      const kept = h.edited(mode.zone, mode.corners.map(q => q.slice()));
      if (kept) {
        mode.zone = kept;
        mode.corners = E().cornersOf(kept);
        renderEdit();
        return;
      }
      mode.corners = d.base;
      renderEdit(true);
    }

    // ---- The map's events and the keys ---------------------------------------------------------------------------
    map.on('click', e => {
      if (!mode || mode.kind === 'edit' || st.switching) return;
      add([e.lngLat.lng, e.lngLat.lat], e.point);
    });
    map.on('dblclick', e => {
      if (!mode) return;
      e.preventDefault();
      if (mode.kind === 'freehand') finish();
    });
    map.on('mousemove', e => {
      if (!mode) return;
      if (mode.kind === 'edit') {
        if (mode.drag) { drag(e); return; }
        map.getCanvas().style.cursor = handleAt(e.point) ? 'move' : '';
        return;
      }
      mode.pointer = [e.lngLat.lng, e.lngLat.lat];
      if (mode.kind === 'freehand') mode.pointer = onCorner(mode.corners, mode.pointer, e.point);
      if (sized(mode.kind)) mode.on = positiveAt(e.point);
      render();
    });
    map.on('mousedown', grab);
    map.on('touchstart', grab);
    map.on('touchmove', drag);
    map.on('touchend', release);
    map.on('mouseup', release);
    // A pan or zoom while drawing moves the label with the map.
    map.on('move', () => { if (mode && mode.kind !== 'edit') render(); });
    root.document.addEventListener('keydown', e => {
      if (!mode || typing(e.target)) return;
      if (e.key === 'Enter') {
        // A focused button does what it says, except the fold's own Drawing button.
        if (e.target.closest && e.target.closest('button, a[href], summary') && e.target !== h.startButton) return;
        e.preventDefault();
        if (mode.kind === 'edit') done(); else finish();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (mode.kind === 'edit') done(); else cancel();
      } else if (e.key === 'Backspace' && mode.kind !== 'edit') {
        e.preventDefault();
        undo();
      }
    }, true);

    return {
      start, finish, undo, cancel, edit, done,
      // After the unit, the size or the edited zone's name changes: the label, the square or the badge again.
      refresh() {
        if (!mode) return;
        if (mode.kind === 'edit') badge('Editing ' + mode.zone.name);
        if (sized(mode.kind)) { mode.size = h.size(); if (mode.size === null) { stop(); return; } }
        render();
      },
      mode: () => (mode ? mode.kind : null),
      editing: () => (mode && mode.kind === 'edit' ? mode.zone : null),
      corners: () => (mode ? mode.corners.map(q => q.slice()) : [])   // test hook
    };
  }

  root.WSDA = root.WSDA || {};
  root.WSDA.emergencyDraw = { create, CROSS };
})(typeof window !== 'undefined' ? window : globalThis);
