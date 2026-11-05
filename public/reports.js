// Reports: GST filing working papers (GSTR-1 / IFF data, GSTR-3B summary with ITC set-off, annual GST summary)
// and an income-tax pack for a proprietor's trading business. Everything is derived from the bills, purchases and
// inventory already in the app, and exported as Excel / PDF / CSV for the owner or their CA.
(function () {
    'use strict';

    const K = window.UIKit;
    const $ = (id) => document.getElementById(id);
    const { inr, iso, addDays, todayStr } = K;
    const esc = (v) => escHtml(v == null ? '' : v);
    const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
    const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
    const OWN_GSTIN = String((typeof COMPANY_INFO !== 'undefined' && COMPANY_INFO.GSTIN) || '').toUpperCase();
    const OWN_STATE = OWN_GSTIN.slice(0, 2);
    const COMPANY = (typeof COMPANY_INFO !== 'undefined' && COMPANY_INFO.NAME) || '';
    const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/;
    const validGstin = (g) => GSTIN_RE.test(String(g || '').toUpperCase());
    const STATES = { '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory' };
    const pos = (code) => `${code}-${STATES[code] || ''}`;
    const dmy = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : (s || ''); };
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const parse = (s) => new Date(s + 'T00:00:00');

    // ====================================================================== periods
    const fyStart = (d) => (d || new Date()).getMonth() >= 3 ? (d || new Date()).getFullYear() : (d || new Date()).getFullYear() - 1;
    function period(key, from, to) {
        const now = new Date(), y = now.getFullYear(), m = now.getMonth();
        const mr = (yy, mm) => [iso(new Date(yy, mm, 1)), iso(new Date(yy, mm + 1, 0))];
        const qr = (yy, qq) => [iso(new Date(yy, qq * 3, 1)), iso(new Date(yy, qq * 3 + 3, 0))];
        const q = Math.floor(m / 3);
        let a, b, label;
        if (key === 'month') { [a, b] = mr(y, m); label = `${MON[m]} ${y}`; }
        else if (key === 'lastmonth') { [a, b] = mr(y, m - 1); const d = parse(a); label = `${MON[d.getMonth()]} ${d.getFullYear()}`; }
        else if (key === 'quarter') { [a, b] = qr(y, q); label = `${MON[q * 3]}–${MON[q * 3 + 2]} ${y}`; }
        else if (key === 'lastquarter') { [a, b] = qr(q === 0 ? y - 1 : y, q === 0 ? 3 : q - 1); const d = parse(a); label = `${MON[d.getMonth()]}–${MON[d.getMonth() + 2]} ${d.getFullYear()}`; }
        else if (key === 'custom') { a = from || todayStr(); b = to || todayStr(); label = `${dmy(a)} to ${dmy(b)}`; }
        else { const off = key === 'fy' ? 0 : key === 'lastfy' ? -1 : -2; const s = fyStart() + off; a = `${s}-04-01`; b = `${s + 1}-03-31`; label = `FY ${s}-${String(s + 1).slice(2)}`; }
        return { from: a, to: b, label, fy: key === 'fy' || key === 'lastfy' || key === 'fy2' ? a.slice(0, 4) : null };
    }

    // ====================================================================== data
    const billsIn = (a, b) => bills.filter(x => (x.date || '') >= a && (x.date || '') <= b);
    const purIn = (a, b) => purchases.filter(x => (x.date || '') >= a && (x.date || '') <= b);
    const isB2B = (b) => b.customer && validGstin(b.customer.gstin);
    const split = (tax) => { const c = r2(tax / 2); return [c, r2(tax - c)]; };

    // net tax-head figures for a period (shared by GSTR-3B, annual and the dashboard-style summaries)
    function core(a, b) {
        const bs = billsIn(a, b), ps = purIn(a, b);
        const out = { bills: bs.length, taxable: 0, nil: 0, cgst: 0, sgst: 0, igst: 0, value: 0, byRate: {} };
        bs.forEach(x => {
            const t = getBillTotals(x);
            out.value += num(x.total);
            (t.gstBreakup || []).forEach(g => {
                if (num(g.rate) > 0) { out.taxable += num(g.taxable); out.cgst += num(g.cgst); out.sgst += num(g.sgst); } else out.nil += num(g.taxable);
                const r = out.byRate[g.rate] = out.byRate[g.rate] || { taxable: 0, tax: 0 };
                r.taxable += num(g.taxable); r.tax += num(g.gst);
            });
        });
        const itc = { purchases: ps.length, taxable: 0, cgst: 0, sgst: 0, igst: 0, excluded: [], mismatched: [] };
        ps.forEach(p => {
            if (!validGstin(p.supplier && p.supplier.gstin)) { itc.excluded.push(p); return; }
            const tax = num(p.totalTax);
            itc.taxable += num(p.taxable);
            if (String(p.supplier.gstin).toUpperCase().slice(0, 2) !== OWN_STATE) itc.igst += tax; else { const [c, s] = split(tax); itc.cgst += c; itc.sgst += s; }
            if (p.reconciled === false) itc.mismatched.push(p);
        });
        ['taxable', 'nil', 'cgst', 'sgst', 'igst', 'value'].forEach(k => { out[k] = r2(out[k]); });
        ['taxable', 'cgst', 'sgst', 'igst'].forEach(k => { itc[k] = r2(itc[k]); });
        return { out, itc, bs, ps };
    }

    // GST set-off rules: IGST credit first (against IGST, then CGST, then SGST), then CGST credit (CGST, then IGST), then SGST credit (SGST, then IGST)
    function setOff(liab, itc) {
        const L = { igst: liab.igst, cgst: liab.cgst, sgst: liab.sgst }, C = { igst: itc.igst, cgst: itc.cgst, sgst: itc.sgst };
        const used = { igst: { igst: 0, cgst: 0, sgst: 0 }, cgst: { igst: 0, cgst: 0, sgst: 0 }, sgst: { igst: 0, cgst: 0, sgst: 0 } };
        const apply = (credit, heads) => heads.forEach(h => { const u = Math.min(C[credit], L[h]); used[credit][h] = r2(u); L[h] = r2(L[h] - u); C[credit] = r2(C[credit] - u); });
        apply('igst', ['igst', 'cgst', 'sgst']); apply('cgst', ['cgst', 'igst']); apply('sgst', ['sgst', 'igst']);
        return { cash: L, carry: C, used };
    }

    function hsnRows(bs) {
        const map = new Map();
        bs.forEach(b => (b.items || []).forEach(it => {
            const hsn = String(it.hsn || '').trim() || 'NA', rate = num(it.gstRate), key = hsn + '|' + rate;
            const e = map.get(key) || { hsn, rate, desc: it.name || '', qty: 0, taxable: 0, tax: 0 };
            e.qty += num(it.qty); e.taxable += num(it.amount); e.tax += r2(num(it.amount) * rate / 100);
            map.set(key, e);
        }));
        return [...map.values()].sort((a, c) => a.hsn.localeCompare(c.hsn) || a.rate - c.rate).map(e => {
            const [c, s] = split(r2(e.tax));
            return [e.hsn, e.desc, 'NOS-NUMBERS', r2(e.qty), r2(e.taxable + e.tax), r2(e.taxable), 0, c, s, 0, e.rate];
        });
    }

    // ====================================================================== report models
    // section: { id, title, note, head:[], cols:['text'|'money'|'int'|'qty'|'pct'], rows:[[...]], foot:[...] }
    const sum = (rows, i) => r2(rows.reduce((a, r) => a + num(r[i]), 0));

    function buildGstr1(P) {
        const { bs } = core(P.from, P.to);
        const notices = [];
        if (!bs.length) notices.push({ level: 'info', text: 'No sales bills in this period.' });
        // B2B
        const b2b = [];
        bs.filter(isB2B).forEach(b => (getBillTotals(b).gstBreakup || []).forEach(g => b2b.push([b.customer.gstin, b.customer.name || '', b.invoiceNo, dmy(b.date), num(b.total), pos(b.customer.gstin.slice(0, 2)), 'N', '', 'Regular B2B', '', num(g.rate), r2(g.taxable), 0])));
        // B2C (small)
        const m = new Map();
        bs.filter(b => !isB2B(b)).forEach(b => (getBillTotals(b).gstBreakup || []).forEach(g => { const k = num(g.rate); m.set(k, (m.get(k) || 0) + num(g.taxable)); }));
        const b2cs = [...m.entries()].sort((a, c) => a[0] - c[0]).map(([rate, t]) => ['OE', pos(OWN_STATE), rate, r2(t), 0, '']);
        // HSN
        const hsn = hsnRows(bs);
        // documents issued
        const nums = bs.map(b => String(b.invoiceNo || '')).filter(Boolean).sort((a, c) => a.localeCompare(c, undefined, { numeric: true }));
        const docs = nums.length ? [['Invoices for outward supply', nums[0], nums[nums.length - 1], nums.length, 0]] : [];
        // summary
        const taxable = sum(b2b, 11) + sum(b2cs, 3);
        const cgst = r2(bs.reduce((a, b) => a + num(getBillTotals(b).totalCgst), 0)), sgst = r2(bs.reduce((a, b) => a + num(getBillTotals(b).totalSgst), 0));
        const total = r2(bs.reduce((a, b) => a + num(b.total), 0));
        // data-quality checks
        const otherState = bs.filter(b => isB2B(b) && b.customer.gstin.slice(0, 2) !== OWN_STATE);
        if (otherState.length) notices.push({ level: 'err', text: `${otherState.length} bill(s) are to customers in another state (${otherState.map(b => '#' + b.invoiceNo).join(', ')}). Sales to another state need IGST, but this app currently records CGST + SGST only — correct these before filing.` });
        const badG = bs.filter(b => b.customer && b.customer.gstin && !validGstin(b.customer.gstin));
        if (badG.length) notices.push({ level: 'warn', text: `${badG.length} bill(s) have a customer GSTIN that is not valid (${badG.map(b => '#' + b.invoiceNo).join(', ')}); they were treated as B2C.` });
        const noHsn = hsn.filter(r => r[0] === 'NA').length;
        if (noHsn) notices.push({ level: 'warn', text: 'Some bill items have no HSN code (shown as "NA"). HSN is mandatory in GSTR-1 (4 digits up to ₹5 crore turnover, 6 digits above).' });
        const numbers = nums.map(n => parseInt(String(n).replace(/\D/g, ''), 10)).filter(n => !isNaN(n)).sort((a, c) => a - c);
        const gaps = []; for (let i = 1; i < numbers.length; i++) for (let k = numbers[i - 1] + 1; k < numbers[i] && gaps.length < 20; k++) gaps.push(k);
        if (gaps.length) notices.push({ level: 'warn', text: `Invoice numbers missing in this period's series: ${gaps.map(g => String(g).padStart(3, '0')).join(', ')}. Deleted or cancelled invoices must be declared as cancelled in the "Documents issued" table.` });
        notices.push({ level: 'info', text: 'Working data to key in (or import) on the GST portal / offline tool — columns follow the GSTR-1 offline-tool layout. B2C Large (inter-state invoices above ₹2.5 lakh), exports, credit/debit notes and amendments are not tracked in this app.' });
        return {
            id: 'gstr1', title: 'GSTR-1 / IFF — outward supplies', file: 'GSTR1', period: P, notices,
            sections: [
                { id: 'summary', title: 'Summary', head: ['Particulars', 'Value'], cols: ['text', 'money'], rows: [['Invoices issued', { v: bs.length, t: 'int' }], ['B2B invoices (customer has GSTIN)', { v: bs.filter(isB2B).length, t: 'int' }], ['B2C invoices', { v: bs.filter(b => !isB2B(b)).length, t: 'int' }], ['Taxable value', r2(taxable)], ['Central tax (CGST)', cgst], ['State tax (SGST)', sgst], ['Total invoice value', total]] },
                { id: 'b2b', title: 'Table 4A — B2B invoices', sheet: 'b2b', head: ['GSTIN/UIN of Recipient', 'Receiver Name', 'Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply', 'Reverse Charge', 'Applicable % of Tax Rate', 'Invoice Type', 'E-Commerce GSTIN', 'Rate', 'Taxable Value', 'Cess Amount'], cols: ['text', 'text', 'text', 'text', 'money', 'text', 'text', 'text', 'text', 'text', 'pct', 'money', 'money'], rows: b2b, foot: b2b.length ? ['Total', '', '', '', '', '', '', '', '', '', '', sum(b2b, 11), 0] : null },
                { id: 'b2cs', title: 'Table 7 — B2C (small) summary', sheet: 'b2cs', head: ['Type', 'Place Of Supply', 'Rate', 'Taxable Value', 'Cess Amount', 'E-Commerce GSTIN'], cols: ['text', 'text', 'pct', 'money', 'money', 'text'], rows: b2cs, foot: b2cs.length ? ['Total', '', '', sum(b2cs, 3), 0, ''] : null },
                { id: 'hsn', title: 'Table 12 — HSN-wise summary of outward supplies', sheet: 'hsn', head: ['HSN', 'Description', 'UQC', 'Total Quantity', 'Total Value', 'Taxable Value', 'Integrated Tax', 'Central Tax', 'State/UT Tax', 'Cess', 'Rate'], cols: ['text', 'text', 'text', 'qty', 'money', 'money', 'money', 'money', 'money', 'money', 'pct'], rows: hsn, foot: hsn.length ? ['Total', '', '', '', sum(hsn, 4), sum(hsn, 5), 0, sum(hsn, 7), sum(hsn, 8), 0, ''] : null },
                { id: 'docs', title: 'Table 13 — Documents issued', sheet: 'docs', head: ['Nature of Document', 'Sr. No. From', 'Sr. No. To', 'Total Number', 'Cancelled'], cols: ['text', 'text', 'text', 'int', 'int'], rows: docs }
            ]
        };
    }

    function buildGstr3b(P) {
        const c = core(P.from, P.to), o = c.out, t = c.itc;
        const notices = [];
        if (!o.bills && !t.purchases) notices.push({ level: 'info', text: 'No bills or purchases in this period.' });
        const liab = { igst: o.igst, cgst: o.cgst, sgst: o.sgst };
        const so = setOff(liab, { igst: t.igst, cgst: t.cgst, sgst: t.sgst });
        if (t.excluded.length) notices.push({ level: 'warn', text: `${t.excluded.length} purchase(s) worth ${inr(t.excluded.reduce((a, p) => a + num(p.totalTax), 0))} of GST were left out of the input credit because the seller GSTIN is missing or invalid (${t.excluded.map(p => p.purchaseNo).join(', ')}). Input credit needs the seller's valid GSTIN.`, });
        if (t.mismatched.length) notices.push({ level: 'warn', text: `${t.mismatched.length} purchase(s) do not add up to the totals printed on the bill (${t.mismatched.map(p => p.purchaseNo).join(', ')}). Check them before claiming credit.` });
        notices.push({ level: 'info', text: 'Input credit is taken from the purchases you recorded in this period and should be matched with your GSTR-2B before filing. Credit reversals (Rule 42/43), blocked credit, interest, late fee and any opening credit balance are not tracked here. Under QRMP, tax for months 1 and 2 is paid via PMT-06 — enter those payments on the portal.' });
        const net = r2(so.cash.igst + so.cash.cgst + so.cash.sgst);
        return {
            id: 'gstr3b', title: 'GSTR-3B — summary return', file: 'GSTR3B', period: P, notices,
            sections: [
                { id: 'outward', title: '3.1 — Outward supplies and inward supplies liable to reverse charge', head: ['Nature of supplies', 'Total taxable value', 'Integrated tax', 'Central tax', 'State/UT tax', 'Cess'], cols: ['text', 'money', 'money', 'money', 'money', 'money'], rows: [['(a) Outward taxable supplies (other than zero rated, nil rated and exempted)', o.taxable, o.igst, o.cgst, o.sgst, 0], ['(b) Outward taxable supplies (zero rated)', 0, 0, 0, 0, 0], ['(c) Other outward supplies (nil rated, exempted)', o.nil, 0, 0, 0, 0], ['(d) Inward supplies (liable to reverse charge)', 0, 0, 0, 0, 0]] },
                { id: 'itc', title: '4 — Eligible ITC', head: ['Details', 'Integrated tax', 'Central tax', 'State/UT tax', 'Cess'], cols: ['text', 'money', 'money', 'money', 'money'], rows: [['(A)(5) All other ITC', t.igst, t.cgst, t.sgst, 0], ['(B) ITC reversed', 0, 0, 0, 0], ['(C) Net ITC available (A − B)', t.igst, t.cgst, t.sgst, 0]] },
                { id: 'pay', title: '6.1 — Payment of tax', head: ['Description', 'Tax payable', 'Paid through ITC — Integrated', 'Paid through ITC — Central', 'Paid through ITC — State/UT', 'Tax paid in cash'], cols: ['text', 'money', 'money', 'money', 'money', 'money'], rows: [['Integrated tax', liab.igst, so.used.igst.igst, so.used.cgst.igst, so.used.sgst.igst, so.cash.igst], ['Central tax', liab.cgst, so.used.igst.cgst, so.used.cgst.cgst, 0, so.cash.cgst], ['State/UT tax', liab.sgst, so.used.igst.sgst, 0, so.used.sgst.sgst, so.cash.sgst], ['Cess', 0, 0, 0, 0, 0]], foot: ['Total', r2(liab.igst + liab.cgst + liab.sgst), r2(so.used.igst.igst + so.used.igst.cgst + so.used.igst.sgst), r2(so.used.cgst.cgst + so.used.cgst.igst), r2(so.used.sgst.sgst + so.used.sgst.igst), net] },
                { id: 'result', title: 'Result', head: ['Particulars', 'Amount'], cols: ['text', 'money'], rows: [['GST to pay in cash', net], ['Unused input credit carried forward — Integrated', so.carry.igst], ['Unused input credit carried forward — Central', so.carry.cgst], ['Unused input credit carried forward — State/UT', so.carry.sgst]] }
            ]
        };
    }

    function monthsOf(P) { const out = []; for (let d = parse(P.from); iso(d) <= P.to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) out.push([iso(d), iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)), `${MON[d.getMonth()]} ${d.getFullYear()}`]); return out; }

    function buildAnnual(P) {
        const notices = [];
        const rows = [], months = monthsOf(P);
        let carry = { igst: 0, cgst: 0, sgst: 0 };
        months.forEach(([a, b, label]) => {
            const c = core(a, b), o = c.out, t = c.itc;
            const so = setOff({ igst: o.igst, cgst: o.cgst, sgst: o.sgst }, { igst: t.igst + carry.igst, cgst: t.cgst + carry.cgst, sgst: t.sgst + carry.sgst });
            carry = so.carry;
            rows.push([label, { v: o.bills, t: 'int' }, o.taxable, o.nil, o.cgst, o.sgst, { v: t.purchases, t: 'int' }, t.taxable, t.cgst, t.sgst, t.igst, r2(so.cash.igst + so.cash.cgst + so.cash.sgst)]);
        });
        const foot = ['Total', { v: rows.reduce((a, r) => a + r[1].v, 0), t: 'int' }, sum(rows, 2), sum(rows, 3), sum(rows, 4), sum(rows, 5), { v: rows.reduce((a, r) => a + r[6].v, 0), t: 'int' }, sum(rows, 7), sum(rows, 8), sum(rows, 9), sum(rows, 10), sum(rows, 11)];
        const all = core(P.from, P.to);
        const turnover = r2(all.out.taxable + all.out.nil);
        if (all.itc.excluded.length) notices.push({ level: 'warn', text: `${all.itc.excluded.length} purchase(s) have no valid seller GSTIN and were left out of the input credit.` });
        if (turnover > 20000000) notices.push({ level: 'info', text: `Your turnover for this year is above ₹2 crore, so GSTR-9 is mandatory.` });
        else notices.push({ level: 'info', text: `Your turnover for this year (${inr(turnover)} before GST) is within ₹2 crore, where GSTR-9 is optional. This sheet still gives you every figure for it. GSTR-9C applies only above ₹5 crore.` });
        notices.push({ level: 'info', text: 'Month-wise cash payable assumes unused input credit carries forward to the next month and ignores any opening credit balance from before this year.' });
        const hsn = hsnRows(all.bs);
        const rate = {}; all.bs.forEach(b => (getBillTotals(b).gstBreakup || []).forEach(g => { const r = rate[g.rate] = rate[g.rate] || [num(g.rate), 0, 0, 0, 0]; r[1] += num(g.taxable); r[2] += num(g.cgst); r[3] += num(g.sgst); }));
        const rateRows = Object.values(rate).sort((a, c) => a[0] - c[0]).map(r => [r[0], r2(r[1]), r2(r[2]), r2(r[3]), r2(r[2] + r[3])]);
        return {
            id: 'annual', title: 'Annual GST summary (working paper for GSTR-9)', file: 'Annual_GST', period: P, notices,
            sections: [
                { id: 'months', title: 'Month-wise sales, input credit and tax payable', sheet: 'monthly', head: ['Month', 'Bills', 'Taxable sales', 'Nil-rated sales', 'CGST collected', 'SGST collected', 'Purchases', 'Taxable purchases', 'ITC CGST', 'ITC SGST', 'ITC IGST', 'Tax payable in cash'], cols: ['text', 'int', 'money', 'money', 'money', 'money', 'int', 'money', 'money', 'money', 'money', 'money'], rows, foot },
                { id: 'rate', title: 'Outward supplies by tax rate (year)', sheet: 'by_rate', head: ['Rate', 'Taxable value', 'CGST', 'SGST', 'Total tax'], cols: ['pct', 'money', 'money', 'money', 'money'], rows: rateRows, foot: rateRows.length ? ['Total', sum(rateRows, 1), sum(rateRows, 2), sum(rateRows, 3), sum(rateRows, 4)] : null },
                { id: 'hsn', title: 'HSN-wise summary of outward supplies (year)', sheet: 'hsn', head: ['HSN', 'Description', 'UQC', 'Total Quantity', 'Total Value', 'Taxable Value', 'Integrated Tax', 'Central Tax', 'State/UT Tax', 'Cess', 'Rate'], cols: ['text', 'text', 'text', 'qty', 'money', 'money', 'money', 'money', 'money', 'money', 'pct'], rows: hsn }
            ]
        };
    }

    // Opening stock value per financial year: stored with the rest of the data (falls back to the old per-browser value)
    function openingKey(fy) { return 'bm_opening_stock_' + fy; }
    function getOpening(fy) {
        const v = window.Sync ? Sync.getOpeningStock(fy) : undefined;
        if (v != null) return v;
        try { return localStorage.getItem(openingKey(fy)) || ''; } catch (e) { return ''; }
    }
    function setOpening(fy, raw) {
        const t = String(raw).trim();
        if (window.Sync) Sync.setOpeningStock(fy, t === '' ? null : Number(t));
        try { localStorage.setItem(openingKey(fy), t); } catch (e) { }
    }
    function buildTrading(P) {
        const c = core(P.from, P.to), bs = c.bs, ps = c.ps, notices = [];
        const turnover = r2(bs.reduce((a, b) => a + num(getBillTotals(b).subtotal), 0));
        const purch = r2(ps.reduce((a, p) => a + num(p.taxable), 0));
        const charges = r2(ps.reduce((a, p) => a + (p.charges || []).filter(x => !num(x.gstRate)).reduce((s, x) => s + num(x.amount), 0), 0));
        const digitalModes = ['upi', 'card', 'netbanking'];
        let digital = 0, cash = 0;
        bs.forEach(b => { const v = num(getBillTotals(b).subtotal); if (digitalModes.includes(String(b.paymentMode || '').toLowerCase())) digital += v; else cash += v; });
        digital = r2(digital); cash = r2(cash);
        const closing = r2(inventory.reduce((a, i) => a + num(i.stock) * num(i.costPrice != null ? i.costPrice : (i.priceExGst != null ? i.priceExGst : i.rate)), 0));
        const opening = num(getOpening(P.fy));
        const gross = r2(turnover + closing - opening - purch - charges);
        const cashPct = turnover ? cash / turnover * 100 : 0;
        const presumptive = r2(digital * 0.06 + cash * 0.08);
        const limit44AD = cashPct <= 5 ? 30000000 : 20000000, audit = cashPct <= 5 ? 100000000 : 10000000;
        if (P.fy == null) notices.push({ level: 'warn', text: 'The income-tax pack is meant for a financial year — choose a financial year above.' });
        notices.push({ level: 'warn', text: 'Closing stock is today\'s inventory valued at the last purchase cost (selling price where no cost is known), so it is only right for the current year-end. Enter the opening stock above. This is a gross-profit estimate for discussion with your CA — it contains no expenses, drawings, loans or bank balances.' });
        const noCost = inventory.filter(i => i.costPrice == null && num(i.stock) > 0).length;
        if (noCost) notices.push({ level: 'info', text: `${noCost} item(s) in stock have no purchase cost recorded and were valued at their selling price.` });
        notices.push({ level: 'info', text: 'Sec 44AD (presumptive income) and Sec 44AB (tax audit) limits shown below depend on your cash share and your CA\'s advice — treat them as a guide, not as a filing.' });
        return {
            id: 'trading', title: 'Income-tax pack — trading account & turnover', file: 'IncomeTax_Pack', period: P, notices,
            sections: [
                { id: 'trading', title: 'Trading account (estimate)', sheet: 'trading', head: ['Particulars', 'Amount'], cols: ['text', 'money'], rows: [['Sales (turnover, before GST)', turnover], ['Add: closing stock (at cost)', closing], ['Less: opening stock', opening], ['Less: purchases (before GST)', purch], ['Less: freight / other direct charges on purchases', charges], ['Gross profit (estimate)', gross], ['Gross profit as % of sales', { v: turnover ? r2(gross / turnover * 100) : 0, t: 'pct' }]] },
                { id: 'mode', title: 'Sales by mode of receipt', sheet: 'receipts', head: ['Mode', 'Sales before GST', 'Share'], cols: ['text', 'money', 'pct'], rows: [['Digital (UPI, card, net banking)', digital, turnover ? r2(digital / turnover * 100) : 0], ['Cash / other', cash, turnover ? r2(cash / turnover * 100) : 0]], foot: ['Total', turnover, 100] },
                { id: 'limits', title: 'Thresholds to discuss with your CA', sheet: 'thresholds', head: ['Item', 'Your figure', 'Limit', 'Status'], cols: ['text', 'text', 'text', 'text'], rows: [['Presumptive taxation (Sec 44AD) — turnover limit', inr(turnover), inr(limit44AD), turnover <= limit44AD ? 'Within limit' : 'Above limit'], ['Deemed profit under 44AD (6% digital + 8% other receipts)', inr(presumptive), '—', 'Informational'], ['Tax audit (Sec 44AB) — turnover limit', inr(turnover), inr(audit), turnover > audit ? 'Audit likely required' : 'Below limit'], ['Cash share of receipts', cashPct.toFixed(1) + '%', '5% (raises the limits above)', cashPct <= 5 ? 'Within 5%' : 'Above 5%']] }
            ]
        };
    }

    // ====================================================================== filing guide (static + live figures)
    function guideHtml() {
        const pan4 = OWN_GSTIN[5], kinds = { P: 'Individual / proprietorship', C: 'Company', F: 'Firm / LLP', H: 'HUF', A: 'Association of persons', B: 'Body of individuals', T: 'Trust', G: 'Government', L: 'Local authority', J: 'Artificial juridical person' };
        const kind = kinds[pan4] || 'Unknown', isProp = pan4 === 'P';
        const P = period('fy'), t = r2(core(P.from, P.to).out.taxable + core(P.from, P.to).out.nil);
        const row = (name, ap, why, where) => `<tr><td><b>${name}</b></td><td><span class="badge badge-${ap === 'Yes' ? 'success' : ap === 'Maybe' ? 'warning' : 'muted'}">${ap}</span></td><td>${why}</td><td>${where}</td></tr>`;
        return `<div class="card">
            <div class="card-head"><h3>Which filings apply to your business?</h3></div>
            <p class="muted" style="margin:0 0 12px">Your GSTIN <span class="mono">${esc(OWN_GSTIN)}</span> (state ${esc(pos(OWN_STATE))}) indicates: <b>${esc(kind)}</b>. Turnover recorded this financial year: <b>${inr(t)}</b> before GST.</p>
            <div class="table-wrap"><table class="data-table guide-table"><thead><tr><th>Filing</th><th>Applies?</th><th>Why</th><th>In this app</th></tr></thead><tbody>
            ${row('GSTR-1 / IFF', 'Yes', 'Regular taxpayer selling taxable goods. Quarterly (with monthly IFF) under QRMP if turnover is up to ₹5 crore, otherwise monthly.', 'GSTR-1 tab')}
            ${row('GSTR-3B', 'Yes', 'Summary of sales, input credit and tax paid — quarterly under QRMP (tax paid monthly), otherwise monthly.', 'GSTR-3B tab')}
            ${row('GSTR-9 (annual return)', t > 20000000 ? 'Yes' : 'Maybe', 'Mandatory above ₹2 crore turnover, optional below it.', 'Annual GST tab')}
            ${row('GSTR-9C', t > 50000000 ? 'Yes' : 'No', 'Only for turnover above ₹5 crore.', '—')}
            ${row('CMP-08 / GSTR-4 (composition)', 'No', 'You charge GST and claim input credit, so you are a regular taxpayer, not a composition dealer.', '—')}
            ${row('Income-tax return', 'Yes', isProp ? 'A proprietor files ITR-3 (with books) or ITR-4 (presumptive, Sec 44AD) — your CA decides.' : 'File the ITR form suited to your constitution.', 'Income-tax pack tab')}
            ${row('Tax audit report (3CA/3CB/3CD)', t > 10000000 ? 'Maybe' : 'No', 'Required if turnover crosses ₹1 crore (₹10 crore when cash receipts are ≤ 5%).', 'Income-tax pack tab (thresholds)')}
            ${row('MCA / ROC (AOC-4, MGT-7, CRA-4, ITR-6)', isProp ? 'No' : 'Maybe', isProp ? 'These are for companies and LLPs; a proprietorship does not file them.' : 'Applies to companies / LLPs.', '—')}
            ${row('TDS / TCS statements (24Q, 26Q, 27Q, 27EQ)', 'Maybe', 'Only if you deduct TDS (salaries, rent, contractors above the limits). TCS on purchases (as on the Servo bill) is collected and reported by the seller — it appears in your Form 26AS as a credit.', 'TCS is recorded under "other charges" on a purchase')}
            ${row('ESI / PF returns', 'Maybe', 'Only if you employ enough people (ESI 10+, PF 20+). Payroll is not tracked in this app.', '—')}
            </tbody></table></div>
            <p class="muted" style="margin:12px 0 0;font-size:12.5px">These are working papers built from the data you enter. Please confirm applicability, due dates and figures with your CA before filing.</p></div>`;
    }

    // ====================================================================== rendering
    let tab = 'gstr1', current = null;
    const BUILDERS = { gstr1: buildGstr1, gstr3b: buildGstr3b, annual: buildAnnual, trading: buildTrading };

    const money = (v) => Number(v) < 0 ? '−' + inr(-Number(v)) : inr(v);
    function fmtCell(v, type) {
        if (v && typeof v === 'object' && 't' in v) { type = v.t; v = v.v; }
        if (v == null || v === '') return '';
        switch (type) { case 'money': return money(v); case 'int': return String(v); case 'qty': return String(v); case 'pct': return (Number(v) % 1 ? Number(v).toFixed(2) : Number(v)) + '%'; default: return esc(v); }
    }
    const isNumType = (t) => ['money', 'int', 'qty', 'pct'].includes(t);

    function renderModel(m) {
        const lvl = { err: 'err', warn: 'warn', info: 'info' };
        const icon = (l) => l === 'info' ? '<svg class="ic"><use href="#i-box"/></svg>' : '<svg class="ic"><use href="#i-alert"/></svg>';
        let html = `<div class="notices">${m.notices.map(n => `<div class="notice ${lvl[n.level]}">${icon(n.level)}<div>${esc(n.text)}</div></div>`).join('')}</div>`;
        m.sections.forEach(s => {
            html += `<div class="card table-card rep-card"><div class="card-head" style="padding:14px 16px 0"><h3>${esc(s.title)}</h3><span class="muted">${s.rows.length} row${s.rows.length === 1 ? '' : 's'}</span></div><div class="table-wrap"><table class="data-table rep-table"><thead><tr>${s.head.map((h, i) => `<th class="${isNumType(s.cols[i]) ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>`;
            html += s.rows.length ? s.rows.map(r => `<tr>${r.map((c, i) => `<td class="${isNumType(c && c.t ? c.t : s.cols[i]) ? 'num' : ''}">${fmtCell(c, s.cols[i])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${s.head.length}" class="empty-state"><div class="big">Nothing to report here for this period</div></td></tr>`;
            html += '</tbody>' + (s.foot ? `<tfoot><tr>${s.foot.map((c, i) => `<td class="${isNumType(c && c.t ? c.t : s.cols[i]) ? 'num' : ''}">${fmtCell(c, s.cols[i])}</td>`).join('')}</tr></tfoot>` : '') + '</table></div></div>';
        });
        return html;
    }

    function currentPeriod() {
        if (tab === 'annual' || tab === 'trading') return period($('repFy').value || 'fy');
        const k = $('repPeriod').value;
        return period(k, $('repFrom').value, $('repTo').value);
    }

    function render() {
        if (!$('rep-body')) return;
        ['gstr1', 'gstr3b', 'annual', 'trading', 'guide'].forEach(t => document.querySelector(`#repTabs [data-tab="${t}"]`).classList.toggle('on', t === tab));
        const fyTab = tab === 'annual' || tab === 'trading', guide = tab === 'guide';
        $('repPeriodWrap').hidden = fyTab || guide; $('repFyWrap').hidden = !fyTab; $('repOpenWrap').hidden = tab !== 'trading';
        $('repCustom').hidden = fyTab || guide || $('repPeriod').value !== 'custom';
        $('repExport').hidden = guide;
        if (guide) { current = null; $('rep-body').innerHTML = guideHtml(); $('repTitle').textContent = 'Filing guide'; $('repPeriodLabel').textContent = ''; return; }
        const P = currentPeriod();
        if (tab === 'trading') { $('repOpening').value = getOpening(P.fy); }
        current = BUILDERS[tab](P);
        $('repTitle').textContent = current.title;
        $('repPeriodLabel').textContent = `${dmy(P.from)} to ${dmy(P.to)}`;
        $('rep-body').innerHTML = renderModel(current);
    }

    // ====================================================================== exports
    function cellVal(c, type) { if (c && typeof c === 'object' && 't' in c) return { v: c.v, t: c.t }; return { v: c, t: type }; }
    const safeSheet = (s, used) => { let n = String(s).replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31).trim() || 'Sheet'; let k = n, i = 2; while (used.has(k)) k = n.slice(0, 28) + ' ' + i++; used.add(k); return k; };

    function toExcel(m) {
        if (!window.XLSX) { toast('Excel library could not be loaded — use CSV instead', 'error'); return; }
        const wb = XLSX.utils.book_new(), used = new Set();
        const about = [[m.title.toUpperCase()], [COMPANY + (OWN_GSTIN ? '   ·   GSTIN ' + OWN_GSTIN : '')], [`Period: ${m.period.label} (${dmy(m.period.from)} to ${dmy(m.period.to)})   ·   Generated ${dmy(todayStr())}`], []].concat(m.notices.map(n => [`${n.level === 'info' ? 'Note' : 'Check'}: ${n.text}`]));
        const wsA = XLSX.utils.aoa_to_sheet(about); wsA['!cols'] = [{ wch: 140 }];
        XLSX.utils.book_append_sheet(wb, wsA, safeSheet('About', used));
        m.sections.forEach(s => {
            const aoa = [s.head].concat(s.rows.map(r => r.map((c, i) => cellVal(c, s.cols[i]).v)));
            if (s.foot) aoa.push(s.foot.map((c, i) => cellVal(c, s.cols[i]).v));
            const ws = XLSX.utils.aoa_to_sheet(aoa);
            const all = s.rows.concat(s.foot ? [s.foot] : []);
            all.forEach((r, ri) => r.forEach((c, ci) => { const t = cellVal(c, s.cols[ci]).t, cell = ws[XLSX.utils.encode_cell({ r: ri + 1, c: ci })]; if (cell && typeof cell.v === 'number') cell.z = t === 'money' ? '#,##0.00' : t === 'pct' ? '0.##"%"' : t === 'qty' ? '#,##0.###' : '0'; }));
            ws['!cols'] = s.head.map((h, i) => ({ wch: Math.max(12, Math.min(48, Math.max(h.length, ...s.rows.slice(0, 40).map(r => String(cellVal(r[i], s.cols[i]).v == null ? '' : cellVal(r[i], s.cols[i]).v).length)) + 2)) }));
            XLSX.utils.book_append_sheet(wb, ws, safeSheet(s.sheet || s.title, used));
        });
        XLSX.writeFile(wb, `${m.file}_${stamp(m)}.xlsx`);
    }
    function toCsv(m) {
        const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
        const lines = [q(m.title), q(`Period: ${m.period.label}`), ''];
        m.sections.forEach(s => { lines.push(q(s.title)); lines.push(s.head.map(q).join(',')); s.rows.forEach(r => lines.push(r.map((c, i) => q(cellVal(c, s.cols[i]).v)).join(','))); if (s.foot) lines.push(s.foot.map((c, i) => q(cellVal(c, s.cols[i]).v)).join(',')); lines.push(''); });
        downloadBlob(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${m.file}_${stamp(m)}.csv`);
    }
    function toPdf(m) {
        if (!(window.jspdf && window.jspdf.jsPDF)) { toast('PDF library could not be loaded — use Excel or CSV', 'error'); return; }
        const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
        doc.setFontSize(14); doc.setFont(undefined, 'bold'); doc.text(m.title.toUpperCase(), 40, 40);
        doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.text(`${COMPANY}   ·   GSTIN ${OWN_GSTIN}   ·   Period: ${m.period.label}`, 40, 56);
        let y = 72;
        const f = (c, t) => { const x = cellVal(c, t); if (x.v == null || x.v === '') return ''; if (x.t === 'money') return Number(x.v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); if (x.t === 'pct') return x.v + '%'; return String(x.v); };
        m.sections.forEach(s => {
            if (y > 480) { doc.addPage(); y = 40; }
            doc.setFontSize(10.5); doc.setFont(undefined, 'bold'); doc.text(s.title, 40, y); doc.setFont(undefined, 'normal');
            doc.autoTable({ startY: y + 6, head: [s.head], body: s.rows.map(r => r.map((c, i) => f(c, s.cols[i]))), foot: s.foot ? [s.foot.map((c, i) => f(c, s.cols[i]))] : undefined, styles: { fontSize: 7.5, cellPadding: 2.5 }, headStyles: { fillColor: [30, 58, 138] }, footStyles: { fillColor: [238, 242, 255], textColor: [17, 24, 39], fontStyle: 'bold' }, columnStyles: Object.fromEntries(s.cols.map((t, i) => [i, { halign: isNumType(t) ? 'right' : 'left' }])), margin: { left: 40, right: 40 } });
            y = doc.lastAutoTable.finalY + 22;
        });
        if (y > 500) { doc.addPage(); y = 40; }
        doc.setFontSize(8); doc.setTextColor(100); m.notices.forEach(n => { const lines = doc.splitTextToSize((n.level === 'info' ? 'Note: ' : 'Check: ') + n.text, 760); doc.text(lines, 40, y); y += lines.length * 10 + 4; });
        doc.save(`${m.file}_${stamp(m)}.pdf`);
    }
    const stamp = (m) => m.period.fy ? `FY${m.period.fy}-${String(+m.period.fy + 1).slice(2)}` : m.period.from === m.period.to ? m.period.from : `${m.period.from}_to_${m.period.to}`;

    // ====================================================================== wiring
    function init() {
        if (!$('repTabs')) return;
        $('repTabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; try { localStorage.setItem('bm_report_tab', tab); } catch (x) { } render(); } });
        $('repPeriod').addEventListener('change', render); $('repFrom').addEventListener('change', render); $('repTo').addEventListener('change', render); $('repFy').addEventListener('change', render);
        $('repOpening').addEventListener('input', () => { const P = currentPeriod(); setOpening(P.fy, $('repOpening').value); clearTimeout(init.t); init.t = setTimeout(() => { const keep = document.activeElement; render(); if (keep && keep.id === 'repOpening') { $('repOpening').focus(); } }, 400); });
        $('repXlsx').addEventListener('click', () => current && toExcel(current));
        $('repPdf').addEventListener('click', () => current && toPdf(current));
        $('repCsv').addEventListener('click', () => current && toCsv(current));
        try { const t = localStorage.getItem('bm_report_tab'); if (t && (BUILDERS[t] || t === 'guide')) tab = t; } catch (e) { }
    }
    window.renderReports = render;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
    window.ReportsApi = { period, core, setOff, buildGstr1, buildGstr3b, buildAnnual, buildTrading };
})();
