/* WA State map period modes (S2b): Single period, Browse over time and Compare two periods.
 * Port of CVI's WA map module (county_period_mode, .time_slider_filter, .wire_time_slider, the master-load domains,
 * county_circle_data_b, county_period_summary, the compare labels and the period part of Reset All). Pure functions;
 * ui.js keeps the state and draws. Deliberate differences: the Browse header names the period on
 * the map also when stepping by year (CVI's header always reads the year-quarter list); the right map ignores a
 * "Refine by species" pick left hidden when its own species is switched off (see rightFilters). As CVI, the left map's
 * refine never reaches the right map; the page says so while it is in use (refineNote). */
(function (root) {
  'use strict';
  const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
  const collate = (a, b) => a.localeCompare(b, 'en');
  const label = (y, q) => root.CVIWA.summary.periodLabel(y, q);

  // Playback speeds (CVI's "Playback speed" picker; Normal is the default) and the Quarter/Year step.
  const SPEEDS = [{ ms: 5000, label: 'Slow (5s / frame)' }, { ms: 3500, label: 'Normal (3.5s / frame)' },
    { ms: 2500, label: 'Fast (2.5s / frame)' }];
  const DEFAULT_SPEED = 3500;
  const STEPS = [{ id: 'quarter', label: 'Step by Quarter' }, { id: 'year', label: 'Step by Year' }];

  // N25: the slider's periods, from the loaded rows. Quarter: the year-quarter pairs present ("2024-Q2"), without any
  // pair containing "NA" (a missing year or quarter), sorted; Year: the years present, as text, in order.
  function domains(loaded) {
    if (!loaded) return { quarter: [], year: [] };
    const q = new Set();
    loaded.rows.forEach(r => {
      const y = r['Reporting.Year'], qt = r['Reporting.Quarter'];
      if (y === null || qt === null || qt === undefined) return;
      const c = y + '-' + qt;
      if (c.indexOf('NA') < 0) q.add(c);
    });
    return { quarter: [...q].sort(collate), year: loaded.yearChoices.map(String) };
  }
  const domainFor = (dom, step) => (step === 'year' ? dom.year : dom.quarter);
  // The slider starts in the middle (CVI: max(1, ceiling(n / 2))); positions are 1..n.
  const middle = n => Math.max(1, Math.ceil(n / 2));
  // A slider position made a whole number from 1 to n.
  const clamp = (i, n) => Math.min(Math.max(1, Math.trunc(Number(i) || 1)), Math.max(1, n));

  // The text above the slider: the period at that position, or "—" without periods.
  function timeLabel(dom, step, i) {
    const d = domainFor(dom, step);
    return d.length ? d[clamp(i, d.length) - 1] : '—';
  }
  // What one slider position puts in the year and quarter pickers: one year and one quarter, or (by year) one year
  // with all four quarters. Null without periods, or for a pair that does not split in two at "-" (CVI then leaves
  // the pickers as they are). As R's strsplit(), a trailing empty part is dropped: "2024-" (a quoted empty quarter) is
  // one part, so nothing changes.
  function frame(dom, step, i) {
    const d = domainFor(dom, step);
    if (!d.length) return null;
    const p = d[clamp(i, d.length) - 1];
    if (step === 'year') return { years: [Number(p)], quarters: QUARTERS.slice() };
    const parts = p.split('-');
    if (parts[parts.length - 1] === '') parts.pop();
    if (parts.length !== 2) return null;
    return { years: [Number(parts[0])], quarters: [parts[1]] };
  }
  // Play (Shiny's slider animation, loop off): from the last position Play starts again at the first; each tick moves
  // one position on; the tick that reaches the last position also stops playback (Shiny: step, then stop when it
  // cannot step again), so the button reads Play while the last period is shown.
  const playStart = (i, n) => (clamp(i, n) >= n ? 1 : clamp(i, n));
  const nextIndex = (i, n) => (clamp(i, n) < n ? clamp(i, n) + 1 : null);

  // The section header (CVI's county_period_summary): "Single: …", "Browse: …" or "Compare: Left … vs Right …".
  function header(s, dom) {
    if (s.periodMode === 'compare') return 'Compare: Left ' + label(s.years, s.quarters)
      + ' vs Right ' + label(s.yearsB, s.quartersB);
    if (s.periodMode === 'browse') {
      const d = domainFor(dom, s.timeStep);
      return d.length ? 'Browse: ' + timeLabel(dom, s.timeStep, s.timeIndex) : 'Browse over time';
    }
    return 'Single: ' + label(s.years, s.quarters);
  }

  // The right map's filters (CVI's county_circle_data_b): its own years and quarters; the shared species unless "Use
  // different species on right map" is ticked. Direction, display mode and styling are shared (the caller adds them).
  // CVI also applies the right map's "Refine by species" picks while that picker is hidden; the page does not.
  function rightFilters(s) {
    const own = !!s.speciesBEnabled;
    return { species: own ? s.speciesB : s.species, rawSpecies: own ? s.speciesBSub : [], years: s.yearsB,
      quarters: s.quartersB };
  }

  // Compare with the shared species: CVI's right map never takes the left map's "Refine by species" picks (parity). The
  // page shows a one-line note while such picks are active (a deliberate addition).
  const refineNote = s => s.periodMode === 'compare' && !s.speciesBEnabled && s.speciesSub.length > 0;

  // Reset All, period part (CVI's reset_filters): Single period, right-map pickers back to everything, its own species
  // off. Slider position, Quarter/Year step and speed are not reset (as CVI).
  function resetDefaults(loaded) {
    const spp = loaded ? loaded.speciesChoices.slice() : [];
    return { periodMode: 'single', speciesBEnabled: false, speciesB: spp, speciesBSub: [],
      yearsB: loaded ? loaded.yearChoices.slice() : [], quartersB: QUARTERS.slice() };
  }

  root.CVIWA = root.CVIWA || {};
  root.CVIWA.periods = { SPEEDS, DEFAULT_SPEED, STEPS, QUARTERS, domains, domainFor, middle, clamp, timeLabel, frame,
    playStart, nextIndex, header, rightFilters, refineNote, resetDefaults };
})(typeof window !== 'undefined' ? window : globalThis);
