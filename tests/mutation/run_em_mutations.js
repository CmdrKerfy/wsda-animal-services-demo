#!/usr/bin/env node
'use strict';
// Emergency Response spot mutations: changes to the rules (which positives get zones, names, the coarse-location
// rule, the edge, the counts, the "nearest" line, the boxes, dates; from E1b the groups, quarantine, the window, the
// weeks and months, the flock sizes and numbers, miles, days since and the GeoJSON; zones.csv and the map picture's
// model, site/emergency/branded.js; the chart's counts and drawing, site/emergency/chart.js), the types, recognition
// and the page must each fail a suite.
//
// Each mutant changes one exact piece of code in a temporary copy of the repository; the suite named for its group
// must then report failed checks. A suite that stops early does not count as catching it.
//   unit   site/emergency/rules.js, types.js, datasets.js, branded.js, chart.js and site/shared/recognize.js, against the Emergency unit
//          suite (which also compares the rules with the R reference)
//   page   site/emergency/app.js, map.js and index.html, against the Emergency Chrome suite's parts named with the
//          mutant ("page" and "results" unless it names others; from E1b also "e1b", "png", "chart" and "speed")
//          (foreground only; about 40 seconds a mutant, so run a few numbers at a time to stay under 600 seconds)
//
// Usage (repository root): node tests/mutation/run_em_mutations.js unit|page [numbers ...]
//                          node tests/mutation/run_em_mutations.js list
// The unmutated suite runs first in the same copy and must pass. The copy is deleted at the end, and the
// repository's files are checked unchanged (SHA-256). Logs and a ledger: local-test-artifacts/em/mutations/.
// Copied from tests/mutation/run_s11_mutations.js (its copy, run and ledger), with the Emergency suites.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 'em', 'mutations');
const TEMP = path.join(ROOT, 'local-test-artifacts', 'em', 'mutation-copy-' + process.argv[2]);
const COPY = path.join(TEMP, 'platform');
const RU = 'site/emergency/rules.js', TY = 'site/emergency/types.js', DS = 'site/emergency/datasets.js';
const RE = 'site/shared/recognize.js', AP = 'site/emergency/app.js', HT = 'site/emergency/index.html';
const BRD = 'site/emergency/branded.js', CHT = 'site/emergency/chart.js', MP = 'site/emergency/map.js';

// [name, file, exact original text, replacement, the Chrome parts that must catch it (page mutants only; default
// "page" and "results")]
const GROUPS = {
  unit: [
    ['past positives get zones', RU,
      "return positives.filter(p => on.has(p.status ? p.status.label : 'none') && inWindow(p, win) && !isPast(p, end));",
      "return positives.filter(p => on.has(p.status ? p.status.label : 'none') && inWindow(p, win));"],
    ['applyTo "confirmed" ticks every status', RU,
      "return { statuses: applyTo === 'confirmed' ? [type.statuses[0].label] : all, pastShown: false };",
      "return { statuses: all, pastShown: false };"],
    ['names: the county left out of "Positive n (County)"', RU,
      "name: id || 'Positive ' + n + (county ? ' (' + county + ')' : '') }", "name: id || 'Positive ' + n }"],
    ['dates: M/D/YYYY read as D/M/YYYY', RU, 'y = +m[3]; mo = +m[1]; d = +m[2];', 'y = +m[3]; mo = +m[2]; d = +m[1];'],
    ['coarse: a street-level location left out', RU, "if (v !== 'rooftop' && v !== 'street') return",
      "if (v !== 'rooftop') return"],
    ['coarse: a missing match_status column counts against the point', RU,
      "if (p.match_status !== undefined && text(p.match_status) !== 'Matched')", "if (text(p.match_status) !== 'Matched')"],
    ['coarse: a town-level location kept', RU, "    if (TOWN_LEVEL.test(text(point.geoSource))) return 'located only to a town';\n", ''],
    ['coarse: a point not placed kept', RU, "    if (UNPLACED.test(text(point.geoSource))) return 'not placed';\n", ''],
    ['edge: a site on a ring\'s edge left out', RU, 'if (km === null || km > s.bufferKm) return;',
      'if (km === null || km >= s.bufferKm) return;'],
    ['counts: a site inside two zones counted twice', RU, 'const insideCount = new Set(found.map(siteKey)).size;',
      'const insideCount = found.length;'],
    ['nearest: the farthest site', RU, 'if (!nearest || km < nearest.exactKm ||', 'if (!nearest || km > nearest.exactKm ||'],
    ['boxes: a missing detection date shown as a value', RU,
      "!read.columns.detected ? { value: null, reason: 'Not available: needs ' + read.type.columns.detected[0] }",
      "!read.columns.detected ? { value: 0, reason: null }"],
    ['columns: the detection date not taken from the next column when the first is blank', RU,
      "detectedAt.map(i => cell(r, i)).find(v => v) || ''", "cell(r, detectedAt.length ? detectedAt[0] : -1)"],
    ['columns: a file without a status column leaves every positive without a status', RU,
      'col.status < 0 ? firstStatus : ', 'col.status < 0 ? null : '],
    ['columns: the type picked from the first disease column only', RU,
      'at.length ? at.flatMap(i => data.map(x => cell(x.r, i))) : null', 'at.length ? data.map(x => cell(x.r, at[0])) : null'],
    ['types: a status spelled in capitals not recognized', TY,
      "const v = String(value == null ? '' : value).trim().toLowerCase();\n    if (!v) return null;",
      "const v = String(value == null ? '' : value).trim();\n    if (!v) return null;"],
    ['types: a disease word matches inside a word', TY,
      'if (at === 0 || !/[a-z0-9]/.test(textLower[at - 1])) return true;', 'return true;'],
    ['types: an http link accepted', TY, "!/^https:\\/\\/[^\\s\"<>]+$/.test(url)", "!/^https?:\\/\\/[^\\s\"<>]+$/.test(url)"],
    ['past: a Close Date after the end still makes it past', RU, 'if (p.closedDate) return !end || p.closedDate <= end;',
      'if (p.closedDate) return true;'],
    ['past: Status Closed decides over the Close Date', RU,
      '    if (p.closedDate) return !end || p.closedDate <= end;\n    return p.closed;', '    return p.closed;'],
    ['quarantine: a release after the end counts as released', RU, 'return !p.quarantine || (!!end && p.quarantine > end);',
      'return !p.quarantine;'],
    ['window: a positive without a date hidden', RU, 'if (!win || !p.detected) return true;',
      'if (!win) return true;\n    if (!p.detected) return false;'],
    ['not mapped: a swapped pair called unreadable', RU, "      return 'latitude and longitude look swapped';",
      "      return 'coordinates not readable';"],
    ['weeks: the Sunday taken in local time', RU, 'addDays(iso, -new Date(msOf(iso)).getUTCDay())',
      'addDays(iso, -new Date(msOf(iso)).getDay())'],
    ['months: 26 weeks already step by month', RU, 'if (weeks <= MAX_WEEKS) {', 'if (weeks < MAX_WEEKS) {'],
    ['play: the last step ends on its Saturday', RU, 'end: saturday < win.end ? saturday : win.end', 'end: saturday'],
    ['size: 1,000 counted Large', RU, "n <= 1000 ? 'Medium'", "n < 1000 ? 'Medium'"],
    ['inventory: a blank counted as zero', RU, "!/^\\d{1,3}(,\\d{3})+$/.test(s)) return null;",
      "!/^\\d{1,3}(,\\d{3})+$/.test(s)) return s ? null : 0;"],
    ['inventory: thousands commas not read', RU, "if (!/^\\d+$/.test(s) && !/^\\d{1,3}(,\\d{3})+$/.test(s))",
      "if (!/^\\d+$/.test(s))"],
    ['numbers: the past positives counted', RU, 'const numbers = numbersLine(read, g.current);',
      'const numbers = numbersLine(read, g.current.concat(g.past));'],
    ['numbers: cattle counted as birds', RU, 'const w = inventoryWordOf(read.type, p);', 'const w = read.type.inventoryWord;'],
    ['numbers: a cattle word matched anywhere in the species', RU,
      "type.countedApart.find(a => a.species.some(w => hasWord(species, w)))", "type.countedApart.find(a => a.species.some(w => species.includes(w)))"],
    ['numbers: "0 cattle" written when no herd has an inventory', RU, "if (n !== null) parts.push(bigNumber(n) + ' ' + w);",
      "parts.push(bigNumber(n || 0) + ' ' + w);"],
    ['types: countedApart not checked', TY, 'species: words(a && a.species, `countedApart[${i}].species`, fail),',
      'species: (a && a.species) || [],'],
    ['zones.csv: not ordered by days since', RU, 'const rows = byQuiet(days).map(', 'const rows = days.map('],
    ['map picture: past rings in the current colors', BRD, 'const pastParts = ringShapes(pastSites, rings, unit, PAST);',
      'const pastParts = ringShapes(pastSites, rings, unit);'],
    ['map picture: the key\'s rings without their distance', BRD, "ring(r.color, r.label + ' (' + b.shown + ' / ' + b.other + ')');",
      'ring(r.color, r.label);'],
    ['map picture: the other unit left out', BRD, "return { shown: distance(d, u), other: String(Number(x.toFixed(1))) + ' ' + E().UNITS[o].label };",
      "return { shown: distance(d, u), other: distance(d, u) };"],
    ['map picture: a zone\'s long name not wrapped', BRD, 'if (!r.county) names = wrap(full, fullPt, nameRoom, 3);',
      'if (false) names = wrap(full, fullPt, nameRoom, 3);'],
    ['map picture: the key\'s counts not drawn', BRD, "const countOf = (it, yy, pt) => (it.count === undefined ? '' :", "const countOf = (it, yy, pt) => (true ? '' :"],
    ['map picture: the Positives box counts every positive drawn', BRD, "{ label: 'Current positives', value: S().comma(input.current || 0), color: TEAL }",
      "{ label: 'Current positives', value: S().comma(positives.length), color: TEAL }"],
    ['map picture: the panel in file order', BRD, 'order.sort((a, b) => (rows[b].count || 0) - (rows[a].count || 0) || a - b);', ''],
    ['map picture: the footer counts every row', BRD, 'S().comma(rowsIn.filter(r => r.count > 0).length)', 'S().comma(rowsIn.length)'],
    ['map picture: the sensitive-data line left out', BRD, '      sensitive,\n', "      '',\n"],
    ['map picture: a long name cut at full size', BRD, 'nameSize = Math.max(3.1 * MIN_SCL, 3.1 * scl * nameRoom / BR.textWidth(full, fullPt, true));',
      'nameSize = 3.1 * scl;'],
    ['boxes: past positives counted in the total', RU, 'const all = !read ? [] : g ? g.current : read.positives.filter(',
      'const all = !read ? [] : g ? g.current.concat(g.past) : read.positives.filter('],
    ['miles: rings kept in km', RU, "const toKm = (d, unit) => (unit === 'mi' ? d * KM_PER_MILE : d);",
      'const toKm = (d, unit) => d;'],
    ['days since: the earliest positive taken', RU, '(!latest || p.detected > latest)', '(!latest || p.detected < latest)'],
    ['GeoJSON: rings left as drawn (clockwise)', RU,
      'const r = (root.WSDA.zones.signedArea(ring) > 0) === ccw ? ring.slice() : ring.slice().reverse();', 'const r = ring.slice();'],
    ['GeoJSON: coordinates not rounded', RU, 'const out = r.map(pt => [round6(pt[0]), round6(pt[1])]);',
      'const out = r.map(pt => [pt[0], pt[1]]);'],
    ['types: applyTo "all" refused without saying why', TY, "if (z.applyTo === 'all') {", "if (false) {"],
    ['types: a column naming an address accepted', TY, '    if (bad) {\n      fail(field, `column names', '    if (false) {\n      fail(field, `column names'],
    ['datasets: the agreed table\'s markers left out (as in v2.0)', DS,
      "const MARKERS = ['Case ID', 'Confirmed Diagnosis', 'Close Date', 'Subtype',\n    'Surveillance Closed',",
      "const MARKERS = [\n    'Surveillance Closed',"],
    ['recognition: bundle.json ignored for zone files', RE, 'let ds = fits.find(d => d.id === mappedId);', 'let ds = null;'],
    ['recognition: CSV files matched against the zone dataset', RE,
      "const dsList = allList.filter(d => d.kind !== 'zone'), zoneList", 'const dsList = allList, zoneList'],
    ['recognition: a shapefile part without its reason', RE,
      "if (zoneSets.length && SHAPEFILE_PARTS.includes(ext)) return", "if (false) return"],
    ['chart counts: the past counted as current', RU, '      else if (isPast(p, end)) c.past++;\n', ''],
    ['chart counts: positives outside the window counted as inside', RU, '      if (!inWindow(p, win)) c.outside++;\n      else if',
      '      if'],
    ['chart counts: a step\'s last day left out', RU, 'p.detected >= x.start && p.detected <= x.end', 'p.detected >= x.start && p.detected < x.end'],
    ['chart counts: the positives without a date not named', RU, 'undated: positives.filter(p => !p.detected).length', 'undated: 0'],
    ['chart: a zero count in the hover', CHT, 'chart.series.filter(s => col.values[s.key] > 0)', 'chart.series.filter(s => col.values[s.key] >= 0)'],
    ['chart: half a positive on the axis', CHT, '.map(b => Math.round(b * 1e9) / 1e9).filter(b => Number.isInteger(b));', ';'],
    ['chart: the series drawn over each other, not stacked', CHT, '        at += v;\n', ''],
    ['chart: every column a keyboard stop', CHT, "tabindex: i === (picked >= 0 ? picked : n - 1) ? '0' : '-1',", "tabindex: '0',"],
    ['chart: the key lists series never counted', CHT, 'chart.series.filter(s => cols.some(c => c.values[s.key] > 0))', 'chart.series'],
    ['chart: a wide slot\'s column not capped', CHT, 'slot * 0.8, MAX_COLUMN)', 'slot * 0.8)'],
    ['map picture: the key\'s rows squeezed past their text (CVI\'s 0.6 alone)', BRD,
      'least: Math.max(MIN_KEY_SQUEEZE, ...shownFacilities.map(it => textShare(it, pt)))', 'least: MIN_KEY_SQUEEZE'],
    ['GeoJSON: a ring\'s name without its positive', RU, "UNITS[o.unit || 'km'].label + ') around ' + text(s.name),",
      "UNITS[o.unit || 'km'].label + ')',"],
    ['map picture: fewer layers listed before smaller text is tried', BRD, 'const KEY_TEXT_STEPS = [1, 0.9, 0.8];', 'const KEY_TEXT_STEPS = [1];'],
    ['map picture: a CVI premises drawn once per movement', BRD, "        .filter(q => !seen.has(q.lat + ',' + q.lon) && seen.add(q.lat + ',' + q.lon));\n", '        ;\n'],
    // Version 2.1, before the publish: dates with a time, the unreadable dates said, no window
    ['dates: a time after M/D/YYYY makes the date unreadable', RU, "m = /^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})(?:[ T].*)?$/.exec(s);",
      "m = /^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})$/.exec(s);"],
    ['dates: an unreadable release date not counted', RU, '      if (releaseText && !release) badReleaseDates++;\n', ''],
    ['the boxes: the unreadable dates never said', RU, "      if (bad) lines.push(", "      if (false) lines.push("],
    ['the boxes: without a window the closed positives counted as current', RU,
      'read.positives.filter(p => !isPast(p, null));', 'read.positives;']
  ],
  page: [
    ['the loader stays open after a clean load', AP, "if (ready && !failed && !notes.length) $('load-fold').open = false;",
      'void ready;'],
    ['a zone file in the files replaces the rings at once', AP,
      "state.useZones = source === 'page' || state.type.zones.source === 'file';", 'state.useZones = true;'],
    ['rings in the wrong order accepted', AP, 'next.every((r, i) => i === 0 || r.distance > next[i - 1].distance);', 'true;'],
    ['the sites outside the zones not drawn', AP,
      "outside.push({ lat: p.lat, lon: p.lon, shape: l.shape, color: l.color, label: name + '\\n' + l.label });", 'void name;'],
    ['the type\'s "?" leaves its fold closed', AP, 'if (fold && !note.hidden) fold.open = true;', 'void fold;'],
    ['the left-out sites not listed', AP, '    if (r.leftOut.length) {\n      const d = el(\'details\', \'em-leftout\')',
      '    if (false) {\n      const d = el(\'details\', \'em-leftout\')'],
    ['CVI movements: origins only', AP, "const opts = { endpoint: 'either',", "const opts = { endpoint: 'origin',"],
    ['the CVI export keeps the address column', AP, 'const header = state.master.header.filter(h => !E.PRIVATE.test(h));',
      'const header = state.master.header;'],
    ['the boxes say nothing of a missing column', AP,
      "card.querySelector('strong').textContent = value === null ? note :", "card.querySelector('strong').textContent = value === null ? '0' :"],
    ['at 320 pixels the results widen the page', HT, '.explore { grid-template-columns: minmax(0, 1fr); }',
      '.explore { grid-template-columns: 1fr; }'],
    ['the sidebar scrolls away with the results', HT, '.em-controls { position: sticky;', '.em-controls { position: static;'],
    ['an added point\'s typed name not used', AP, '        p.name = typed || p.first;', '        void typed;'],
    ['a removed point\'s name given again', AP, 'const n = ++state.pointsAdded;', 'const n = state.points.length + 1;'],
    // E1b (14 onward)
    ['the status list shown without a status column', AP, "$('em-statuses-field').hidden = !state.read || !state.read.columns.status;",
      "$('em-statuses-field').hidden = !state.read;", ['e1b']],
    ['past positives drawn while "Show past positives" is not ticked', AP,
      'const shown = read ? read.positives.filter(p => E.inWindow(p, state.window) && (state.ticks.pastShown || !E.isPast(p, end))) : [];',
      'const shown = read ? read.positives.filter(p => E.inWindow(p, state.window)) : [];', ['e1b']],
    ['a first date after the second accepted', AP, 'if (next.start > next.end) {', 'if (false) {', ['e1b']],
    ['the play starts where it rests, not at the first step', AP,
      '    if (state.stepAt >= steps.length - 1) state.stepAt = -1;   // from the first step\n', '', ['e1b']],
    ['the play loops instead of stopping at the end', AP,
      'if (state.stepAt >= state.steps.steps.length - 1) { stopPlay(); return; }',
      'if (state.stepAt >= state.steps.steps.length - 1) state.stepAt = -1;', ['e1b']],
    ['the slider leaves the play running', AP, "    const i = Number($('em-step').value);\n    stopPlay();\n",
      "    const i = Number($('em-step').value);\n", ['e1b']],
    ['the CVI movements worked out during the play', AP,
      "    if (state.playing) {\n      out.append(el('p', 'muted', 'The CVI movements are worked out when the play stops.'));",
      "    if (false) {\n      out.append(el('p', 'muted', 'The CVI movements are worked out when the play stops.'));", ['e1b', 'speed']],
    ['km | miles keeps the numbers typed (the rings change size)', AP, 'if (state.rings) state.rings = ringsIn(unit);',
      'void ringsIn;', ['e1b']],
    ['the zone hover lists the largest ring first', MP, '[...lines.values()].sort((a, b) => a.km - b.km ||', '[...lines.values()].sort((a, b) => b.km - a.km ||', ['e1b']],
    ['the rows not mapped not listed', AP, '    if (!dropped.length) return null;\n', '    return null;\n', ['e1b']],
    ['a new set of files keeps the type picked for the earlier ones', AP,
      "    state.typePicked = false;\n    say('load-status', 'info', 'Reading files…');", "    say('load-status', 'info', 'Reading files…');", ['e1b']],
    ['zones.geojson left out of the Export', AP, "    add('zones.geojson', JSON.stringify(zonesGeoJson()) + '\\n');\n", '', ['results']],
    ['the chart\'s picked column not following the play', AP, 'picked: i === state.stepAt,', 'picked: false,', ['chart']],
    ['the chart\'s note silent on the rows not mapped', AP,
      "    if (t.notMapped) notCounted.push(t.notMapped.toLocaleString('en-US') + ' not mapped');\n", '', ['chart']],
    ['the map picture ignores a paused play\'s date', AP, '    window: state.window, current: E.groups(read, state.window).current.length,',
      '    window: state.fileWindow, current: E.groups(read, state.fileWindow).current.length,', ['png']],
    // E1b's UI pass: the value boxes and the hovers
    ['the line under the boxes never shown', AP, '    strip.hidden = !lines.length;', '    strip.hidden = true;', ['e1b']],
    ['the rows not mapped not in the warning color', AP, "strip.append(el('span', /^Animals /.test(l) ? '' : 'warn', l));",
      "strip.append(el('span', '', l));", ['e1b']],
    ['the last positive\'s date left as written in the file', AP, "set('box-last', v.last.value === null ? null : E.dayLabel(v.last.value),",
      "set('box-last', v.last.value,", ['e1b']],
    ['the zone hover drops a positive\'s smaller rings', MP, '      if (!groups.has(t.head)) groups.set(t.head, []);',
      '      groups.set(t.head, []);', ['e1b']],
    ['the hover wider than a phone\'s map', MP, "maxWidth: 'min(320px, calc(100vw - 48px))' });", "maxWidth: '320px' });", ['e1b']],
    // Version 2.1: the legend, the fold summaries, the dates, the play's label, the results tables
    ['on a phone the legend over the map again', HT, '    #em-legend { position: static;', '    #em-legend { position: absolute;', ['e1b']],
    ['a sidebar fold\'s summary beside its heading again', HT, '  .em-controls .fold-sum { display: block;',
      '  .em-controls .fold-sum { display: inline;', ['e1b']],
    ['a fold\'s summary broken inside an item', AP,
      "    box.replaceChildren(...parts.map((t, i) => i % 2 ? document.createTextNode(t) : el('span', 'item', t)));",
      "    box.textContent = parts.join('');", ['e1b']],
    ['the date boxes on one row', HT, 'grid-template-columns: auto auto; justify-content: start;',
      'grid-template-columns: auto auto auto auto; justify-content: start;', ['e1b']],
    ['the play\'s label as "Week of" again', AP, "const said = n ? 'Up to ' + E.dayLabel(upTo) + ' · '",
      "const said = n ? s.steps[state.stepAt].label + ' · '", ['e1b']],
    ['the "Zones" list\'s dates left as written in the file', AP, "r[5] ? E.dayLabel(r[5]) : 'no date',",
      "r[5] || 'no date',", ['e1b']],
    ['on a phone the "Zones" rows not stacked', AP,
      "    table[0].classList.add('stack-narrow');\n    fold.append(sum, ...table);\n    return fold;\n  }\n  // The rows of the positives file",
      "    fold.append(sum, ...table);\n    return fold;\n  }\n  // The rows of the positives file", ['e1b']],
    ['a zone file\'s layer line names every zone again', AP, '    const line = zones.length > 1 ?', '    const line = false ?', ['e1b']],
    ['"Not mapped" not in the warning color', HT, '  details.em-notmapped > summary strong { color: var(--notice-text); }\n', '', ['e1b']],
    ['the results tables the full width again', HT, '  .em-results table { width: auto; max-width: 100%;', '  .em-results table { width: 100%;', ['results']],
    ['a number\'s heading at its column\'s left', AP,
      "columns.forEach((c, j) => head.append(el('th', rows.length && typeof rows[0][j] === 'number' ? 'num' : null, c)));",
      "columns.forEach(c => head.append(el('th', null, c)));", ['results']],
    // E1b (version 2.1): a zone without a dated positive; the population key and the zone hover's lines
    ['a zone without a dated positive: empty cells again', AP, "E.dayLabel(r[5]) : 'no date', r[5] ? r[6] : 'unknown']",
      "E.dayLabel(r[5]) : '', r[6]]", ['e1b']],
    ['the population key left out of the legend', AP, 'const pc = PN.legendEntries(pcDrawn(), PN.DEFAULT_RAMP);', 'const pc = [];', ['e1b']],
    ['the zone hover without the population lines', MP, '    if (context.length) out.context = context;\n', '', ['e1b']],
    // Version 2.1: the chart opened with each new set of files; "Export & Preview" in the sidebar
    ['the chart left closed after a load', AP, "    $('em-chart-fold').open = ready;\n", '', ['chart']],
    ['"Export & Preview" open from the start', HT, '<details class="section" id="export-fold" data-section="export">',
      '<details class="section" id="export-fold" data-section="export" open>', ['png']],
    // Version 2.1: each count once; the past box's quarantine in the warning color; the date fitted
    ['the past box\'s quarantine not in the warning color', AP, "    $('box-past').classList.toggle('quar', !!v.past.quarantined);\n", '', ['e1b']],
    ['a wide date cut off its box on a phone again', HT, '  #box-last:not(.na) strong { font-size: clamp(15px, 13.5cqi, 22px); }\n', '', ['e1b']],
    ['the sidebar summary counts the positives again', AP, "zonesMode ? 'zones from a file' : !state.rings", "zonesMode ? 'zones from a file' : targets.length ? targets.length + ' with zones' : !state.rings", ['page']],
    // The boxes' icons in brand colors; the map picture's box named as the page's
    ['the current positives\' box without its brand color', HT, '  #box-positives { --box: var(--wsda-crimson); }\n', '', ['e1b']],
    ['the quarantine\'s gold tile gone', HT, '    .count-card.quar .card-ic { color: var(--wsda-dark-brown); background: var(--wsda-gold); }\n', '', ['e1b']],
    ['the map picture\'s box named "Positives" again', BRD, "label: 'Current positives', value: S().comma(input.current || 0)", "label: 'Positives', value: S().comma(input.current || 0)", ['png']],
    // The quarantine note as the "As of" note, its number alone in bold and the warning color
    ['the whole quarantine note in bold and the warning color again', HT, '  .count-card.quar .card-note b {', '  .count-card.quar .card-note, .count-card.quar .card-note b {', ['e1b']],
    ['the quarantine note\'s number not set apart', AP, "      note.replaceChildren(el('b', '', n), v.past.note.slice(n.length));\n", '', ['e1b']],
    // Version 2.1, before the publish: the "To" date to today, the label past the last step, the "?" sentence, the
    // bundle's zone file on a type change
    ['the "To" date stops at the latest detection again', AP, "      input.max = key === 'end' && today > fw.end ? today : fw.end;",
      '      input.max = fw.end;', ['e1b']],
    ['past the last step the play\'s label names the step, not the window\'s end', AP,
      'state.window.end > s.steps[n - 1].end ? state.window.end', 'false ? state.window.end', ['e1b']],
    ['the "?" silent on positives closed by their status alone', AP,
      "const said = EXAMPLES + (byStatusOnly ? ' ' + NO_CLOSE_DATE : '');", 'const said = EXAMPLES;', ['e1b']],
    ['a type change keeps the bundle\'s zone file as it was', AP,
      "    if (state.zoneFile && state.zoneFile.source !== 'page') state.useZones = state.type.zones.source === 'file';\n", '', ['e1b']]
  ]
};

// The references and inputs the suites read (the sample is written by the Chrome suite's part "load"; the
// 50,000-row master by tests/synthetic/make_scale_master.js, for the part "speed").
const ARTIFACTS = ['local-test-artifacts/em/oracle_em.json', 'local-test-artifacts/em/sample'];
const SCALE_MASTER = 'local-test-artifacts/scale/cvi_master_50000.csv';

const mode = process.argv[2];
const picks = process.argv.slice(3).map(Number);
if (mode === 'list') {
  Object.keys(GROUPS).forEach(g => GROUPS[g].forEach((m, i) => console.log(g + ' ' + (i + 1) + '. ' + m[0] + ' (' + m[1] + ')')));
  process.exit(0);
}
if (!GROUPS[mode] || picks.some(n => !Number.isInteger(n) || n < 1 || n > GROUPS[mode].length)) {
  throw new Error('Use: <unit|page> [numbers ...] | list');
}
const list = GROUPS[mode].map((m, i) => ({ n: i + 1, name: m[0], file: m[1], from: m[2], to: m[3], parts: mode === 'page' ? m[4] || ['page', 'results'] : [] }))
  .filter(m => !picks.length || picks.includes(m.n));
// The unmutated run covers every part the picked mutants name.
const allParts = [...new Set(list.flatMap(m => m.parts))];

const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const files = [...new Set(list.map(m => m.file))];
const before = Object.fromEntries(files.map(f => [f, sha(path.join(ROOT, f))]));

// One run of the group's suite in the copy: the summary line, the failed checks and whether it stopped early.
function runSuite(label, parts) {
  const started = Date.now();
  const suite = mode === 'page' ? ['tests/browser/run_em_browser.js', ...parts] : ['tests/node/run_em_unit_tests.js'];
  const r = cp.spawnSync(process.execPath, suite, { cwd: COPY, encoding: 'utf8',
    maxBuffer: 64 << 20, timeout: 5 * 60000, killSignal: 'SIGINT' });
  const output = (r.stdout || '') + (r.stderr || '');
  fs.writeFileSync(path.join(OUT, mode + '-' + label + '.log'), output);
  // The suite's summary line (the unit suite lists its failures after it).
  const m = [...output.matchAll(/(\d+) passed, (\d+) failed/g)].pop();
  const fails = output.split('\n').filter(l => /^\s*FAIL /.test(l));
  return { status: r.status, passed: m ? Number(m[1]) : null, failed: m ? Number(m[2]) : null,
    crashed: !m || r.signal !== null, firstFails: fails.slice(0, 4).map(l => l.slice(0, 200)),
    seconds: Math.round((Date.now() - started) / 1000) };
}

if (fs.existsSync(TEMP)) throw new Error('A mutation-copy folder exists: inspect the interrupted run before starting again.');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
let caught = 0;
let restored = true;
try {
  for (const d of ['site', 'tests']) fs.cpSync(path.join(ROOT, d), path.join(COPY, d), { recursive: true });
  for (const a of ARTIFACTS) fs.cpSync(path.join(ROOT, a), path.join(COPY, a), { recursive: true });
  if (allParts.includes('speed')) fs.cpSync(path.join(ROOT, SCALE_MASTER), path.join(COPY, SCALE_MASTER));
  // The fixtures (and test-tables/ in the copy) for the suites.
  cp.execFileSync(process.execPath, ['tests/synthetic/make_em_fixtures.js'], { cwd: COPY, stdio: 'ignore' });
  const base = runSuite('baseline', allParts);
  console.log('unmutated: ' + JSON.stringify(base));
  results.push(Object.assign({ baseline: mode }, base));
  if (base.status !== 0 || base.failed !== 0 || base.crashed) throw new Error('The unmutated suite must pass before mutations.');
  for (const m of list) {
    const p = path.join(COPY, m.file);
    const original = fs.readFileSync(p, 'utf8');
    const hash = sha(p);
    const count = original.split(m.from).length - 1;
    if (count !== 1) throw new Error(m.n + '. ' + m.name + ': expected exactly one match, found ' + count);
    fs.writeFileSync(p, original.replace(m.from, () => m.to));
    let r;
    try {
      r = runSuite(String(m.n), m.parts);
    } finally {
      fs.writeFileSync(p, original);
    }
    restored = restored && sha(p) === hash;
    const ok = r.status === 1 && r.failed > 0 && !r.crashed;
    if (ok) caught++;
    results.push(Object.assign({ n: m.n, name: m.name, file: m.file, caught: ok }, r));
    console.log(m.n + '. ' + (ok ? 'caught' : r.crashed ? 'STOPPED (not counted)' : 'MISSED') + ': ' + m.name + (m.parts.length ? ' [' + m.parts.join(' ') + ']' : '') + ' (' +
      r.passed + ' passed, ' + r.failed + ' failed, ' + r.seconds + ' s)');
    (r.firstFails || []).forEach(l => console.log('     ' + l));
  }
} finally {
  fs.rmSync(TEMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  fs.writeFileSync(path.join(OUT, mode + '-' + (picks.join('-') || 'all') + '.json'), JSON.stringify(results, null, 2) + '\n');
}
const unchanged = files.every(f => sha(path.join(ROOT, f)) === before[f]);
console.log(mode + ': ' + caught + ' of ' + list.length + ' mutants caught; copy restored: ' + restored
  + '; repository files unchanged: ' + unchanged + '; copy deleted: ' + !fs.existsSync(TEMP));
if (caught !== list.length || !restored || !unchanged) process.exitCode = 1;
