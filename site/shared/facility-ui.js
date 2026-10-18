/* Facility layer list with per-layer refine lists. Selections live in the caller's state object; the caller's
 * page supplies the "Show: All · Clear" links.
 * Element IDs are built from the scope and list positions, never from file keys or values, and stay the
 * same between renders, so keyboard focus and list scroll positions can be restored after a re-render. */
(function (root) {
  'use strict';

  // Run rebuild(), then put focus and scroll positions back on the elements with the same IDs.
  function preserve(container, rebuild) {
    const active = document.activeElement;
    const focusId = active && active.id && container.contains(active) ? active.id : null;
    const scrolled = Array.from(container.querySelectorAll('[id]'))
      .filter(e => e.scrollTop > 0).map(e => [e.id, e.scrollTop]);
    rebuild();
    scrolled.forEach(([id, top]) => { const e = document.getElementById(id); if (e) e.scrollTop = top; });
    if (focusId) {
      const e = document.getElementById(focusId);
      if (e && !e.disabled) e.focus({ preventScroll: true });
    }
  }

  // Rebuild the layer list in the container, keeping focus and scroll positions.
  function render(container, prepared, state, changed, scope, options) {
    options = options || {};
    preserve(container, () => build(container, prepared, state, changed, scope, options));
  }

  function el(tag, text) {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    return e;
  }

  // Fill the container with the layer rows, under their group headings.
  function build(container, prepared, state, changed, scope, options) {
    const F = root.WSDA.facilities;
    container.replaceChildren();
    F.groups(prepared.layers).forEach(g => {
      const group = el('h3', g.group);
      group.className = 'fac-grp';
      container.append(group);
      prepared.layers.filter(l => g.keys.includes(l.key)).forEach(l => {
        container.append(layerRow(l, prepared.layers.indexOf(l), state, changed, scope, options));
      });
    });
  }

  // One layer's row: its checkbox, mark and name, its count, any omission note and its attribute filters.
  function layerRow(l, index, state, changed, scope, options) {
    const F = root.WSDA.facilities;
    const row = el('div'), label = el('label'), input = el('input');
    row.className = 'facility-layer';
    input.type = 'checkbox'; input.id = scope + '-layer-' + index; input.value = l.key;
    input.disabled = !l.usable; input.checked = state.selectedLayers.includes(l.key);
    input.dataset.layerIndex = index;
    input.addEventListener('change', () => {
      const on = new Set(state.selectedLayers);
      if (input.checked) on.add(l.key); else on.delete(l.key);
      state.selectedLayers = [...on];
      changed();
    });
    const swatch = F.markElement(l, 18);
    swatch.classList.add('fac-dot');
    const title = el('span', l.liveLabel);
    title.className = 'facility-title';
    label.className = 'fac-row' + (l.usable ? '' : ' unusable');
    label.append(input, swatch, title);
    row.append(label);

    const shown = l.usable && input.checked;
    if (shown && options.counts) {
      const n = el('span', ' — ' + (options.counts[l.key] || 0));
      n.className = 'facility-local-count';
      label.append(n);
      if (!options.counts[l.key]) {
        row.append(el('p', options.emptyReason || 'No facilities match the selected counties and attributes.'));
      }
    }
    if (!l.usable) {
      const why = el('p', options.reason ? options.reason(l.key) : l.reason);
      why.className = 'fac-why';
      row.append(why);
    } else if (l.dropped || l.outOfRange) {
      const why = el('p', options.reason ? options.reason(l.key)
        : (l.dropped + l.outOfRange) + ' rows omitted: ' + l.dropped + ' without numeric coordinates; '
          + l.outOfRange + ' outside valid coordinate ranges.');
      why.className = 'fac-why';
      row.append(why);
    }
    if (shown) {
      const columns = Object.keys(l.choices);
      if (!columns.length) row.append(el('p', 'No eligible attribute filters in this file.'));
      else row.append(filterFold(l, index, columns, state, changed, scope));
    }
    return row;
  }

  // A layer's attribute filters fold away so long lists do not fill the sidebar. The fold
  // starts closed, its header says how many filters are on, and open or closed is kept between re-renders.
  const openFolds = new Set();
  function filterFold(l, index, columns, state, changed, scope) {
    const fold = el('details'), summary = el('summary', 'Filter by attributes'), note = el('span');
    const memory = scope + ':' + l.key;
    const picked = state.attributes[l.key] || {};
    const on = columns.filter(h => (picked[h] || []).length).length;
    fold.className = 'facility-filters';
    fold.id = scope + '-filters-' + index;
    fold.open = openFolds.has(memory);
    fold.addEventListener('toggle', () => {
      if (fold.open) openFolds.add(memory); else openFolds.delete(memory);
    });
    note.className = 'fold-sum';
    note.textContent = on ? on + (on === 1 ? ' filter on' : ' filters on') : '';
    summary.append(note);
    fold.append(summary);
    columns.forEach((h, j) => fold.append(refineList(l, h, scope + '-refine-' + index + '-' + j, j, state, changed)));
    fold.append(el('p', 'None ticked = no restriction.'));
    return fold;
  }

  // One ticked list per eligible column: any ticked value matches; empty means no restriction.
  function refineList(l, h, id, j, state, changed) {
    const F = root.WSDA.facilities;
    const picks = () => (state.attributes[l.key] && state.attributes[l.key][h]) || [];
    const set = values => {
      if (!state.attributes[l.key]) state.attributes[l.key] = Object.create(null);
      state.attributes[l.key][h] = values;
      changed();
    };
    const block = el('div'), head = el('div'), name = el('span', F.pretty(h)), links = el('span'), clear = el('button', 'Clear');
    block.className = 'facility-refine-block';
    head.className = 'ctl-row';
    name.className = 'ctl'; name.id = id + '-label';
    links.className = 'links';
    clear.type = 'button'; clear.id = id + '-clear'; clear.dataset.refineClear = '';
    clear.addEventListener('click', () => set([]));
    links.append(clear);
    head.append(name, links);
    const list = el('div');
    list.className = 'checklist facility-refine'; list.id = id;
    list.setAttribute('role', 'group'); list.setAttribute('aria-labelledby', name.id);
    list.dataset.columnIndex = j;
    l.choices[h].forEach((v, k) => {
      const option = el('label'), box = el('input');
      box.type = 'checkbox'; box.id = id + '-' + k; box.value = v; box.checked = picks().includes(v);
      box.addEventListener('change', () => {
        const chosen = new Set(picks());
        if (box.checked) chosen.add(v); else chosen.delete(v);
        set(l.choices[h].filter(x => chosen.has(x)));
      });
      option.append(box, document.createTextNode(' ' + v));
      list.append(option);
    });
    block.append(head, list);
    return block;
  }

  root.WSDA = root.WSDA || {};
  root.WSDA.facilityUI = { render, preserve };
})(typeof window !== 'undefined' ? window : globalThis);
