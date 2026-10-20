/* Shaded counties and states (choropleth) for CVI data: a deliberate addition, not in CVI. Pure: no page, no map.
 *
 * WA State's "Shaded counties" fills each Washington county by its animals (Total animals, or Animals per square
 * mile of the county's Census land area); National Flow's "Shaded states" fills each state by its animals moved with
 * Washington. One value per place: on WA State both directions ticked give the Combined total.
 *
 * Classes: Natural breaks (CVI's Fisher, the default) or Quantile, "Number of bins" of them (5 by default), as the
 * Infrastructure dashboard's Density view counts them: one class when every place has the same value, each class
 * labeled by the values it holds, "1" or "3 – 5". A value on a break falls in the class R's cut()
 * gives it (scaling.bincode). Compare's two maps and the GIF's frames share one set of classes, worked out from all
 * their values together, so a color means the same number on each map and in every frame.
 *
 * Colors ("ColorBrewer, palest dropped"): ColorBrewer 2.0's Blues (Inbound), Oranges (Outbound)
 * and GnBu (Combined) without their near-white classes, so the lightest places do not fade into the white lines.
 * Five classes: Blues and GnBu classes 3, 5, 7, 8, 9 of 9, Oranges classes 2 to 6 of 6 (every neighboring pair at
 * least 12.2 apart, CIE ΔE, worst of normal vision and three simulated deficiencies). Fewer classes take colors
 * evenly from the same five. More than five are not offered while shaded: six or seven from ColorBrewer's 9-class
 * versions put neighbors only 5.8 to 7.3 apart (under 10 reads as alike), the problem dropping the palest classes
 * avoids.
 *
 * "No movements": a Washington county with no animals in the view gets a light diagonal hatch (HATCH), told apart
 * from every class by its texture; on National Flow a state with none stays the plain land gray. */
(function (root) {
  'use strict';
  const S = () => root.CVIWA.scaling;

  // ── Colors ──────────────────────────────────────────────────────────────────────────────────────────────────
  // Light to dark.
  const FIVE = {
    Inbound: ['#c6dbef', '#6baed6', '#2171b5', '#08519c', '#08306b'],
    Outbound: ['#fdd0a2', '#fdae6b', '#fd8d3c', '#e6550d', '#a63603'],
    Combined: ['#ccebc5', '#7bccc4', '#2b8cbe', '#0868ac', '#084081']
  };
  const MAX_CLASSES = 5;
  // The light hatch for "No movements": a pale gray ground with darker gray lines at 45°.
  const HATCH = { ground: '#f4f4f4', line: '#bdbdbd', step: 5, width: 1.4 };
  // White lines between the shaded places, on the live maps and the PNGs.
  const LINE = '#ffffff';
  // The outline of a spotlit county (WA State) or a state picked in a chart (National Flow): white, wider than the
  // county lines (white for now; to revisit, docs/FUTURE_ENHANCEMENTS.md entry 7). Widths: live maps in pixels,
  // PNGs in ggplot2 line widths.
  const OUTLINE = { color: '#ffffff', live: 3, png: 2.0 };
  const FILL_OPACITY = '0.8';   // the default fill opacity, 80%
  const CREDIT = 'Shaded-map colors: ColorBrewer 2.0 (Cynthia A. Brewer, Penn State), Apache License 2.0';

  // Which ramp: WA State's directions ticked (an array) or National Flow's direction ("inbound", "outbound",
  // "combined"). Both directions, or Combined, take the Combined ramp.
  function rampKey(direction) {
    if (Array.isArray(direction)) {
      if (direction.length === 1 && direction[0] === 'Inbound') return 'Inbound';
      if (direction.length === 1 && direction[0] === 'Outbound') return 'Outbound';
      return 'Combined';
    }
    if (direction === 'inbound') return 'Inbound';
    if (direction === 'outbound') return 'Outbound';
    return 'Combined';
  }
  // n colors, light to dark, evenly from the five (n up to 5). One class takes the middle.
  function rampColors(key, n) {
    const k = Math.max(1, Math.min(MAX_CLASSES, Math.trunc(n)));
    const from = FIVE[key] || FIVE.Combined;
    if (k === 1) return [from[Math.floor(from.length / 2)]];
    const out = [];
    for (let i = 0; i < k; i++) out.push(from[Math.round((i * (from.length - 1)) / (k - 1))]);
    return out;
  }

  // ── Land areas ──────────────────────────────────────────────────────────────────────────────────────────────
  // Each Washington county's land area in square miles: the sum of its 2020 Census tracts' ALAND (geo/tracts-wa.js),
  // to one decimal. Kept here so the 3 MB tract file is not loaded for the areas; the unit tests check every row
  // against the tracts' sums.
  const LAND_SQ_MI = {
    'Adams': 1925.0, 'Asotin': 636.1, 'Benton': 1700.1, 'Chelan': 2921.2, 'Clallam': 1738.7, 'Clark': 628.5,
    'Columbia': 868.6, 'Cowlitz': 1141.2, 'Douglas': 1819.2, 'Ferry': 2203.2, 'Franklin': 1241.6, 'Garfield': 710.8,
    'Grant': 2679.6, 'Grays Harbor': 1901.5, 'Island': 208.5, 'Jefferson': 1803.7, 'King': 2115.2, 'Kitsap': 395.1,
    'Kittitas': 2297.3, 'Klickitat': 1871.6, 'Lewis': 2402.8, 'Lincoln': 2310.6, 'Mason': 959.5, 'Okanogan': 5266.2,
    'Pacific': 933.6, 'Pend Oreille': 1400.2, 'Pierce': 1668.0, 'San Juan': 173.9, 'Skagit': 1730.2,
    'Skamania': 1658.3, 'Snohomish': 2086.5, 'Spokane': 1764.2, 'Stevens': 2477.1, 'Thurston': 722.5,
    'Wahkiakum': 262.9, 'Walla Walla': 1270.0, 'Whatcom': 2107.9, 'Whitman': 2159.3, 'Yakima': 4294.5
  };
  const SQ_M_PER_SQ_MI = 2589988.110336;

  // ── Measures ────────────────────────────────────────────────────────────────────────────────────────────────
  const MEASURES = {
    total: { label: 'Total animals', title: 'TOTAL ANIMALS', unit: 'animals' },
    per_sq_mi: { label: 'Animals per square mile', title: 'ANIMALS PER SQ MI', unit: 'animals per sq mi' }
  };
  const good = v => v !== null && v !== undefined && Number.isFinite(v);
  // A value as the legend and the tooltips write it: whole animals with thousands marks; per square mile whole
  // numbers from 100 up, one decimal from 1 up, two significant figures below 1, so a positive value never reads "0".
  // extra: more digits (the legend adds them until neighboring classes read differently).
  function format(v, measure, extra) {
    if (!good(v)) return '';
    const x = extra || 0;
    // Thousands marks on a number already written with its decimals.
    const marks = t => t.replace(/^(\d+)/, i => i.replace(/\B(?=(\d{3})+$)/g, ','));
    if (measure !== 'per_sq_mi') return !x || Number.isInteger(v) ? S().comma(v) : marks(v.toFixed(x));
    if (v >= 100) return x ? marks(v.toFixed(x)) : S().comma(v);
    if (v >= 1) return v.toFixed(1 + x);
    if (v === 0) return '0';
    return String(Number(v.toPrecision(2 + x)));
  }
  // A row's county as one of the 39 names, matched without regard to case or spaces around it (a file
  // writing "YAKIMA" was once hatched "No movements" while its circle showed), or null for a name the map does not have
  // (e.g. "N/A").
  const COUNTY_KEYS = new Map(Object.keys(LAND_SQ_MI).map(n => [n.toLowerCase(), n]));
  function countyName(name) {
    if (name === null || name === undefined) return null;
    return COUNTY_KEYS.get(String(name).trim().replace(/\s+/g, ' ').toLowerCase()) || null;
  }
  // Each county's value (a Map of county name to number) from WA State's rows built with one value per county
  // (aggregate.build with mode "total", or one direction), keyed by countyName(); a name that is not one of the 39 is
  // kept as written (never shaded). Counties without a land area are left out of per square mile.
  function countyValues(rows, measure) {
    const out = new Map();
    for (const r of rows) {
      if (r.county === null || r.county === undefined || !good(r.total_animals)) continue;
      const key = countyName(r.county) || r.county;
      out.set(key, (out.get(key) || 0) + r.total_animals);
    }
    if (measure !== 'per_sq_mi') return out;
    const per = new Map();
    for (const [county, total] of out) {
      if (LAND_SQ_MI[county]) per.set(county, total / LAND_SQ_MI[county]);
    }
    return per;
  }
  // Each county's CVI records in the rows the map draws (an Inbound row counts at its destination county, the others
  // at their origin, as the circles), keyed by countyName(): the hover's "n CVI records, no animal counts" for a
  // county hatched "No movements" whose rows have no animal counts.
  function countyRecords(rawRows) {
    const out = new Map();
    for (const r of rawRows || []) {
      const key = countyName(r.Movement === 'Inbound' ? r['Dest.County'] : r['Origin.County']);
      if (key) out.set(key, (out.get(key) || 0) + 1);
    }
    return out;
  }
  // The animals the shaded map cannot place: rows whose county is not one of the 39. Returns
  // { animals, names } (names by animals, largest first, ties by name), or null when there are none.
  function unplaced(rows) {
    const by = new Map();
    for (const r of rows || []) {
      if (r.county === null || r.county === undefined || !good(r.total_animals) || r.total_animals <= 0) continue;
      if (countyName(r.county)) continue;
      const n = String(r.county).trim() || '(blank)';
      by.set(n, (by.get(n) || 0) + r.total_animals);
    }
    if (!by.size) return null;
    const names = [...by].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(x => x[0]);
    return { animals: [...by.values()].reduce((t, v) => t + v, 0), names };
  }
  // The legend's two lines for them: "Not on the map: 1,234 animals" and "in counties named N/A, Yakama" (at most
  // three names, each cut to 24 characters, then "and n more"), or null.
  function unplacedLines(u) {
    if (!u) return null;
    const cut = n => (n.length > 24 ? n.slice(0, 23) + '\u2026' : n);
    const shown = u.names.slice(0, 3).map(cut).join(', ') + (u.names.length > 3 ? ' and ' + (u.names.length - 3) +
      ' more' : '');
    return ['Not on the map: ' + S().comma(u.animals) + ' animals', 'in counties named ' + shown];
  }

  // Each state's animals moved with Washington (a Map of state code to number) from National Flow's lines
  // (flow.lines: a row per state and species group), and each state's species totals for the hover.
  function stateValues(lines) {
    const values = new Map();
    const species = new Map();
    for (const a of lines || []) {
      if (!a.state || String(a.state).toUpperCase() === 'WA') continue;
      const x = good(a.total_animals) ? a.total_animals : 0;
      values.set(a.state, (values.get(a.state) || 0) + x);
      if (!species.has(a.state)) species.set(a.state, []);
      species.get(a.state).push({ group: a.species_group, animals: x });
    }
    return { values, species };
  }

  // ── Classes ─────────────────────────────────────────────────────────────────────────────────────────────────
  const uniq = a => a.filter((v, i) => a.indexOf(v) === i);
  // The classes of a set of values (the basis: every value the map, both Compare maps or every GIF frame shows).
  // method: "natural" or "quantile". Values of zero or less, or missing, take no class ("No movements").
  // Returns { method, nBins, breaks, n, single, classOf(v) (1..n or null), labels, counts, colors } with labels per
  // class from the values it holds (an empty class keeps its interval) and colors from the ramp key's.
  function classify(basis, method, nBins, key, measure) {
    const pos = basis.filter(v => good(v) && v > 0);
    const n0 = Math.max(2, Math.min(MAX_CLASSES, Math.trunc(nBins || 5)));
    const base = { method, nBins: n0, measure: measure || 'total' };
    if (!pos.length) return Object.assign(base, { breaks: [], n: 0, single: false, classOf: () => null, labels: [],
      counts: [], colors: [] });
    const lo = Math.min(...pos);
    const hi = Math.max(...pos);
    let breaks;
    let single = false;
    if (lo === hi) {
      single = true;   // one class
      breaks = [lo, hi];
    } else {
      const quantiles = () => uniq(S().quantile7(pos, S().seqProbs(n0 + 1)));
      if (method === 'quantile') {
        breaks = quantiles();
      } else {
        try {
          breaks = S().fisherBreaks(pos, Math.min(n0, uniq(pos).length));
        } catch (e) {
          breaks = null;
        }
        if (!breaks || uniq(breaks).length < 2) breaks = quantiles();
      }
      breaks = uniq(breaks);
      // The ends at the lowest and highest value (Fisher pads them by half a gap when every value is its own class).
      breaks[0] = lo;
      breaks[breaks.length - 1] = hi;
      breaks = uniq(breaks);
    }
    const n = single ? 1 : breaks.length - 1;
    // A value's class number (1 to n), or null for a missing, zero or negative value.
    const classOf = v => {
      if (!good(v) || v <= 0) return null;
      if (single) return 1;
      if (v <= breaks[0]) return 1;
      if (v >= breaks[n]) return n;
      return S().bincode([v], breaks)[0];
    };
    const held = Array.from({ length: n }, () => []);
    for (const v of pos) held[classOf(v) - 1].push(v);
    const ends = held.map((h, k) => [h.length ? Math.min(...h) : breaks[k], h.length ? Math.max(...h) : breaks[k + 1]]);
    // More digits only for the labels that would read the same: a class whose two ends read alike, and the two
    // classes on either side of an end and next start that read alike. Each label takes the digits its own clashes
    // need, at most two more; the other labels keep their normal form. Read as numbers, so labels that differ only in
    // their decimals at a format step ("100.0" then "100", "1" then "1.0") also count as reading the same.
    const read = (v, x) => Number(format(v, base.measure, x).replace(/,/g, ''));
    const need = clash => { let x = 0; while (x < 2 && clash(x)) x++; return x; };
    const own = ends.map(([a, b]) => (a === b ? 0 : need(x => read(a, x) >= read(b, x))));
    const edge = ends.map(([, b], k) => (k + 1 < ends.length ? need(x => read(b, x) >= read(ends[k + 1][0], x)) : 0));
    const extra = ends.map((e, k) => Math.max(own[k], edge[k], k ? edge[k - 1] : 0));
    const labels = ends.map(([a, b], k) => (a === b ? format(a, base.measure, extra[k])
      : format(a, base.measure, extra[k]) + ' – ' + format(b, base.measure, extra[k])));
    return Object.assign(base, { breaks, n, single, classOf, labels, counts: held.map(h => h.length),
      colors: rampColors(key, n) });
  }
  // One set of classes for several WA State maps at once (Compare's two maps, the GIF's frames): every map's county
  // values together (rowsList: each map's rows as aggregate.build gives them). Only Washington's 39 counties count.
  function countyClasses(rowsList, measure, method, nBins, direction) {
    const basis = [];
    for (const rows of rowsList) {
      for (const [county, v] of countyValues(rows, measure)) {
        if (LAND_SQ_MI[county]) basis.push(v);
      }
    }
    return classify(basis, method, nBins, rampKey(direction), measure);
  }
  // The same for National Flow's states (linesList: each map's or frame's flow.lines).
  function stateClasses(linesList, method, nBins, direction) {
    const basis = [];
    for (const lines of linesList) basis.push(...stateValues(lines).values.values());
    return classify(basis, method, nBins, rampKey(direction), 'total');
  }
  // The places to shade: names (the map's features), values (a Map), the classes. Each gets
  // { name, value, cls, color, none } (none: no movements; color null then).
  function shade(names, values, cls) {
    return names.map(name => {
      const value = values.has(name) ? values.get(name) : null;
      const c = cls.classOf(value);
      return { name, value, cls: c, color: c ? cls.colors[c - 1] : null, none: !c };
    });
  }
  // The legend: the title, the measure's line and one row per class, then "No movements" (WA counties: the hatch;
  // National Flow: plain land, listed only when a state has none). dirLabel: "Inbound", "Outbound" or "Combined".
  function legend(cls, measure, dirLabel, withNone) {
    const m = MEASURES[measure] || MEASURES.total;
    const rows = cls.labels.map((label, k) => ({ color: cls.colors[k], label, cls: k + 1 }));
    return { title: m.title, subtitle: dirLabel, rows, none: withNone ? 'No movements' : null,
      sizing: (cls.method === 'quantile' ? 'Quantile' : 'Natural breaks') + ', ' + cls.n +
        (cls.n === 1 ? ' class' : ' classes') };
  }

  // ── Pictures of the hatch ───────────────────────────────────────────────────────────────────────────────────
  // SVG: a pattern to put in <defs> (id given), its fill "url(#id)".
  function hatchPattern(id, scale) {
    const k = scale || 1;
    const s = HATCH.step * k;
    return '<pattern id="' + id + '" width="' + s + '" height="' + s + '" patternUnits="userSpaceOnUse" ' +
      'patternTransform="rotate(45)"><rect width="' + s + '" height="' + s + '" fill="' + HATCH.ground + '"/>' +
      '<line x1="0" y1="0" x2="0" y2="' + s + '" stroke="' + HATCH.line + '" stroke-width="' + (HATCH.width * k) +
      '"/></pattern>';
  }
  // CSS: the same hatch as a background (the live legend's swatch).
  const hatchCss = () => 'repeating-linear-gradient(45deg, ' + HATCH.line + ' 0 1px, ' + HATCH.ground + ' 1px ' +
    (HATCH.step - 1) + 'px)';

  root.CVIWA = root.CVIWA || {};
  root.CVIWA.choropleth = {
    FIVE, MAX_CLASSES, HATCH, LINE, OUTLINE, FILL_OPACITY, CREDIT, LAND_SQ_MI, SQ_M_PER_SQ_MI, MEASURES,
    rampKey, rampColors, format, countyName, countyValues, countyRecords, unplaced, unplacedLines, stateValues,
    classify, countyClasses, stateClasses, shade, legend,
    hatchPattern, hatchCss
  };
})(typeof window !== 'undefined' ? window : globalThis);
