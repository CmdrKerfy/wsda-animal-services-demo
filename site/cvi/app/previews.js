/* The CVI page's three preview dialogs (S7): Preview Map Data, Preview Stats and Preview Charts, as CVI's
 * Export & Preview section shows them (mod_maps.R), with CVI's titles, footers and Close button. The contents come
 * from exports.js (the Map Data rows and the Stats text) and chartsvg.js (the chart PNGs an export writes).
 *
 * The Map Data table is page code, no table library: a search box, a text filter on every column,
 * sorting by a column header and 15 rows per page, as CVI's DT table (filter = "top", dom = "ftip"). CVI's DT shows
 * a range slider over a number column; here a number column's filter box matches the number's text (a recorded
 * difference). The search and the filters match word by word, as DT's smart search.
 *
 * One dialog element is reused (the browser's own <dialog>: keyboard focus stays inside and returns to the button
 * that opened it). Escape closes it, also from the search box (page code; Safari's search box keeps Escape). A
 * click on the dimmed page around it also closes it (CVI's easyClose), but not a drag that starts inside it. */
(function (root) {
  'use strict';
  const doc = root.document;
  const PAGE_SIZE = 15;   // CVI's pageLength

  const el = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  // ── The table's rules (pure) ───────────────────────────────────────────────────────────────────────────────
  // A cell's text: a number as JavaScript writes it (as DT shows it), a missing value empty.
  const cellText = v => (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v)) ? '' : String(v));
  // DT's smart search: the text split into words at spaces, a phrase in double quotes kept as one word, ignoring
  // case. A row matches when it holds every word, each anywhere in it ("king inbound" finds King's inbound rows).
  const words = text => ((text || '').toLowerCase().match(/"[^"]*"|[^\s"]+/g) || [])
    .map(w => w.replace(/"/g, '')).filter(w => w.trim());
  const holdsAll = (text, ws) => ws.every(w => text.indexOf(w) >= 0);
  // Rows matching the search (in all their cells together, joined as DT joins them) and every column filter (in that
  // column's cell).
  function filterRows(rows, search, columnFilters) {
    const s = words(search);
    const cf = (columnFilters || []).map(words);
    return rows.filter(r => {
      if (s.length && !holdsAll(r.map(v => cellText(v).toLowerCase()).join('  '), s)) return false;
      return cf.every((ws, j) => !ws.length || holdsAll(cellText(r[j]).toLowerCase(), ws));
    });
  }
  // Rows sorted by one column: numbers by value, text in the browser's order; missing values first going up. The
  // sort is stable, so equal values keep the table's own order.
  function sortRows(rows, column, descending) {
    if (column === null || column === undefined) return rows.slice();
    const key = v => (v === null || v === undefined || v === '' ? null : v);
    const out = rows.map((r, i) => ({ r, i }));
    out.sort((a, b) => {
      const x = key(a.r[column]), y = key(b.r[column]);
      let c;
      if (x === null || y === null) c = x === null ? (y === null ? 0 : -1) : 1;
      else if (typeof x === 'number' && typeof y === 'number') c = x - y;
      else c = String(x).localeCompare(String(y), 'en');
      if (descending) c = -c;
      return c || a.i - b.i;
    });
    return out.map(o => o.r);
  }
  // The rows of one page and DT's line under the table ("Showing 1 to 15 of 120 entries", with "(filtered from …)"
  // when a search or filter is on).
  function pageOf(rows, page, total) {
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const p = Math.min(Math.max(0, page), pages - 1);
    const shown = rows.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);
    const n = x => x.toLocaleString('en-US');
    let info = rows.length ? 'Showing ' + n(p * PAGE_SIZE + 1) + ' to ' + n(p * PAGE_SIZE + shown.length) + ' of '
      + n(rows.length) + ' entries' : 'Showing 0 to 0 of 0 entries';
    if (rows.length !== total) info += ' (filtered from ' + n(total) + ' total entries)';
    return { rows: shown, page: p, pages, info };
  }

  // ── The dialog ─────────────────────────────────────────────────────────────────────────────────────────────
  let dialog = null;
  let cleanup = null;   // what to undo when the dialog closes (object URLs of chart pictures)
  // The preview dialog, built on first use and kept.
  function ensureDialog() {
    if (dialog) return dialog;
    dialog = el('dialog', 'preview-dialog');
    dialog.id = 'preview-dialog';
    dialog.setAttribute('aria-labelledby', 'preview-title');
    const head = el('div', 'preview-head');
    const title = el('h2', 'preview-title');
    title.id = 'preview-title';
    const x = el('button', 'preview-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', close);
    head.append(title, x);
    const body = el('div', 'preview-body');
    body.id = 'preview-body';
    const foot = el('div', 'preview-foot');
    const note = el('span', 'preview-note');
    note.id = 'preview-note';
    const btn = el('button', 'btn', 'Close');
    btn.type = 'button';
    btn.id = 'preview-close';
    btn.addEventListener('click', close);
    foot.append(note, btn);
    dialog.append(head, body, foot);
    // Escape closes the dialog wherever the focus is inside it, as CVI's dialog. Safari lets the search box keep an
    // Escape press for itself, so without this the Map Data dialog (opened with the focus in its search box) stays
    // open there.
    dialog.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close();
    });
    // A click on the backdrop lands on the dialog element itself, outside its box. It closes the dialog only when the
    // press began there too: selecting text inside and releasing the mouse outside also gives such a click
    // (Bootstrap's modal, CVI's easyClose, ignores it too).
    const onBackdrop = e => {
      if (e.target !== dialog) return false;
      const r = dialog.getBoundingClientRect();
      return !(e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom);
    };
    let pressedOnBackdrop = false;
    dialog.addEventListener('pointerdown', e => { pressedOnBackdrop = onBackdrop(e); });
    dialog.addEventListener('click', e => {
      if (pressedOnBackdrop && onBackdrop(e)) close();
      pressedOnBackdrop = false;
    });
    // The close event comes a moment after closing; by then the dialog may have been opened again.
    dialog.addEventListener('close', () => {
      if (dialog.open) return;
      releasePictures();
      dialog.querySelector('#preview-body').replaceChildren();
    });
    doc.body.appendChild(dialog);
    return dialog;
  }
  // Frees what the last contents held (their chart pictures' object URLs).
  function releasePictures() {
    if (cleanup) cleanup();
    cleanup = null;
  }
  // Opens the dialog with a title, a body element, the footer's note and a size ('xl' or 'l', as CVI's); an open
  // dialog takes the new contents.
  function open(title, body, note, size) {
    const d = ensureDialog();
    releasePictures();
    d.className = 'preview-dialog ' + (size === 'l' ? 'size-l' : 'size-xl');
    d.querySelector('#preview-title').textContent = title;
    d.querySelector('#preview-body').replaceChildren(body);
    d.querySelector('#preview-note').textContent = note;
    if (!d.open) d.showModal();
    d.querySelector('#preview-body').scrollTop = 0;
    return d;
  }
  function close() {
    if (dialog && dialog.open) dialog.close();
  }

  // ── Preview Map Data ───────────────────────────────────────────────────────────────────────────────────────
  // preview: exports.mapDataPreview() ({ title, columns, rows, footer }).
  function showMapData(preview) {
    const columns = preview.columns, all = preview.rows;
    const numeric = columns.map((c, j) => all.length > 0 && all.every(r => r[j] === null || typeof r[j] === 'number'));
    const state = { search: '', filters: columns.map(() => ''), sortColumn: null, descending: false, page: 0 };
    const wrap = el('div', 'dt');
    const top = el('div', 'dt-top');
    const searchLabel = el('label', null, 'Search: ');
    const search = el('input');
    search.type = 'search';
    search.className = 'dt-search';
    searchLabel.appendChild(search);
    top.appendChild(searchLabel);
    const scroll = el('div', 'dt-scroll');
    const table = el('table', 'dt-table');
    const thead = el('thead');
    const headRow = el('tr');
    const filterRow = el('tr', 'dt-filters');
    const tbody = el('tbody');
    const info = el('div', 'dt-info');
    info.setAttribute('role', 'status');
    const pager = el('div', 'dt-pager');
    pager.setAttribute('role', 'navigation');
    pager.setAttribute('aria-label', 'Table pages');

    columns.forEach((c, j) => {
      const th = el('th');
      th.setAttribute('aria-sort', 'none');
      const b = el('button', 'dt-sort', c);
      b.type = 'button';
      b.title = 'Sort by ' + c;
      b.addEventListener('click', () => {
        state.descending = state.sortColumn === j ? !state.descending : false;
        state.sortColumn = j;
        state.page = 0;
        draw();
      });
      th.appendChild(b);
      if (numeric[j]) th.classList.add('num');
      headRow.appendChild(th);
      const fc = el('th');
      const fi = el('input', 'dt-filter');
      fi.type = 'text';
      fi.placeholder = 'All';
      fi.setAttribute('aria-label', 'Filter ' + c);
      fi.addEventListener('input', () => {
        state.filters[j] = fi.value;
        state.page = 0;
        draw();
      });
      fc.appendChild(fi);
      filterRow.appendChild(fc);
    });
    thead.append(headRow, filterRow);
    table.append(thead, tbody);
    scroll.appendChild(table);
    wrap.append(top, scroll, info, pager);
    search.addEventListener('input', () => {
      state.search = search.value;
      state.page = 0;
      draw();
    });

    // A pager button that goes to a page of the table.
    function pageButton(text, page, disabled, current) {
      const b = el('button', 'dt-page' + (current ? ' current' : ''), text);
      b.type = 'button';
      b.disabled = disabled;
      if (current) b.setAttribute('aria-current', 'page');
      b.addEventListener('click', () => {
        state.page = page;
        draw();
      });
      return b;
    }
    // Redraws the table for the current search, column filters, sort and page.
    function draw() {
      const matched = filterRows(all, state.search, state.filters);
      const view = pageOf(sortRows(matched, state.sortColumn, state.descending), state.page, all.length);
      state.page = view.page;
      tbody.replaceChildren();
      if (!view.rows.length) {
        const tr = el('tr');
        const td = el('td', 'dt-empty', 'No matching records found');
        td.colSpan = columns.length;
        tr.appendChild(td);
        tbody.appendChild(tr);
      }
      view.rows.forEach(r => {
        const tr = el('tr');
        r.forEach((v, j) => {
          const td = el('td', numeric[j] ? 'num' : null, cellText(v));
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      [...headRow.children].forEach((th, j) => {
        const on = state.sortColumn === j;
        th.setAttribute('aria-sort', on ? (state.descending ? 'descending' : 'ascending') : 'none');
        th.classList.toggle('sorted-up', on && !state.descending);
        th.classList.toggle('sorted-down', on && state.descending);
      });
      info.textContent = view.info;
      pager.replaceChildren(pageButton('Previous', view.page - 1, view.page === 0));
      pageNumbers(view.page, view.pages).forEach(p => {
        if (p === null) pager.appendChild(el('span', 'dt-gap', '…'));
        else pager.appendChild(pageButton(String(p + 1), p, false, p === view.page));
      });
      pager.appendChild(pageButton('Next', view.page + 1, view.page >= view.pages - 1));
    }
    draw();
    open(preview.title, wrap, preview.footer, 'xl');
    search.focus();
    return { draw, state };
  }
  // The page numbers DT shows: all of them up to 7; else the first, the last and those around the current page, with
  // a gap (null) where pages are left out.
  function pageNumbers(page, pages) {
    if (pages <= 7) return [...Array(pages).keys()];
    if (page < 4) return [0, 1, 2, 3, 4, null, pages - 1];
    if (page > pages - 5) return [0, null, pages - 5, pages - 4, pages - 3, pages - 2, pages - 1];
    return [0, null, page - 1, page, page + 1, null, pages - 1];
  }

  // ── Preview Stats ──────────────────────────────────────────────────────────────────────────────────────────
  // preview: exports.statsPreview() ({ title, text, footer }); the text in a fixed-width box, as CVI's.
  function showStats(preview) {
    const pre = el('pre', 'stats-text', preview.text);
    pre.tabIndex = 0;
    open(preview.title, pre, preview.footer, 'l');
  }

  // ── Preview Charts ─────────────────────────────────────────────────────────────────────────────────────────
  // charts: [{ name (the file in charts/), blob (the PNG), alt (the chart's title) }], one under the other with a
  // line between them, as CVI's dialog shows the PNGs its export writes.
  function showCharts(title, charts, footer) {
    const box = el('div', 'chart-previews');
    const urls = [];
    charts.forEach((c, i) => {
      if (i > 0) box.appendChild(el('hr'));
      const fig = el('figure', 'chart-preview');
      fig.dataset.file = c.name;
      const img = el('img');
      const url = root.URL.createObjectURL(c.blob);
      urls.push(url);
      img.src = url;
      img.alt = c.alt;
      const cap = el('figcaption', null, 'charts/' + c.name);
      fig.append(img, cap);
      box.appendChild(fig);
    });
    open(title, box, footer, 'xl');
    cleanup = () => urls.forEach(u => root.URL.revokeObjectURL(u));
  }

  // Preview Map (S9): the branded PNG (two in Compare), each with its file name, at the dialog's width.
  function showMap(title, pictures, footer) {
    const box = el('div', 'chart-previews map-previews');
    const urls = [];
    pictures.forEach((p, i) => {
      if (i > 0) box.appendChild(el('hr'));
      const fig = el('figure', 'chart-preview');
      fig.dataset.file = p.name;
      const img = el('img');
      const url = root.URL.createObjectURL(p.blob);
      urls.push(url);
      img.src = url;
      img.alt = p.alt;
      fig.append(img, el('figcaption', null, p.name));
      box.appendChild(fig);
    });
    open(title, box, footer, 'xl');
    cleanup = () => urls.forEach(u => root.URL.revokeObjectURL(u));
  }

  root.CVIWA = root.CVIWA || {};
  root.CVIWA.previews = { showMapData, showStats, showCharts, showMap, close, filterRows, sortRows, pageOf, pageNumbers,
    cellText, PAGE_SIZE, isOpen: () => !!(dialog && dialog.open) };
})(typeof window !== 'undefined' ? window : globalThis);
