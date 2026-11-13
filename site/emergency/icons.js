/* The page's own icons, in Emergency's own file so CVI's icons.js is not changed:
 *   pin   "On a day": Bootstrap Icons' geo-alt-fill (MIT; the same path as in site/cvi/app/icons.js).
 *   span  "Between dates": two bars with an arrow between them, drawn for this page on Bootstrap Icons' 16-unit grid,
 *         in the same style (no Bootstrap icon file on this machine to copy one from).
 *   draw, rectangle, square, circle  "Draw a zone" (2.6): its button, the badge and the shape switch's Freehand (four
 *         sides with a square handle at each corner), Rectangle, Square and Circle (an outline with its middle), drawn
 *         for this page on the same grid; their outlines are strokes (STROKES), the handles and the dot filled.
 *   file-earmark-text, printer  the Report button and "Print / Save as PDF" (2.9): Bootstrap Icons, from
 *         bsicons::bs_icon() (bsicons 0.1.2, MIT; site/PROVENANCE.md). The key messages' icons are in message-icons.js.
 * WSDA.emergencyIcons.path(name) gives the path data (16 by 16) for the map picture; svg(name, size) the inline SVG
 * for the page, and fill(root) puts it in every element with data-em-icon (its name). */
(function (root) {
  'use strict';
  const PATHS = {
    pin: 'M8 16s6-5.69 6-10A6 6 0 0 0 2 6c0 4.31 6 10 6 10m0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6',
    span: 'M1 2.5a.5.5 0 0 1 1 0v11a.5.5 0 0 1-1 0zm13 0a.5.5 0 0 1 1 0v11a.5.5 0 0 1-1 0zM4.85 7.5h6.3l-1.65-1.65.7-.7' +
      'L13.05 8l-2.85 2.85-.7-.7 1.65-1.65h-6.3l1.65 1.65-.7.7L2.95 8 5.8 5.15l.7.7z',
    draw: 'M1.3 2.8h3.4v3.4H1.3zM8.3.8h3.4v3.4H8.3zM11.8 6.8h3.4v3.4h-3.4zM5.3 11.8h3.4v3.4H5.3z',
    square: 'M8 6.7a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6',
    circle: 'M8 6.7a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6',
    // The Report button and its print button (2.9): Bootstrap Icons' own paths, from bsicons::bs_icon() (bsicons 0.1.2, MIT).
    'file-earmark-text': 'M5.5 7a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1h-5zM5 9.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1' +
      ' .5-.5h2a.5.5 0 0 1 0 1h-2a.5.5 0 0 1-.5-.5zM9.5 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0zm0 1v2A1' +
      '.5 1.5 0 0 0 11 4.5h2V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5.5z',
    printer: 'M2.5 8a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zM5 1a2 2 0 0 0-2 2v2H2a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1v1a2 2 0 0 0 2 2h6a2 2 0 0 ' +
      '0 2-2v-1h1a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1V3a2 2 0 0 0-2-2H5zM4 3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2H4V3zm1 5a2 2 0 0 0-' +
      '2 2v1H2a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v-1a2 2 0 0 0-2-2H5zm7 2v3a1 1 0 0 1-1 1H5a1 ' +
      '1 0 0 1-1-1v-3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1z'
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
