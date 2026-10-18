/* Name markers on the branded PNGs (S9): facility names printed next to their markers, kept apart, with a
 * thin leader line when a name has to move away from its marker. CVI does this with ggrepel's geom_text_repel
 * (static_map_renderer.R 1263-1283: italic, ggplot2 size 2.6, the layer's darker label color, a white halo, gray
 * leader lines 0.25 wide); the page uses its own placement, so the places differ while the names, wrapping, colors
 * and markers are CVI's. Used by County Focus now and the Infrastructure dashboard's Facilities PNG later.
 * Pure: page points in, places out (uses branded.js's text widths). */
(function (root) {
  'use strict';
  const B = () => root.WSDA.branded;

  // R's strwrap(x, width = 22) for a facility name (static_map_renderer.R 1142-1148): words joined while the line
  // stays shorter than the width; a name of fewer than 22 characters stays on one line; a longer word keeps a line
  // of its own.
  function wrapName(s, width) {
    const w = width || 22;
    const text = String(s === null || s === undefined ? '' : s).trim();
    if (!text) return [];
    if (Array.from(text).length <= w) return [text];
    const lines = [];
    let cur = '';
    for (const word of text.split(/\s+/)) {
      const next = cur ? cur + ' ' + word : word;
      if (cur && Array.from(next).length >= w) {
        lines.push(cur);
        cur = word;
      } else {
        cur = next;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  const LINE = 1.15;   // line height, in font sizes
  // A name's box around its center (x, y).
  function boxAt(x, y, w, h) {
    return { x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 };
  }
  // True when two boxes overlap.
  const meet = (a, b) => Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);
  // True when a circle ({ x, y, r }) overlaps a box.
  const touches = (c, b) => {
    const dx = c.x - Math.max(b.x0, Math.min(c.x, b.x1));
    const dy = c.y - Math.max(b.y0, Math.min(c.y, b.y1));
    return dx * dx + dy * dy < c.r * c.r;
  };

  // A grid over the page for finding what a candidate box may meet (testing every placed box and
  // marker for each of a name's 64 candidate places took seconds with hundreds of names). Each item goes into every
  // cell its bounding box touches, edges included, and a query looks only in the cells the box touches; two shapes
  // that overlap always share a cell, so every answer is the one a test against the whole list would give.
  function grid(size) {
    const cells = new Map();
    const wide = [];   // items without finite bounds or over many cells: tested on every query, as before
    const span = (a, b) => [Math.floor(a / size), Math.floor(b / size)];
    let stamp = 0;
    return {
      add(item, x0, x1, y0, y1) {
        const finite = Number.isFinite(x0) && Number.isFinite(x1) && Number.isFinite(y0) && Number.isFinite(y1);
        const [i0, i1] = finite ? span(x0, x1) : [0, 0], [j0, j1] = finite ? span(y0, y1) : [0, 0];
        if (!finite || (i1 - i0 + 1) * (j1 - j0 + 1) > 4096) {
          wide.push(item);
          return;
        }
        for (let i = i0; i <= i1; i++) {
          for (let j = j0; j <= j1; j++) {
            const key = i + ',' + j;
            if (!cells.has(key)) cells.set(key, []);
            cells.get(key).push(item);
          }
        }
      },
      // True when test(item) holds for an item that may meet the box (each item tested once); a box without finite
      // bounds is tested against every item, as the plain list did.
      some(b, test) {
        if (wide.some(item => test(item.v))) return true;
        if (!(Number.isFinite(b.x0) && Number.isFinite(b.x1) && Number.isFinite(b.y0) && Number.isFinite(b.y1))) {
          for (const list of cells.values()) if (list.some(item => test(item.v))) return true;
          return false;
        }
        stamp++;
        const [i0, i1] = span(b.x0, b.x1), [j0, j1] = span(b.y0, b.y1);
        for (let i = i0; i <= i1; i++) {
          for (let j = j0; j <= j1; j++) {
            const list = cells.get(i + ',' + j);
            if (!list) continue;
            for (const item of list) {
              if (item.stamp === stamp) continue;
              item.stamp = stamp;
              if (test(item.v)) return true;
            }
          }
        }
        return false;
      }
    };
  }
  // A grid holding the boxes in list.
  const boxGrid = (list, size) => {
    const g = grid(size);
    list.forEach(b => g.add({ v: b }, b.x0, b.x1, b.y0, b.y1));
    return g;
  };
  // A grid holding the circles in list, by their bounding boxes.
  const circleGrid = (list, size) => {
    const g = grid(size);
    list.forEach(c => g.add({ v: c }, c.x - c.r, c.x + c.r, c.y - c.r, c.y + c.r));
    return g;
  };

  // Places for names. names: [{ lines, x, y, r (the marker's radius) }] in drawing order; markers: every marker
  // ({ x, y, r }) a name must not cover; soft: things better not covered (the CVI circles); area: { x0, x1, y0, y1 };
  // taken: boxes already used by other text (the county names), never covered.
  // For each name, places around its marker in eight directions, ring after ring farther out; the first place that
  // covers no other name and no marker and stays in the area wins (one that also misses the soft things first).
  // Returns [{ x, y, box, leader: null or { x1, y1, x2, y2 }, free }].
  function place(names, markers, soft, area, pt, taken) {
    const size = Math.max(8 * pt, 1);
    const placed = boxGrid(taken || [], size);
    const markerGrid = circleGrid(markers, size), softGrid = circleGrid(soft, size);
    const out = [];
    const DIRS = [[1, 0], [-1, 0], [0, -1], [0, 1], [1, -1], [-1, -1], [1, 1], [-1, 1]];
    for (const n of names) {
      const w = Math.max(...n.lines.map(l => B().textWidth(l, pt))) + 2;
      const h = n.lines.length * pt * LINE;
      let best = null;
      for (let ring = 0; ring < 8 && !(best && best.free && !best.soft); ring++) {
        const gap = n.r + 2 + ring * pt * 1.4;
        DIRS.forEach(([dx, dy], k) => {
          const x = n.x + dx * (gap + w / 2);
          const y = n.y + dy * (gap + h / 2);
          const b = boxAt(x, y, w, h);
          const off = b.x0 < area.x0 || b.x1 > area.x1 || b.y0 < area.y0 || b.y1 > area.y1;
          const hit = placed.some(b, p => meet(p, b)) || markerGrid.some(b, m => touches(m, b));
          const softHit = softGrid.some(b, c => touches(c, b));
          const free = !off && !hit;
          const score = (free ? 0 : 1e6) + (off ? 1e5 : 0) + (softHit ? 1e3 : 0) + ring * 10 + k;
          if (!best || score < best.score) best = { x, y, b, free, soft: softHit, score };
        });
      }
      placed.add({ v: best.b }, best.b.x0, best.b.x1, best.b.y0, best.b.y1);
      // A leader line from the marker's edge to the name's box when the name sits away from its marker.
      const nx = Math.max(best.b.x0, Math.min(n.x, best.b.x1));
      const ny = Math.max(best.b.y0, Math.min(n.y, best.b.y1));
      const d = Math.hypot(nx - n.x, ny - n.y);
      const leader = d > n.r + 3 ? { x1: n.x + (nx - n.x) * n.r / d, y1: n.y + (ny - n.y) * n.r / d, x2: nx, y2: ny }
        : null;
      out.push({ x: best.x, y: best.y, box: best.b, leader, free: best.free });
    }
    return out;
  }

  // The SVG markup of one placed name: its leader line, then its lines (italic, halo), centered on the place.
  // o: { bold, halo } for the Facilities map's names (CVI: bold, not italic, halo radius 0.18).
  function markup(name, at, pt, color, o) {
    const BR = B();
    const parts = [];
    if (at.leader) {
      parts.push(BR.line(at.leader.x1, at.leader.y1, at.leader.x2, at.leader.y2, '#888888', BR.linePt(0.25)));
    }
    name.lines.forEach((l, i) => {
      const y = at.y + (i - (name.lines.length - 1) / 2) * pt * LINE;
      parts.push(BR.text(l, at.x, y, { pt, color, italic: !(o && o.bold), bold: !!(o && o.bold), anchor: 'middle',
        halo: { color: '#ffffff', opacity: 1, width: 2 * 0.18 * pt } }));
    });
    return parts.join('');
  }

  root.WSDA = root.WSDA || {};
  root.WSDA.labels = { wrapName, place, markup, LINE };
})(typeof window !== 'undefined' ? window : globalThis);
