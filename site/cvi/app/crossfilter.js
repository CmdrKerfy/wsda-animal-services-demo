/* Chart cross-filtering: clicking a bar or point in a chart filters the other charts, and the
 * map where that makes sense. Pure functions; the page keeps the state and draws what these return.
 *
 * Rules:
 * - Chart filters are their own layer on top of the sidebar. Each Map View keeps its own. A click toggles a value;
 *   values from different charts combine (Cattle and King and 2025 Q2); values of one kind combine with "or".
 * - Kinds: species (a species group), period (a year and quarter), place (on WA State the Spotlight Counties, which
 *   the page keeps equal to state.wa.place; on National Flow a partner state; on County Focus a county), pair (a
 *   corridor: two WA counties on the WA State movement view, two county labels on County Focus) and premises
 *   (County Focus).
 * - The clicked chart keeps all its bars: each chart is filtered by every kind except the one it sets.
 * - Species and period filter the map, value boxes and strip like a sidebar pick. Places, pairs and premises only
 *   highlight on the map; the other charts are filtered to them.
 * - Counting is S7's with the per-direction fix: totals across directions (species, corridors) count the
 *   merged rows (the loader's two copies of a WA-to-WA row once), and the charts by direction count both copies,
 *   each at its own end (Inbound at its destination, otherwise at its origin; the partner state on Flow). So a
 *   place filter is applied to each copy, before the merge, as a premises filter: the per-direction charts add up
 *   to the clicked bar, and the merged charts too, except a movement within one picked place (or between two),
 *   which they count once. Species, period and pair give the same answer for both copies.
 * - A filter whose value the sidebar no longer has rows for is dropped with a message (reconcile()). Period filters
 *   are dropped, and period points cannot be clicked, while Browse or Compare sets the period. A pair filter on the
 *   WA State map is dropped when the movement view is turned off.
 * - "Non-WA" bars (many places) and grayed charts offer nothing to click. */
(function (root) {
  'use strict';
  const C = () => root.CVIWA.charts;
  const FOCUS = () => root.CVIWA.focus;

  const KINDS = ['species', 'period', 'place', 'pair', 'premises'];
  // The kinds each Map View's charts can set (the corridor chart included).
  const VIEW_KINDS = {
    wa: ['species', 'period', 'place', 'pair'],
    flow: ['species', 'period', 'place'],
    focus: ['species', 'place', 'pair', 'premises']
  };
  const SEP = '\u0000';   // between the two ends of a pair value
  const NON_WA = 'Non-WA';

  // The kind a chart sets with a click, so the one it is not filtered by. corridors on the WA State map is the
  // movement view's chart of pairs between WA counties.
  function ownKind(chartId, view) {
    if (chartId === 'species') return 'species';
    if (chartId === 'over_time') return 'period';
    if (chartId === 'top_places' || chartId === 'emerging') return 'place';
    if (chartId === 'corridors') return view === 'flow' ? 'place' : 'pair';
    if (chartId === 'top_premises') return 'premises';
    return null;
  }

  // ── State ──────────────────────────────────────────────────────────────────────────────────────────────────
  // One object per Map View: a list of values per kind, and the premises' labels for the chip bar.
  function emptyView() {
    return { species: [], period: [], place: [], pair: [], premises: [], labels: {} };
  }
  // A new state with no chart filter on any of the three views.
  function create() {
    return { wa: emptyView(), flow: emptyView(), focus: emptyView() };
  }
  // A copy of the state with one view replaced (the state is never changed in place).
  function withView(state, view, v) {
    const out = Object.assign({}, state);
    out[view] = v;
    return out;
  }
  // A copy of one view's filters, with lists of its own.
  function copyView(v) {
    const out = emptyView();
    KINDS.forEach(k => { out[k] = v[k].slice(); });
    out.labels = Object.assign({}, v.labels);
    return out;
  }

  // pick: { kind, value, label } (label only for premises, whose label can change between filters).
  function isPicked(state, view, pick) {
    return state[view][pick.kind].includes(pick.value);
  }
  // Adds a pick to a view's filters, or removes it when it is already there (a new state is returned).
  function toggle(state, view, pick) {
    const v = copyView(state[view]);
    const at = v[pick.kind].indexOf(pick.value);
    if (at >= 0) {
      v[pick.kind].splice(at, 1);
      delete v.labels[pick.value];
    } else {
      v[pick.kind].push(pick.value);
      if (pick.label !== undefined) v.labels[pick.value] = pick.label;
    }
    return withView(state, view, v);
  }
  // Removes every value of one kind (a chip's ×).
  function removeKind(state, view, kind) {
    const v = copyView(state[view]);
    if (kind === 'premises') v.labels = {};
    v[kind] = [];
    return withView(state, view, v);
  }
  // Sets a view's places (on WA State: the page's Spotlight Counties).
  function setPlaces(state, view, places) {
    const v = copyView(state[view]);
    v.place = places.slice();
    return withView(state, view, v);
  }
  // "Clear chart filters" (the chip bar) and Reset All: every kind of one view. On WA State the page also clears the
  // spotlight, which is the place filter there.
  function clearView(state, view) {
    return withView(state, view, emptyView());
  }
  // Whether a view has any chart filter on.
  function isActive(state, view) {
    return VIEW_KINDS[view].some(k => state[view][k].length > 0);
  }

  // ── What a click stands for ────────────────────────────────────────────────────────────────────────────────
  const pairValue = (a, b) => a + SEP + b;
  const pairEnds = value => value.split(SEP);
  // A corridor bar's label in charts.js: "Origin  →  Destination".
  const labelEnds = label => label.split('  →  ');

  // The pick behind a mark of a chart, or null when it cannot be clicked. mark: the bar (species, emerging,
  // corridors, top premises), the place's group of bars (top places) or the period's label (over time).
  // ctx.periodMode: 'single', 'browse' or 'compare'.
  function pickOf(view, chart, mark, ctx) {
    if (!chart || chart.empty) return null;
    const id = chart.id;
    if (id === 'species') return { kind: 'species', value: mark.label };
    if (id === 'over_time') {
      if (view === 'focus' || !ctx || ctx.periodMode !== 'single') return null;
      return { kind: 'period', value: mark };
    }
    if (id === 'top_places' || id === 'emerging') {
      return mark.label === NON_WA ? null : { kind: 'place', value: mark.label };
    }
    if (id === 'corridors') {
      const ends = labelEnds(mark.label);
      if (ends.length !== 2) return null;
      if (view === 'flow') {
        // A pair of states picks its non-WA end; WA to WA (a "wa"-to-WA row) has none.
        const other = ends[0] === 'WA' ? ends[1] : ends[1] === 'WA' ? ends[0] : null;
        return other === null || other === 'WA' ? null : { kind: 'place', value: other };
      }
      return { kind: 'pair', value: pairValue(ends[0], ends[1]) };
    }
    if (id === 'top_premises') return { kind: 'premises', value: mark.premises, label: mark.label };
    return null;
  }

  const trimmed = v => (v === null || v === undefined ? '' : String(v).trim());

  // ── Row tests ──────────────────────────────────────────────────────────────────────────────────────────────
  // The test for one kind's values, on one row (one loader copy).
  function test(view, kind, values) {
    const set = new Set(values);
    if (kind === 'species') return r => set.has(r['Species.Group']);
    if (kind === 'period') return r => set.has(C().periodOf(r).label);
    if (kind === 'place') return r => set.has(C().placeOf(r, view));
    if (kind === 'premises') return r => set.has(FOCUS().premisesKey(r));
    if (kind === 'pair' && view === 'wa') {
      // Movement between WA counties (movement.js): both states exactly "WA", the counties without surrounding
      // spaces, as the movement view and the corridor chart's labels.
      return r => r['Origin.State'] === 'WA' && r['Dest.State'] === 'WA'
        && set.has(pairValue(trimmed(r['Origin.County']), trimmed(r['Dest.County'])));
    }
    if (kind === 'pair') {
      // County Focus corridors (charts.js): the county labels, "Non-WA" for the out-of-state placeholder.
      return r => {
        const o = C().countyLabel(r['Origin.County']);
        const d = C().countyLabel(r['Dest.County']);
        return o !== null && d !== null && set.has(pairValue(o.trim(), d.trim()));
      };
    }
    throw new Error('Unknown chart filter kind ' + kind);
  }
  // Every test of the given kinds that has values, joined with "and"; null when none applies.
  function allOf(view, state, kinds) {
    const tests = kinds.filter(k => state[view][k].length).map(k => test(view, k, state[view][k]));
    if (!tests.length) return null;
    return r => tests.every(t => t(r));
  }

  // The filters a map draws with (and its value boxes and strip): the sidebar's filters f with the species and period
  // chart filters folded in, so the result is exactly the matching sidebar pick (one group picked also shows raw
  // species, as CVI's): the groups both pick, and one period as that year and quarter alone. Several periods: their
  // years and quarters, and f.keep for the exact pairs. opts.ownSpecies: the Compare right map has its own species
  // ("Use different species on right map"), so a species filter is not applied to it.
  function mapFilters(view, f, state, opts) {
    const v = state[view];
    const out = Object.assign({}, f);
    if (v.species.length && !(opts && opts.ownSpecies)) {
      const set = new Set(v.species);
      out.species = f.species.filter(x => set.has(x));
    }
    if (v.period.length && VIEW_KINDS[view].includes('period')) {
      const parts = v.period.map(p => p.split(' '));
      const years = new Set(parts.map(p => Number(p[0])));
      const quarters = new Set(parts.map(p => p[1]));
      out.years = f.years.filter(y => years.has(Number(y)));
      out.quarters = f.quarters.filter(q => quarters.has(q));
      if (v.period.length > 1) {
        const exact = test(view, 'period', v.period);
        out.keep = f.keep ? (r => f.keep(r) && exact(r)) : exact;
      }
    }
    return out;
  }

  // The rows a chart counts, from the rows of the map's sidebar filters (both loader copies, as the map draws them).
  // The result goes to charts.js, which merges the copies for its totals across directions; it is the input itself
  // when no filter applies.
  function chartRows(view, rows, state, chartId) {
    const own = ownKind(chartId, view);
    const kinds = VIEW_KINDS[view].filter(k => k !== own && state[view][k].length);
    if (!kinds.length) return rows;
    return rows.filter(allOf(view, state, kinds));
  }
  // The rule for the County Focus premises a chart draws (top premises): every kind but premises, each copy at its
  // own end (the premises builder counts copies). Null when nothing applies.
  function premisesRule(state) {
    return allOf('focus', state, ['species', 'place', 'pair']);
  }

  // The within-state movement view (movement.js) takes the WA State map's filters (mapFilters). Its corridor chart
  // also keeps only the pairs touching a spotlighted county, as the map draws them in full color: this rule, or null
  // without a spotlight. Its lines are not filtered by the spotlight (they are highlighted).
  function movementChartRule(state) {
    const places = state.wa.place;
    if (!places.length) return null;
    const set = new Set(places);
    return r => set.has(trimmed(r['Origin.County'])) || set.has(trimmed(r['Dest.County']));
  }

  // ── Highlights on the map ──────────────────────────────────────────────────────────────────────────────────
  // County Focus: the premises to draw in full color, as premisesKey values, or null when no place, pair or premises
  // filter is on. A premises is highlighted when it passes each of them: its key is picked, its county is picked, and
  // one of its rows (row_indices into masterRows) is in a picked pair.
  function focusHighlight(premises, masterRows, state) {
    const v = state.focus;
    if (!v.place.length && !v.pair.length && !v.premises.length) return null;
    const keys = new Set(v.premises);
    const counties = new Set(v.place);
    const inPair = v.pair.length ? test('focus', 'pair', v.pair) : null;
    const out = new Set();
    premises.forEach(p => {
      const key = p.direction + '\r' + p.group_key;
      if (keys.size && !keys.has(key)) return;
      if (counties.size && !counties.has(C().countyLabel(p.county))) return;
      if (inPair && !p.row_indices.some(i => inPair(masterRows[i]))) return;
      out.add(key);
    });
    return out;
  }

  // ── When the sidebar changes ───────────────────────────────────────────────────────────────────────────────
  // Drops the values the sidebar's rows no longer have (rows: the view's rows under the sidebar filters alone, both
  // copies). ctx: { periodMode, movementOn }. The WA State place is the spotlight, a sidebar control of its own, so it
  // is never dropped here. ctx.pairRows (WA State): the movement view's rows under the sidebar filters, for its
  // corridors (it ignores Direction). ctx.pickerEmpty: a required picker of the view is empty (say both
  // Direction boxes unticked); the map then draws nothing, so nothing is dropped for 'rows' and ticking a box again
  // brings the view back as it was (the filters are kept). Returns { state, dropped: [{ kind, values,
  // reason }] }; reason 'rows' or 'period mode' or 'movement off'.
  function reconcile(view, state, rows, ctx) {
    const v = copyView(state[view]);
    const dropped = [];
    const drop = (kind, values, reason) => {
      if (!values.length) return;
      dropped.push({ kind, values, reason, labels: values.map(x => v.labels[x]) });
      v[kind] = v[kind].filter(x => !values.includes(x));
      values.forEach(x => { delete v.labels[x]; });
    };
    if (v.period.length && ctx && ctx.periodMode && ctx.periodMode !== 'single') drop('period', v.period, 'period mode');
    if (view === 'wa' && v.pair.length && !(ctx && ctx.movementOn)) drop('pair', v.pair, 'movement off');
    const present = kind => {
      const at = values => test(view, kind, values);
      let source = rows;
      if (kind === 'pair' && view === 'wa' && ctx && ctx.pairRows) source = ctx.pairRows;
      return value => source.some(at([value]));
    };
    if (ctx && ctx.pickerEmpty) return { state: withView(state, view, v), dropped };
    VIEW_KINDS[view].forEach(kind => {
      if (kind === 'place' && view === 'wa') return;
      if (!v[kind].length) return;
      const has = present(kind);
      drop(kind, v[kind].filter(x => !has(x)), 'rows');
    });
    return { state: withView(state, view, v), dropped };
  }

  // ── Text ───────────────────────────────────────────────────────────────────────────────────────────────────
  const KIND_NAMES = {
    species: () => 'Species group',
    period: () => 'Period',
    place: view => (view === 'wa' ? 'Spotlight' : view === 'flow' ? 'State' : 'County'),
    pair: () => 'Corridor',
    premises: () => 'Premises'
  };
  // A picked value as the chips write it: a corridor as "Origin → Destination", premises by their label.
  function valueText(kind, value, labels) {
    if (kind === 'pair') return pairEnds(value).join(' → ');
    if (kind === 'premises') return labels && labels[value] !== undefined ? labels[value] : value;
    return value;
  }
  // The chip bar: one chip per kind with values, in a fixed order ("Species group: Cattle", "Spotlight: King, Pierce").
  function chips(state, view) {
    const v = state[view];
    return VIEW_KINDS[view].filter(k => v[k].length).map(kind => ({
      kind,
      text: KIND_NAMES[kind](view) + ': ' + v[kind].map(x => valueText(kind, x, v.labels)).join(', ')
    }));
  }
  // The message for dropped filters, or null.
  function dropMessage(view, dropped) {
    if (!dropped.length) return null;
    const parts = dropped.map(d => KIND_NAMES[d.kind](view) + ': '
      + d.values.map((x, i) => (d.kind === 'premises' && d.labels[i] !== undefined ? d.labels[i]
        : valueText(d.kind, x, {}))).join(', '));
    const why = dropped.every(d => d.reason === 'period mode') ? 'Browse and Compare set the period.'
      : dropped.every(d => d.reason === 'movement off') ? 'The movement view is off.'
        : 'The sidebar filters no longer include it.';
    return 'Chart filter removed (' + parts.join('; ') + '). ' + why;
  }
  // What a click on a mark does, for its hover text. On WA State a county click is S7's click-to-spotlight, in its
  // existing words.
  // Why the over-time chart's points cannot be clicked, or null: while browsing or comparing, the period
  // is set by the slider or by each map's own picker, so the hover text says so.
  function noPickText(view, chart, ctx) {
    if (!chart || chart.empty || chart.id !== 'over_time' || view === 'focus') return null;
    const mode = ctx && ctx.periodMode;
    if (mode === 'browse') return 'Browse sets the period, so the points cannot be clicked.';
    if (mode === 'compare') return 'Each map has its own period in Compare, so the points cannot be clicked.';
    return null;
  }
  // The hover text of a clickable chart mark or map point: what a click on it would do.
  function hoverText(view, pick, picked) {
    const what = valueText(pick.kind, pick.value, pick.label === undefined ? {} : { [pick.value]: pick.label });
    if (pick.kind === 'place' && view === 'wa') {
      return picked ? 'Click to remove ' + what + ' from Spotlight Counties.'
        : 'Click to add ' + what + ' to Spotlight Counties.';
    }
    return picked ? 'Click to remove the filter for ' + what + '.' : 'Click to filter by ' + what + '.';
  }

  root.CVIWA = root.CVIWA || {};
  root.CVIWA.crossfilter = { KINDS, VIEW_KINDS, SEP, ownKind, create, emptyView, isPicked, toggle, removeKind,
    setPlaces, clearView, isActive, pickOf, test, mapFilters, chartRows, premisesRule, movementChartRule, focusHighlight,
    reconcile, chips, dropMessage, hoverText, noPickText, pairValue };
})(typeof window !== 'undefined' ? window : globalThis);
