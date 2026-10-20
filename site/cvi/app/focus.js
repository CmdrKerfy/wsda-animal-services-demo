/* Pure County Focus rules: premises, popups and hover (as plain text for the page and as CVI's HTML for the checks),
 * value boxes and the summary strip. Input is master.load()
 * output; no page or map dependency. The boxes and strip reuse the WA map's summary.js helpers. */
(function (root) {
  'use strict';
  const COORDS = ['Origin.Lat', 'Origin.Long', 'Dest.Lat', 'Dest.Long'];
  const cmp = (a, b) => a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1;
  const text = x => x === undefined || x === null ? null : String(x);
  const nonblank = x => x !== null && x.trim() !== '';
  const esc = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const dash = x => (x === null || x === undefined || x === '' ? '—' : String(x));
  // The premises popup's table as plain text (the page builds it as page elements): distinct CVI / Origin / Dest /
  // Species rows sorted by CVI, at most maxRows, and how many more. A blank cell is a dash.
  function popupData(rows, hasCvi, maxRows = 25) {
    const distinct = new Map();
    for (const r of rows) {
      const item = { cvi: hasCvi ? text(r.CVI) : null,
        org: dash(r['Origin.City']) + ', ' + dash(r['Origin.State']),
        dst: dash(r['Dest.City']) + ', ' + dash(r['Dest.State']), sp: dash(r['Species.Group']) };
      distinct.set(JSON.stringify(item), item);
    }
    const ordered = [...distinct.values()].sort((a, b) => cmp(a.cvi, b.cvi));
    return { rows: ordered.slice(0, maxRows).map(r => [dash(r.cvi), r.org, r.dst, r.sp]),
      more: Math.max(0, ordered.length - maxRows) };
  }
  // CVI's .mk_focus_popup HTML, from the same rows (checked against CVI's).
  function popupHtml(p) {
    const body = p.rows.map(r => '<tr>' + r.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('');
    const foot = p.more ? "<div style='font-size:0.75em;color:#777;margin-top:3px;'>+" + p.more + ' more CVIs</div>' : '';
    return "<div style='max-height:240px;overflow:auto;font-size:0.78em;'><table style='border-collapse:collapse;'>"
      + "<thead><tr style='text-align:left;border-bottom:1px solid #ccc;'><th style='padding:2px 6px;'>CVI</th>"
      + "<th style='padding:2px 6px;'>Origin</th><th style='padding:2px 6px;'>Dest</th><th style='padding:2px 6px;'>Species</th></tr></thead>"
      + '<tbody>' + body + '</tbody></table>' + foot + '</div>';
  }
  const popup = (rows, hasCvi, maxRows) => popupHtml(popupData(rows, hasCvi, maxRows));
  const MERGED = '⚠ Multiple premises share this geocode (file lacks farm IDs) — totals combined', HINT = 'Click for CVI list';
  // CVI's premises hover HTML from its plain-text parts (file text escaped; CVI inserts it as HTML).
  function tooltipHtml(t) {
    return '<strong>' + t.role + '</strong><br/>' + esc(t.place) + '<br/>' + (t.cvis === null ? '' : esc(t.cvis) + '<br/>')
      + esc(t.total) + (t.merged ? "<br/><span style='color:#B36B00;font-size:0.8em;'>" + MERGED + '</span>' : '')
      + "<br/><span style='color:#777;font-size:0.85em;'>" + HINT + '</span>';
  }
  // The premises' species breakdown as a JSON object string: each label's total animals, largest first.
  function speciesJson(rows, field) {
    const totals = new Map();
    for (const r of rows) {
      const label = text(r[field]);
      if (!nonblank(label)) continue;
      const key = label.trim(), n = r['Total.Animals'];
      totals.set(key, (totals.get(key) || 0) + (n === null || n === undefined || Number.isNaN(n) ? 0 : n));
    }
    // Keep CVI's quote substitution and stable total ranking; JSON-encode control characters/backslashes.
    return '{' + [...totals].sort((a, b) => b[1] - a[1]).map(([k, n]) => JSON.stringify(k.replace(/"/g, "'"))
      + ':' + JSON.stringify(root.CVIWA.scaling.rRound(n))).join(',') + '}';
  }
  // The county picker's choices: every WA county named at either end of a row, sorted.
  function countyChoices(master) {
    const names = new Set();
    for (const r of master.rows) for (const end of ['Origin', 'Dest']) {
      const name = text(r[end + '.County']);
      if (r[end + '.State'] === 'WA' && nonblank(name)) names.add(name);
    }
    return [...names].sort(cmp);
  }
  // A row's premises as build() groups it (CVI's .grp, the same rule as in build()): the farm entity id at the row's
  // counted end when there is one, else its coordinates, after the direction, as the map draws importers and
  // exporters apart; null for a row with no direction. The chart filters use it to find a premises' rows
  // (crossfilter.js); the MC unit suite checks it against build()'s groups.
  function groupKey(r, end) {
    const eid = text(r['farm_entity_id_' + end.toLowerCase()]);
    if (nonblank(eid)) return 'e:' + eid.trim();
    return 'c:' + root.CVIWA.master.asNumeric(r[end + '.Long']) + ',' + root.CVIWA.master.asNumeric(r[end + '.Lat']);
  }
  // A row's premises id as build() keys it (its direction, then groupKey at the counted end), or null without one.
  function premisesKey(r) {
    if (r.Movement !== 'Inbound' && r.Movement !== 'Outbound') return null;
    return r.Movement + '\r' + groupKey(r, r.Movement === 'Inbound' ? 'Dest' : 'Origin');
  }
  // The map's premises from the filtered rows, grouped and sized, with their popups and hovers; also the rows picked
  // and how many were left off for an unusable location. Empty when columns, counties or rows are missing.
  function build(master, opts) {
    const missingCoordinates = COORDS.filter(c => !master.header.includes(c));
    const result = { missingCoordinates, omittedRows: 0, selectedRowIndices: [], premises: [] };
    if (missingCoordinates.length || !opts.counties.length || !master.rows.length) return result;
    const species = new Set(opts.species), years = new Set(opts.years), quarters = new Set(opts.quarters);
    const counties = new Set(opts.counties), raw = new Set(opts.rawSpecies || []);
    const groups = new Map(), hasCvi = master.header.includes('CVI');
    master.rows.forEach((r, index) => {
      const dir = r.Movement, end = dir === 'Inbound' ? 'Dest' : 'Origin';
      if (!['Inbound', 'Outbound'].includes(dir)
        || (opts.direction !== 'combined' && dir !== (opts.direction === 'inbound' ? 'Inbound' : 'Outbound'))
        || !species.has(r['Species.Group']) || !years.has(r['Reporting.Year']) || !quarters.has(r['Reporting.Quarter'])
        || !counties.has(r[end + '.County']) || r[end + '.State'] !== 'WA'
        || (master.hasSpecies && raw.size && !raw.has(r.Species))) return;
      if (opts.keep && !opts.keep(r)) return;   // the chart filters (crossfilter.js), when given
      result.selectedRowIndices.push(index);
      const lon = root.CVIWA.master.asNumeric(r[end + '.Long']), lat = root.CVIWA.master.asNumeric(r[end + '.Lat']);
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon === null || lat === null
        || Math.abs(lon) > 180 || Math.abs(lat) > 90) {
        result.omittedRows++; return;
      }
      const eid = text(r['farm_entity_id_' + end.toLowerCase()]);
      const key = nonblank(eid) ? 'e:' + eid.trim() : 'c:' + lon + ',' + lat;
      const id = dir + '\r' + key;
      if (!groups.has(id)) groups.set(id, { group_key: key, direction: dir, lon, lat, total_animals: 0, n_shipments: 0,
        city: text(r[end + '.City']), state: text(r[end + '.State']), county: text(r[end + '.County']),
        row_indices: [], cities: new Set(), cvis: new Set() });
      const g = groups.get(id), city = text(r[end + '.City']);
      g.row_indices.push(index); g.n_shipments++;
      if (r['Total.Animals'] !== null && !Number.isNaN(r['Total.Animals'])) g.total_animals += r['Total.Animals'];
      if (nonblank(city)) g.cities.add(city);
      if (hasCvi) g.cvis.add(text(r.CVI));
    });
    // dplyr groups by C-locale key before stable city/direction/descending-total ranking.
    const out = [...groups.values()].sort((a, b) => cmp(a.direction, b.direction) || cmp(a.group_key, b.group_key));
    out.sort((a, b) => cmp(a.city, b.city) || cmp(a.direction, b.direction) || b.total_animals - a.total_animals);
    const cityGroups = new Map();
    for (const g of out) {
      const id = JSON.stringify([g.city, g.direction]);
      if (!cityGroups.has(id)) cityGroups.set(id, []);
      cityGroups.get(id).push(g);
    }
    for (const list of cityGroups.values()) list.forEach((g, i) => {
      const label = nonblank(g.city) ? g.city : g.lon.toFixed(3) + ', ' + g.lat.toFixed(3);
      g.premises_id = label + (list.length > 1 ? ' #' + (i + 1) : '');
      g.n_cvis = hasCvi ? g.cvis.size : null;
      g.cvi_list = hasCvi ? [...g.cvis].filter(x => x !== null).sort(cmp).slice(0, 2).join(', ') : null;
      g.merged_premises = g.group_key.startsWith('c:') && g.cities.size > 1;
      delete g.cities; delete g.cvis;
      if (opts.direction === 'combined' && opts.mode === 'side_by_side') g.lon += g.direction === 'Inbound' ? -0.008 : 0.008;
      g.color = g.direction === 'Inbound' ? '#1C9CD9' : '#F0A06E';
    });
    const sizing = root.CVIWA.scaling.focusSizing(out.map(g => g.total_animals), opts.scaling || 'log', opts.nBins || 5);
    const animalText = root.CVIWA.scaling.formatR(out.map(g => root.CVIWA.scaling.rRound(g.total_animals)));
    const cviText = root.CVIWA.scaling.formatR(out.map(g => g.n_cvis === null ? NaN : g.n_cvis));
    out.forEach((g, i) => {
      g.radius_px = sizing.radii[i];
      const rows = g.row_indices.map(j => master.rows[j]);
      g.popup = popupData(rows, hasCvi);
      g.popup_html = popupHtml(g.popup);
      g.species_json = speciesJson(rows, opts.species.length === 1 && master.hasSpecies ? 'Species' : 'Species.Group');
      // The hover's lines as plain text (CVI's tooltip_text), the HTML string made from them.
      g.tooltip = { role: g.direction === 'Inbound' ? 'Importer' : 'Exporter',
        place: (g.city === null || g.city === '' ? '(unknown city)' : g.city) + ', '
          + (g.state === null || g.state === '' ? '?' : g.state)
          + (g.county === null || g.county === '' ? '' : ' — ' + g.county + ' County'),
        cvis: g.n_cvis === null ? null : g.n_cvis <= 2 && g.cvi_list
          ? (g.n_cvis === 1 ? 'CVI' : 'CVIs') + ': ' + g.cvi_list
          : 'CVIs: ' + cviText[i],
        total: 'Total: ' + animalText[i] + ' animals', merged: g.merged_premises, merged_text: MERGED, hint: HINT };
      g.tooltip_text = tooltipHtml(g.tooltip);
    });
    result.premises = out;
    result.legend = sizing.legend;   // the nested legend's values and radii, from the circles' own partition
    return result;
  }

  // ── Value boxes and strip (CVI's current_map_data, current_map_summary, value_boxes and filter_summary_strip,
  // County Focus branch) ──────────────────────────────────────────────────────────────────────────────────────
  const SUM = () => root.CVIWA.summary, S = () => root.CVIWA.scaling;
  // The rows the boxes count: with counties picked, species group, year and quarter; importers are Inbound rows whose
  // destination county is picked, exporters Outbound rows whose origin county is picked, as the direction allows; then
  // "Refine by species". Deliberate difference: that end's state must be exactly "WA" (CVI tests the county
  // name only). Rows without a usable premises location stay: they count in the boxes, not on the map. Null when none.
  function summaryRows(master, opts) {
    if (!master || !opts.counties.length) return null;
    const sp = new Set(opts.species), yr = new Set(opts.years), qt = new Set(opts.quarters), counties = new Set(opts.counties);
    const dir = opts.direction || 'combined';
    let sub = master.rows.filter(r => {
      const end = r.Movement === 'Inbound' ? 'Dest' : r.Movement === 'Outbound' ? 'Origin' : null;
      return end !== null && (dir === 'combined' || r.Movement === (dir === 'inbound' ? 'Inbound' : 'Outbound'))
        && sp.has(r['Species.Group']) && yr.has(r['Reporting.Year']) && qt.has(r['Reporting.Quarter'])
        && counties.has(r[end + '.County']) && r[end + '.State'] === 'WA';
    });
    if (!sub.length) return null;
    if (opts.rawSpecies && opts.rawSpecies.length && master.hasSpecies) {
      const raw = new Set(opts.rawSpecies);
      sub = sub.filter(r => raw.has(r.Species));
      if (!sub.length) return null;
    }
    if (opts.keep) {
      sub = sub.filter(opts.keep);   // the chart filters (crossfilter.js), when given
      if (!sub.length) return null;
    }
    return sub;
  }
  // The four numbers: Total animals (the loader's two copies of a WA-to-WA row count once),
  // Unique CVIs (null without a CVI column), Premises and Top species. CVI counts premises from the box rows with
  // coordinates; with these rules that is the premises on the map (built = build(master, opts)), and null when
  // the table has no premises coordinates (CVI shows 0). Null when no row matches.
  function summary(master, opts, built) {
    const sub = summaryRows(master, opts);
    if (!sub) return null;
    const b = built || build(master, opts);
    const total = SUM().dedupeVolume(sub).reduce((t, r) => (r['Total.Animals'] === null ? t : t + r['Total.Animals']), 0);
    return { total_animals: total, n_cvis: master.header.includes('CVI') ? SUM().uniqueCvis(sub) : null,
      n_premises: b.missingCoordinates.length ? null : b.premises.length,
      top_species: SUM().topSpecies(sub, opts.species.length === 1 && master.hasSpecies) };
  }
  const columns = cs => (cs.length === 1 ? 'the column ' : 'the columns ')
    + (cs.length === 1 ? cs[0] : cs.slice(0, -1).join(', ') + ' and ' + cs[cs.length - 1]);
  const needsCoordinates = missing => 'Needs ' + columns(missing) + ' in the CVI master table.';
  const PREMISES_SHORT = 'Needs premises coordinates';
  // Both animal numbers stay, each explained, as on the WA map.
  const HELP_TOTAL = 'Animals moved to or from the selected counties, as the direction shows. A movement within Washington '
    + 'counts once. Rows without a usable premises location still count here.';
  // The strip's animals label (CVI: "Animals: "), named for what it counts, as its help says.
  const STRIP_ANIMALS = 'Animals at mapped premises: ';
  const HELP_STRIP = 'The total of the premises on the map. A movement within Washington between two premises in the selected '
    + 'counties counts at both of them when both directions are shown, so this can be more than Total animals; rows without '
    + 'a usable premises location are left out, so it can also be less.';
  // The boxes: the WA map's boxes with "Premises" (CVI: icon buildings, a whole number without separators) in place of
  // "WA counties", grayed with the missing columns when premises cannot be placed (as Unique CVIs without a CVI column).
  // o.noCounty: a master is loaded but no county is ticked, so the boxes say what to do (CVI's "Load a master…" read
  // as if the data had not arrived).
  function valueBoxes(s, missing, o) {
    if (!s && o && o.noCounty) return { state: 'alert', icon: 'info-circle',
      lines: ['Tick a county under Focus county / counties to see its numbers.'] };
    if (!s) return SUM().valueBoxes(null);
    const vb = SUM().valueBoxes(Object.assign({}, s, { n_counties: 0 }));
    vb.metrics[0] = Object.assign({}, vb.metrics[0], { help: HELP_TOTAL });
    const m = { label: 'Premises', icon: 'buildings', accent: '#5d6873' };
    vb.metrics[2] = s.n_premises === null
      ? Object.assign(m, { text: '—', zero: false, disabled: true, reason: needsCoordinates(missing || COORDS),
        short: PREMISES_SHORT })
      : Object.assign(m, { text: String(s.n_premises), zero: s.n_premises === 0 });
    return vb;
  }
  // The strip from the premises on the map (built): Focus (counties in pick order), Period, Animals (the premises'
  // total, a WA-to-WA movement at both its premises) and Premises with importers and exporters. CVI's two prompts
  // otherwise. Deliberate differences: without premises coordinates the strip says which columns are missing (CVI: "No
  // records match"); rows left off the map for an unusable location are counted; in Combined with one
  // direction empty the other direction's premises are summarized (CVI's builder errors and shows none).
  function strip(opts, built) {
    if (!opts.counties.length) return { state: 'message', lines: ['Select one or more focus counties in the sidebar to populate the map.'] };
    if (built.missingCoordinates.length) return { state: 'message',
      lines: ['Premises cannot be placed. ' + needsCoordinates(built.missingCoordinates)] };
    const ps = built.premises, left = built.omittedRows;
    const leftText = S().comma(left) + (left === 1 ? ' row' : ' rows') + ' without a usable premises location';
    if (!ps.length) return { state: 'message', lines: left ? ['No premises can be placed: ' + leftText + '.']
      : ['No records match the selected counties + filters.'] };
    const sum = ps.reduce((t, p) => t + p.total_animals, 0), nIn = ps.filter(p => p.direction === 'Inbound').length;
    const items = [
      { label: 'Focus: ', text: opts.counties.join(', ') },
      { label: 'Period: ', text: SUM().periodLabel(opts.years, opts.quarters) },
      { label: STRIP_ANIMALS, text: S().formatR([sum])[0], help: HELP_STRIP },
      { label: 'Premises: ', text: ps.length + ' (' + nIn + ' importer, ' + (ps.length - nIn) + ' exporter)' }];
    if (left) items.push({ label: 'Not on the map: ', text: leftText });
    return { state: 'summary', items };
  }

  // ── Page defaults and fit (CVI's County Focus inputs and fit_intrastate) ───────────────────────────────────────
  // CVI's defaults (its control definitions and reset_filters): no counties, Combined, Overlapping, every species group,
  // no refine, every year and quarter, Logarithmic with 5 bins, 80% opacity, county labels and outlines on, Auto label
  // and boundary styles, circles shown. Basemap: the page's offline map (S3, a deliberate difference).
  function resetDefaults(master) {
    return { counties: [], direction: 'combined', mode: 'overlap', species: master ? master.speciesChoices.slice() : [],
      speciesSub: [], years: master ? master.yearChoices.slice() : [], quarters: ['Q1', 'Q2', 'Q3', 'Q4'],
      scaling: 'log', nBins: 5, opacity: '0.8', labels: true, outlines: true, labelStyle: 'auto', boundaryStyle: 'auto',
      hide: false, group: true };
  }
  // The box "Fit to selected counties" and the auto-zoom show: the selected counties' polygons (every part, from the
  // bundled outlines; CVI: sf::st_bbox of its county polygons) widened by 0.3 degrees on each side. Null without a
  // selected county the outlines know.
  function fitBox(counties, picks, pad) {
    const want = new Set(picks || []), p = pad === undefined ? 0.3 : pad, b = [Infinity, Infinity, -Infinity, -Infinity];
    counties.features.forEach(f => {
      if (!want.has(f.properties.name) || !f.geometry) return;
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      polys.forEach(poly => poly.forEach(ring => ring.forEach(([x, y]) => {
        b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
      })));
    });
    return Number.isFinite(b[0]) ? [b[0] - p, b[1] - p, b[2] + p, b[3] + p] : null;
  }

  root.CVIWA = root.CVIWA || {};
  root.CVIWA.focus = { build, premisesKey, countyChoices, popup, popupData, popupHtml, tooltipHtml, speciesJson, COORDS,
    summaryRows, summary, valueBoxes, strip,
    HELP_TOTAL, HELP_STRIP, STRIP_ANIMALS, resetDefaults, fitBox };
})(typeof window !== 'undefined' ? window : globalThis);
