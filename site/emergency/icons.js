/* The page's own icons, in Emergency's own file so CVI's icons.js is not changed (2.5 scope question 8):
 *   pin   "On a day": Bootstrap Icons' geo-alt-fill (MIT; the same path as in site/cvi/app/icons.js).
 *   span  "Between dates": two bars with an arrow between them, drawn for this page on Bootstrap Icons' 16-unit grid,
 *         in the same style (no Bootstrap icon file on this machine to copy one from).
 *   draw, rectangle, square, circle  "Draw a zone" (2.6): its button, the badge and the shape switch's Freehand (four
 *         sides with a square handle at each corner), Rectangle, Square and Circle (an outline with its middle), drawn
 *         for this page on the same grid; their outlines are strokes (STROKES), the handles and the dot filled.
 * WSDA.emergencyIcons.path(name) gives the path data (16 by 16) for the map picture; svg(name, size) the inline SVG
 * for the page, and fill(root) puts it in every element with data-em-icon="pin", "span", "draw", "rectangle",
 * "square" or "circle". */
(function (root) {
  'use strict';
  const PATHS = {
    pin: 'M8 16s6-5.69 6-10A6 6 0 0 0 2 6c0 4.31 6 10 6 10m0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6',
    span: 'M1 2.5a.5.5 0 0 1 1 0v11a.5.5 0 0 1-1 0zm13 0a.5.5 0 0 1 1 0v11a.5.5 0 0 1-1 0zM4.85 7.5h6.3l-1.65-1.65.7-.7' +
      'L13.05 8l-2.85 2.85-.7-.7 1.65-1.65h-6.3l1.65 1.65-.7.7L2.95 8 5.8 5.15l.7.7z',
    draw: 'M1.3 2.8h3.4v3.4H1.3zM8.3.8h3.4v3.4H8.3zM11.8 6.8h3.4v3.4h-3.4zM5.3 11.8h3.4v3.4H5.3z',
    square: 'M8 6.7a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6',
    circle: 'M8 6.7a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6'
  };
  const STROKES = {
    draw: { d: 'M3 4.5 10 2.5l3.5 6-6.5 5z', width: 1.3 },
    rectangle: { d: 'M1.5 3.5h13v9h-13z', width: 1.4 },
    square: { d: 'M2.5 2.5h11v11h-11z', width: 1.4 },
    circle: { d: 'M8 2.2a5.8 5.8 0 1 1 0 11.6 5.8 5.8 0 0 1 0-11.6z', width: 1.4 }
  };
  const path = name => PATHS[name];
  function svg(name, size) {
    const s = size || 14, k = STROKES[name];
    return '<svg class="em-ic" viewBox="0 0 16 16" width="' + s + '" height="' + s + '" fill="currentColor" aria-hidden="true">' +
      (k ? '<path d="' + k.d + '" fill="none" stroke="currentColor" stroke-width="' + k.width + '" stroke-linejoin="round"/>' : '') +
      (PATHS[name] ? '<path d="' + PATHS[name] + '"/>' : '') + '</svg>';
  }
  function fill(top) {
    (top || root.document).querySelectorAll('[data-em-icon]').forEach(e => { e.innerHTML = svg(e.getAttribute('data-em-icon')); });
  }
  root.WSDA = root.WSDA || {};
  root.WSDA.emergencyIcons = { path, svg, fill, PATHS, STROKES };
})(typeof window !== 'undefined' ? window : globalThis);
