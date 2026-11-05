// Dashboard: period overview of sales, purchases and GST position, plus the lists a shop owner checks daily.
(function () {
    'use strict';

    const K = window.UIKit;
    const $ = (id) => document.getElementById(id);
    const { inr, icon, iso, addDays, todayStr } = K;
    const esc = (v) => escHtml(v == null ? '' : v);
    const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
    const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
    const inrShort = (n) => {
        n = Number(n) || 0; const a = Math.abs(n), s = n < 0 ? '−' : '';
        if (a >= 1e7) return s + '₹' + (a / 1e7).toFixed(2) + ' Cr';
        if (a >= 1e5) return s + '₹' + (a / 1e5).toFixed(2) + ' L';
        return s + inr(a).replace(/\.00$/, '');
    };
    const fmt = (iso) => formatDate(iso);
    const signed = (n) => (n < 0 ? '−' : '') + inr(Math.abs(n));
    const dayMs = 86400000;
    const parse = (s) => new Date(s + 'T00:00:00');
    const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / dayMs);

    const PERIODS = [['month', 'This month'], ['lastmonth', 'Last month'], ['last30', 'Last 30 days'], ['quarter', 'This quarter'], ['fy', 'This financial year'], ['lastfy', 'Last financial year']];
    let period = 'month';
    try { const s = localStorage.getItem('bm_dash_period'); if (PERIODS.some(p => p[0] === s)) period = s; } catch (e) { }

    // ------------------------------------------------------------------ periods
    function bounds(key) {
        const now = new Date(), today = todayStr(), y = now.getFullYear(), m = now.getMonth();
        const monthRange = (yy, mm) => [iso(new Date(yy, mm, 1)), iso(new Date(yy, mm + 1, 0))];
        const fyStart = (m >= 3 ? y : y - 1);
        let from, to, prevFrom, prevTo, label, unit;
        if (key === 'month') { [from, to] = monthRange(y, m); [prevFrom, prevTo] = monthRange(y, m - 1); label = now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); unit = 'day'; }
        else if (key === 'lastmonth') { [from, to] = monthRange(y, m - 1); [prevFrom, prevTo] = monthRange(y, m - 2); label = parse(from).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); unit = 'day'; }
        else if (key === 'last30') { to = today; from = iso(addDays(now, -29)); prevTo = iso(addDays(now, -30)); prevFrom = iso(addDays(now, -59)); label = 'Last 30 days'; unit = 'day'; }
        else if (key === 'quarter') { const q = Math.floor(m / 3) * 3; from = iso(new Date(y, q, 1)); to = iso(new Date(y, q + 3, 0)); prevFrom = iso(new Date(y, q - 3, 1)); prevTo = iso(new Date(y, q, 0)); label = 'This quarter'; unit = 'week'; }
        else if (key === 'fy') { from = `${fyStart}-04-01`; to = `${fyStart + 1}-03-31`; prevFrom = `${fyStart - 1}-04-01`; prevTo = `${fyStart}-03-31`; label = `FY ${fyStart}-${String(fyStart + 1).slice(2)}`; unit = 'month'; }
        else { from = `${fyStart - 1}-04-01`; to = `${fyStart}-03-31`; prevFrom = `${fyStart - 2}-04-01`; prevTo = `${fyStart - 1}-03-31`; label = `FY ${fyStart - 1}-${String(fyStart).slice(2)}`; unit = 'month'; }
        // totals run up to today for a period still in progress, compared with the same number of days of the previous period
        const effTo = to > today ? today : to;
        const elapsed = Math.max(1, diffDays(from, effTo) + 1);
        const cmpTo = (() => { const t = iso(addDays(parse(prevFrom), elapsed - 1)); return t > prevTo ? prevTo : t; })();
        return { key, from, to, effTo: effTo < from ? from : effTo, prevFrom, prevTo: cmpTo, label, unit };
    }
    const within = (d, a, b) => d >= a && d <= b;

    function bins(b) {
        const out = [];
        if (b.unit === 'day') { for (let d = parse(b.from); iso(d) <= b.to; d = addDays(d, 1)) { const s = iso(d); out.push({ from: s, to: s, label: d.getDate() + ' ' + d.toLocaleDateString('en-IN', { month: 'short' }) }); } }
        else if (b.unit === 'week') {
            let d = parse(b.from);
            while (iso(d) <= b.to) { const e = addDays(d, 6); const to = iso(e) > b.to ? b.to : iso(e); out.push({ from: iso(d), to, label: d.getDate() + ' ' + d.toLocaleDateString('en-IN', { month: 'short' }) }); d = addDays(d, 7); }
        } else {
            let d = parse(b.from);
            while (iso(d) <= b.to) { const e = new Date(d.getFullYear(), d.getMonth() + 1, 0); out.push({ from: iso(d), to: iso(e), label: d.toLocaleDateString('en-IN', { month: 'short' }) }); d = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
        }
        return out;
    }

    // ------------------------------------------------------------------ numbers
    function totals(from, to) {
        const bs = bills.filter(b => within(b.date || '', from, to));
        const ps = purchases.filter(p => within(p.date || '', from, to));
        const out = { bills: bs, purchases: ps, sales: 0, salesNet: 0, purch: 0, purchNet: 0, outGst: 0, inGst: 0, outByRate: {}, inByRate: {} };
        bs.forEach(b => {
            const t = getBillTotals(b);
            out.sales += num(b.total); out.salesNet += num(t.subtotal); out.outGst += num(t.totalGst);
            (t.gstBreakup || []).forEach(g => { out.outByRate[g.rate] = (out.outByRate[g.rate] || 0) + num(g.gst); });
        });
        ps.forEach(p => {
            out.purch += num(p.grandTotal); out.purchNet += num(p.taxable); out.inGst += num(p.totalTax);
            Object.keys(p.gstByRate || {}).forEach(r => { out.inByRate[r] = (out.inByRate[r] || 0) + num(p.gstByRate[r]); });
        });
        ['sales', 'salesNet', 'purch', 'purchNet', 'outGst', 'inGst'].forEach(k => { out[k] = r2(out[k]); });
        return out;
    }
    const stockLevel = (i) => { const s = Number(i.stock) || 0; return s <= 0 ? 'out' : s <= 5 ? 'low' : 'in'; };
    const statusBadge = (s) => { const k = String(s || '').toLowerCase(); return `<span class="badge badge-${k === 'paid' ? 'success' : k === 'pending' ? 'warning' : k === 'unpaid' ? 'danger' : 'muted'}">${esc(s || 'N/A')}</span>`; };
    const delta = (cur, prev) => {
        if (!prev) return cur ? '<span class="delta-up">new</span>' : '';
        const p = (cur - prev) / prev * 100;
        return `<span class="${p >= 0 ? 'delta-up' : 'delta-down'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p).toFixed(0)}%</span>`;
    };

    // ------------------------------------------------------------------ navigation helpers
    function fire(id, value) { const el = $(id); if (!el) return; el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); }
    window.dashGo = function (where, a, b) {
        if (where === 'bills') { showSection('bills'); __tblClear('bills'); fire('billsRange', 'custom'); fire('billsFrom', a); fire('billsTo', b); }
        else if (where === 'purchases') { showSection('purchases'); __tblClear('purchases'); fire('purRange', 'custom'); fire('purFrom', a); fire('purTo', b); }
        else if (where === 'unpaid') { showSection('bills'); __tblClear('bills'); setBillsStatus('Unpaid'); }
        else if (where === 'stock') { showSection('inventory'); setInvStockFilter('attention'); }
    };

    // ------------------------------------------------------------------ render
    function render() {
        if (!$('kpiGrid')) return;
        const b = bounds(period), cur = totals(b.from, b.effTo), prev = totals(b.prevFrom, b.prevTo);
        const empty = !bills.length && !purchases.length && !inventory.length;

        // header
        $('dashRange').textContent = `${fmt(b.from)} – ${fmt(b.to)}${b.effTo < b.to ? ` · showing up to today` : ''}`;
        if ($('dashPeriod') && $('dashPeriod').value !== period) $('dashPeriod').value = period;
        $('dashStart').hidden = !empty;

        // KPIs
        const net = r2(cur.outGst - cur.inGst);
        const unpaidBills = bills.filter(x => String(x.status).toLowerCase() !== 'paid');
        const unpaid = r2(unpaidBills.reduce((s, x) => s + num(x.total), 0));
        const out = inventory.filter(i => stockLevel(i) === 'out').length, low = inventory.filter(i => stockLevel(i) === 'low').length;
        const stockValue = inventory.reduce((s, i) => s + (Number(i.stock) || 0) * (Number(i.costPrice != null ? i.costPrice : (i.priceExGst != null ? i.priceExGst : i.rate)) || 0), 0);
        const kpi = (cls, ic, label, value, sub, action, title) => `<button class="kpi ${cls}" onclick="${action}" ${title ? `title="${esc(title)}"` : ''}>
            <div class="kpi-label"><span class="kpi-icon">${icon(ic)}</span>${label}</div>
            <div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></button>`;
        $('kpiGrid').innerHTML =
            kpi('t-success', 'rupee', 'Sales', inrShort(cur.sales), `${cur.bills.length} bill${cur.bills.length === 1 ? '' : 's'} · ${delta(cur.sales, prev.sales) || 'no change'} vs previous`, `dashGo('bills','${b.from}','${b.effTo}')`, 'Total of your bills including GST') +
            kpi('', 'purchase', 'Purchases', inrShort(cur.purch), `${cur.purchases.length} purchase${cur.purchases.length === 1 ? '' : 's'} · ${delta(cur.purch, prev.purch) || 'no change'} vs previous`, `dashGo('purchases','${b.from}','${b.effTo}')`, 'Total of supplier bills including GST') +
            kpi(net > 0 ? 't-warning' : 't-success', 'alert', net >= 0 ? 'GST payable' : 'GST credit', inrShort(Math.abs(net)), `Collected ${inrShort(cur.outGst)} − paid ${inrShort(cur.inGst)}`, `dashGo('purchases','${b.from}','${b.effTo}')`, 'Estimate: GST charged on your bills minus GST paid on purchases in this period') +
            kpi(unpaid > 0 ? 't-warning' : '', 'bills', 'To collect', inrShort(unpaid), `${unpaidBills.length} unpaid / pending bill${unpaidBills.length === 1 ? '' : 's'}`, "dashGo('unpaid')", 'All unpaid and pending bills, any date') +
            kpi(out || low ? 't-danger' : '', 'box', 'Stock alerts', String(out + low), `${out} out · ${low} low · stock worth ${inrShort(stockValue)}`, "dashGo('stock')", 'Stock value uses last purchase cost where known, otherwise the selling price');

        renderChart(b, cur, prev);
        renderGst(cur, b);
        renderLists(b, cur);
    }

    function nice(m) { const p = Math.pow(10, Math.floor(Math.log10(m))); const f = m / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }

    function renderChart(b, cur, prev) {
        const list = bins(b);
        const sales = list.map(x => r2(bills.filter(y => within(y.date || '', x.from, x.to)).reduce((s, y) => s + num(y.total), 0)));
        const buys = list.map(x => r2(purchases.filter(y => within(y.date || '', x.from, x.to)).reduce((s, y) => s + num(y.grandTotal), 0)));
        $('dashLegend').innerHTML = `<span class="lg"><i class="sw s-a"></i>Sales <b>${inr(cur.sales)}</b></span><span class="lg"><i class="sw s-b"></i>Purchases <b>${inr(cur.purch)}</b></span>`;
        const box = $('dashChart');
        if (!sales.some(Boolean) && !buys.some(Boolean)) { box.innerHTML = '<div class="mini-empty">No bills or purchases in this period yet.</div>'; return; }
        const W = Math.max(320, box.clientWidth || 760), H = W < 520 ? 210 : 270, pl = 54, pr = 8, pt = 10, pb = 28;
        const top = nice(Math.max(...sales, ...buys, 1)), n = list.length, gw = (W - pl - pr) / n;
        const bw = Math.max(2, Math.min(22, gw * 0.38)), today = todayStr();
        let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Sales and purchases per ${b.unit}">`;
        [0, .25, .5, .75, 1].forEach(f => { const y = pt + (H - pt - pb) * (1 - f); svg += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}"/><text x="${pl - 8}" y="${y + 4}" text-anchor="end">${f ? inrShort(top * f).replace(/\.00$/, '') : '0'}</text>`; });
        const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - pl) / 56))));
        list.forEach((x, i) => {
            const gx = pl + i * gw + (gw - (2 * bw + 2)) / 2, base = H - pb;
            const h1 = (H - pt - pb) * sales[i] / top, h2 = (H - pt - pb) * buys[i] / top;
            const tip = `${x.label}: sales ${inr(sales[i])} · purchases ${inr(buys[i])}`;
            if (sales[i]) svg += `<rect class="bar bar-a${within(today, x.from, x.to) ? ' now' : ''}" x="${gx}" y="${base - Math.max(h1, 2)}" width="${bw}" height="${Math.max(h1, 2)}" rx="3"><title>${esc(tip)}</title></rect>`;
            if (buys[i]) svg += `<rect class="bar bar-b" x="${gx + bw + 2}" y="${base - Math.max(h2, 2)}" width="${bw}" height="${Math.max(h2, 2)}" rx="3"><title>${esc(tip)}</title></rect>`;
            if (!sales[i] && !buys[i]) svg += `<rect x="${gx}" y="${base - 12}" width="${2 * bw + 2}" height="12" fill="transparent"><title>${esc(x.label)}: nothing recorded</title></rect>`;
            if (i % step === 0) svg += `<text x="${pl + i * gw + gw / 2}" y="${H - 8}" text-anchor="middle">${esc(x.label)}</text>`;
        });
        box.innerHTML = svg + '</svg>';
    }

    function renderGst(cur, b) {
        const rates = [...new Set(Object.keys(cur.outByRate).concat(Object.keys(cur.inByRate)))].map(Number).sort((a, c) => a - c);
        const net = r2(cur.outGst - cur.inGst);
        const row = (label, o, i) => `<tr><td>${label}</td><td class="num">${inr(o)}</td><td class="num">${inr(i)}</td><td class="num ${o - i > 0 ? 'neg' : 'pos'}">${signed(r2(o - i))}</td></tr>`;
        $('gstCard').innerHTML = (cur.bills.length || cur.purchases.length) ? `
            <table class="gst-table"><thead><tr><th>GST rate</th><th class="num" title="GST you charged on your bills">Collected</th><th class="num" title="GST you paid on purchases">Paid</th><th class="num">Net</th></tr></thead><tbody>
            ${rates.map(r => row(r + '%', cur.outByRate[r] || 0, cur.inByRate[r] || 0)).join('')}
            </tbody><tfoot><tr><td>Total</td><td class="num">${inr(cur.outGst)}</td><td class="num">${inr(cur.inGst)}</td><td class="num ${net > 0 ? 'neg' : 'pos'}">${signed(net)}</td></tr></tfoot></table>
            <div class="gst-note ${net > 0 ? 'pay' : 'credit'}">${net > 0 ? `You owe about <b>${inr(net)}</b> in GST for this period.` : net < 0 ? `You have about <b>${inr(-net)}</b> of GST credit for this period.` : 'Collected and paid GST are equal.'}</div>
            <div class="gst-split"><span>Sales before GST <b>${inr(cur.salesNet)}</b></span><span>Purchases before GST <b>${inr(cur.purchNet)}</b></span></div>`
            : '<div class="mini-empty">GST appears here once you have bills or purchases in this period.</div>';
        $('gstRange').textContent = b.label;
    }

    function renderLists(b, cur) {
        // recent bills
        const recentBills = bills.slice().sort((a, c) => ((c.timestamp || c.date) > (a.timestamp || a.date) ? 1 : -1)).slice(0, 6);
        $('recentBills').innerHTML = recentBills.length ? recentBills.map(x => `<div class="mini-row" onclick="viewBill('${x.id}')">
            <div class="mini-main"><strong>${esc((x.customer && x.customer.name) || 'Walk-in')} <span class="mono muted">#${esc(x.invoiceNo)}</span></strong><small>${esc(fmt(x.date))} · ${(x.items || []).length} item(s)</small></div>${statusBadge(x.status)}<span class="mini-val">${inr(x.total)}</span></div>`).join('')
            : '<div class="mini-empty">No bills yet.<br><button class="link-btn" onclick="showNewBillForm()">Create your first bill</button></div>';

        // recent purchases
        const recentPur = purchases.slice().sort((a, c) => (c.date || '').localeCompare(a.date || '') || (c.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 6);
        $('recentPurchases').innerHTML = recentPur.length ? recentPur.map(p => `<div class="mini-row" onclick="viewPurchase('${p.id}')">
            <div class="mini-main"><strong title="${esc(p.supplier.name || '')}">${esc(p.supplier.name || p.supplier.gstin || 'Seller')}</strong><small>${esc(fmt(p.date))} · ${esc(p.invoiceNo)} · GST ${inr(p.totalTax)}</small></div><span class="mini-val">${inr(p.grandTotal)}</span></div>`).join('')
            : '<div class="mini-empty">No purchases yet.<br><button class="link-btn" onclick="showSection(\'purchases\');openPurchase(\'scan\')">Scan a supplier bill</button></div>';

        // payments to collect (oldest first)
        const today = todayStr();
        const due = bills.filter(x => String(x.status).toLowerCase() !== 'paid').sort((a, c) => (a.date || '').localeCompare(c.date || '')).slice(0, 5);
        $('dueList').innerHTML = due.length ? due.map(x => { const age = Math.max(0, diffDays(x.date || today, today)); return `<div class="mini-row" onclick="viewBill('${x.id}')">
            <div class="mini-main"><strong>${esc((x.customer && x.customer.name) || 'Walk-in')} <span class="mono muted">#${esc(x.invoiceNo)}</span></strong><small class="${age > 30 ? 'late' : ''}">${age === 0 ? 'today' : age + ' day' + (age > 1 ? 's' : '') + ' old'} · ${esc(x.status)}</small></div><span class="mini-val">${inr(x.total)}</span></div>`; }).join('')
            : '<div class="mini-empty">Nothing to collect 🎉</div>';

        // top sellers (suppliers) by purchase value in the period
        const sup = {};
        cur.purchases.forEach(p => { const k = (p.supplier.gstin || p.supplier.name || '?').toLowerCase(); const e = sup[k] = sup[k] || { name: p.supplier.name || p.supplier.gstin, gstin: p.supplier.gstin, total: 0, count: 0 }; e.total += num(p.grandTotal); e.count++; });
        const topSup = Object.values(sup).sort((a, c) => c.total - a.total).slice(0, 5);
        $('topSellers').innerHTML = topSup.length ? topSup.map((s, i) => `<div class="mini-row" onclick="showSection('purchases');fire_sup('${esc(s.gstin || s.name).replace(/'/g, '&#39;')}')">
            <span class="rank">${i + 1}</span><div class="mini-main"><strong title="${esc(s.name)}">${esc(s.name)}</strong><small>${s.count} bill${s.count > 1 ? 's' : ''}${s.gstin ? ' · ' + esc(s.gstin) : ''}</small></div><span class="mini-val">${inr(s.total)}</span></div>`).join('')
            : '<div class="mini-empty">No purchases in this period.</div>';

        // top items sold (period)
        const qty = {};
        cur.bills.forEach(x => (x.items || []).forEach(it => { if (!it.name) return; const e = qty[it.name] = qty[it.name] || { q: 0, amt: 0 }; e.q += num(it.qty); e.amt += num(it.amount); }));
        const top = Object.entries(qty).sort((a, c) => c[1].q - a[1].q).slice(0, 5);
        $('topItems').innerHTML = top.length ? top.map(([n, v], i) => `<div class="mini-row" onclick="openPalette('${esc(n).replace(/'/g, '&#39;')}')">
            <span class="rank">${i + 1}</span><div class="mini-main"><strong>${esc(n)}</strong><small>${inr(v.amt)} before GST</small></div><span class="mini-val">${v.q} sold</span></div>`).join('')
            : '<div class="mini-empty">Items you sell will show up here.</div>';

        // stock alerts
        const alerts = inventory.filter(i => stockLevel(i) !== 'in').sort((a, c) => (a.stock || 0) - (c.stock || 0)).slice(0, 6);
        $('lowStockList').innerHTML = alerts.length ? alerts.map(i => `<div class="mini-row" onclick="goAdjustStock('${i.id}')">
            <div class="mini-main"><strong>${esc(i.name)}</strong><small class="mono">${esc(i.code)}${i.partNumber ? ' · ' + esc(i.partNumber) : ''}</small></div>
            <span class="badge badge-${stockLevel(i) === 'out' ? 'danger' : 'warning'}">${stockLevel(i) === 'out' ? 'Out' : 'Low'}</span><span class="mini-val">${i.stock || 0}</span></div>`).join('')
            : `<div class="mini-empty">${inventory.length ? 'All items are well stocked 🎉' : 'No inventory yet.'}</div>`;
    }
    window.fire_sup = (key) => { const sel = $('purSupplier'); if (!sel) return; __tblClear('purchases'); fire('purSupplier', String(key).toLowerCase()); };

    // ------------------------------------------------------------------ wiring
    function init() {
        const sel = $('dashPeriod'); if (!sel) return;
        sel.innerHTML = PERIODS.map(p => `<option value="${p[0]}">${p[1]}</option>`).join('');
        sel.value = period;
        sel.addEventListener('change', () => { period = sel.value; try { localStorage.setItem('bm_dash_period', period); } catch (e) { } render(); });
        let t; window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { if (document.getElementById('dashboard-section').classList.contains('active')) render(); }, 150); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
    window.Dashboard = { render };
})();
