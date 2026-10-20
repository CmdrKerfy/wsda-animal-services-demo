/* WA State map summaries: the four value boxes above the map and the summary strip below it.
 * Port of CVI's WA map module (current_map_data, current_map_summary, value_boxes, filter_summary_strip,
 * .period_label) with two documented deviations: only the loader's two copies of one intrastate row merge for
 * "Total animals", and "Unique CVIs" is grayed with a reason when the table has no CVI column. Pure functions; the
 * page draws what they return. */
(function (root) {
  'use strict';
  const S = () => root.CVIWA.scaling;
  const collate = (a, b) => a.localeCompare(b, 'en');
  const nonblank = s => s !== null && s !== undefined && String(s).trim().length > 0;

  // The rows the WA State map draws for these filters (CVI's current_map_data, county branch): species group, year,
  // quarter and direction, then "Refine by species" when the table has a Species column, then f.keep (optional: the
  // chart filters of crossfilter.js). Null when nothing matches.
  function mapRows(loaded, f) {
    const sp = new Set(f.species), yr = new Set(f.years), qt = new Set(f.quarters), dir = new Set(f.direction);
    let sub = loaded.rows.filter(r => sp.has(r['Species.Group']) && yr.has(r['Reporting.Year'])
      && qt.has(r['Reporting.Quarter']) && dir.has(r.Movement));
    if (!sub.length) return null;
    if (f.rawSpecies && f.rawSpecies.length && loaded.hasSpecies) {
      const raw = new Set(f.rawSpecies);
      sub = sub.filter(r => raw.has(r.Species));
      if (!sub.length) return null;
    }
    if (f.keep) {
      sub = sub.filter(f.keep);
      if (!sub.length) return null;
    }
    return sub;
  }

  // CVI's intrastate test (dedupe_intrastate_volume): both states read "WA" after trimming, in any case.
  const isWa = s => s !== null && s !== undefined && String(s).trim().toUpperCase() === 'WA';
  // Merge only loader copies: the loader's Inbound and Outbound copies of one intrastate row
  // carry the same file row number (master.js SOURCE_ROW); only the first of them present counts towards a total
  // across directions, and only when CVI's own test calls the row WA-to-WA. CVI also merges any rows identical apart
  // from Movement, so two identical WA-to-WA rows, or an Import and an Export of one, count once there and twice here.
  function dedupeVolume(sub) {
    const SRC = root.CVIWA.master.SOURCE_ROW, seen = new Set();
    return sub.filter(r => {
      if (!isWa(r['Origin.State']) || !isWa(r['Dest.State'])) return true;
      const t = r[SRC];
      if (t === undefined) return true;
      if (seen.has(t)) return false;
      seen.add(t); return true;
    });
  }

  // CVI's cvi_unique_cvi_count: distinct nonblank CVI values after trimming.
  function uniqueCvis(sub) {
    const s = new Set();
    sub.forEach(r => { const v = r.CVI; if (v !== null && v !== undefined) { const t = String(v).trim(); if (t) s.add(t); } });
    return s.size;
  }

  // The four numbers (CVI's current_map_summary for the WA State map), or null when no row matches.
  function summary(loaded, f) {
    const sub = mapRows(loaded, f);
    if (!sub) return null;
    const total = dedupeVolume(sub)
      .reduce((t, r) => (r['Total.Animals'] === null ? t : t + r['Total.Animals']), 0);
    // WA counties: the counties the map draws a circle for. CVI tests a county with nzchar(trimws()), which is TRUE
    // for a missing county, so a row with coordinates and no county name counts as one more county (null here).
    const counties = new Set();
    sub.forEach(r => {
      if (r.Movement === 'Inbound' && (r['Dest.County'] === null || nonblank(r['Dest.County']))
        && r['Dest.County.Lat'] !== null && r['Dest.County.Long'] !== null) counties.add(r['Dest.County']);
      if (r.Movement === 'Outbound' && (r['Origin.County'] === null || nonblank(r['Origin.County']))
        && r['Origin.County.Lat'] !== null && r['Origin.County.Long'] !== null) counties.add(r['Origin.County']);
    });
    return { total_animals: total, n_cvis: loaded.header.indexOf('CVI') >= 0 ? uniqueCvis(sub) : null,
      n_counties: counties.size, top_species: topSpecies(sub, f.species.length === 1 && loaded.hasSpecies) };
  }
  // Top species: the raw Species when exactly one group is picked and the column exists (useRaw), else the group. Counts
  // rows (an intrastate row's two copies are two), ties go to the first name in sorted order.
  function topSpecies(sub, useRaw) {
    const tally = new Map();
    sub.forEach(r => {
      const v = useRaw ? r.Species : r['Species.Group'];
      if (v !== null && v !== undefined && v !== '') tally.set(v, (tally.get(v) || 0) + 1);
    });
    let top = '—';
    [...tally.keys()].sort(collate).forEach(k => { if (top === '—' || tally.get(k) > tally.get(top)) top = k; });
    return top;
  }

  const fmt1 = x => S().formatR([x])[0];
  const isZero = v => { const n = Number(String(v).replace(/,/g, '')); return String(v).trim() !== '' && n === 0; };
  const NO_CVI_REASON = 'Needs the column CVI in the CVI master table.';   // the checklist's wording (datasets.js)
  const NO_CVI_SHORT = 'Needs the CVI column';   // shown in the grayed box, so it keeps the other boxes' size
  // Both of CVI's animal numbers stay, each with help text. The strip can also be lower (rows the map cannot place
  // count in the box only), and the WA counties box can be one higher than the strip's Counties (CVI counts a row
  // with a map position but no county name).
  // A record the file repeats exactly counts each time: the page merges only the loader's two copies of one
  // WA-to-WA row (a recorded deliberate difference; CVI's app drops exact WA-to-WA repeats first).
  const HELP_TOTAL = 'Animals moved in the current view. A movement within Washington (WA to WA) counts once. '
    + 'Rows the map cannot place (no county or no map position) still count here. A record repeated exactly in the '
    + 'file counts each time; CVI\'s own app counts a repeated WA-to-WA record once.';
  const HELP_STRIP = 'Arrivals plus departures at the WA counties on the map. A movement within Washington counts at both of '
    + 'its counties when both directions are shown, so this can be more than Total animals; rows the map cannot place '
    + 'are left out, so it can also be less. Counties are the counties drawn; the WA counties box also counts rows that '
    + 'have a map position but no county name, as CVI does, so it can be one higher.';
  // What the value boxes show: CVI's alert when nothing matches, else four metrics with CVI's labels, icons and
  // accents. A metric whose value is 0 is styled as zero (CVI's "metric-zero").
  function valueBoxes(s) {
    if (!s) return { state: 'alert', icon: 'info-circle', lines: ['Load a master and apply filters to see summary metrics.'] };
    const m = (label, text, icon, accent) => ({ label, text, icon, accent, zero: isZero(text) });
    const cvi = s.n_cvis === null
      ? Object.assign(m('Unique CVIs in current view', '—', 'file-earmark-medical', '#2980b9'), { disabled: true, reason: NO_CVI_REASON, short: NO_CVI_SHORT })
      : m('Unique CVIs in current view', S().comma(s.n_cvis), 'file-earmark-medical', '#2980b9');  // a whole number: never 1e+05
    return { state: 'metrics', metrics: [
      Object.assign(m('Total animals', fmt1(s.total_animals), 'stack', '#1c5a83'), { help: HELP_TOTAL }), cvi,
      m('WA counties', String(s.n_counties), 'geo-alt', '#5d6873'),
      m('Top species', s.top_species, 'tags', '#27ae60')] };
  }

  // Ticked values that skip one that could be ticked, as runs: gapRuns([2021, 2022, 2025], String, '–', [2021, 2022,
  // 2023, 2024, 2025]) is "2021–2022, 2025". choices: every value that can be ticked (a year with no records is not
  // one, so it is no gap); without choices, consecutive whole numbers. null when nothing is skipped or a value is
  // unknown, so the caller keeps CVI's "first–last" (a deliberate difference: CVI's "2021–2025" hides the skip).
  function gapRuns(values, name, dash, choices) {
    const v = [...new Set(values.map(Number))].sort((a, b) => a - b);
    const order = choices ? [...new Set(choices.map(Number))].sort((a, b) => a - b) : null;
    const at = x => (order ? order.indexOf(x) : x);
    if (v.length < 2 || !v.every(x => Number.isInteger(x) && at(x) >= 0)) return null;
    if (at(v[v.length - 1]) - at(v[0]) + 1 === v.length) return null;
    const runs = [];
    for (const x of v) {
      const last = runs[runs.length - 1];
      if (last && at(x) === at(last[1]) + 1) last[1] = x;
      else runs.push([x, x]);
    }
    return runs.map(r => (r[0] === r[1] ? name(r[0]) : name(r[0]) + dash + name(r[1]))).join(', ');
  }

  // CVI's .period_label: years and quarters sorted as text; up to two years joined with "/", more as "first-last";
  // all four quarters as "Q1-Q4", else listed; "—" for none.
  function periodLabel(years, quarters) {
    const y = years.map(String).sort(collate), q = quarters.map(String).sort(collate);
    const ys = !y.length ? '—' : y.length <= 2 ? y.join('/') : y[0] + '-' + y[y.length - 1];
    const qs = !q.length ? '—' : q.length === 4 ? 'Q1-Q4' : q.join(', ');
    return ys + ' ' + qs;
  }

  // CH: "Shaded counties" while WA State's counties are shaded (a deliberate addition, not in CVI).
  const MODE_LABEL = { side_by_side: 'Map A — Side-by-side', total: 'Map B — Combined total', shaded: 'Shaded counties' };
  // The summary strip (CVI's filter_summary_strip, WA State branch) from the circles the map draws
  // (aggregate.build). Animals sums the circles, so a WA-to-WA movement counts at both of its counties when both
  // directions are shown. With no circles: CVI's "No records match" diagnostic.
  function strip(loaded, f, circles) {
    const empty = !f.species.length || !f.quarters.length || !f.direction.length || !f.years.length;
    if (empty || !circles || !circles.length) {
      const uniq = col => [...new Set(loaded.rows.map(r => r[col]).filter(v => v !== null && v !== undefined))]
        .sort(collate).join(' | ');
      return { state: 'message', lines: ['No records match current filters.', 'Filter values applied:',
        'Years: ' + f.years.join(', '), 'Quarters: ' + f.quarters.join(', '), 'Direction: ' + f.direction.join(', '),
        'Species: ' + f.species.join(', '), 'In your data:', 'Movement values: ' + uniq('Movement'),
        'Species.Group values: ' + uniq('Species.Group')] };
    }
    const sum = xs => xs.reduce((t, x) => (x === null || Number.isNaN(x) ? t : t + x), 0);
    const byDir = new Map();
    circles.forEach(c => byDir.set(c.direction,
      (byDir.get(c.direction) || 0) + (c.total_animals === null ? 0 : c.total_animals)));
    const dirs = [...byDir.keys()].sort(collate), dirText = S().formatR(dirs.map(d => byDir.get(d)));
    return { state: 'summary', items: [
      { label: 'Period: ', text: periodLabel(f.years, f.quarters) },
      { label: 'Animals: ', text: fmt1(sum(circles.map(c => c.total_animals))), help: HELP_STRIP },
      { label: 'Counties: ', text: String(new Set(circles.map(c => c.county)).size) },
      { label: 'Mode: ', text: MODE_LABEL[f.mode] || MODE_LABEL.side_by_side },
      { label: 'By direction: ', text: dirs.map((d, i) => d + ': ' + dirText[i]).join(' | ') }] };
  }

  // Spotlight choices (CVI fills them on load): every origin and destination county name in the loaded table, sorted,
  // without blank names. Out-of-state names such as "N/A" stay, as in CVI.
  function spotlightChoices(loaded) {
    const s = new Set();
    loaded.rows.forEach(r => [r['Origin.County'], r['Dest.County']].forEach(c => { if (nonblank(c)) s.add(c); }));
    return [...s].sort(collate);
  }

  // CVI's .build_county_map() with counties picked: circles of the picked counties keep the chosen opacity (hover
  // adds 0.25), all others are drawn underneath at 0.10 without a hover change. Input in drawing order (largest
  // first); each part keeps that order. With nothing picked, all circles are drawn as usual.
  const DIM_OPACITY = 0.10;
  function spotlightSplit(circles, spotlight) {
    if (!spotlight || !spotlight.length) return { spot: null, dim: null, all: circles };
    const pick = new Set(spotlight);
    return { spot: circles.filter(c => pick.has(c.county)), dim: circles.filter(c => !pick.has(c.county)), all: null };
  }

  // Reset All Filters (CVI's reset_filters observer, WA State map controls that exist in the browser): every species
  // group and year of the loaded table, all quarters, both directions, no refined species, side-by-side circles,
  // logarithmic scaling, 5 bins, 60% opacity, the default palette, county labels on. County lines are not reset (as in
  // CVI). By design the spotlight is cleared too (CVI leaves it).
  function resetDefaults(loaded) {
    return { species: loaded ? loaded.speciesChoices.slice() : [], speciesSub: [], spotlight: [],
      years: loaded ? loaded.yearChoices.slice() : [], quarters: ['Q1', 'Q2', 'Q3', 'Q4'], direction: ['Inbound', 'Outbound'],
      mode: 'side_by_side', scaling: 'log', nBins: 5, opacity: '0.6', palette: 'WSDA Default', labels: true };
  }

  root.CVIWA = root.CVIWA || {};
  root.CVIWA.summary = { mapRows, dedupeVolume, uniqueCvis, summary, topSpecies, valueBoxes, periodLabel, gapRuns, strip,
    NO_CVI_REASON, HELP_TOTAL, HELP_STRIP,
    spotlightChoices, spotlightSplit, DIM_OPACITY, resetDefaults };
})(typeof window !== 'undefined' ? window : globalThis);
