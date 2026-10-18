/* Within-state movement: which file rows count as movement between Washington counties, and
 * the numbers each of the three display options needs. Pure functions; nothing here draws.
 *
 * Counting rules:
 * - A row counts when both states read exactly "WA" (as CVI's former line map and the National Flow map compare
 *   them) and it has a direction on the WA State map (Inbound or Outbound after loading; a row with no Movement is
 *   on no map). It follows the WA State map's Species Group, Refine by species, year and quarter filters; the
 *   Direction checkboxes do not split it, because a within-state movement is both a departure and an arrival.
 * - Each file row counts once: the loader's Inbound and Outbound copies of an "Intrastate" row are merged by their
 *   file row (master.js SOURCE_ROW). An Import row and an Export row of one movement are two file rows
 *   and count twice, by design.
 * - Grain: county to county, at the master's county points. A row with no county at either end (missing, blank,
 *   or CVI's out-of-state placeholder "N/A" or "NA") or without both county points is left out and counted, so
 *   the page can say how many rows are not shown.
 * - Movement within one county (the same county at both ends) is kept, unlike CVI's former line map
 *   (map_helpers.R build_intrastate_line_data(), which leaves it out).
 * - A county's point is the one given in the counted row with the latest year, the earliest file row first and
 *   the origin before the destination within a row (the WA State map takes the latest year's point as well).
 *   CVI's former line map groups by the points themselves, so a county whose point changed between years got
 *   two lines there.
 * - Animals: a missing count adds 0 (CVI's na.rm); records: each counted row once.
 *
 * The options: A draws lines(), the top pairs between counties, and rings() for movement within a
 * county; B shows grid(), origin counties down and destination counties across; C shades each county by one of the
 * three numbers of countyTotals(). touching() keeps the pairs with an end in the given counties (the spotlight). */
(function (root) {
  'use strict';
  const S = () => root.CVIWA.scaling;
  const cmpC = (a, b) => (a < b ? -1 : a > b ? 1 : 0);   // C-locale order, as dplyr's group order

  const LINE_CAP = 25;            // lines drawn by default in option A (the busiest pairs between counties)
  const LINE_WIDTH = [0.5, 6];    // CVI's former line map: .compute_radius(min_r = 0.5, max_r = 6)
  const RING_RADIUS = [3, 14];    // within-county rings (option A, the one the page uses)
  const GRID_SIZE = 15;           // counties in each direction of the grid (option B), the busiest first

  // ── Rows ─────────────────────────────────────────────────────────────────────────────────────────────────
  const isWa = s => s === 'WA';
  // A county name without surrounding spaces (as the charts' labels), or null when there is none (missing, blank,
  // or the out-of-state placeholder). "King " and "King" are one county, on the map and in the charts.
  function countyOf(v) {
    if (v === null || v === undefined) return null;
    const t = String(v).trim();
    if (t === '' || t.toUpperCase() === 'N/A' || t.toUpperCase() === 'NA') return null;
    return t;
  }
  // A row's county at one end ('Origin' or 'Dest'), by countyOf().
  const nameOf = (r, end) => countyOf(r[end + '.County']);
  const hasPoint = (r, end) => Number.isFinite(r[end + '.County.Lat']) && Number.isFinite(r[end + '.County.Long']);

  // loaded: master.load()'s result. filters: { species, years, quarters, rawSpecies } as on the WA State map, and keep
  // (optional: the chart filters of crossfilter.js).
  // Returns the counted rows, and how many within-state rows were left out and why.
  function rows(loaded, filters) {
    const sp = new Set(filters.species);
    const yr = new Set(filters.years);
    const qt = new Set(filters.quarters);
    const refine = filters.rawSpecies && filters.rawSpecies.length && loaded.hasSpecies
      ? new Set(filters.rawSpecies) : null;
    const SRC = root.CVIWA.master.SOURCE_ROW;
    const seen = new Set();
    const counted = [];
    const leftOut = { noCounty: 0, noPoint: 0 };
    for (const r of loaded.rows) {
      if (r.Movement !== 'Inbound' && r.Movement !== 'Outbound') continue;
      if (!isWa(r['Origin.State']) || !isWa(r['Dest.State'])) continue;
      if (!sp.has(r['Species.Group']) || !yr.has(r['Reporting.Year']) || !qt.has(r['Reporting.Quarter'])) continue;
      if (refine && !refine.has(r.Species)) continue;
      if (filters.keep && !filters.keep(r)) continue;
      const fileRow = r[SRC];
      if (fileRow !== undefined) {
        if (seen.has(fileRow)) continue;   // the second loader copy of an Intrastate row
        seen.add(fileRow);
      }
      if (countyOf(r['Origin.County']) === null || countyOf(r['Dest.County']) === null) {
        leftOut.noCounty++;
      } else if (!hasPoint(r, 'Origin') || !hasPoint(r, 'Dest')) {
        leftOut.noPoint++;
      } else {
        counted.push(r);
      }
    }
    return { counted, leftOut };
  }

  // The sentence under the view when rows are left out, or null.
  function leftOutText(leftOut) {
    const n = leftOut.noCounty + leftOut.noPoint;
    if (!n) return null;
    const parts = [];
    const has = k => (k === 1 ? 'has' : 'have');
    if (leftOut.noCounty) parts.push(leftOut.noCounty + ' ' + has(leftOut.noCounty) + ' no county');
    if (leftOut.noPoint) parts.push(leftOut.noPoint + ' ' + has(leftOut.noPoint) + ' no county point');
    return n + ' within-state ' + (n === 1 ? 'row is' : 'rows are') + ' not shown: ' + parts.join(', ') + '.';
  }

  // ── Points ───────────────────────────────────────────────────────────────────────────────────────────────
  // Each county's point: latest year first, then the earliest file row, then the origin before the destination.
  function points(counted) {
    const SRC = root.CVIWA.master.SOURCE_ROW;
    const best = new Map();
    counted.forEach((r, i) => {
      const year = r['Reporting.Year'];
      const fileRow = r[SRC] === undefined ? i : r[SRC];
      [['Origin', 0], ['Dest', 1]].forEach(([end, side]) => {
        const county = nameOf(r, end);
        const b = best.get(county);
        const better = !b || year > b.year || (year === b.year
          && (fileRow < b.fileRow || (fileRow === b.fileRow && side < b.side)));
        if (better) {
          best.set(county, { year, fileRow, side, lat: r[end + '.County.Lat'], lon: r[end + '.County.Long'] });
        }
      });
    });
    const out = {};
    [...best.keys()].sort(cmpC).forEach(c => {
      out[c] = { lat: best.get(c).lat, lon: best.get(c).lon };
    });
    return out;
  }

  // ── Pairs ────────────────────────────────────────────────────────────────────────────────────────────────
  // One entry per origin and destination county (and species group when bySpecies), with its animals, records and
  // unique CVIs (distinct nonblank CVI numbers, as the Unique CVIs box counts them), the most animals first; ties by
  // origin, destination and group in C-locale order.
  function pairs(counted, opts) {
    const bySpecies = !!(opts && opts.bySpecies);
    const groups = new Map();
    for (const r of counted) {
      const origin = nameOf(r, 'Origin');
      const dest = nameOf(r, 'Dest');
      const group = bySpecies ? r['Species.Group'] : null;
      const key = origin + '\u0000' + dest + '\u0000' + (group === null ? '' : group);
      if (!groups.has(key)) {
        const p = { origin, dest, animals: 0, records: 0, cvis: 0, cviSet: new Set() };
        if (bySpecies) p.species = group;
        groups.set(key, p);
      }
      const p = groups.get(key);
      const a = r['Total.Animals'];
      if (a !== null && !Number.isNaN(a)) p.animals += a;
      p.records++;
      const cvi = r.CVI === null || r.CVI === undefined ? '' : String(r.CVI).trim();
      if (cvi) p.cviSet.add(cvi);
    }
    const out = [...groups.values()];
    out.forEach(p => {
      p.cvis = p.cviSet.size;
      delete p.cviSet;
    });
    return out.sort((a, b) => b.animals - a.animals || cmpC(a.origin, b.origin)
      || cmpC(a.dest, b.dest) || cmpC(a.species || '', b.species || ''));
  }
  const within = list => list.filter(p => p.origin === p.dest);
  const between = list => list.filter(p => p.origin !== p.dest);

  // The pairs with an end in one of the counties (the spotlight).
  function touching(list, counties) {
    const set = new Set(counties);
    return list.filter(p => set.has(p.origin) || set.has(p.dest));
  }

  // ── Option A: lines and rings ────────────────────────────────────────────────────────────────────────────
  // The three original display options (lines(), rings(), grid(), summary()): the page draws mapView() instead;
  // they are kept because the unit suite checks them against the R reference.
  // The busiest pairs between two counties (cap: LINE_CAP), each with a width from the map's scaling method over
  // the lines drawn, as CVI's former line map (0.5 to 6 pixels).
  function lines(list, opts) {
    const o = Object.assign({ cap: LINE_CAP, scaling: 'log', nBins: 5 }, opts);
    const drawn = between(list).slice(0, o.cap);
    const widths = S().computeRadius(drawn.map(p => p.animals), o.scaling, LINE_WIDTH[0], LINE_WIDTH[1], o.nBins);
    return drawn.map((p, i) => Object.assign({}, p, { width_px: widths[i] }));
  }
  // Movement within a county: a ring at the county's point, its radius from the scaling method over the rings.
  function rings(list, opts) {
    const o = Object.assign({ scaling: 'log', nBins: 5 }, opts);
    const inside = within(list);
    const radii = S().computeRadius(inside.map(p => p.animals), o.scaling, RING_RADIUS[0], RING_RADIUS[1], o.nBins);
    return inside.map((p, i) => ({ county: p.origin, animals: p.animals, records: p.records, radius_px: radii[i] }));
  }

  // ── Option C: county numbers ─────────────────────────────────────────────────────────────────────────────
  // Per county with movement: animals (and records) moved within it, sent to other WA counties and received from
  // them; counties in C-locale order.
  function countyTotals(list) {
    const totals = new Map();
    const entry = c => {
      if (!totals.has(c)) {
        totals.set(c, { county: c, within: 0, sent: 0, received: 0,
          withinRecords: 0, sentRecords: 0, receivedRecords: 0 });
      }
      return totals.get(c);
    };
    for (const p of list) {
      if (p.origin === p.dest) {
        entry(p.origin).within += p.animals;
        entry(p.origin).withinRecords += p.records;
      } else {
        entry(p.origin).sent += p.animals;
        entry(p.origin).sentRecords += p.records;
        entry(p.dest).received += p.animals;
        entry(p.dest).receivedRecords += p.records;
      }
    }
    return [...totals.values()].sort((a, b) => cmpC(a.county, b.county));
  }

  // ── Option B: origin-by-destination grid ─────────────────────────────────────────────────────────────────
  // The size busiest counties (animals within, sent and received together; ties by name), the same counties down
  // and across, and a cell for each pair between them that has rows.
  function grid(list, opts) {
    const o = Object.assign({ size: GRID_SIZE }, opts);
    const busy = countyTotals(list)
      .map(t => ({ county: t.county, animals: t.within + t.sent + t.received }))
      .sort((a, b) => b.animals - a.animals || cmpC(a.county, b.county))
      .slice(0, o.size)
      .map(t => t.county);
    const set = new Set(busy);
    const cells = list.filter(p => set.has(p.origin) && set.has(p.dest))
      .map(p => ({ origin: p.origin, dest: p.dest, animals: p.animals, records: p.records }));
    return { counties: busy, cells };
  }

  // ── The movement view on the WA State map (option A) ─────────────────────────────────────────────────────
  const TOP_CHOICES = [5, 10, 25, 50];   // the "Lines shown" picker
  const SHOWN_DEFAULT = 10;              // "Lines shown" when the page opens and after Reset All
  const LINE_SHOWN = 0.9, LINE_FADED = 0.12, RING_SHOWN = 0.95, RING_FADED = 0.15;
  // Lines styled by rank: ranks 1 to 5, 6 to 10, 11 to 25, and 26 and beyond
  // (to 50, plus pairs drawn for a spotlight, a picked corridor or a badge), each group thinner and lighter than the
  // one before. One teal hue getting lighter: Dark Teal and Blue Green from the WSDA guide for the top 10, then two
  // lighter teals (readability over the brand palette). CVI's former line map drew 0.5 to 6 px
  // by animals.
  const TIER_LAST_RANK = [5, 10, 25];
  const TIER_WIDTH = [7, 5, 3, 2];
  const TIER_COLORS = ['#245566', '#0094aa', '#4fb0bf', '#8cc5cf'];
  // A rank's group: 0 for ranks 1 to 5, ... 3 for 26 and beyond.
  function tierOf(rank) {
    const t = TIER_LAST_RANK.findIndex(last => rank <= last);
    return t < 0 ? TIER_LAST_RANK.length : t;
  }
  // The filled arrowhead at the destination end, in pixels: its length grows with the line's width, and its tip
  // stops ARROW_GAP short of the county point. The curve is cut back by that room in map units, measured at the
  // opening view (about zoom 6.3, where one degree of latitude is about 164 pixels), so the tip moves a little closer
  // to the county point at lower zooms and further away when zooming in.
  const ARROW_GAP = 10;
  const PX_PER_DEGREE = 164;
  const arrowLength = w => 10 + 1.6 * w;
  const pairKey = (origin, dest) => origin + '\u0000' + dest;
  // The pairs between counties in rank order for "Show charts by:": animals, CVI records or unique
  // CVIs, the most first, ties in the order of the corridor chart's labels (its bars are sorted by value, ties in
  // R's sort order of "Origin  →  Destination"), so the map's top pairs are the chart's first bars. Animals too
  // (pairs() breaks ties in C-locale order, which differs when names differ by letter case).
  const MEASURE_FIELD = { animals: 'animals', records: 'records', cvis: 'cvis' };
  function ranked(list, measure) {
    const f = MEASURE_FIELD[measure] || 'animals';
    const label = p => p.origin + '  \u2192  ' + p.dest;
    return between(list).slice().sort((a, b) => b[f] - a[f] || label(a).localeCompare(label(b), 'en'));
  }
  const exact = x => root.CVIWA.charts.exact(x);
  const plural = (n, one, many) => exact(n) + ' ' + (n === 1 ? one : many);

  // A curved path from a to b ([lon, lat]), bending to the right of travel so that A to B and B to A do not overlap.
  // The path is cut back from b by `room` degrees (measured along it, at most 40% of its length), where the
  // arrowhead's base sits: head.at is that point and head.bearing the direction of travel there, in degrees clockwise
  // from north. middle is the curve's middle (where a badge sits). Longitudes are scaled by cos(47°), so the bend and
  // the bearing look the same in every direction at Washington's latitude.
  function curve(a, b, room) {
    const k = Math.cos(47 * Math.PI / 180);
    const P = [a[0] * k, a[1]];
    const Q = [b[0] * k, b[1]];
    const dx = Q[0] - P[0];
    const dy = Q[1] - P[1];
    const C = [(P[0] + Q[0]) / 2 + dy * 0.2, (P[1] + Q[1]) / 2 - dx * 0.2];
    const at = t => [(1 - t) * (1 - t) * P[0] + 2 * (1 - t) * t * C[0] + t * t * Q[0],
      (1 - t) * (1 - t) * P[1] + 2 * (1 - t) * t * C[1] + t * t * Q[1]];
    const pts = [];
    for (let i = 0; i <= 48; i++) pts.push(at(i / 48));
    const step = i => Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += step(i);
    // Walk back from b until the room is used up.
    let left = Math.min(room || 0, 0.4 * length);
    let end = pts.length - 1;
    while (end > 1 && left > step(end)) {
      left -= step(end);
      end--;
    }
    const from = pts[end - 1];
    const to = pts[end];
    const f = left / (step(end) || 1);
    const base = [to[0] + (from[0] - to[0]) * f, to[1] + (from[1] - to[1]) * f];
    const kept = pts.slice(0, end).concat([base]);
    const bearing = Math.atan2(to[0] - from[0], to[1] - from[1]) * 180 / Math.PI;
    const back = q => [q[0] / k, q[1]];
    return { line: kept.map(back), head: { at: back(base), bearing }, middle: back(at(0.5)) };
  }

  // What the movement view draws. list: pairs() of the counted rows; pts: points(); opts: { cap (the "Lines shown"
  // picker), measure ("Show charts by:": animals, records or cvis), scaling and nBins (the rings), spotlight
  // (counties), picked (pair keys: the corridor chart's filter), badges (up to three pair keys: the corridor chart's
  // first bars), bySpecies (pairs() by species group, for the hover) }.
  // Lines: the cap top-ranked pairs between two counties (ranked by the measure), plus every pair touching a
  // spotlighted county, a picked pair and a badge's pair, each styled by its rank's group (width, color) with a
  // filled arrowhead at the destination end. In full color: the picked pairs, else the pairs touching the spotlight,
  // else all; the others faded. Rings: movement within a county, sized by the scaling method, in full color unless a
  // pair is picked or the county is outside a spotlight. Lines are listed in drawing order: faded first, then the
  // lowest rank first (the top five on top).
  // A true spotlight (the other pairs hidden): with a spotlight and no picked pair,
  // only the pairs touching the spotlight are drawn (the cap does not add others) and only the spotlit counties'
  // rings; with a picked pair the rule above stands.
  // A rank group's name in the legends, in plain words ("Ranks" reads as jargon):
  // "1st–5th busiest", or "15th busiest" for one line.
  function ordinal(n) {
    const tens = n % 100;
    const end = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th';
    return n + end;
  }
  const busiestLabel = (first, last) => (first === last ? ordinal(first) : ordinal(first) + '\u2013' + ordinal(last)) +
    ' busiest';

  // The movement view's lines, rings and counties, by the rules written above ordinal().
  function mapView(list, pts, opts) {
    const o = Object.assign({ cap: SHOWN_DEFAULT, measure: 'animals', scaling: 'log', nBins: 5, spotlight: [], picked: [],
      badges: [], bySpecies: [] }, opts);
    const spot = new Set(o.spotlight.map(countyOf).filter(v => v !== null));
    const picked = new Set(o.picked);
    const touches = p => spot.has(p.origin) || spot.has(p.dest);
    const all = ranked(list, o.measure);
    const field = MEASURE_FIELD[o.measure] || 'animals';
    const trueSpot = spot.size > 0 && !picked.size;
    const drawn = all.map((p, i) => ({ p, rank: i + 1 })).filter(({ p, rank }) => (trueSpot ? touches(p)
      : rank <= o.cap || touches(p) || picked.has(pairKey(p.origin, p.dest))
        || o.badges.indexOf(pairKey(p.origin, p.dest)) >= 0));
    const topSpecies = new Map();
    o.bySpecies.forEach(p => {
      const k = pairKey(p.origin, p.dest);
      if (!topSpecies.has(k)) topSpecies.set(k, p.species);   // bySpecies lists the most animals first
    });
    const lines = drawn.map(({ p, rank }) => {
      const k = pairKey(p.origin, p.dest);
      const on = picked.size ? picked.has(k) : spot.size ? touches(p) : true;
      const badge = o.badges.indexOf(k);
      const tier = tierOf(rank);
      const width = TIER_WIDTH[tier];
      const room = (ARROW_GAP + arrowLength(width)) / PX_PER_DEGREE;
      const c = curve([pts[p.origin].lon, pts[p.origin].lat], [pts[p.dest].lon, pts[p.dest].lat], room);
      const tip = [p.origin + ' \u2192 ' + p.dest, plural(p.animals, 'animal', 'animals') + ' in '
        + plural(p.records, 'CVI record', 'CVI records')];
      if (o.measure === 'cvis') tip.push(plural(p.cvis, 'unique CVI', 'unique CVIs'));
      if (topSpecies.has(k)) tip.push('Top species: ' + topSpecies.get(k));
      return { key: k, origin: p.origin, dest: p.dest, animals: p.animals, records: p.records, cvis: p.cvis,
        value: p[field], rank, tier, width_px: width, color: TIER_COLORS[tier], arrow_px: arrowLength(width), on,
        opacity: on ? LINE_SHOWN : LINE_FADED, badge: badge >= 0 ? badge + 1 : null, line: c.line, head: c.head,
        middle: c.middle, tip };
    });
    lines.sort((a, b) => (a.on === b.on ? 0 : a.on ? 1 : -1) || b.rank - a.rank);
    const rings = S().computeRadius(within(list).map(p => p.animals), o.scaling, RING_RADIUS[0], RING_RADIUS[1], o.nBins);
    const ringsOut = within(list).map((p, i) => {
      const on = !picked.size && (!spot.size || spot.has(p.origin));
      return { county: p.origin, animals: p.animals, records: p.records, radius_px: rings[i], on,
        opacity: on ? RING_SHOWN : RING_FADED, lon: pts[p.origin].lon, lat: pts[p.origin].lat };
    });
    // Each county with movement, at its point, with option C's three numbers for its hover.
    const counties = countyTotals(list).map(t => ({ county: t.county, lon: pts[t.county].lon, lat: pts[t.county].lat,
      tip: [t.county + ' County', 'Moved within the county: ' + plural(t.within, 'animal', 'animals'),
        'Sent to other WA counties: ' + plural(t.sent, 'animal', 'animals'),
        'Received from other WA counties: ' + plural(t.received, 'animal', 'animals')] }));
    return { lines, rings: trueSpot ? ringsOut.filter(r => r.on) : ringsOut, counties, pairsBetween: all.length,
      cap: o.cap, measure: o.measure,
      shown: lines.filter(l => l.on).length, extra: drawn.length - Math.min(o.cap, all.length) };
  }

  // The rows of the movement view's corridor chart: movement between two different counties (charts.js corridors
  // draws them; within-county movement is shown by the rings).
  const betweenRows = counted => counted.filter(r => nameOf(r, 'Origin') !== nameOf(r, 'Dest'));

  // Everything the three options need for one set of filters.
  function summary(loaded, filters, opts) {
    const r = rows(loaded, filters);
    const list = pairs(r.counted);
    return {
      records: r.counted.length,
      leftOut: r.leftOut,
      leftOutText: leftOutText(r.leftOut),
      points: points(r.counted),
      pairs: list,
      lines: lines(list, opts),
      rings: rings(list, opts),
      counties: countyTotals(list),
      grid: grid(list, opts)
    };
  }

  root.CVIWA = root.CVIWA || {};
  root.CVIWA.movement = { rows, leftOutText, points, pairs, within, between, touching, lines, rings, countyTotals,
    grid, summary, countyOf, curve, mapView, ranked, tierOf, ordinal, busiestLabel, betweenRows, pairKey, arrowLength, LINE_CAP,
    LINE_WIDTH, RING_RADIUS, GRID_SIZE, TOP_CHOICES, SHOWN_DEFAULT, TIER_LAST_RANK, TIER_WIDTH, TIER_COLORS,
    ARROW_GAP, PX_PER_DEGREE, LINE_SHOWN, LINE_FADED, RING_SHOWN, RING_FADED };
})(typeof window !== 'undefined' ? window : globalThis);
