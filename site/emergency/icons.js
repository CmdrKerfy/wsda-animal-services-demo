/* The two time views' icons (2.5), in Emergency's own file so CVI's icons.js is not changed (scope question 8):
 *   pin   "On a day": Bootstrap Icons' geo-alt-fill (MIT; the same path as in site/cvi/app/icons.js).
 *   span  "Between dates": two bars with an arrow between them, drawn for this page on Bootstrap Icons' 16-unit grid,
 *         in the same style (no Bootstrap icon file on this machine to copy one from).
 * WSDA.emergencyIcons.path(name) gives the path data (16 by 16) for the map picture; svg(name, size) the inline SVG
 * for the page, and fill(root) puts it in every element with data-em-icon="pin" or "span". */
(function (root) {
  'use strict';
  const PATHS = {
    pin: 'M8 16s6-5.69 6-10A6 6 0 0 0 2 6c0 4.31 6 10 6 10m0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6',
    span: 'M1 2.5a.5.5 0 0 1 1 0v11a.5.5 0 0 1-1 0zm13 0a.5.5 0 0 1 1 0v11a.5.5 0 0 1-1 0zM4.85 7.5h6.3l-1.65-1.65.7-.7' +
      'L13.05 8l-2.85 2.85-.7-.7 1.65-1.65h-6.3l1.65 1.65-.7.7L2.95 8 5.8 5.15l.7.7z'
  };
  const path = name => PATHS[name];
  function svg(name, size) {
    const s = size || 14;
    return '<svg class="em-ic" viewBox="0 0 16 16" width="' + s + '" height="' + s + '" fill="currentColor" aria-hidden="true">' +
      '<path d="' + PATHS[name] + '"/></svg>';
  }
  function fill(top) {
    (top || root.document).querySelectorAll('[data-em-icon]').forEach(e => { e.innerHTML = svg(e.getAttribute('data-em-icon')); });
  }
  root.WSDA = root.WSDA || {};
  root.WSDA.emergencyIcons = { path, svg, fill, PATHS };
})(typeof window !== 'undefined' ? window : globalThis);
