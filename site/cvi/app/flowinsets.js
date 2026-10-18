/* National Flow map: Alaska and Hawaii in two inset boxes (on the shaded and the Lines map, the Alaska box as tall as
 * Hawaii's). The outlines are geo/us-insets.js (derive_insets.R,
 * each state in its own equal-area projection scaled to its box). Pure layout shared by the live map (flowmap.js, an
 * overlay at the top left beside the zoom buttons) and the branded PNG and GIF (brandedmaps.js, at the map's top left,
 * under the stat row). A box is drawn only for a state with movements in the view (for the GIF, in any frame). A flow
 * line to Alaska or Hawaii runs straight from Washington's anchor to the state's center in its box. Deliberate
 * difference: CVI draws neither state (its Flow map's lines to them leave the frame). */
(function (root) {
  'use strict';
  const CODES = ['AK', 'HI'];

  // The inset states among some state codes (any iterable), in CODES order.
  function present(codes) {
    const have = new Set();
    for (const c of codes || []) if (c !== null && c !== undefined) have.add(String(c).toUpperCase());
    return CODES.filter(c => have.has(c));
  }

  // The boxes of the given states, side by side from (o.x, o.y), all o.height tall: a title row of o.title, then the
  // outline inside o.pad on every side, each box as wide as its outline needs. data: geo/us-insets.js. Returns
  // [{ code, name, x, y, w, h, shape: { x, y, w, h }, anchor: [x, y], d }] (d: the outline as SVG path data).
  function layout(data, codes, o) {
    const out = [];
    let x = o.x;
    for (const code of codes) {
      const s = data && data.states && data.states[code];
      if (!s) continue;
      const sh = o.height - o.title - 2 * o.pad;
      const sw = sh * s.aspect;
      const box = { code, name: s.name, x, y: o.y, w: sw + 2 * o.pad, h: o.height };
      box.shape = { x: x + o.pad, y: o.y + o.title + o.pad, w: sw, h: sh };
      box.anchor = [box.shape.x + s.anchor[0] * sw, box.shape.y + s.anchor[1] * sh];
      box.d = pathData(s.rings, box.shape);
      out.push(box);
      x += box.w + o.gap;
    }
    return out;
  }

  // Rings in box units (0 to 1, y down) as SVG path data inside a rectangle.
  const num = v => String(Math.round(v * 100) / 100);
  function pathData(rings, r) {
    return rings.map(ring => ring.map((p, i) => (i ? 'L' : 'M') + num(r.x + p[0] * r.w) + ' ' + num(r.y + p[1] * r.h))
      .join('') + 'Z').join('');
  }

  // A state's animals in the view: the sum of its lines' totals (missing counts as zero), or null without a line.
  function totalOf(lines, code) {
    let t = null;
    for (const a of lines || []) {
      if (String(a.state).toUpperCase() !== code) continue;
      const v = a.total_animals;
      t = (t || 0) + (v === null || v === undefined || Number.isNaN(v) ? 0 : v);
    }
    return t;
  }

  root.CVIWA = root.CVIWA || {};
  root.CVIWA.flowinsets = { CODES, present, layout, pathData, totalOf };
})(typeof window !== 'undefined' ? window : globalThis);
