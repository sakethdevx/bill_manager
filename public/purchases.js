// Purchases: one record per supplier bill (seller, GSTIN, invoice, GST by rate), with items flowing into
// inventory + stock. Entry by photo (OCR in the browser, no API key) or manually. Month-end statement export.
(function () {
    'use strict';

    const K = window.UIKit;
    const $ = (id) => document.getElementById(id);
    const { inr, icon, hl, tokens, matchAll } = K;
    const esc = (v) => escHtml(v == null ? '' : v);
    const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
    const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
    const has = (v) => v !== '' && v != null && isFinite(parseFloat(v));
    const OWN_GSTIN = String((typeof COMPANY_INFO !== 'undefined' && COMPANY_INFO.GSTIN) || '').toUpperCase();
    const OWN_STATE = OWN_GSTIN.slice(0, 2);
    const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/;
    const TESS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js';
    const MAX_W = 2400;
    const normInv = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    // the reader sometimes drops a leading prefix ("V-EC-26-27-1758" vs "EC-26-27-1758"): treat a long common ending as the same invoice
    const sameInvoice = (a, b) => { a = normInv(a); b = normInv(b); return !!a && !!b && (a === b || (Math.min(a.length, b.length) >= 6 && (a.endsWith(b) || b.endsWith(a)))); };
    const gstinOk = (g) => GSTIN_RE.test(String(g || '').toUpperCase());
    const interState = (g) => gstinOk(g) && OWN_STATE && String(g).toUpperCase().slice(0, 2) !== OWN_STATE;
    const ddmmyyyy = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : (iso || ''); };

    // ======================================================================
    // Totals
    // ======================================================================
    function computeTotals(lines, charges, roundOff, declared, printedSlabs) {
        const slabs = {};
        let taxable = 0, other = 0;
        const add = (rate, net, tax) => { const k = String(rate); const s = slabs[k] = slabs[k] || { rate: +rate, taxable: 0, tax: 0 }; s.taxable += net; s.tax += tax; };
        lines.forEach(l => {
            const net = num(l.net), g = num(l.gstRate);
            add(g, net, l.gstAmt != null ? num(l.gstAmt) : r2(net * g / 100));
            taxable += net;
        });
        (charges || []).forEach(c => {
            const amt = num(c.amount), g = num(c.gstRate);
            if (g > 0) { add(g, amt, r2(amt * g / 100)); taxable += amt; } else other += amt;
        });
        // when the bill prints its own tax summary, use those per-rate figures if they agree with the items (differences are just paise of rounding)
        const list = Object.values(slabs).map(s => {
            const pr = (printedSlabs || []).find(x => Math.abs(x.rate - s.rate) < 0.01);
            const tax = pr && Math.abs(pr.tax - s.tax) <= 0.5 ? pr.tax : s.tax;
            return { rate: s.rate, taxable: r2(s.taxable), tax: r2(tax) };
        }).sort((a, b) => a.rate - b.rate);
        const calc = { slabs: list, taxable: r2(taxable), totalTax: r2(list.reduce((a, s) => a + s.tax, 0)), other: r2(other), roundOff: r2(num(roundOff)) };
        calc.grand = r2(calc.taxable + calc.totalTax + calc.other + calc.roundOff);
        const d = declared || {};
        const final = {
            taxable: has(d.taxable) ? r2(d.taxable) : calc.taxable,
            totalTax: has(d.tax) ? r2(d.tax) : calc.totalTax,
            grandTotal: has(d.grand) ? r2(d.grand) : calc.grand
        };
        const checks = [];
        if (has(d.taxable)) checks.push({ label: 'Taxable total', bill: r2(d.taxable), items: calc.taxable });
        if (has(d.tax)) checks.push({ label: 'Total GST', bill: r2(d.tax), items: calc.totalTax });
        if (has(d.grand)) checks.push({ label: 'Grand total', bill: r2(d.grand), items: calc.grand });
        checks.forEach(c => { c.diff = r2(c.bill - c.items); c.ok = Math.abs(c.diff) <= 1; });
        return { calc, final, checks, reconciled: checks.length > 0 && checks.every(c => c.ok) };
    }

    const splitTax = (tax, gstin) => { tax = num(tax); if (interState(gstin)) return { igst: r2(tax), cgst: 0, sgst: 0 }; const c = r2(tax / 2); return { cgst: c, sgst: r2(tax - c), igst: 0 }; };

    // ======================================================================
    // Draft state (the open drawer)
    // ======================================================================
    const D = window.__purchaseDraft = { slabs: [], files: [], rows: [], charges: [], raw: '', warnings: [], busy: false, nextId: 1, cur: 0, worker: null, source: 'manual', declared: {} };

    function show(step) {
        ['pick', 'progress', 'review', 'done'].forEach(s => { $('p-' + s).hidden = s !== step; });
        $('purchase-drawer').dataset.step = step;
        const b = $('purchase-drawer').querySelector('.drawer-body'); if (b) b.scrollTop = 0;
    }

    function resetDraft() {
        D.files.forEach(f => URL.revokeObjectURL(f.url));
        Object.assign(D, { slabs: [], files: [], rows: [], charges: [], raw: '', warnings: [], busy: false, declared: {}, source: 'manual' });
        ['pSupplier', 'pGstin', 'pInvoiceNo', 'pNotes', 'pDecTaxable', 'pDecTax', 'pDecGrand'].forEach(id => { $(id).value = ''; });
        $('pDate').value = K.todayStr(); $('pRound').value = '0';
        renderThumbs();
    }

    window.openPurchase = function (mode) {
        resetDraft();
        $('pTitle').textContent = 'New purchase';
        $('purchase-drawer').style.display = 'block';
        document.body.classList.add('no-scroll');
        if (mode === 'manual') startManual(); else show('pick');
    };
    window.closePurchase = function () {
        if (D.busy) return;
        $('purchase-drawer').style.display = 'none';
        document.body.classList.remove('no-scroll');
    };
    function startManual() {
        D.rows = [makeRow({ name: '', part: '', hsn: '', qty: '', unit: '', rate: '', gst: 18, discPct: 0, net: '', flags: {} }, true)];
        D.source = 'manual';
        renderReview(); show('review');
        if (!(window.matchMedia && matchMedia('(pointer: coarse)').matches)) setTimeout(() => { const f = $('pSupplier'); f && f.focus(); }, 60);
    }

    // ======================================================================
    // Choosing images + OCR
    // ======================================================================
    function addFiles(list) {
        const imgs = [...list].filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
        if (!imgs.length) { toast('Please choose an image (JPG or PNG)', 'error'); return; }
        imgs.forEach(f => D.files.push({ file: f, url: URL.createObjectURL(f), rot: 0, name: f.name }));
        renderThumbs();
    }
    function renderThumbs() {
        const box = $('pThumbs');
        box.innerHTML = D.files.map((f, i) => `<div class="thumb"><img src="${f.url}" alt="" style="transform:rotate(${f.rot}deg)">
            <div class="thumb-actions"><button type="button" data-rot="${i}" title="Rotate" aria-label="Rotate">↻</button><button type="button" data-del="${i}" title="Remove" aria-label="Remove">${icon('x')}</button></div></div>`).join('');
        box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { const f = D.files.splice(+b.dataset.del, 1)[0]; URL.revokeObjectURL(f.url); renderThumbs(); }));
        box.querySelectorAll('[data-rot]').forEach(b => b.addEventListener('click', () => { const f = D.files[+b.dataset.rot]; f.rot = (f.rot + 90) % 360; renderThumbs(); }));
        $('pReadBtn').disabled = !D.files.length;
        $('pReadBtn').textContent = D.files.length > 1 ? `Read ${D.files.length} pages` : 'Read bill';
    }
    function loadTesseract() {
        if (window.Tesseract) return Promise.resolve();
        return new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = TESS_URL; s.onload = res; s.onerror = () => rej(new Error('Could not load the text reader. It needs an internet connection the first time.'));
            document.head.appendChild(s);
        });
    }
    function toCanvas(f) {
        return new Promise((res, rej) => {
            const img = new Image();
            img.onload = () => {
                const sc = Math.min(1, MAX_W / Math.max(img.width, img.height * 0.75));
                const w = Math.round(img.width * sc), h = Math.round(img.height * sc), rot = f.rot % 360, swap = rot === 90 || rot === 270;
                const c = document.createElement('canvas'); c.width = swap ? h : w; c.height = swap ? w : h;
                const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
                x.translate(c.width / 2, c.height / 2); x.rotate(rot * Math.PI / 180); x.drawImage(img, -w / 2, -h / 2, w, h);
                // straighten, even out lighting and erase the table's ruled lines (big accuracy win on photos)
                try { if (!window.BillScanImage) return res(c); const o = BillScanImage.preprocess(c); console.debug('[scan] page', c.width + 'x' + c.height, 'skew', o.skew); res(o.canvas); }
                catch (e) { console.warn('image clean-up failed, using the original', e); res(c); }
            };
            img.onerror = () => rej(new Error('Could not open ' + f.name));
            img.src = f.url;
        });
    }

    async function readBill() {
        if (!D.files.length || D.busy) return;
        D.busy = true; show('progress');
        const bar = $('pBar'), msg = $('pMsg');
        const setP = (p, m) => { bar.style.width = Math.round(p * 100) + '%'; if (m) msg.textContent = m; };
        try {
            setP(0.02, 'Loading text reader…');
            await loadTesseract();
            if (!D.worker) {
                D.worker = await Tesseract.createWorker('eng', 1, {
                    logger: m => { if (m.status === 'recognizing text') setP((D.cur + m.progress) / D.files.length, `Reading page ${D.cur + 1} of ${D.files.length}…`); else if (/loading|initializ/.test(m.status)) setP(0.03, 'Preparing (first time may take a moment)…'); }
                });
            }
            const rows = [], raws = [], warnings = [], slabs = [], doc = { supplierName: '', supplierGstin: '', date: '', invoiceNo: '', charges: [], roundOff: 0, declared: { taxable: null, tax: null, grand: null } };
            for (D.cur = 0; D.cur < D.files.length; D.cur++) {
                setP(D.cur / D.files.length, `Reading page ${D.cur + 1} of ${D.files.length}…`);
                const canvas = await toCanvas(D.files[D.cur]);
                const { data } = await D.worker.recognize(canvas);
                raws.push(data.text);
                const r = BillScanParser.parse(data.words.map(w => ({ t: w.text, c: w.confidence, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 })), { ownGstin: OWN_GSTIN });
                r.warnings.forEach(w => warnings.push((D.files.length > 1 ? `Page ${D.cur + 1}: ` : '') + w));
                r.rows.forEach(x => rows.push(x));
                const d = r.doc || {};
                ['supplierName', 'supplierGstin', 'date'].forEach(k => { if (!doc[k] && d[k]) doc[k] = d[k]; });
                if (!doc.invoiceNo && r.invoiceNo) doc.invoiceNo = r.invoiceNo;
                (d.slabs || []).forEach(x => { if (!slabs.some(y => y.rate === x.rate)) slabs.push(x); });
                (d.charges || []).forEach(c => { if (!doc.charges.some(x => x.label === c.label && x.amount === c.amount)) doc.charges.push(c); });
                if (d.roundOff && !doc.roundOff) doc.roundOff = d.roundOff;
                ['taxable', 'tax', 'grand'].forEach(k => { if (doc.declared[k] == null && d.declared && d.declared[k] != null) doc.declared[k] = d.declared[k]; });
            }
            setP(1, 'Matching with your inventory…');
            D.raw = raws.join('\n\n--- next page ---\n\n'); D.warnings = warnings; D.source = 'scan'; D.slabs = slabs;
            D.rows = mergeDuplicates(rows).map(r => makeRow(r, false));
            D.charges = doc.charges.map(c => ({ label: c.label, amount: c.amount, gstRate: 0 }));
            $('pSupplier').value = doc.supplierName || ''; $('pGstin').value = doc.supplierGstin || '';
            $('pInvoiceNo').value = doc.invoiceNo || ''; $('pDate').value = doc.date || K.todayStr();
            $('pRound').value = doc.roundOff || 0;
            $('pDecTaxable').value = doc.declared.taxable != null ? doc.declared.taxable : '';
            $('pDecTax').value = doc.declared.tax != null ? doc.declared.tax : '';
            $('pDecGrand').value = doc.declared.grand != null ? doc.declared.grand : '';
            const known = findSupplier($('pSupplier').value, $('pGstin').value);
            if (known) { if (!$('pGstin').value) $('pGstin').value = known.gstin; if (!$('pSupplier').value) $('pSupplier').value = known.name; }
            D.busy = false; renderReview(); show('review');
        } catch (err) {
            console.error(err); D.busy = false; show('pick'); toast(err.message || 'Could not read the image', 'error');
        }
    }

    function mergeDuplicates(rows) {
        const seen = new Map(), out = [];
        rows.forEach(r => {
            const key = normInv(r.part);
            if (key && seen.has(key)) {
                const t = seen.get(key);
                t.qty = num(t.qty) + num(r.qty); t.net = r2(num(t.net) + num(r.net));
                if (t.gstAmt != null && r.gstAmt != null) t.gstAmt = r2(t.gstAmt + r.gstAmt); else t.gstAmt = null;
                return;
            }
            if (key) seen.set(key, r);
            out.push(r);
        });
        return out;
    }

    // ======================================================================
    // Rows (items of the purchase)
    // ======================================================================
    function makeRow(r, manual) {
        const row = {
            id: D.nextId++, name: r.name || '', part: r.part || '', hsn: r.hsn || '', qty: r.qty, unit: r.unit || '', rate: r.rate,
            disc: r.discPct || 0, discAmt: r.discAmt != null ? r.discAmt : '', discSource: r.discAmt != null ? 'amt' : 'pct', gst: r.gst == null ? 18 : r.gst, net: r.net == null ? '' : r.net,
            netManual: !manual && r.netSrc && r.netSrc !== 'qty × rate', gstAmtScanned: r.gstAmt == null ? null : r.gstAmt, flags: r.flags || {}
        };
        if (row.discAmt === '') row.discAmt = has(row.qty) && has(row.rate) ? r2(num(row.qty) * num(row.rate) * num(row.disc) / 100) : 0;
        rematch(row);
        return row;
    }
    function rematch(row) {
        row.match = BillScanParser.matchInventory(row, inventory);
        row.action = row.match.item ? 'u:' + row.match.item.id : 'new';
    }
    function recalcNet(row) {
        if (row.netManual) return;
        if (!(has(row.qty) && has(row.rate))) { row.net = ''; return; }
        const gross = num(row.qty) * num(row.rate);
        if (row.discSource === 'amt') {          // flat discount in rupees stays fixed when qty / rate change
            const d = Math.min(Math.max(num(row.discAmt), 0), gross);
            row.net = r2(gross - d); row.disc = gross > 0 ? r2(d / gross * 100) : 0;
        } else {                                 // percentage discount
            row.discAmt = r2(gross * num(row.disc) / 100);
            row.net = r2(gross - row.discAmt);
        }
    }
    const rowToLine = (row) => ({ net: num(row.net), gstRate: num(row.gst), gstAmt: row.gstAmtScanned });

    function statusBadge(row) {
        if (row.action === 'rec') return '<span class="badge badge-muted">Purchase only</span>';
        if (row.action.startsWith('u:')) return `<span class="badge badge-warning">In inventory · ${row.match.status === 'part' ? 'part number' : 'HSN + name'}</span>`;
        if (row.match.status === 'hsn' && row.match.candidates.length) return '<span class="badge badge-info">New · same HSN exists</span>';
        return '<span class="badge badge-success">New item</span>';
    }
    function actionOptions(row) {
        let o = '';
        row.match.candidates.slice(0, 6).forEach(i => { o += `<option value="u:${esc(i.id)}" ${row.action === 'u:' + i.id ? 'selected' : ''}>Add stock → ${esc(i.code)} · ${esc(i.name)} (now ${i.stock || 0})</option>`; });
        o += `<option value="new" ${row.action === 'new' ? 'selected' : ''}>Add to inventory as a new item</option>`;
        o += `<option value="rec" ${row.action === 'rec' ? 'selected' : ''}>Record in purchase only (not in inventory)</option>`;
        return o;
    }
    function fld(row, key, label, cls, type, extra) {
        const bad = row.flags[key] ? ' chk' : '';
        const title = row.flags[key] ? ' title="The text reader was not sure about this — please check"' : '';
        return `<label class="sc-f ${cls}${bad}"${title}><span>${label}</span><input data-k="${key}" data-id="${row.id}" type="${type || 'text'}" ${type === 'number' ? 'step="any" min="0"' : ''} value="${esc(row[key])}" ${extra || ''}></label>`;
    }
    function rowHtml(row) {
        const isDoz = /^do?z/i.test(row.unit || '');
        const existing = row.action.startsWith('u:') ? inventory.find(i => i.id === row.action.slice(2)) : null;
        return `<div class="sc-row ${existing ? 'exists' : ''}" data-id="${row.id}">
            <div class="sc-top">${statusBadge(row)}
                <select class="sc-action" data-id="${row.id}" aria-label="What to do with this item">${actionOptions(row)}</select>
                <button type="button" class="icon-btn" data-del="${row.id}" title="Remove item" aria-label="Remove item">${icon('trash')}</button></div>
            <div class="sc-grid">
                ${fld(row, 'name', 'Item name', 'sc-name')}
                ${fld(row, 'part', 'Part number', 'sc-part')}
                ${fld(row, 'hsn', 'HSN code', 'sc-hsn')}
                <label class="sc-f sc-qty${row.flags.qty ? ' chk' : ''}"><span>Qty${row.unit ? ` <em class="unit">${esc(row.unit)}</em>` : ''}</span><input data-k="qty" data-id="${row.id}" type="number" step="any" min="0" value="${esc(row.qty)}"></label>
                ${fld(row, 'rate', 'Rate (list, ₹)', 'sc-rate', 'number')}
                ${fld(row, 'disc', 'Discount %', 'sc-disc', 'number')}
                ${fld(row, 'discAmt', 'Discount ₹', 'sc-discamt', 'number')}
                ${fld(row, 'gst', 'GST %', 'sc-gst', 'number')}
                ${fld(row, 'net', 'Net value w/o GST (₹)', 'sc-net', 'number')}
            </div>
            <div class="sc-note">${rowNote(row, existing)}</div>
            ${isDoz ? `<button type="button" class="link-btn sc-doz" data-doz="${row.id}">Quantity is in dozens — convert to pieces (×12)</button>` : ''}
        </div>`;
    }
    function rowNote(row, existing) {
        const parts = [];
        const q = num(row.qty), n = num(row.net);
        if (q > 0 && n > 0) parts.push(`Cost per unit <b>${inr(n / q)}</b> · GST <b>${inr(row.gstAmtScanned != null ? row.gstAmtScanned : n * num(row.gst) / 100)}</b>`);
        if (existing) parts.push(`Stock of <b>${esc(existing.name)}</b> (${esc(existing.code)}): <b>${existing.stock || 0}</b> → <b>${(existing.stock || 0) + q}</b>`);
        return parts.join(' · ');
    }

    // ======================================================================
    // Review screen: notices, totals, reconciliation
    // ======================================================================
    function readDeclared() { return { taxable: $('pDecTaxable').value, tax: $('pDecTax').value, grand: $('pDecGrand').value }; }
    function currentTotals() {
        return computeTotals(D.rows.map(rowToLine), D.charges, $('pRound').value, readDeclared(), D.slabs);
    }

    function findSupplier(name, gstin) {
        const g = String(gstin || '').toUpperCase().trim(), n = String(name || '').toLowerCase().trim();
        return purchases.map(p => p.supplier).find(s => s && ((g && s.gstin === g) || (n && s.name && s.name.toLowerCase() === n))) || null;
    }
    function findDuplicate(gstin, name, invoiceNo, excludeId) {
        if (!normInv(invoiceNo)) return null;
        const g = String(gstin || '').toUpperCase().trim(), n = String(name || '').toLowerCase().trim();
        return purchases.find(p => p.id !== excludeId && sameInvoice(p.invoiceNo, invoiceNo) && ((g && p.supplier.gstin === g) || (!g && n && (p.supplier.name || '').toLowerCase() === n))) || null;
    }

    function renderCharges() {
        $('pCharges').innerHTML = D.charges.map((c, i) => `<div class="charge-row" data-i="${i}">
            <input data-c="label" type="text" value="${esc(c.label)}" placeholder="e.g. Freight & forwarding" aria-label="Charge name">
            <input data-c="amount" type="number" step="0.01" value="${esc(c.amount)}" placeholder="Amount ₹" aria-label="Amount">
            <label class="gst-in">GST % <input data-c="gstRate" type="number" step="any" min="0" value="${esc(c.gstRate)}"></label>
            <button type="button" class="icon-btn" data-delc="${i}" title="Remove" aria-label="Remove charge">${icon('trash')}</button></div>`).join('') || '<p class="muted" style="margin:0 0 8px">None. Add freight, packing, TCS or other amounts printed on the bill.</p>';
    }

    function renderTotals() {
        const T = currentTotals(), g = $('pGstin').value.toUpperCase();
        const inter = interState(g);
        let html = `<table class="ptable"><thead><tr><th>GST rate</th><th class="num">Taxable value</th>${inter ? '<th class="num">IGST</th>' : '<th class="num">CGST</th><th class="num">SGST</th>'}<th class="num">GST</th></tr></thead><tbody>`;
        T.calc.slabs.forEach(s => {
            const sp = splitTax(s.tax, g);
            html += `<tr><td>${s.rate}%</td><td class="num">${inr(s.taxable)}</td>${inter ? `<td class="num">${inr(sp.igst)}</td>` : `<td class="num">${inr(sp.cgst)}</td><td class="num">${inr(sp.sgst)}</td>`}<td class="num">${inr(s.tax)}</td></tr>`;
        });
        if (!T.calc.slabs.length) html += `<tr><td colspan="${inter ? 4 : 5}" class="muted">Add items to see the GST breakup.</td></tr>`;
        html += '</tbody></table>';
        html += `<div class="gst-line"><span>Net value (before GST)</span><span>${inr(T.calc.taxable)}</span></div>
            <div class="gst-line"><span>Total GST</span><span>${inr(T.calc.totalTax)}</span></div>
            ${T.calc.other ? `<div class="gst-line"><span>Other charges (no GST)</span><span>${inr(T.calc.other)}</span></div>` : ''}
            ${T.calc.roundOff ? `<div class="gst-line"><span>Round-off</span><span>${inr(T.calc.roundOff)}</span></div>` : ''}
            <div class="grand"><span>Grand total (from the items)</span><strong>${inr(T.calc.grand)}</strong></div>`;
        $('pTotals').innerHTML = html;

        const rc = $('pRecon');
        if (!T.checks.length) rc.innerHTML = '<div class="recon neutral">Enter the totals printed on the bill to double-check the items.</div>';
        else {
            const bad = T.checks.filter(c => !c.ok);
            rc.innerHTML = bad.length
                ? `<div class="recon warn">${icon('alert')}<div><b>The items do not add up to the bill's totals.</b> ${bad.map(c => `${c.label}: bill ${inr(c.bill)} vs items ${inr(c.items)} (${c.diff > 0 ? '+' : ''}${inr(c.diff)})`).join(' · ')}.<br>A row may be misread or missing. You can still save — the bill's printed totals will be kept as the official figures.</div></div>`
                : `<div class="recon ok">${icon('check')}<div>The items add up to the totals printed on the bill.</div></div>`;
        }
        renderNotices(T);
        $('pGstinHint').textContent = g.length === 0 ? '' : gstinOk(g) ? `Valid format · state code ${g.slice(0, 2)} · ${inter ? 'other state → IGST' : 'same state → CGST + SGST'}` : (g.length < 15 ? `${g.length}/15 characters` : 'This does not look like a valid GSTIN');
        $('pGstinHint').style.color = g && g.length >= 15 && !gstinOk(g) ? 'var(--danger)' : '';
    }

    function renderNotices(T) {
        T = T || currentTotals();
        const n = { part: 0, hsn: 0, fresh: 0, rec: 0 };
        D.rows.forEach(r => { if (r.action === 'rec') n.rec++; else if (r.action.startsWith('u:')) (r.match.status === 'part' ? n.part++ : n.hsn++); else n.fresh++; });
        const out = [];
        const dup = findDuplicate($('pGstin').value, $('pSupplier').value, $('pInvoiceNo').value, D.editingId);
        if (dup) out.push(`<div class="notice err">${icon('alert')}<div><b>This bill may already be recorded</b> as ${esc(dup.purchaseNo)} (${esc(formatDate(dup.date))}, ${inr(dup.grandTotal)}). Saving it again would add the stock twice.</div></div>`);
        if (n.part) out.push(`<div class="notice warn">${icon('alert')}<div><b>${n.part} item${n.part > 1 ? 's' : ''} already in your inventory</b> (same part number) — stock will be <b>increased</b>, not duplicated.</div></div>`);
        if (n.hsn) out.push(`<div class="notice warn">${icon('alert')}<div><b>${n.hsn} item${n.hsn > 1 ? 's' : ''} matched by HSN + name</b> — please check they are really the same product.</div></div>`);
        if (n.fresh) out.push(`<div class="notice info">${icon('box')}<div><b>${n.fresh} new item${n.fresh > 1 ? 's' : ''}</b> will be added to inventory with the quantity as opening stock.</div></div>`);
        D.warnings.forEach(w => out.push(`<div class="notice err">${icon('alert')}<div>${esc(w)}</div></div>`));
        if (D.source === 'scan' && !D.rows.length) out.push(`<div class="notice err">${icon('alert')}<div>No items were detected. Add them manually below, or go back and try a clearer photo.</div></div>`);
        $('pNotice').innerHTML = out.join('');
    }

    function renderReview() {
        $('pRows').innerHTML = D.rows.map(rowHtml).join('');
        $('pRaw').textContent = D.raw || '';
        renderCharges(); renderTotals();
    }
    function uniqueSuppliers() {
        const m = new Map();
        purchases.forEach(p => {
            const s = p.supplier; if (!s || !(s.name || s.gstin)) return;
            const k = (s.gstin || s.name).toLowerCase();
            const e = m.get(k) || { name: s.name || '', gstin: s.gstin || '', count: 0, last: '' };
            e.count++;
            if ((p.date || '') >= e.last) { e.last = p.date || ''; e.name = s.name || e.name; e.gstin = s.gstin || e.gstin; }
            m.set(k, e);
        });
        return [...m.values()].sort((a, b) => (b.last || '').localeCompare(a.last || '') || a.name.localeCompare(b.name));
    }

    // Suggestions for the seller name / GSTIN boxes, built from sellers already used in earlier purchases
    function attachSuggest(input) {
        const box = document.createElement('div');
        box.className = 'suggest'; box.hidden = true; box.setAttribute('role', 'listbox');
        input.closest('.form-group').classList.add('has-suggest');
        input.closest('.form-group').appendChild(box);
        let items = [], sel = -1;
        const close = () => { box.hidden = true; sel = -1; };
        const render = () => {
            const toks = tokens(input.value);
            items = uniqueSuppliers().filter(s => !toks.length || matchAll(s.name + ' ' + s.gstin, toks)).slice(0, 8);
            // nothing to suggest, or the box already holds exactly one complete match
            if (!items.length || (items.length === 1 && toks.length && (input.value.trim().toUpperCase() === items[0].gstin || input.value.trim().toLowerCase() === items[0].name.toLowerCase()))) { close(); return; }
            box.innerHTML = items.map((s, i) => `<div class="sg-item${i === sel ? ' sel' : ''}" role="option" data-i="${i}">
                <strong>${hl(s.name || '—', toks)}</strong><small class="mono">${hl(s.gstin || 'no GSTIN', toks)}</small>
                <em>${s.count} bill${s.count > 1 ? 's' : ''}${s.last ? ' · last ' + esc(formatDate(s.last)) : ''}</em></div>`).join('');
            box.style.top = (input.offsetTop + input.offsetHeight + 4) + 'px';
            box.hidden = false;
        };
        const pick = (i) => {
            const s = items[i]; if (!s) return;
            $('pSupplier').value = s.name; $('pGstin').value = s.gstin;
            close(); renderTotals();
            const next = $('pInvoiceNo'); next && next.focus();
        };
        input.addEventListener('click', render);   // opens on click or typing — not merely because the form focused the box
        input.addEventListener('input', () => { sel = -1; render(); });
        input.addEventListener('blur', () => setTimeout(close, 150));
        input.addEventListener('keydown', e => {
            if (box.hidden) { if (e.key === 'ArrowDown') render(); return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % items.length; render(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; render(); }
            else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); pick(sel); }
            else if (e.key === 'Escape') { e.stopPropagation(); close(); }
        });
        box.addEventListener('mousedown', e => { const it = e.target.closest('.sg-item'); if (it) { e.preventDefault(); pick(+it.dataset.i); } });
    }


    // Suggestions for the item boxes (name / part number / HSN): inventory items first, then lines from earlier purchases
    function itemCatalog() {
        const recent = [...purchases].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
        const lastFor = (pred) => { for (const p of recent) { const l = (p.lines || []).find(pred); if (l) return { rate: l.rate, disc: l.discPct, unit: l.unit, date: p.date }; } return null; };
        const out = [], seen = new Set();
        inventory.forEach(i => {
            const last = lastFor(l => l.itemId === i.id);
            out.push({ kind: 'inv', id: i.id, name: i.name, part: i.partNumber || '', hsn: i.hsn || '', gst: i.gstRate, code: i.code, stock: i.stock || 0, last });
            seen.add(normInv(i.partNumber) || normInv(i.name));
        });
        recent.forEach(p => (p.lines || []).forEach(l => {
            const key = normInv(l.part) || normInv(l.name);
            if (!key || seen.has(key) || (l.itemId && inventory.some(i => i.id === l.itemId))) return;
            seen.add(key);
            out.push({ kind: 'past', name: l.name, part: l.part || '', hsn: l.hsn || '', gst: l.gstRate, code: '', stock: null, last: { rate: l.rate, disc: l.discPct, unit: l.unit, date: p.date } });
        }));
        return out;
    }

    function attachItemSuggest() {
        const box = document.createElement('div');
        box.className = 'suggest suggest-fixed'; box.hidden = true; box.setAttribute('role', 'listbox');
        document.body.appendChild(box);
        let items = [], sel = -1, cur = null;   // cur = { input, row }
        const close = () => { box.hidden = true; sel = -1; };
        const render = () => {
            if (!cur) return close();
            const row = D.rows.find(r => r.id === +cur.input.dataset.id); if (!row) return close();
            const toks = tokens(cur.input.value);
            const usedIds = new Set(D.rows.filter(r => r !== row && r.action.startsWith('u:')).map(r => r.action.slice(2)));
            let list = itemCatalog().filter(c => !(c.id && usedIds.has(c.id)));
            if (toks.length) list = list.filter(c => matchAll([c.name, c.part, c.code, c.hsn].join(' '), toks));
            else list = list.filter(c => c.last).slice(0, 6);   // empty box: items bought before
            items = list.slice(0, 8);
            if (!items.length) return close();
            box.innerHTML = items.map((c, i) => `<div class="sg-item${i === sel ? ' sel' : ''}" role="option" data-i="${i}">
                <strong>${hl(c.name, toks)}</strong>
                <small>${c.kind === 'inv' ? `<span class="badge badge-${c.stock > 0 ? 'success' : 'danger'}">stock ${c.stock}</span>` : '<span class="badge badge-muted">earlier purchase</span>'}</small>
                <em class="mono">${[c.part && hl(c.part, toks), c.code && esc(c.code), c.hsn && 'HSN ' + hl(c.hsn, toks), c.gst != null ? c.gst + '% GST' : ''].filter(Boolean).join(' · ')}${c.last && c.last.rate ? ` · last rate ${inr(c.last.rate)}${c.last.disc ? ' −' + c.last.disc + '%' : ''}` : ''}</em></div>`).join('');
            const r = cur.input.getBoundingClientRect();
            const width = Math.max(r.width, 360);
            box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) + 'px';
            box.style.width = width + 'px';
            const below = window.innerHeight - r.bottom;
            if (below < 220 && r.top > below) { box.style.top = 'auto'; box.style.bottom = (window.innerHeight - r.top + 4) + 'px'; }
            else { box.style.bottom = 'auto'; box.style.top = (r.bottom + 4) + 'px'; }
            box.hidden = false;
        };
        const pick = (i) => {
            const c = items[i]; if (!c || !cur) return;
            const row = D.rows.find(r => r.id === +cur.input.dataset.id); if (!row) return;
            row.name = c.name; row.part = c.part; row.hsn = c.hsn; if (c.gst != null) row.gst = c.gst;
            if (c.last) { if (c.last.unit && !row.unit) row.unit = c.last.unit; if (c.last.rate) { row.rate = c.last.rate; row.disc = c.last.disc || 0; row.discSource = 'pct'; } }
            ['name', 'part', 'hsn', 'rate', 'disc', 'discAmt', 'gst'].forEach(k => { row.flags[k] = false; });
            row.netManual = false; row.gstAmtScanned = null; recalcNet(row);
            if (c.kind === 'inv') {
                const it = inventory.find(x => x.id === c.id);
                row.match = { status: c.part ? 'part' : 'hsn', item: it, candidates: [it] };
                row.action = 'u:' + c.id;
            } else rematch(row);
            close(); reflow(row);
            const q = $('pRows').querySelector(`.sc-row[data-id="${row.id}"] [data-k="qty"]`); q && q.focus();
        };
        const rows = $('pRows');
        rows.addEventListener('focusin', e => { const k = e.target.dataset && e.target.dataset.k; if (['name', 'part', 'hsn'].includes(k)) { cur = { input: e.target }; sel = -1; render(); } else { cur = null; close(); } });
        rows.addEventListener('input', e => { const k = e.target.dataset && e.target.dataset.k; if (['name', 'part', 'hsn'].includes(k)) { cur = { input: e.target }; sel = -1; render(); } });
        rows.addEventListener('focusout', () => setTimeout(() => { if (!cur || document.activeElement !== cur.input) close(); }, 150));
        rows.addEventListener('keydown', e => {
            if (box.hidden || !cur || e.target !== cur.input) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % items.length; render(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; render(); }
            else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); pick(sel); }
            else if (e.key === 'Escape') { e.stopPropagation(); close(); }
        });
        box.addEventListener('mousedown', e => { const it = e.target.closest('.sg-item'); if (it) { e.preventDefault(); pick(+it.dataset.i); } });
        $('purchase-drawer').querySelector('.drawer-body').addEventListener('scroll', () => { if (!box.hidden) render(); });
        window.addEventListener('resize', close);
    }

    function reflow(row) {
        const old = $('pRows').querySelector(`.sc-row[data-id="${row.id}"]`);
        if (old) { const t = document.createElement('div'); t.innerHTML = rowHtml(row); old.replaceWith(t.firstElementChild); }
        renderTotals();
    }
    // update only the match badge / action list / note of a row so that inputs keep focus and text while the user is typing
    function refreshRowMatch(row) {
        const el = $('pRows').querySelector(`.sc-row[data-id="${row.id}"]`); if (!el) return;
        const existing = row.action.startsWith('u:') ? inventory.find(i => i.id === row.action.slice(2)) : null;
        el.classList.toggle('exists', !!existing);
        const badge = el.querySelector('.sc-top .badge'); if (badge) badge.outerHTML = statusBadge(row);
        const sel = el.querySelector('.sc-action'); if (sel) sel.innerHTML = actionOptions(row);
        el.querySelector('.sc-note').innerHTML = rowNote(row, existing);
        renderNotices();
    }
    function refreshRowNums(row) {
        const el = $('pRows').querySelector(`.sc-row[data-id="${row.id}"]`); if (!el) return;
        const set = (k, v) => { const i = el.querySelector(`[data-k="${k}"]`); if (i && document.activeElement !== i) i.value = v; };
        set('net', row.net); set('disc', row.disc); set('discAmt', row.discAmt);
        const existing = row.action.startsWith('u:') ? inventory.find(i => i.id === row.action.slice(2)) : null;
        el.querySelector('.sc-note').innerHTML = rowNote(row, existing);
    }

    function onRowInput(e) {
        const el = e.target, id = +el.dataset.id; if (!id) return;
        const row = D.rows.find(r => r.id === id); if (!row) return;
        if (el.classList.contains('sc-action')) { row.action = el.value; refreshRowMatch(row); return; }
        const k = el.dataset.k; if (!k) return;
        row[k] = el.value;
        if (row.flags[k]) { row.flags[k] = false; const f = el.closest('.sc-f'); f && f.classList.remove('chk'); }
        if (k === 'disc') row.discSource = 'pct';
        if (k === 'discAmt') row.discSource = 'amt';
        if (['qty', 'rate', 'disc', 'discAmt'].includes(k)) { row.netManual = false; row.gstAmtScanned = null; recalcNet(row); refreshRowNums(row); renderTotals(); }
        else if (k === 'net') {
            row.netManual = true; row.gstAmtScanned = null;
            const gross = num(row.qty) * num(row.rate);
            if (gross > 0 && has(row.net)) { row.discAmt = Math.max(0, r2(gross - num(row.net))); row.disc = r2(row.discAmt / gross * 100); }
            refreshRowNums(row); renderTotals();
        } else if (k === 'gst') { row.gstAmtScanned = null; refreshRowNums(row); renderTotals(); }
        else if (e.type === 'change' && ['part', 'hsn', 'name'].includes(k)) { rematch(row); refreshRowMatch(row); }
    }

    // ======================================================================
    // Saving a purchase
    // ======================================================================
    function nextPurchaseNo() {
        let max = 0;
        purchases.forEach(p => { const m = String(p.purchaseNo || '').match(/(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); });
        return 'PUR-' + String(max + 1).padStart(4, '0');
    }

    async function save() {
        const supplierName = $('pSupplier').value.trim(), gstin = $('pGstin').value.toUpperCase().replace(/\s/g, ''), invoiceNo = $('pInvoiceNo').value.trim(), date = $('pDate').value;
        const bad = (id, msg) => { const el = $(id); el.focus(); el.scrollIntoView({ block: 'center' }); toast(msg, 'error'); };
        if (!supplierName && !gstin) return bad('pSupplier', 'Please enter the seller name');
        if (!invoiceNo) return bad('pInvoiceNo', "Please enter the seller's invoice number");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad('pDate', 'Please enter the invoice date');
        if (!D.rows.length) { toast('Add at least one item', 'error'); return; }
        for (const r of D.rows) {
            const missing = !String(r.name).trim() && !r.action.startsWith('u:') ? 'name' : (r.action !== 'rec' && !(num(r.qty) > 0)) ? 'qty' : (!has(r.net) ? 'net' : null);
            if (missing) {
                const el = $('pRows').querySelector(`.sc-row[data-id="${r.id}"] [data-k="${missing}"]`);
                if (el) { el.closest('.sc-f').classList.add('chk'); el.scrollIntoView({ block: 'center' }); el.focus(); }
                toast({ name: 'Please enter an item name', qty: 'Please enter a quantity greater than 0', net: 'Please enter the net value (or quantity and rate)' }[missing], 'error'); return;
            }
        }
        const dup = findDuplicate(gstin, supplierName, invoiceNo, D.editingId);
        if (dup && !(await uiConfirm('This bill looks already recorded', `${dup.purchaseNo} has the same seller and invoice number (${dup.invoiceNo}). Saving again will add the stock a second time.`, 'Save anyway'))) return;

        const T = currentTotals();
        const pno = nextPurchaseNo();
        const reason = `Purchase ${pno} · invoice ${invoiceNo}`;
        const effects = { updated: [], created: [], recorded: 0 };
        const lines = D.rows.map(r => {
            const qty = num(r.qty), net = r2(num(r.net)), gstRate = num(r.gst);
            const gstAmt = r.gstAmtScanned != null ? r2(r.gstAmtScanned) : r2(net * gstRate / 100);
            const unitCost = qty > 0 ? r2(net / qty) : null;
            const line = { itemId: null, name: String(r.name).trim(), part: String(r.part || '').trim(), hsn: String(r.hsn || '').trim(), qty, unit: r.unit || '', rate: num(r.rate), discPct: num(r.disc), discAmt: r2(num(r.discAmt)), net, gstRate, gstAmt, stock: false, newItem: false };
            if (r.action === 'rec') { effects.recorded++; return line; }
            let target = r.action.startsWith('u:') ? inventory.find(i => i.id === r.action.slice(2)) : null;
            if (!target) { const m = BillScanParser.matchInventory(r, inventory); if (m.status === 'part') target = m.item; }   // created by an earlier row of this bill
            if (target) {
                const before = target.stock || 0;
                target.stock = before + qty;
                if (!target.partNumber && line.part) target.partNumber = line.part;
                if (!target.hsn && line.hsn) target.hsn = line.hsn;
                if (unitCost != null) target.costPrice = unitCost;
                stockHistory.unshift({ id: uid('history'), timestamp: new Date().toISOString(), itemId: target.id, itemName: target.name, action: 'add', quantity: qty, stockAfter: target.stock, reason, purchaseId: pno });
                effects.updated.push({ code: target.code, name: target.name, qty, before, after: target.stock });
                line.itemId = target.id; line.stock = true;
            } else {
                const ex = has(r.rate) ? r2(num(r.rate)) : (unitCost || 0);
                const item = { id: uid('item'), code: generateNextItemCode(), name: line.name, partNumber: line.part, hsn: line.hsn, gstRate, priceExGst: ex, priceInclGst: r2(ex * (1 + gstRate / 100)), rate: ex, costPrice: unitCost, stock: qty, description: '' };
                inventory.push(item);
                stockHistory.unshift({ id: uid('history'), timestamp: new Date().toISOString(), itemId: item.id, itemName: item.name, action: 'add', quantity: qty, stockAfter: qty, reason: reason + ' (new item)', purchaseId: pno });
                effects.created.push({ code: item.code, name: item.name, qty, gst: gstRate, cost: unitCost });
                line.itemId = item.id; line.stock = true; line.newItem = true;
            }
            return line;
        });

        const d = readDeclared();
        const p = {
            id: uid('purchase'), purchaseNo: pno, supplier: { name: supplierName, gstin }, invoiceNo, date, notes: $('pNotes').value.trim(),
            lines, charges: D.charges.filter(c => has(c.amount)).map(c => ({ label: c.label || 'Charge', amount: r2(num(c.amount)), gstRate: num(c.gstRate) })),
            roundOff: T.calc.roundOff,
            taxable: T.final.taxable, totalTax: T.final.totalTax, grandTotal: T.final.grandTotal,
            gstByRate: Object.fromEntries(T.calc.slabs.map(s => [String(s.rate), s.tax])),
            taxableByRate: Object.fromEntries(T.calc.slabs.map(s => [String(s.rate), s.taxable])),
            otherCharges: r2(T.final.grandTotal - T.final.taxable - T.final.totalTax),
            computed: { taxable: T.calc.taxable, totalTax: T.calc.totalTax, grandTotal: T.calc.grand },
            declared: (has(d.taxable) || has(d.tax) || has(d.grand)) ? { taxable: has(d.taxable) ? r2(d.taxable) : null, tax: has(d.tax) ? r2(d.tax) : null, grand: has(d.grand) ? r2(d.grand) : null } : null,
            reconciled: T.checks.length ? T.reconciled : null,
            source: D.source, createdAt: new Date().toISOString()
        };
        purchases.unshift(p);
        saveState(); loadInventory(); updateStockItemSelect(); loadStockHistory(); loadPurchases();
        renderDone(p, effects); show('done');
        toast(`${pno} saved`, 'success');
    }

    function renderDone(p, fx) {
        const li = (t) => `<li>${t}</li>`;
        $('pDoneBody').innerHTML = `
            <div class="done-head">${icon('check')}<div><h4>${esc(p.purchaseNo)} saved</h4><p class="muted">${esc(p.supplier.name || p.supplier.gstin)} · invoice ${esc(p.invoiceNo)} · ${inr(p.grandTotal)}</p></div></div>
            <div class="summary-chips" style="border:0;background:none;padding:0 0 10px">
                <span class="chip">Net value <b>${inr(p.taxable)}</b></span>
                ${Object.keys(p.gstByRate).map(r => `<span class="chip">GST ${r}% <b>${inr(p.gstByRate[r])}</b></span>`).join('')}
                <span class="chip">Total <b>${inr(p.grandTotal)}</b></span></div>
            ${fx.updated.length ? `<h5>Stock increased (${fx.updated.length})</h5><ul class="done-list">${fx.updated.map(u => li(`<span class="mono">${esc(u.code)}</span> ${esc(u.name)} <b class="qty-up">+${u.qty}</b> <span class="muted">${u.before} → ${u.after}</span>`)).join('')}</ul>` : ''}
            ${fx.created.length ? `<h5>New items added (${fx.created.length})</h5><ul class="done-list">${fx.created.map(u => li(`<span class="mono">${esc(u.code)}</span> ${esc(u.name)} <span class="muted">· stock ${u.qty} · ${u.gst}% GST${u.cost != null ? ' · cost ' + inr(u.cost) : ''}</span>`)).join('')}</ul>` : ''}
            ${fx.recorded ? `<p class="muted" style="margin-top:12px">${fx.recorded} line${fx.recorded > 1 ? 's' : ''} recorded in the purchase only.</p>` : ''}`;
    }

    // ======================================================================
    // Purchases table
    // ======================================================================
    function fyRange(offset) {
        const now = new Date(), y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1, s = y + offset;
        return [`${s}-04-01`, `${s + 1}-03-31`];
    }
    function periodRange(key, from, to) {
        const now = new Date(), t = K.todayStr(), ym = t.slice(0, 7);
        switch (key) {
            case 'month': return [ym + '-01', K.iso(new Date(now.getFullYear(), now.getMonth() + 1, 0))];
            case 'lastmonth': return [K.iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), K.iso(new Date(now.getFullYear(), now.getMonth(), 0))];
            case 'fy': return fyRange(0);
            case 'lastfy': return fyRange(-1);
            case 'custom': return [from || '', to || ''];
            default: return ['', ''];
        }
    }
    const supKey = (p) => ((p.supplier && (p.supplier.gstin || p.supplier.name)) || '').toLowerCase();
    const gstText = (p) => Object.keys(p.gstByRate || {}).sort((a, b) => a - b).filter(r => p.gstByRate[r]).map(r => `${r}%: ${inr(p.gstByRate[r])}`).join(' · ');

    K.tables.purchases = K.makeTable({
        name: 'purchases', container: 'purchasesTableContainer', tbody: 'purchasesTableBody', info: 'purPaginationInfo', pager: 'purPager',
        perPage: 'purPerPage', searchInput: 'purSearch', clear: 'purClear', cols: 9, per: 25,
        sortKey: 'date', sortDir: 'desc', defaultDesc: ['date', 'taxable', 'totalTax', 'grandTotal', 'lines'],
        source: () => purchases,
        emptyTitle: 'No purchases yet', emptyText: "Record a supplier bill — by photo or manually — to track GST paid and update stock.",
        emptyAction: '<button class="btn btn-primary" onclick="openPurchase(\'scan\')">Scan a purchase bill</button>',
        filterEls: [['purRange', 'range'], ['purFrom', 'from'], ['purTo', 'to'], ['purSupplier', 'supplier']],
        onFilter: (k, v) => { if (k === 'range') $('purCustomRange').hidden = v !== 'custom'; },
        resetUI: () => { ['purSearch', 'purRange', 'purFrom', 'purTo', 'purSupplier'].forEach(id => { const e = $(id); if (e) e.value = ''; }); $('purCustomRange').hidden = true; },
        sortValue: (p, k) => k === 'lines' ? (p.lines || []).length : k === 'supplier.name' ? (p.supplier.name || '').toLowerCase() : k === 'date' ? (p.date || '') + '|' + (p.createdAt || '') : getValueByPath(p, k),
        filter: (p, f, toks) => {
            const [from, to] = periodRange(f.range, f.from, f.to);
            if (from && (p.date || '') < from) return false;
            if (to && (p.date || '') > to) return false;
            if (f.supplier && supKey(p) !== f.supplier) return false;
            if (!toks.length) return true;
            return matchAll([p.purchaseNo, p.invoiceNo, p.date, p.supplier.name, p.supplier.gstin, p.grandTotal, p.notes].concat((p.lines || []).map(l => `${l.name} ${l.part} ${l.hsn}`)).join(' '), toks);
        },
        row: (p, toks) => {
            const n = (p.lines || []).length, first = n ? p.lines[0].name : '';
            return `<tr class="clickable" onclick="viewPurchase('${p.id}')">
                <td><span class="mono cell-main">${esc(p.purchaseNo)}</span></td>
                <td>${esc(formatDate(p.date))}</td>
                <td><span class="cell-main">${hl(p.invoiceNo, toks)}</span></td>
                <td><span class="cell-main">${hl(p.supplier.name || '—', toks)}</span>${p.supplier.gstin ? `<span class="cell-sub mono">${hl(p.supplier.gstin, toks)}</span>` : ''}</td>
                <td class="num">${n}<span class="cell-sub">${esc(first)}${n > 1 ? ` +${n - 1}` : ''}</span></td>
                <td class="num">${inr(p.taxable)}</td>
                <td class="num">${inr(p.totalTax)}<span class="cell-sub">${esc(gstText(p))}</span></td>
                <td class="num"><strong>${inr(p.grandTotal)}</strong>${p.reconciled === false ? `<span class="cell-sub" style="color:var(--warning)" title="The item lines do not add up to the totals printed on the bill">⚠ check totals</span>` : ''}</td>
                <td class="actions-col" onclick="event.stopPropagation()"><div class="table-actions">
                    <button class="icon-btn" title="View" aria-label="View" onclick="viewPurchase('${p.id}')">${icon('eye')}</button>
                    <button class="icon-btn danger" title="Delete" aria-label="Delete" onclick="deletePurchase('${p.id}')">${icon('trash')}</button></div></td></tr>`;
        },
        summary: (rows) => {
            const el = $('purSummary');
            if (!purchases.length) { el.innerHTML = ''; return; }
            const sum = (f) => r2(rows.reduce((a, p) => a + num(f(p)), 0));
            const rates = [...new Set(rows.flatMap(p => Object.keys(p.gstByRate || {})))].sort((a, b) => a - b);
            el.innerHTML = `<span class="chip">Purchases <b>${rows.length}</b></span><span class="chip">Net value <b>${inr(sum(p => p.taxable))}</b></span>
                ${rates.map(r => `<span class="chip">GST ${r}% <b>${inr(sum(p => (p.gstByRate || {})[r]))}</b></span>`).join('')}
                <span class="chip">Total GST <b>${inr(sum(p => p.totalTax))}</b></span><span style="flex:1"></span><span class="chip">Total <b>${inr(sum(p => p.grandTotal))}</b></span>`;
        },
        csv: [
            { label: 'Purchase ID', get: p => p.purchaseNo }, { label: 'Invoice date', get: p => p.date }, { label: 'Invoice No', get: p => p.invoiceNo },
            { label: 'Seller', get: p => p.supplier.name }, { label: 'Seller GSTIN', get: p => p.supplier.gstin }, { label: 'Net value', get: p => p.taxable },
            { label: 'GST 5%', get: p => (p.gstByRate || {})['5'] || 0 }, { label: 'GST 12%', get: p => (p.gstByRate || {})['12'] || 0 }, { label: 'GST 18%', get: p => (p.gstByRate || {})['18'] || 0 }, { label: 'GST 28%', get: p => (p.gstByRate || {})['28'] || 0 },
            { label: 'Total GST', get: p => p.totalTax }, { label: 'Total', get: p => p.grandTotal }
        ]
    });

    window.loadPurchases = function () {
        K.tables.purchases.render(); refreshPurchaseFilters(); K.refreshChrome();
    };
    window.refreshPurchaseFilters = function () {
        const sel = $('purSupplier'); if (!sel) return;
        const cur = sel.value;
        sel.innerHTML = '<option value="">All sellers</option>' + uniqueSuppliers().map(s => `<option value="${esc((s.gstin || s.name).toLowerCase())}">${esc(s.name)}</option>`).join('');
        sel.value = [...sel.options].some(o => o.value === cur) ? cur : '';
        if (sel.value !== cur) K.tables.purchases.st.filters.supplier = '';
    };

    // ======================================================================
    // View / edit / delete
    // ======================================================================
    let viewing = null;
    window.viewPurchase = function (id) {
        const p = purchases.find(x => x.id === id); if (!p) return;
        viewing = p; renderView(false);
        $('purchaseViewModal').classList.add('active'); document.body.classList.add('no-scroll');
    };
    window.closePurchaseView = function () { $('purchaseViewModal').classList.remove('active'); viewing = null; if (!document.querySelector('.drawer[style*="display: block"]')) document.body.classList.remove('no-scroll'); };

    function renderView(editing) {
        const p = viewing; if (!p) return;
        $('pvTitle').textContent = `${p.purchaseNo} · ${p.supplier.name || p.supplier.gstin}`;
        const inter = interState(p.supplier.gstin);
        const head = editing ? `<div class="form-row">
                <div class="form-group flex-2"><label>Seller name</label><input id="peName" value="${esc(p.supplier.name)}"></div>
                <div class="form-group"><label>Seller GSTIN</label><input id="peGstin" value="${esc(p.supplier.gstin)}" maxlength="15" style="text-transform:uppercase"></div></div>
            <div class="form-row">
                <div class="form-group"><label>Invoice number</label><input id="peInv" value="${esc(p.invoiceNo)}"></div>
                <div class="form-group"><label>Invoice date</label><input id="peDate" type="date" value="${esc(p.date)}"></div>
                <div class="form-group flex-2"><label>Notes</label><input id="peNotes" value="${esc(p.notes)}"></div></div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:14px"><button class="btn" id="peCancel">Cancel</button><button class="btn btn-primary" id="peSave">Save changes</button></div>`
            : `<div class="bill-info pv-head">
                <div class="info-group"><h4>Purchase ID</h4><p class="mono">${esc(p.purchaseNo)}</p></div>
                <div class="info-group"><h4>Invoice no.</h4><p>${esc(p.invoiceNo)}</p></div>
                <div class="info-group"><h4>Invoice date</h4><p>${esc(formatDate(p.date))}</p></div>
                <div class="info-group"><h4>Seller</h4><p>${esc(p.supplier.name || '—')}</p></div>
                <div class="info-group"><h4>Seller GSTIN</h4><p class="mono">${esc(p.supplier.gstin || '—')}</p></div>
                ${p.notes ? `<div class="info-group"><h4>Notes</h4><p>${esc(p.notes)}</p></div>` : ''}</div>`;
        const slabs = Object.keys(p.gstByRate || {}).map(Number).sort((a, b) => a - b);
        $('purchaseViewContent').innerHTML = `${head}
            <div class="bill-items"><table class="pv-table"><thead><tr><th>#</th><th>Item</th><th>Part no.</th><th>HSN</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Discount</th><th class="num">Net value</th>${inter ? '<th class="num">IGST</th>' : '<th class="num">CGST</th><th class="num">SGST</th>'}<th class="num">Line total</th></tr></thead><tbody>
            ${p.lines.map((l, i) => {
                const sp = splitTax(l.gstAmt, p.supplier.gstin), half = num(l.gstRate) / 2;
                const taxCells = inter
                    ? `<td class="num">${inr(sp.igst)}<span class="cell-sub">${l.gstRate}%</span></td>`
                    : `<td class="num">${inr(sp.cgst)}<span class="cell-sub">${half}%</span></td><td class="num">${inr(sp.sgst)}<span class="cell-sub">${half}%</span></td>`;
                return `<tr><td>${i + 1}</td><td>${esc(l.name)}${l.stock ? '' : ' <span class="muted">(not in inventory)</span>'}</td><td>${esc(l.part || '—')}</td><td>${esc(l.hsn || '—')}</td><td class="num">${l.qty}${l.unit ? ' ' + esc(l.unit) : ''}</td><td class="num">${inr(l.rate)}</td><td class="num">${l.discAmt || l.discPct ? `${inr(l.discAmt != null ? l.discAmt : r2(l.qty * l.rate * l.discPct / 100))}<span class="cell-sub">${l.discPct}%</span>` : '—'}</td><td class="num">${inr(l.net)}</td>${taxCells}<td class="num"><strong>${inr(num(l.net) + num(l.gstAmt))}</strong></td></tr>`;
            }).join('')}
            </tbody><tfoot><tr><td colspan="7">Total of items</td><td class="num">${inr(p.lines.reduce((a, l) => a + num(l.net), 0))}</td>${inter ? `<td class="num">${inr(p.lines.reduce((a, l) => a + splitTax(l.gstAmt, p.supplier.gstin).igst, 0))}</td>` : `<td class="num">${inr(p.lines.reduce((a, l) => a + splitTax(l.gstAmt, p.supplier.gstin).cgst, 0))}</td><td class="num">${inr(p.lines.reduce((a, l) => a + splitTax(l.gstAmt, p.supplier.gstin).sgst, 0))}</td>`}<td class="num">${inr(p.lines.reduce((a, l) => a + num(l.net) + num(l.gstAmt), 0))}</td></tr></tfoot></table></div>
            <div class="bill-summary">
                ${slabs.map(r => { const sp = splitTax(p.gstByRate[r], p.supplier.gstin); return `<div class="gst-line"><span>GST ${r}% on ${inr((p.taxableByRate || {})[r] || 0)}${inter ? '' : ` (CGST ${inr(sp.cgst)} + SGST ${inr(sp.sgst)})`}</span><span>${inr(p.gstByRate[r])}</span></div>`; }).join('')}
                ${(p.charges || []).map(c => `<div class="gst-line"><span>${esc(c.label)}${c.gstRate ? ` (GST ${c.gstRate}%)` : ''}</span><span>${inr(c.amount)}</span></div>`).join('')}
                ${p.roundOff ? `<div class="gst-line"><span>Round-off</span><span>${inr(p.roundOff)}</span></div>` : ''}
                <div class="gst-line"><span>Net value (before GST)</span><span>${inr(p.taxable)}</span></div>
                <div class="gst-line"><span>Total GST paid</span><span>${inr(p.totalTax)}</span></div></div>
            <div class="bill-total">Total: ${inr(p.grandTotal)}</div>
            ${p.reconciled === false ? `<p class="muted" style="margin-top:10px">⚠ The item lines add up to ${inr(p.computed.grandTotal)}, but the bill's printed total is ${inr(p.grandTotal)}. The printed figures are the official ones.</p>` : ''}`;
        if (editing) {
            $('peCancel').onclick = () => renderView(false);
            $('peSave').onclick = async () => {
                const name = $('peName').value.trim(), gstin = $('peGstin').value.toUpperCase().replace(/\s/g, ''), inv = $('peInv').value.trim(), date = $('peDate').value;
                if (!(name || gstin) || !inv || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('Seller, invoice number and date are required', 'error'); return; }
                const dup = findDuplicate(gstin, name, inv, p.id);
                if (dup && !(await uiConfirm('Same bill already recorded', `${dup.purchaseNo} has the same seller and invoice number.`, 'Save anyway'))) return;
                p.supplier = { name, gstin }; p.invoiceNo = inv; p.date = date; p.notes = $('peNotes').value.trim();
                saveState(); loadPurchases(); renderView(false); toast('Details updated', 'success');
            };
        }
    }
    $('pvEdit').addEventListener('click', () => renderView(true));
    $('pvPrint').addEventListener('click', () => {
        if (!viewing) return;
        const body = $('purchaseViewContent').cloneNode(true);
        body.querySelectorAll('button, .icon-btn').forEach(e => e.remove());
        printDocument('Purchase ' + viewing.purchaseNo, `<div class="pr-head"><h1>${esc(COMPANY_INFO.NAME)}</h1><p>Purchase record ${esc(viewing.purchaseNo)} · GSTIN ${esc(COMPANY_INFO.GSTIN)}</p></div>` + body.innerHTML, { landscape: true });
    });
    $('pvDelete').addEventListener('click', () => { if (viewing) deletePurchase(viewing.id); });

    window.deletePurchase = async function (id) {
        const p = purchases.find(x => x.id === id); if (!p) return;
        const units = p.lines.filter(l => l.stock && l.itemId).reduce((a, l) => a + l.qty, 0);
        const ok = await uiConfirm(`Delete ${p.purchaseNo}?`, units ? `The ${units} unit${units === 1 ? '' : 's'} this purchase added will be taken back out of stock. Items it created stay in inventory (with their stock reduced).` : 'This removes the purchase record.', 'Delete purchase');
        if (!ok) return;
        const short = [];
        p.lines.forEach(l => {
            if (!l.stock || !l.itemId) return;
            const it = inventory.find(i => i.id === l.itemId); if (!it) return;
            const before = it.stock || 0, after = Math.max(0, before - l.qty);
            if (before < l.qty) short.push(it.name);
            it.stock = after;
            stockHistory.unshift({ id: uid('history'), timestamp: new Date().toISOString(), itemId: it.id, itemName: it.name, action: 'remove', quantity: before - after, stockAfter: after, reason: `Purchase ${p.purchaseNo} deleted`, purchaseId: p.purchaseNo });
        });
        purchases.splice(purchases.indexOf(p), 1);
        saveState(); closePurchaseView(); loadInventory(); updateStockItemSelect(); loadStockHistory(); loadPurchases();
        toast(short.length ? `${p.purchaseNo} deleted (stock of ${short.length} item${short.length > 1 ? 's' : ''} was already lower — set to 0)` : `${p.purchaseNo} deleted`, short.length ? 'error' : 'success');
    };

    // ======================================================================
    // Purchase statement (month-end export)
    // ======================================================================
    function statementData() {
        const key = $('stPeriod').value;
        const [from, to] = key === 'all' ? ['', ''] : periodRange(key, $('stFrom').value, $('stTo').value);
        const list = purchases.filter(p => (!from || p.date >= from) && (!to || p.date <= to)).sort((a, b) => (a.date || '').localeCompare(b.date || '') || String(a.purchaseNo).localeCompare(String(b.purchaseNo)));
        const rates = [...new Set([5, 18].concat(list.flatMap(p => Object.keys(p.gstByRate || {}).map(Number).filter(r => (p.gstByRate[r] || 0) !== 0))))].sort((a, b) => a - b);
        const head = ['S.No', 'Date', 'Invoice No.', 'Seller Name', 'Seller GSTIN', 'Net Value (before tax)'].concat(rates.map(r => `GST ${r}%`), ['Other charges / round-off', 'Total (after tax)']);
        const rows = list.map((p, i) => {
            const gst = rates.map(r => r2((p.gstByRate || {})[r] || 0));
            return [i + 1, ddmmyyyy(p.date), p.invoiceNo, p.supplier.name, p.supplier.gstin, r2(p.taxable)].concat(gst, [r2(p.grandTotal - p.taxable - gst.reduce((a, b) => a + b, 0)), r2(p.grandTotal)]);
        });
        const totals = ['', '', '', 'TOTAL', '', ''];
        for (let c = 5; c < head.length; c++) totals[c] = r2(rows.reduce((a, r) => a + num(r[c]), 0));
        totals[5] = r2(rows.reduce((a, r) => a + num(r[5]), 0));
        const label = key === 'all' ? 'All purchases' : (from && to ? `${ddmmyyyy(from)} to ${ddmmyyyy(to)}` : 'All dates');
        return { head, rows, totals, label, from, to, count: list.length, key };
    }
    function renderStatementPreview() {
        const d = statementData();
        $('stCustom').hidden = $('stPeriod').value !== 'custom';
        const last = d.totals.length - 1;
        $('stPreview').innerHTML = d.count
            ? `<div class="summary-chips" style="border:0;padding:0;background:none"><span class="chip">Bills <b>${d.count}</b></span><span class="chip">Net <b>${inr(d.totals[5])}</b></span><span class="chip">GST <b>${inr(d.totals.slice(6, last - 1).reduce((a, b) => a + num(b), 0))}</b></span><span class="chip">Total <b>${inr(d.totals[last])}</b></span></div><p class="muted" style="margin-top:6px">${esc(d.label)}</p>`
            : '<p class="muted">No purchases in this period.</p>';
        $('stDownload').disabled = !d.count;
    }
    window.openStatement = function () {
        const f = K.tables.purchases.st.filters;
        $('stPeriod').value = ['month', 'lastmonth', 'fy', 'lastfy', 'custom'].includes(f.range) ? f.range : 'month';
        $('stFrom').value = f.from || ''; $('stTo').value = f.to || '';
        renderStatementPreview();
        $('statementModal').classList.add('active'); document.body.classList.add('no-scroll');
    };
    window.closeStatement = function () { $('statementModal').classList.remove('active'); if (!document.querySelector('.drawer[style*="display: block"]')) document.body.classList.remove('no-scroll'); };

    function downloadStatement() {
        const d = statementData(); if (!d.count) return;
        const fmt = $('stFormat').value, company = (typeof COMPANY_INFO !== 'undefined' && COMPANY_INFO.NAME) || '';
        const stamp = d.key === 'month' || d.key === 'lastmonth' ? d.from.slice(0, 7) : (d.from && d.to ? `${d.from}_to_${d.to}` : 'all');
        const base = `Purchase_Statement_${stamp}`;
        if (fmt === 'csv') {
            const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
            const csv = [d.head.map(q).join(',')].concat(d.rows.concat([d.totals]).map(r => r.map(q).join(','))).join('\r\n');
            downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), base + '.csv');
        } else if (fmt === 'xlsx') {
            if (!window.XLSX) { toast('Excel library could not be loaded — use CSV instead', 'error'); return; }
            const aoa = [['PURCHASE STATEMENT'], [company], [`Period: ${d.label}   ·   Generated ${ddmmyyyy(K.todayStr())}`], [], d.head].concat(d.rows, [d.totals]);
            const ws = XLSX.utils.aoa_to_sheet(aoa);
            const firstData = 5, lastRow = aoa.length - 1;
            for (let r = firstData; r <= lastRow; r++) for (let c = 5; c < d.head.length; c++) { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell && typeof cell.v === 'number') cell.z = '#,##0.00'; }
            ws['!cols'] = d.head.map((h, i) => ({ wch: i === 3 ? 30 : i === 4 ? 18 : i === 2 ? 18 : i === 0 ? 6 : i === 1 ? 12 : 16 }));
            const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Purchases');
            XLSX.writeFile(wb, base + '.xlsx');
        } else {
            if (!(window.jspdf && window.jspdf.jsPDF)) { toast('PDF library could not be loaded — use Excel or CSV', 'error'); return; }
            const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
            doc.setFontSize(14); doc.setFont(undefined, 'bold'); doc.text('PURCHASE STATEMENT', 40, 40);
            doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.text(`${company}   ·   Period: ${d.label}`, 40, 56);
            const money = (v) => typeof v === 'number' ? v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v;
            doc.autoTable({
                startY: 70, head: [d.head], body: d.rows.map(r => r.map(money)), foot: [d.totals.map(money)],
                styles: { fontSize: 8, cellPadding: 3 }, headStyles: { fillColor: [30, 58, 138] }, footStyles: { fillColor: [238, 242, 255], textColor: [17, 24, 39], fontStyle: 'bold' },
                columnStyles: Object.fromEntries(d.head.map((_, i) => [i, { halign: i >= 5 ? 'right' : 'left' }]))
            });
            doc.save(base + '.pdf');
        }
        toast(`Statement downloaded (${d.count} bill${d.count > 1 ? 's' : ''})`, 'success');
    }

    // ======================================================================
    // Wiring
    // ======================================================================
    function init() {
        $('pCamera').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
        $('pUpload').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
        const dz = $('pDrop');
        ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
        ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
        dz.addEventListener('drop', e => addFiles(e.dataTransfer.files));
        document.addEventListener('paste', e => { if ($('purchase-drawer').style.display === 'block' && !$('p-pick').hidden && e.clipboardData.files.length) addFiles(e.clipboardData.files); });
        $('pReadBtn').addEventListener('click', readBill);
        $('pManual').addEventListener('click', startManual);
        $('pBack').addEventListener('click', () => show('pick'));
        $('pSaveBtn').addEventListener('click', save);
        $('pAgain').addEventListener('click', () => { resetDraft(); show('pick'); });
        $('pAddRow').addEventListener('click', () => { const r = makeRow({ name: '', part: '', hsn: '', qty: '', unit: '', rate: '', gst: 18, discPct: 0, net: '', flags: {} }, true); D.rows.push(r); renderReview(); const el = $('pRows').querySelector(`.sc-row[data-id="${r.id}"] input`); el && el.focus(); });
        $('pAddCharge').addEventListener('click', () => { D.charges.push({ label: '', amount: '', gstRate: 0 }); renderCharges(); const l = $('pCharges').querySelectorAll('.charge-row'); const last = l[l.length - 1]; last && last.querySelector('input').focus(); });

        const rows = $('pRows');
        rows.addEventListener('input', onRowInput); rows.addEventListener('change', onRowInput);
        rows.addEventListener('click', e => {
            const d = e.target.closest('[data-del]'); if (d) { D.rows = D.rows.filter(r => r.id !== +d.dataset.del); renderReview(); return; }
            const z = e.target.closest('[data-doz]');
            if (z) { const r = D.rows.find(x => x.id === +z.dataset.doz); if (r) { r.qty = num(r.qty) * 12; if (has(r.rate)) r.rate = r2(num(r.rate) / 12); r.unit = 'Nos'; reflow(r); } }
        });
        const ch = $('pCharges');
        ch.addEventListener('input', e => { const row = e.target.closest('.charge-row'); if (!row) return; const c = D.charges[+row.dataset.i]; c[e.target.dataset.c] = e.target.value; renderTotals(); });
        ch.addEventListener('click', e => { const b = e.target.closest('[data-delc]'); if (b) { D.charges.splice(+b.dataset.delc, 1); renderCharges(); renderTotals(); } });
        ['pRound', 'pDecTaxable', 'pDecTax', 'pDecGrand', 'pGstin', 'pInvoiceNo', 'pSupplier'].forEach(id => $(id).addEventListener('input', () => renderTotals()));
        $('pSupplier').addEventListener('change', () => { const s = findSupplier($('pSupplier').value, ''); if (s && !$('pGstin').value) { $('pGstin').value = s.gstin || ''; renderTotals(); } });
        $('pGstin').addEventListener('change', () => { $('pGstin').value = $('pGstin').value.toUpperCase().replace(/\s/g, ''); const s = findSupplier('', $('pGstin').value); if (s && !$('pSupplier').value) { $('pSupplier').value = s.name; } renderTotals(); });

        attachSuggest($('pSupplier')); attachSuggest($('pGstin')); attachItemSuggest();

        const d = $('purchase-drawer');
        d.addEventListener('mousedown', e => { d._bd = e.target === d; });
        d.addEventListener('click', e => { if (e.target === d && d._bd && !D.busy) closePurchase(); });
        $('purchaseViewModal').addEventListener('click', e => { if (e.target === $('purchaseViewModal')) closePurchaseView(); });
        $('statementModal').addEventListener('click', e => { if (e.target === $('statementModal')) closeStatement(); });

        $('purStatementBtn').addEventListener('click', openStatement);
        ['stPeriod', 'stFrom', 'stTo'].forEach(id => $(id).addEventListener('change', renderStatementPreview));
        $('stDownload').addEventListener('click', downloadStatement);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
