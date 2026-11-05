// Bill Manager — UI layer: tables (search / sort / filter / paginate), dashboard,
// command palette, toasts, confirm dialog, theme and keyboard shortcuts.
// Loaded after app.js; it (re)defines the render functions app.js calls.
(function () {
    'use strict';

    const LOW_STOCK = 5; // stock at or below this (but > 0) counts as "low"
    const $ = (id) => document.getElementById(id);
    const inr = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const inrShort = (n) => {
        n = Number(n) || 0;
        if (n >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr';
        if (n >= 1e5) return '₹' + (n / 1e5).toFixed(2) + ' L';
        return inr(n).replace(/\.00$/, '');
    };
    const icon = (name) => `<svg class="ic"><use href="#i-${name}"/></svg>`;
    const deb = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

    // ------------------------------------------------------------------
    // Search helpers: every word must match somewhere in the row's haystack
    // ------------------------------------------------------------------
    const tokens = (q) => String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    const matchAll = (hay, toks) => { const h = String(hay).toLowerCase(); return toks.every(t => h.includes(t)); };
    function hl(text, toks) {
        const safe = escHtml(text == null ? '' : text);
        if (!toks || !toks.length) return safe;
        const re = new RegExp('(' + toks.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'ig');
        // highlight only in text nodes of the escaped string (entities are untouched because tokens rarely match them)
        return safe.replace(re, '<mark>$1</mark>');
    }

    function cmp(a, b, dir) {
        const na = typeof a === 'number', nb = typeof b === 'number';
        let r;
        if (a == null || a === '') r = (b == null || b === '') ? 0 : 1;
        else if (b == null || b === '') r = -1;
        else if (na && nb) r = a - b;
        else r = String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
        // empties always last regardless of direction
        if (a == null || a === '' || b == null || b === '') return r;
        return dir === 'asc' ? r : -r;
    }

    // ------------------------------------------------------------------
    // Generic table controller
    // ------------------------------------------------------------------
    function makeTable(cfg) {
        const st = Object.assign({ search: '', page: 1, per: cfg.per || 10, sortKey: cfg.sortKey || null, sortDir: cfg.sortDir || 'asc', filters: {} }, loadPrefs(cfg.name));
        const api = { st, rows: [], filtered: [] };

        function loadPrefs(name) { try { return JSON.parse(localStorage.getItem('bm_tbl_' + name)) || {}; } catch (e) { return {}; } }
        function savePrefs() { try { localStorage.setItem('bm_tbl_' + cfg.name, JSON.stringify({ per: st.per, sortKey: st.sortKey, sortDir: st.sortDir })); } catch (e) { } }

        api.compute = function () {
            const toks = tokens(st.search);
            let rows = cfg.source().filter(r => cfg.filter(r, st.filters, toks));
            if (st.sortKey) {
                const get = cfg.sortValue || ((r, k) => getValueByPath(r, k));
                rows = rows.slice().sort((x, y) => cmp(get(x, st.sortKey), get(y, st.sortKey), st.sortDir));
            }
            api.filtered = rows;
            return rows;
        };

        api.render = function () {
            const rows = api.compute();
            const toks = tokens(st.search);
            const pages = Math.max(1, Math.ceil(rows.length / st.per));
            if (st.page > pages) st.page = pages;
            const start = (st.page - 1) * st.per;
            const pageRows = rows.slice(start, start + st.per);
            const tbody = $(cfg.tbody);
            const total = cfg.source().length;

            if (!rows.length) {
                const filtered = total > 0;
                tbody.innerHTML = `<tr><td colspan="${cfg.cols}" class="empty-state">
                    <div class="big">${filtered ? 'No matches found' : cfg.emptyTitle}</div>
                    <div>${filtered ? 'Try a different search or clear the filters.' : cfg.emptyText}</div>
                    ${filtered ? `<button class="btn" onclick="__tblClear('${cfg.name}')">Clear filters</button>` : (cfg.emptyAction || '')}
                </td></tr>`;
            } else {
                tbody.innerHTML = pageRows.map(r => cfg.row(r, toks)).join('');
            }

            const info = $(cfg.info);
            if (info) info.textContent = rows.length ? `Showing ${start + 1}–${Math.min(rows.length, start + st.per)} of ${rows.length}${rows.length !== total ? ` (filtered from ${total})` : ''}` : (total ? `0 of ${total}` : '');
            renderPager($(cfg.pager), st.page, pages, (p) => { st.page = p; api.render(); });

            // sort indicators
            document.querySelectorAll('#' + cfg.container + ' thead th.sortable').forEach(th => {
                th.classList.toggle('sorted-asc', th.dataset.key === st.sortKey && st.sortDir === 'asc');
                th.classList.toggle('sorted-desc', th.dataset.key === st.sortKey && st.sortDir === 'desc');
                th.setAttribute('aria-sort', th.dataset.key === st.sortKey ? (st.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
            });

            const active = !!(st.search || Object.values(st.filters).some(v => v));
            const clr = $(cfg.clear); if (clr) clr.hidden = !active;
            if (cfg.summary) cfg.summary(rows, active);
        };

        api.reset = function () {
            st.search = ''; st.page = 1; st.filters = {};
            if (cfg.resetUI) cfg.resetUI();
            api.render();
        };

        api.wire = function () {
            const s = $(cfg.searchInput);
            if (s) s.addEventListener('input', deb(e => { st.search = e.target.value; st.page = 1; api.render(); }, 120));
            const per = $(cfg.perPage);
            if (per) { per.value = String(st.per); per.addEventListener('change', e => { st.per = parseInt(e.target.value); st.page = 1; savePrefs(); api.render(); }); }
            document.querySelectorAll('#' + cfg.container + ' thead th.sortable').forEach(th => {
                th.tabIndex = 0;
                const go = () => {
                    const k = th.dataset.key;
                    if (st.sortKey === k) {
                        if (st.sortDir === 'asc') st.sortDir = 'desc'; else { st.sortKey = cfg.sortKey || null; st.sortDir = cfg.sortDir || 'asc'; if (st.sortKey === k) st.sortDir = 'asc'; }
                    } else { st.sortKey = k; st.sortDir = (cfg.defaultDesc || []).includes(k) ? 'desc' : 'asc'; }
                    st.page = 1; savePrefs(); api.render();
                };
                th.addEventListener('click', go);
                th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
            });
            (cfg.filterEls || []).forEach(([id, key]) => {
                const el = $(id); if (!el) return;
                el.addEventListener('change', () => { st.filters[key] = el.value; st.page = 1; if (cfg.onFilter) cfg.onFilter(key, el.value); api.render(); });
            });
            const clr = $(cfg.clear); if (clr) clr.addEventListener('click', api.reset);
            const ex = $(cfg.exportBtn);
            if (ex) ex.addEventListener('click', () => exportView(cfg, api));
        };
        return api;
    }

    window.__tblClear = (name) => { const t = tables[name]; if (t) t.reset(); };

    function renderPager(el, page, pages, go) {
        if (!el) return;
        if (pages <= 1) { el.innerHTML = ''; return; }
        const set = new Set([1, pages, page, page - 1, page + 1]);
        const list = [...set].filter(p => p >= 1 && p <= pages).sort((a, b) => a - b);
        let html = `<button data-p="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Previous page">‹</button>`;
        let prev = 0;
        list.forEach(p => { if (p - prev > 1) html += '<button disabled>…</button>'; html += `<button data-p="${p}" class="${p === page ? 'on' : ''}">${p}</button>`; prev = p; });
        html += `<button data-p="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="Next page">›</button>`;
        el.innerHTML = html;
        el.querySelectorAll('button[data-p]').forEach(b => b.addEventListener('click', () => go(parseInt(b.dataset.p))));
    }

    function csvCell(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
    function exportView(cfg, api) {
        const rows = api.filtered;
        if (!rows.length) { toast('Nothing to export — the current view is empty', 'error'); return; }
        const cols = cfg.csv;
        const out = [cols.map(c => csvCell(c.label)).join(',')].concat(rows.map(r => cols.map(c => csvCell(c.get(r))).join(','))).join('\n');
        downloadBlob(new Blob(['﻿' + out], { type: 'text/csv;charset=utf-8' }), `${cfg.name}_${new Date().toISOString().slice(0, 10)}.csv`);
        toast(`Exported ${rows.length} row${rows.length > 1 ? 's' : ''}`, 'success');
    }

    // ------------------------------------------------------------------
    // Domain helpers
    // ------------------------------------------------------------------
    const todayStr = () => new Date().toISOString().slice(0, 10);
    const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
    const iso = (d) => { const x = new Date(d); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
    const stockLevel = (i) => { const s = Number(i.stock) || 0; return s <= 0 ? 'out' : s <= LOW_STOCK ? 'low' : 'in'; };
    const statusBadge = (s) => {
        const k = String(s || '').toLowerCase();
        const cls = k === 'paid' ? 'success' : k === 'pending' ? 'warning' : k === 'unpaid' ? 'danger' : 'muted';
        return `<span class="badge badge-${cls}">${escHtml(s || 'N/A')}</span>`;
    };
    const billTotal = (b) => Number(b.total) || 0;

    function dateRange(rangeKey, from, to) {
        const t = todayStr();
        switch (rangeKey) {
            case 'today': return [t, t];
            case '7': return [iso(addDays(new Date(), -6)), t];
            case '30': return [iso(addDays(new Date(), -29)), t];
            case 'month': return [t.slice(0, 8) + '01', t];
            case 'custom': return [from || '', to || ''];
            default: return ['', ''];
        }
    }

    // ------------------------------------------------------------------
    // Tables
    // ------------------------------------------------------------------
    const tables = {};

    tables.bills = makeTable({
        name: 'bills', container: 'billsTableContainer', tbody: 'billsTableBody', info: 'billsPaginationInfo', pager: 'billsPager',
        perPage: 'billsPerPage', searchInput: 'billsSearch', clear: 'billsClear', exportBtn: 'billsExportView', cols: 8, per: 10,
        sortKey: 'date', sortDir: 'desc', defaultDesc: ['date', 'total'],
        source: () => bills,
        emptyTitle: 'No bills yet', emptyText: 'Create your first bill to see it here.',
        emptyAction: '<button class="btn btn-primary" onclick="showNewBillForm()">Create a bill</button>',
        filterEls: [['billsStatusFilter', 'status'], ['billsPayFilter', 'pay'], ['billsRange', 'range'], ['billsFrom', 'from'], ['billsTo', 'to']],
        onFilter: (k, v) => { if (k === 'range') $('billsCustomRange').hidden = v !== 'custom'; },
        resetUI: () => { ['billsSearch', 'billsStatusFilter', 'billsPayFilter', 'billsRange', 'billsFrom', 'billsTo'].forEach(id => { const e = $(id); if (e) e.value = ''; }); $('billsCustomRange').hidden = true; },
        sortValue: (b, k) => k === 'items' ? (b.items || []).length : k === 'date' ? (b.date || '') + '|' + (b.timestamp || '') : getValueByPath(b, k),
        filter: (b, f, toks) => {
            if (f.status && String(b.status || '').toLowerCase() !== f.status.toLowerCase()) return false;
            if (f.pay && String(b.paymentMode || '').toLowerCase() !== f.pay.toLowerCase()) return false;
            const [from, to] = dateRange(f.range, f.from, f.to);
            if (from && (b.date || '') < from) return false;
            if (to && (b.date || '') > to) return false;
            if (!toks.length) return true;
            const c = b.customer || {};
            const hay = [b.invoiceNo, b.date, c.name, c.phone, c.address, b.paymentMode, b.status, b.total].concat((b.items || []).map(i => `${i.name} ${i.hsn || ''}`)).join(' ');
            return matchAll(hay, toks);
        },
        row: (b, toks) => {
            const c = b.customer || {};
            const n = (b.items || []).length;
            const first = n ? b.items[0].name : '';
            return `<tr class="clickable" onclick="viewBill('${b.id}')">
                <td><span class="cell-main mono">${hl(b.invoiceNo, toks)}</span></td>
                <td>${escHtml(formatDate(b.date))}</td>
                <td>${c.name ? `<span class="cell-main">${hl(c.name, toks)}</span>` : '<span class="muted">Walk-in</span>'}${c.phone ? `<span class="cell-sub">${hl(c.phone, toks)}</span>` : ''}</td>
                <td>${n} item${n === 1 ? '' : 's'}<span class="cell-sub">${escHtml(first)}${n > 1 ? ` +${n - 1} more` : ''}</span></td>
                <td>${escHtml(b.paymentMode || '—')}</td>
                <td>${statusBadge(b.status)}</td>
                <td class="num"><strong>${inr(billTotal(b))}</strong></td>
                <td class="actions-col" onclick="event.stopPropagation()"><div class="table-actions">
                    ${String(b.status).toLowerCase() !== 'paid' ? `<button class="icon-btn ok" title="Mark as paid" aria-label="Mark as paid" onclick="markBillPaid('${b.id}')">${icon('check')}</button>` : ''}
                    <button class="icon-btn" title="View" aria-label="View" onclick="viewBill('${b.id}')">${icon('eye')}</button>
                    <button class="icon-btn danger" title="Delete" aria-label="Delete" onclick="deleteBill('${b.id}')">${icon('trash')}</button>
                </div></td></tr>`;
        },
        summary: (rows, active) => {
            const sum = rows.reduce((s, b) => s + billTotal(b), 0);
            const unpaid = rows.filter(b => String(b.status).toLowerCase() !== 'paid').reduce((s, b) => s + billTotal(b), 0);
            const el = $('billsSummary');
            if (!bills.length) { el.innerHTML = ''; return; }
            const st = tables.bills.st.filters.status || '';
            el.innerHTML = `<span class="chip">Bills <b>${rows.length}</b></span>
                <span class="chip">Total <b>${inr(sum)}</b></span>
                <span class="chip">Outstanding <b>${inr(unpaid)}</b></span>
                <span style="flex:1"></span>
                ${['Paid', 'Unpaid', 'Pending'].map(s => `<button class="chip ${st === s ? 'on' : ''}" data-q="${s}">${s}</button>`).join('')}`;
            el.querySelectorAll('button[data-q]').forEach(b => b.addEventListener('click', () => {
                const sel = $('billsStatusFilter');
                sel.value = sel.value === b.dataset.q ? '' : b.dataset.q;
                sel.dispatchEvent(new Event('change'));
            }));
        },
        csv: [
            { label: 'Invoice No', get: b => b.invoiceNo }, { label: 'Date', get: b => b.date },
            { label: 'Customer', get: b => (b.customer || {}).name }, { label: 'Phone', get: b => (b.customer || {}).phone },
            { label: 'Address', get: b => (b.customer || {}).address }, { label: 'Payment Mode', get: b => b.paymentMode },
            { label: 'Status', get: b => b.status },
            { label: 'Items', get: b => (b.items || []).map(i => `${i.name} (${i.qty} x ${i.rate})`).join('; ') },
            { label: 'Total w/o GST', get: b => getBillTotals(b).subtotal }, { label: 'Total GST', get: b => getBillTotals(b).totalGst },
            { label: 'Total', get: b => b.total }
        ]
    });

    tables.inventory = makeTable({
        name: 'inventory', container: 'inventoryTableContainer', tbody: 'inventoryTableBody', info: 'invPaginationInfo', pager: 'invPager',
        perPage: 'invPerPage', searchInput: 'invSearch', clear: 'invClear', exportBtn: 'invExportView', cols: 9, per: 25,
        sortKey: 'name', sortDir: 'asc',
        source: () => inventory,
        emptyTitle: 'Inventory is empty', emptyText: 'Add your first item to start tracking stock.',
        emptyAction: '<button class="btn btn-primary" onclick="showNewInventoryForm()">Add an item</button>',
        filterEls: [['invStockFilter', 'stock'], ['invGstFilter', 'gst']],
        resetUI: () => ['invSearch', 'invStockFilter', 'invGstFilter'].forEach(id => { const e = $(id); if (e) e.value = ''; }),
        sortValue: (i, k) => k === 'priceExGst' ? (i.priceExGst != null ? i.priceExGst : i.rate) : k === 'priceInclGst' ? (i.priceInclGst != null ? i.priceInclGst : i.rate) : k === 'stock' ? (Number(i.stock) || 0) : k === 'gstRate' ? (Number(i.gstRate) || 0) : getValueByPath(i, k),
        filter: (i, f, toks) => {
            if (f.stock) { const l = stockLevel(i); if (f.stock === 'attention' ? l === 'in' : l !== f.stock) return false; }
            if (f.gst !== '' && f.gst != null && String(Number(i.gstRate) || 0) !== f.gst) return false;
            if (!toks.length) return true;
            return matchAll([i.code, i.name, i.partNumber, i.hsn, i.description].join(' '), toks);
        },
        row: (i, toks) => {
            const l = stockLevel(i);
            const badge = l === 'out' ? '<span class="badge badge-danger">Out</span>' : l === 'low' ? '<span class="badge badge-warning">Low</span>' : '<span class="badge badge-success">In stock</span>';
            const ex = i.priceExGst != null ? i.priceExGst : i.rate;
            const inc = i.priceInclGst != null ? i.priceInclGst : i.rate;
            return `<tr>
                <td><span class="mono cell-main">${hl(i.code, toks)}</span></td>
                <td><span class="cell-main">${hl(i.name, toks)}</span>${i.description ? `<span class="cell-sub">${escHtml(i.description.length > 70 ? i.description.slice(0, 70) + '…' : i.description)}</span>` : ''}</td>
                <td>${i.partNumber ? `<span class="mono">${hl(i.partNumber, toks)}</span>` : '<span class="muted">—</span>'}</td>
                <td>${hl(i.hsn || '—', toks)}</td>
                <td class="num">${fmtRate(i.gstRate)}</td>
                <td class="num">${inr(ex)}</td>
                <td class="num">${inr(inc)}</td>
                <td class="num"><span class="stock-num">${Number(i.stock) || 0}</span>${badge}</td>
                <td class="actions-col"><div class="table-actions">
                    <button class="icon-btn" title="Adjust stock" aria-label="Adjust stock" onclick="goAdjustStock('${i.id}')">${icon('stock')}</button>
                    <button class="icon-btn" title="Edit" aria-label="Edit" onclick="editInventoryItem('${i.id}')">${icon('edit')}</button>
                    <button class="icon-btn danger" title="Delete" aria-label="Delete" onclick="deleteInventoryItem('${i.id}')">${icon('trash')}</button>
                </div></td></tr>`;
        },
        summary: (rows) => {
            const el = $('invSummary');
            if (!inventory.length) { el.innerHTML = ''; return; }
            const c = { in: 0, low: 0, out: 0 };
            inventory.forEach(i => c[stockLevel(i)]++);
            const value = rows.reduce((s, i) => s + (Number(i.stock) || 0) * (Number(i.priceExGst != null ? i.priceExGst : i.rate) || 0), 0);
            const cur = tables.inventory.st.filters.stock || '';
            el.innerHTML = `<span class="chip">Items <b>${rows.length}</b></span><span class="chip">Stock value (w/o GST) <b>${inr(value)}</b></span><span style="flex:1"></span>
                <button class="chip ${cur === 'in' ? 'on' : ''}" data-s="in">In stock <b>${c.in}</b></button>
                <button class="chip ${cur === 'low' ? 'on' : ''}" data-s="low">Low <b>${c.low}</b></button>
                <button class="chip ${cur === 'out' ? 'on' : ''}" data-s="out">Out <b>${c.out}</b></button>`;
            el.querySelectorAll('button[data-s]').forEach(b => b.addEventListener('click', () => setInvStockFilter(cur === b.dataset.s ? '' : b.dataset.s)));
        },
        csv: [
            { label: 'Item Code', get: i => i.code }, { label: 'Item Name', get: i => i.name }, { label: 'Part Number', get: i => i.partNumber },
            { label: 'HSN', get: i => i.hsn }, { label: 'GST %', get: i => i.gstRate },
            { label: 'Price w/o GST', get: i => i.priceExGst != null ? i.priceExGst : i.rate },
            { label: 'Price with GST', get: i => i.priceInclGst != null ? i.priceInclGst : i.rate },
            { label: 'Stock', get: i => i.stock || 0 }, { label: 'Description', get: i => i.description }
        ]
    });

    tables.stock = makeTable({
        name: 'stock', container: 'stockHistoryContainer', tbody: 'stockHistoryBody', info: 'histPaginationInfo', pager: 'histPager',
        perPage: 'histPerPage', searchInput: 'histSearch', clear: 'histClear', exportBtn: 'histExportView', cols: 6, per: 25,
        sortKey: 'timestamp', sortDir: 'desc', defaultDesc: ['timestamp'],
        source: () => stockHistory,
        emptyTitle: 'No stock history yet', emptyText: 'Stock changes and bill deductions will appear here.',
        filterEls: [['histActionFilter', 'action']],
        resetUI: () => ['histSearch', 'histActionFilter'].forEach(id => { const e = $(id); if (e) e.value = ''; }),
        filter: (h, f, toks) => {
            if (f.action && h.action !== f.action) return false;
            return !toks.length || matchAll([h.itemName, h.reason, h.action].join(' '), toks);
        },
        row: (h, toks) => {
            const cls = h.action === 'add' ? 'success' : h.action === 'remove' ? 'danger' : 'info';
            const lbl = h.action === 'add' ? 'Added' : h.action === 'remove' ? 'Removed' : 'Set';
            const sign = h.action === 'add' ? '+' : h.action === 'remove' ? '−' : '=';
            return `<tr><td>${escHtml(formatDateTime(h.timestamp))}</td>
                <td><span class="cell-main">${hl(h.itemName, toks)}</span></td>
                <td><span class="badge badge-${cls}">${lbl}</span></td>
                <td class="num ${h.action === 'add' ? 'qty-up' : h.action === 'remove' ? 'qty-down' : ''}">${sign}${h.quantity}</td>
                <td class="num"><strong>${h.stockAfter}</strong></td>
                <td>${hl(h.reason || '—', toks)}</td></tr>`;
        },
        csv: [
            { label: 'Date & Time', get: h => formatDateTime(h.timestamp) }, { label: 'Item', get: h => h.itemName },
            { label: 'Action', get: h => h.action }, { label: 'Quantity', get: h => h.quantity },
            { label: 'Stock After', get: h => h.stockAfter }, { label: 'Reason', get: h => h.reason }
        ]
    });

    window.setInvStockFilter = function (v) {
        const sel = $('invStockFilter'); if (!sel) return;
        sel.value = v; tables.inventory.st.filters.stock = v; tables.inventory.st.page = 1; tables.inventory.render();
    };
    window.goAdjustStock = function (id) {
        showSection('stock');
        const sel = $('stockItemSelect'); sel.value = id; sel.dispatchEvent(new Event('change'));
        $('stockQuantity').focus();
    };
    window.markBillPaid = function (id) {
        const b = bills.find(x => x.id === id); if (!b) return;
        b.status = 'Paid'; saveState(); loadBills();
        toast(`Bill ${b.invoiceNo} marked as paid`, 'success');
    };

    // Render functions that app.js calls
    window.loadBills = function () { tables.bills.render(); refreshChrome(); };
    window.loadInventory = function () { refreshGstOptions(); tables.inventory.render(); refreshChrome(); };
    window.loadStockHistory = function () { tables.stock.render(); refreshChrome(); };

    function refreshGstOptions() {
        const sel = $('invGstFilter'); if (!sel) return;
        const cur = sel.value;
        const rates = [...new Set(inventory.map(i => Number(i.gstRate) || 0))].sort((a, b) => a - b);
        sel.innerHTML = '<option value="">All GST rates</option>' + rates.map(r => `<option value="${r}">${r}% GST</option>`).join('');
        sel.value = rates.map(String).includes(cur) ? cur : '';
        if (sel.value !== cur) tables.inventory.st.filters.gst = '';
    }

    // Stock form: show current stock + segmented action control
    function wireStockForm() {
        const seg = $('stockActionSeg'), act = $('stockAction'), sel = $('stockItemSelect');
        seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
            act.value = b.dataset.v;
            seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
        }));
        const hint = () => {
            const it = inventory.find(i => i.id === sel.value);
            $('stockCurrentHint').textContent = it ? `Current stock: ${it.stock || 0}` : '';
        };
        sel.addEventListener('change', hint);
        $('stockForm').addEventListener('submit', () => setTimeout(() => { hint(); seg.querySelector('button').click(); }, 0));
    }

    // ------------------------------------------------------------------
    // Dashboard + sidebar counters
    // ------------------------------------------------------------------
    function refreshChrome() {
        const nb = $('navBillsCount'), ni = $('navInvCount'), nl = $('navLowCount');
        if (nb) nb.textContent = bills.length || '';
        if (ni) ni.textContent = inventory.length || '';
        const attention = inventory.filter(i => stockLevel(i) !== 'in').length;
        if (nl) nl.textContent = attention || '';
        renderDashboard();
    }

    function renderDashboard() {
        if (!$('kpiGrid')) return;
        const today = todayStr();
        const monthStart = today.slice(0, 8) + '01';
        const prevMonthStart = iso(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1));
        const prevMonthEnd = iso(new Date(new Date().getFullYear(), new Date().getMonth(), 0));
        const sumBy = (fn) => bills.filter(fn).reduce((s, b) => s + billTotal(b), 0);
        const todaySales = sumBy(b => b.date === today);
        const monthSales = sumBy(b => b.date >= monthStart && b.date <= today);
        const prevSales = sumBy(b => b.date >= prevMonthStart && b.date <= prevMonthEnd);
        const unpaidBills = bills.filter(b => String(b.status).toLowerCase() !== 'paid');
        const unpaid = unpaidBills.reduce((s, b) => s + billTotal(b), 0);
        const monthBills = bills.filter(b => b.date >= monthStart && b.date <= today).length;
        const out = inventory.filter(i => stockLevel(i) === 'out').length;
        const low = inventory.filter(i => stockLevel(i) === 'low').length;
        const stockValue = inventory.reduce((s, i) => s + (Number(i.stock) || 0) * (Number(i.priceExGst != null ? i.priceExGst : i.rate) || 0), 0);

        let delta = '';
        if (prevSales > 0) {
            const p = ((monthSales - prevSales) / prevSales) * 100;
            delta = `<span class="${p >= 0 ? 'delta-up' : 'delta-down'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p).toFixed(0)}%</span> vs last month`;
        } else delta = `${monthBills} bill${monthBills === 1 ? '' : 's'} this month`;

        const kpi = (cls, ic, label, value, sub, action) => `<button class="kpi ${cls}" onclick="${action}">
            <div class="kpi-label"><span class="kpi-icon">${icon(ic)}</span>${label}</div>
            <div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></button>`;
        $('kpiGrid').innerHTML =
            kpi('', 'rupee', "Today's sales", inrShort(todaySales), `${bills.filter(b => b.date === today).length} bill(s) today`, "showSection('bills');setBillsRange('today')") +
            kpi('t-success', 'bills', 'This month', inrShort(monthSales), delta, "showSection('bills');setBillsRange('month')") +
            kpi('t-warning', 'alert', 'Outstanding', inrShort(unpaid), `${unpaidBills.length} unpaid / pending bill(s)`, "showSection('bills');setBillsStatus('Unpaid')") +
            kpi(out || low ? 't-danger' : '', 'box', 'Stock alerts', `${out + low}`, `${out} out · ${low} low · stock worth ${inrShort(stockValue)}`, "showSection('inventory');setInvStockFilter('attention')");

        // 14 day sales chart
        const days = [];
        for (let i = 13; i >= 0; i--) days.push(iso(addDays(new Date(), -i)));
        const byDay = Object.fromEntries(days.map(d => [d, 0]));
        bills.forEach(b => { if (b.date in byDay) byDay[b.date] += billTotal(b); });
        const vals = days.map(d => byDay[d]);
        const max = Math.max(...vals, 1);
        const W = Math.max(320, $('salesChart').clientWidth || 760), H = W < 520 ? 180 : 220, pl = 46, pb = 26, pt = 12, bw = (W - pl - 8) / days.length;
        const nice = (m) => { const p = Math.pow(10, Math.floor(Math.log10(m))); const f = m / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
        const top = nice(max);
        let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Sales for the last 14 days">`;
        [0, .5, 1].forEach(f => { const y = pt + (H - pt - pb) * (1 - f); svg += `<line class="grid" x1="${pl}" x2="${W - 8}" y1="${y}" y2="${y}"/><text x="${pl - 8}" y="${y + 4}" text-anchor="end">${f ? inrShort(top * f).replace(/\.00$/, '') : '0'}</text>`; });
        days.forEach((d, i) => {
            const h = (H - pt - pb) * (vals[i] / top);
            const x = pl + i * bw + bw * .2;
            const dt = new Date(d + 'T00:00:00');
            svg += `<rect class="bar ${d === today ? 'today' : ''}" x="${x}" y="${H - pb - Math.max(h, vals[i] ? 2 : 0)}" width="${bw * .6}" height="${Math.max(h, vals[i] ? 2 : 0)}" rx="4"><title>${dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}: ${inr(vals[i])}</title></rect>`;
            if (W > 520 ? i % 2 === 1 : i % 4 === 1) svg += `<text x="${x + bw * .3}" y="${H - 8}" text-anchor="middle">${dt.getDate()} ${dt.toLocaleDateString('en-IN', { month: 'short' })}</text>`;
        });
        $('salesChart').innerHTML = svg + '</svg>';
        $('salesRangeTotal').textContent = 'Total ' + inr(vals.reduce((a, b) => a + b, 0));

        // Recent bills
        const recent = bills.slice().sort((a, b) => ((b.timestamp || b.date) > (a.timestamp || a.date) ? 1 : -1)).slice(0, 6);
        $('recentBills').innerHTML = recent.length ? recent.map(b => `<div class="mini-row" onclick="viewBill('${b.id}')">
            <div class="mini-main"><strong>${escHtml((b.customer && b.customer.name) || 'Walk-in')} <span class="mono muted">#${escHtml(b.invoiceNo)}</span></strong><small>${escHtml(formatDate(b.date))} · ${(b.items || []).length} item(s)</small></div>
            ${statusBadge(b.status)}<span class="mini-val">${inr(billTotal(b))}</span></div>`).join('')
            : `<div class="mini-empty">No bills yet.<br><button class="link-btn" onclick="showNewBillForm()">Create your first bill</button></div>`;

        // Low stock
        const alerts = inventory.filter(i => stockLevel(i) !== 'in').sort((a, b) => (a.stock || 0) - (b.stock || 0)).slice(0, 6);
        $('lowStockList').innerHTML = alerts.length ? alerts.map(i => `<div class="mini-row" onclick="goAdjustStock('${i.id}')">
            <div class="mini-main"><strong>${escHtml(i.name)}</strong><small class="mono">${escHtml(i.code)}${i.partNumber ? ' · ' + escHtml(i.partNumber) : ''}</small></div>
            <span class="badge badge-${stockLevel(i) === 'out' ? 'danger' : 'warning'}">${stockLevel(i) === 'out' ? 'Out' : 'Low'}</span><span class="mini-val">${i.stock || 0}</span></div>`).join('')
            : `<div class="mini-empty">${inventory.length ? 'All items are well stocked 🎉' : 'No inventory yet.'}</div>`;

        // Top items
        const qty = {};
        bills.forEach(b => (b.items || []).forEach(it => { const k = it.name; if (!k) return; qty[k] = qty[k] || { q: 0, amt: 0 }; qty[k].q += Number(it.qty) || 0; qty[k].amt += Number(it.amount) || 0; }));
        const top5 = Object.entries(qty).sort((a, b) => b[1].q - a[1].q).slice(0, 5);
        $('topItems').innerHTML = top5.length ? top5.map(([n, v], i) => `<div class="mini-row" onclick="openPalette('${escHtml(n).replace(/'/g, '&#39;')}')">
            <span class="rank">${i + 1}</span><div class="mini-main"><strong>${escHtml(n)}</strong><small>${inr(v.amt)} before GST</small></div><span class="mini-val">${v.q} sold</span></div>`).join('')
            : '<div class="mini-empty">Sales will show up here.</div>';
    }

    let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (activeSection() === 'dashboard') renderDashboard(); }, 150); });
    window.setBillsRange = (v) => { const s = $('billsRange'); s.value = v; s.dispatchEvent(new Event('change')); };
    window.setBillsStatus = (v) => { const s = $('billsStatusFilter'); s.value = v; s.dispatchEvent(new Event('change')); };

    // ------------------------------------------------------------------
    // Toasts, alert() override, confirm dialog
    // ------------------------------------------------------------------
    function toast(msg, type) {
        const box = $('toasts'); if (!box) return;
        const el = document.createElement('div');
        el.className = 'toast ' + (type || '');
        el.innerHTML = `${icon(type === 'error' ? 'alert' : 'check')}<span>${escHtml(msg)}</span>`;
        box.appendChild(el);
        const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 260); };
        el.addEventListener('click', kill);
        setTimeout(kill, type === 'error' ? 6000 : 3200);
    }
    window.toast = toast;
    // Existing code calls alert('…'): route to toasts (messages that look like problems are shown as errors)
    window.alert = function (msg) {
        const m = String(msg);
        toast(m, /^(please|unable|no |invalid|error|select)/i.test(m) ? 'error' : 'success');
    };

    window.uiConfirm = function (title, text, okLabel) {
        return new Promise(res => {
            const d = $('confirmDialog');
            $('confirmTitle').textContent = title || 'Are you sure?';
            $('confirmText').textContent = text || '';
            const ok = $('confirmOk'), no = $('confirmCancel');
            ok.textContent = okLabel || 'Delete';
            d.style.display = 'block';
            no.focus();
            const done = (v) => { d.style.display = 'none'; ok.onclick = no.onclick = null; d.removeEventListener('keydown', key); document.removeEventListener('keydown', esc, true); res(v); };
            const key = (e) => { if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === ok ? no : ok).focus(); } };
            const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
            ok.onclick = () => done(true); no.onclick = () => done(false);
            d.addEventListener('keydown', key); document.addEventListener('keydown', esc, true);
            d.onclick = (e) => { if (e.target === d) done(false); };
        });
    };

    // ------------------------------------------------------------------
    // Drawers (new bill / inventory item): scroll lock, focus, backdrop-close, shortcuts
    // ------------------------------------------------------------------
    function watchDrawer(id, onOpen, onClose) {
        const d = $(id); if (!d) return;
        let open = false;
        new MutationObserver(() => {
            const nowOpen = d.style.display !== 'none';
            if (nowOpen === open) return;
            open = nowOpen;
            document.body.classList.toggle('no-scroll', !!document.querySelector('.drawer[style*="display: block"], #billViewModal.active'));
            if (open) { onOpen && onOpen(); const f = d.querySelector('input:not([readonly]):not([type=hidden]),select'); setTimeout(() => f && f.focus(), 60); }
            else onClose && onClose();
        }).observe(d, { attributes: true, attributeFilter: ['style'] });
        d.addEventListener('mousedown', e => { if (e.target === d) d.dataset.bd = '1'; else delete d.dataset.bd; });
        d.addEventListener('click', e => { if (e.target === d && d.dataset.bd) { (id === 'new-bill-form' ? hideNewBillForm : hideNewInventoryForm)(); } });
    }

    // Autofill customer details from previous bills
    function wireCustomerAutofill() {
        const name = $('customerName');
        const refresh = () => {
            const seen = new Map();
            bills.forEach(b => { const c = b.customer; if (c && c.name && !seen.has(c.name.toLowerCase())) seen.set(c.name.toLowerCase(), c); });
            $('customerNames').innerHTML = [...seen.values()].map(c => `<option value="${escHtml(c.name)}">${escHtml(c.phone || '')}</option>`).join('');
            name._known = seen;
        };
        name.addEventListener('focus', refresh);
        name.addEventListener('input', () => {
            const c = name._known && name._known.get(name.value.trim().toLowerCase());
            if (c) { if (!$('customerPhone').value) $('customerPhone').value = c.phone || ''; if (!$('customerAddress').value) $('customerAddress').value = c.address || ''; }
        });
    }

    // Keyboard handling inside the bill form: Enter in last field adds a row; Ctrl+Enter saves
    function wireBillFormKeys() {
        const form = $('billForm');
        form.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); form.requestSubmit(); return; }
            if (e.key === 'Enter' && e.target.matches('input')) {
                e.preventDefault(); // Enter should never submit by accident
                const row = e.target.closest('.item-row');
                if (row) {
                    const fields = [...row.querySelectorAll('input:not([type=hidden]):not([readonly])')];
                    const idx = fields.indexOf(e.target);
                    if (idx >= 0 && idx < fields.length - 1) fields[idx + 1].focus();
                    else { const nr = addBillItem(); nr.querySelector('.item-name').focus(); }
                } else {
                    const all = [...form.querySelectorAll('input:not([type=hidden]):not([readonly]),select')];
                    const i = all.indexOf(e.target); if (all[i + 1]) all[i + 1].focus();
                }
            }
        });
        form.addEventListener('input', e => {
            if (e.target.classList.contains('item-name')) {
                // datalist selection / typing resolved to an inventory item
            }
        });
    }

    // ------------------------------------------------------------------
    // Command palette
    // ------------------------------------------------------------------
    let palSel = 0, palItems = [];
    window.openPalette = function (q) {
        const p = $('palette'); p.hidden = false;
        const inp = $('paletteInput'); inp.value = q ? String(q).replace(/&#39;/g, "'") : ''; inp.focus(); inp.select();
        palSel = 0; renderPalette();
    };
    function closePalette() { $('palette').hidden = true; }
    function renderPalette() {
        const toks = tokens($('paletteInput').value);
        const cmds = [
            { g: 'Actions', ic: 'plus', t: 'Create new bill', s: 'N', run: () => showNewBillForm() },
            { g: 'Actions', ic: 'plus', t: 'Add inventory item', s: '', run: () => { showSection('inventory'); showNewInventoryForm(); } },
            { g: 'Go to', ic: 'dashboard', t: 'Dashboard', run: () => showSection('dashboard') },
            { g: 'Go to', ic: 'bills', t: 'Bills', run: () => showSection('bills') },
            { g: 'Go to', ic: 'box', t: 'Inventory', run: () => showSection('inventory') },
            { g: 'Go to', ic: 'stock', t: 'Stock management', run: () => showSection('stock') },
            { g: 'Go to', ic: 'export', t: 'Export data', run: () => showSection('export') },
            { g: 'Actions', ic: 'moon', t: 'Toggle dark mode', run: () => toggleTheme() }
        ].filter(c => matchAll(c.t + ' ' + c.g, toks));
        let list = toks.length ? [] : cmds;
        if (toks.length) {
            const bs = bills.filter(b => matchAll([b.invoiceNo, (b.customer || {}).name, (b.customer || {}).phone, b.total].concat((b.items || []).map(i => i.name)).join(' '), toks)).slice(0, 6)
                .map(b => ({ g: 'Bills', ic: 'bills', t: `#${b.invoiceNo} · ${(b.customer && b.customer.name) || 'Walk-in'}`, sub: `${formatDate(b.date)} · ${inr(billTotal(b))} · ${b.status || ''}`, run: () => { showSection('bills'); viewBill(b.id); } }));
            const is = inventory.filter(i => matchAll([i.code, i.name, i.partNumber, i.hsn].join(' '), toks)).slice(0, 6)
                .map(i => ({ g: 'Inventory', ic: 'box', t: i.name, sub: `${i.code}${i.partNumber ? ' · ' + i.partNumber : ''} · stock ${i.stock || 0} · ${inr(i.priceExGst != null ? i.priceExGst : i.rate)}`, run: () => { showSection('inventory'); const s = $('invSearch'); s.value = i.code; tables.inventory.st.search = i.code; tables.inventory.render(); } }));
            list = [...bs, ...is, ...cmds];
        }
        palItems = list;
        if (palSel >= list.length) palSel = Math.max(0, list.length - 1);
        let html = '', lastG = '';
        list.forEach((it, idx) => {
            if (it.g !== lastG) { html += `<div class="pal-group">${it.g}</div>`; lastG = it.g; }
            html += `<div class="pal-item ${idx === palSel ? 'sel' : ''}" data-i="${idx}">${icon(it.ic)}<div class="pal-main"><strong>${escHtml(it.t)}</strong>${it.sub ? `<small>${escHtml(it.sub)}</small>` : ''}</div></div>`;
        });
        $('paletteResults').innerHTML = html || '<div class="mini-empty">Nothing found</div>';
        $('paletteResults').querySelectorAll('.pal-item').forEach(el => {
            el.addEventListener('mousemove', () => { palSel = +el.dataset.i; markSel(); });
            el.addEventListener('click', () => runPal(+el.dataset.i));
        });
    }
    function markSel() {
        $('paletteResults').querySelectorAll('.pal-item').forEach(el => el.classList.toggle('sel', +el.dataset.i === palSel));
        const s = $('paletteResults').querySelector('.pal-item.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
    }
    function runPal(i) { const it = palItems[i]; if (!it) return; closePalette(); it.run(); }

    // ------------------------------------------------------------------
    // Theme
    // ------------------------------------------------------------------
    function currentTheme() {
        const t = document.documentElement.getAttribute('data-theme');
        return t || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }
    function paintThemeIcon() { document.querySelectorAll('.theme-toggle').forEach(b => { b.innerHTML = icon(currentTheme() === 'dark' ? 'sun' : 'moon'); }); }
    function toggleTheme() {
        const n = currentTheme() === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', n);
        try { localStorage.setItem('bm_theme', n); } catch (e) { }
        paintThemeIcon();
    }

    // ------------------------------------------------------------------
    // Global wiring
    // ------------------------------------------------------------------
    function activeSection() { const s = document.querySelector('.section.active'); return s ? s.id.replace('-section', '') : ''; }
    function anyOverlayOpen() {
        return !$('palette').hidden || $('confirmDialog').style.display === 'block' ||
            $('new-bill-form').style.display === 'block' || $('new-inventory-form').style.display === 'block' || $('billViewModal').classList.contains('active');
    }

    function initUI() {
        if (initUI.done) return; initUI.done = true;
        Object.values(tables).forEach(t => t.wire());
        wireStockForm(); wireCustomerAutofill(); wireBillFormKeys();
        watchDrawer('new-bill-form', () => { refreshItemSuggestions(); }, null);
        watchDrawer('new-inventory-form', null, null);

        $('paletteBtn').addEventListener('click', () => openPalette());
        $('palette').addEventListener('mousedown', e => { if (e.target === $('palette')) closePalette(); });
        $('paletteInput').addEventListener('input', () => { palSel = 0; renderPalette(); });
        $('paletteInput').addEventListener('keydown', e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palItems.length - 1, palSel + 1); markSel(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(0, palSel - 1); markSel(); }
            else if (e.key === 'Enter') { e.preventDefault(); runPal(palSel); }
        });

        document.querySelectorAll('.theme-toggle').forEach(b => b.addEventListener('click', toggleTheme)); paintThemeIcon();

        const sb = $('sidebar'), bd = $('sidebarBackdrop');
        const setSb = (o) => { sb.classList.toggle('open', o); bd.classList.toggle('open', o); };
        $('menuBtn').addEventListener('click', () => setSb(!sb.classList.contains('open')));
        bd.addEventListener('click', () => setSb(false));
        sb.addEventListener('click', e => { if (e.target.closest('.nav-btn')) setSb(false); });

        const email = $('user-email'); const av = $('userAvatar');
        const setAv = () => { if (av && email) av.textContent = (email.textContent || 'U').trim().charAt(0).toUpperCase(); };
        setAv(); new MutationObserver(setAv).observe(email, { childList: true, characterData: true, subtree: true });

        document.addEventListener('keydown', e => {
            const tag = (e.target.tagName || '').toLowerCase();
            const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('palette').hidden ? openPalette() : closePalette(); return; }
            if (e.key === 'Escape') {
                if (!$('palette').hidden) return closePalette();
                if ($('new-bill-form').style.display === 'block') return hideNewBillForm();
                if ($('new-inventory-form').style.display === 'block') return hideNewInventoryForm();
                if ($('billViewModal').classList.contains('active')) return closeBillModal();
                return;
            }
            if (typing || anyOverlayOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
            if ($('app-container').style.display === 'none') return;
            if (e.key === '/') {
                const map = { bills: 'billsSearch', inventory: 'invSearch', stock: 'histSearch' };
                const el = $(map[activeSection()]);
                if (el) { e.preventDefault(); el.focus(); el.select(); } else { e.preventDefault(); openPalette(); }
            } else if (e.key.toLowerCase() === 'n') { e.preventDefault(); activeSection() === 'inventory' ? showNewInventoryForm() : showNewBillForm(); }
            else if ('12345'.includes(e.key) && e.key) { showSection(['dashboard', 'bills', 'inventory', 'stock', 'export'][+e.key - 1]); }
        });

        // Restore last section
        try { const s = localStorage.getItem('bm_section'); if (s && SECTION_META[s]) showSection(s); else showSection('dashboard'); } catch (e) { showSection('dashboard'); }
    }

    // app.js calls these after data loads
    window.initBillsControls = function () { initUI(); refreshGstOptions(); refreshChrome(); };
    window.onSectionShown = function (name) {
        if (name === 'dashboard') renderDashboard();
        if (name === 'bills') tables.bills.render();
        if (name === 'inventory') tables.inventory.render();
        if (name === 'stock') tables.stock.render();
    };
    paintThemeIcon();
})();
