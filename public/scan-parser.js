// Purchase-bill parser: turns OCR words (with bounding boxes) into line items.
// Pure functions, no DOM — usable in the browser (window.BillScanParser) and in Node for tests.
(function (root) {
    'use strict';

    const GST_SLABS = [0, 0.25, 3, 5, 12, 18, 28];
    const KW = /^(desc|description|product|item|particulars|goods|name|part|hsn|sac|qty|quantity|unit|uom|rate|price|mrp|amount|amt|gst|cgst|sgst|igst|taxable|disc|total|value|no|sn|s\.n|sl)\.?%?$/i;

    // ---------- token helpers ----------
    const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    // Strip table-border artefacts (|, [, ], {, }, !, _) that OCR reads from ruled lines
    const tidy = (t) => String(t).replace(/^[|\[\]{}!_~—–=]+|[|\[\]{}!_~—–=]+$/g, '').trim();
    const isJunk = (t) => !/[A-Za-z0-9]/.test(t);
    // Numeric-looking token: digits with , . and optional %.  Fix common OCR mix-ups first.
    function numFix(t) {
        let s = tidy(t).replace(/[)(]/g, '');
        if (/^[\dOolI,.\-%]+$/.test(s) && /\d/.test(s)) s = s.replace(/[Oo]/g, '0').replace(/[lI]/g, '1');
        if (/^\d{1,6},\d{2}$/.test(s)) s = s.replace(',', '.');
        return s;
    }
    const isNum = (t) => /^-?\d[\d,]*(\.\d+)?%?$/.test(numFix(t));
    const toNum = (t) => { const s = numFix(t).replace(/[,%]/g, ''); const n = parseFloat(s); return isNaN(n) ? null : n; };
    const isPct = (t) => /^\d+(\.\d+)?\s*%$/.test(numFix(t));
    const isInt = (t) => /^\d[\d,]*(\.0+)?$/.test(numFix(t));
    // identifier-like: part number / HSN  (letters+digits, at least 3 digits, no decimal point)
    const isId = (t) => { const s = tidy(t).replace(/[()]/g, ''); return /^[A-Za-z0-9][A-Za-z0-9\-\/]{3,}$/.test(s) && (s.match(/\d/g) || []).length >= 3 && !/\./.test(s) && !/,/.test(s); };
    const isAlphaShort = (t) => /^[A-Za-z]{2,5}\.?$/.test(tidy(t));
    const nearSlab = (r) => GST_SLABS.reduce((b, s) => Math.abs(s - r) < Math.abs(b - r) ? s : b, 18);
    const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

    // ---------- geometry ----------
    function prepWords(words) {
        return words
            .map(w => ({ t: String(w.t), c: w.c == null ? 100 : w.c, x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1, xc: (w.x0 + w.x1) / 2, yc: (w.y0 + w.y1) / 2, h: w.y1 - w.y0 }))
            .filter(w => w.t.trim() && !isJunk(w.t));
    }

    // Estimate page skew (photos are rarely straight): choose the angle that makes text rows collapse into the sharpest horizontal bands
    function estimateSkew(ws) {
        const pts = ws.filter(w => w.t.length >= 2 && w.c > 30);
        if (pts.length < 15) return 0;
        const bin = Math.max(6, median(pts.map(p => p.h)) * 0.5);
        let best = 0, bestScore = -1;
        for (let a = -4; a <= 4.001; a += 0.1) {
            const k = Math.tan(a * Math.PI / 180), hist = new Map();
            pts.forEach(p => { const b = Math.round((p.yc - p.xc * k) / bin); hist.set(b, (hist.get(b) || 0) + 1); });
            let s = 0; hist.forEach(v => { s += v * v; });
            if (s > bestScore) { bestScore = s; best = a; }
        }
        return best;
    }

    function clusterLines(ws, k) {
        const items = ws.map(w => Object.assign({}, w, { ys: w.yc - w.xc * k })).sort((a, b) => a.ys - b.ys);
        const tol = Math.max(8, median(items.map(i => i.h)) * 0.55);
        const lines = [];
        items.forEach(w => {
            const L = lines[lines.length - 1];
            if (L && Math.abs(w.ys - L.y) <= tol) { L.w.push(w); L.y = L.w.reduce((s, x) => s + x.ys, 0) / L.w.length; }
            else lines.push({ y: w.ys, w: [w] });
        });
        lines.forEach(l => l.w.sort((a, b) => a.x0 - b.x0));
        return lines;
    }

    // ---------- table detection ----------
    function isDataLine(l) {
        const toks = l.w.filter(w => !isJunk(w.t));
        const nums = toks.filter(w => isNum(w.t));
        const decimals = nums.filter(w => /\d\.\d{1,2}$/.test(numFix(w.t)));
        const alphas = toks.filter(w => (w.t.match(/[A-Za-z]/g) || []).length >= 3);
        if (/grand\s*total|tax\s*rate|rupees|freight|round\s*off|^\W*(?:\w{1,2}\W+)?total\b|^add\b/i.test(toks.map(w => w.t).join(' '))) return false;
        return nums.length >= 3 && alphas.length >= 1 && decimals.length >= 2 && toks.length >= 5;
    }

    function findTable(lines) {
        const idx = [];
        lines.forEach((l, i) => { if (isDataLine(l)) idx.push(i); });
        if (!idx.length) return null;
        const ys = idx.map(i => lines[i].y);
        const gaps = ys.slice(1).map((y, i) => y - ys[i]).filter(g => g > 0);
        const spacing = median(gaps) || 40;
        // split into runs where consecutive data rows are not too far apart; keep the longest run
        const runs = []; let cur = [idx[0]];
        for (let i = 1; i < idx.length; i++) {
            if (lines[idx[i]].y - lines[idx[i - 1]].y <= spacing * 3.2) cur.push(idx[i]); else { runs.push(cur); cur = [idx[i]]; }
        }
        runs.push(cur);
        const run = runs.sort((a, b) => b.length - a.length)[0];
        return { rows: run.map(i => lines[i]), first: run[0], last: run[run.length - 1], spacing };
    }

    // column boundaries: x ranges that contain words in the table rows, separated by empty gaps
    function findColumns(rows) {
        const toks = [];
        rows.forEach(r => r.w.forEach(w => { if (!isJunk(w.t)) toks.push(w); }));
        const h = median(toks.map(t => t.h)) || 20;
        const gap = Math.max(6, h * 0.3);
        const iv = toks.map(t => [t.x0, t.x1]).sort((a, b) => a[0] - b[0]);
        const cols = [];
        iv.forEach(([a, b]) => {
            const c = cols[cols.length - 1];
            if (c && a - c.x1 <= gap) c.x1 = Math.max(c.x1, b); else cols.push({ x0: a, x1: b });
        });
        return cols;
    }

    const colOf = (cols, w) => {
        let best = -1, bd = 1e9;
        cols.forEach((c, i) => {
            const d = w.xc >= c.x0 && w.xc <= c.x1 ? 0 : Math.min(Math.abs(w.xc - c.x0), Math.abs(w.xc - c.x1));
            if (d < bd) { bd = d; best = i; }
        });
        return best;
    };

    // ---------- main ----------
    function parse(rawWords, opts) {
        opts = opts || {};
        const out = { rows: [], invoiceNo: '', gstDefault: null, skew: 0, warnings: [], debug: {} };
        let ws = prepWords(rawWords || []);
        ws = ws.filter(w => !(w.t.length === 1 && /[^A-Za-z0-9%₹]/.test(w.t)));
        if (ws.length < 10) { out.warnings.push('Very little text was detected. Try a sharper, well-lit, straight photo.'); return out; }

        const skew = estimateSkew(ws);
        out.skew = skew;
        const k = Math.tan(skew * Math.PI / 180);
        const lines = clusterLines(ws, k);
        const fullText = lines.map(l => l.w.map(w => w.t).join(' ')).join('\n');

        out.invoiceNo = findInvoiceNo(lines);
        out.gstDefault = findDocGst(fullText);

        const table = findTable(lines);
        if (!table) { out.warnings.push('Could not find the items table. Make sure the whole table is visible, then try again or add rows manually.'); return out; }

        const cols = findColumns(table.rows);

        // header band: lines just above the first data row that contain header keywords
        const header = [];
        for (let i = table.first - 1; i >= 0 && i >= table.first - 4; i--) {
            const l = lines[i];
            if (table.rows[0].y - l.y > table.spacing * 4) break;
            const hit = l.w.filter(w => KW.test(tidy(w.t).replace(/[:;]/g, ''))).length;
            if (hit >= 1) header.unshift(l); else if (header.length) break;
        }
        const colHead = cols.map(() => []);
        header.forEach(l => l.w.forEach(w => { if (!isJunk(w.t)) colHead[colOf(cols, w)].push(w.t); }));
        const headText = colHead.map(a => a.join(' ').toLowerCase());

        // cell text per row/column
        const grid = table.rows.map(r => {
            const cells = cols.map(() => []);
            r.w.forEach(w => { if (!isJunk(w.t)) cells[colOf(cols, w)].push(w); });
            return cells;
        });
        const colVals = cols.map((_, ci) => grid.map(row => row[ci].map(w => w.t).join(' ').trim()));
        const colStat = cols.map((_, ci) => {
            const v = colVals[ci].filter(Boolean);
            const n = Math.max(1, v.length);
            const nums = v.filter(x => isNum(x));
            return {
                fill: v.length / grid.length,
                numFrac: nums.length / n,
                pctFrac: v.filter(x => isPct(x)).length / n,
                idFrac: v.filter(x => isId(x)).length / n,
                medLen: median(v.map(x => tidy(x).replace(/[^A-Za-z0-9]/g, '').length)),
                alphaShortFrac: v.filter(x => isAlphaShort(x)).length / n,
                intFrac: nums.filter(x => isInt(x)).length / n,
                decFrac: nums.filter(x => /\.\d/.test(numFix(x))).length / n,
                med: median(nums.map(x => toNum(x)).filter(x => x != null)),
                nums: nums.map(x => toNum(x)).filter(x => x != null),
                head: headText[ci]
            };
        });

        // --- assign roles ---
        const role = {}; // role -> column index
        const used = new Set();
        const take = (r, i) => { if (i != null && i >= 0 && !used.has(i) && role[r] == null) { role[r] = i; used.add(i); } };
        const byHead = (re, pred) => cols.findIndex((_, i) => !used.has(i) && re.test(colStat[i].head) && (!pred || pred(colStat[i], i)));

        // GST half-rate columns (CGST/SGST "rate" cells such as 2.5 | 2.5 or 9 | 9)
        const HALF = [0, 0.125, 0.25, 1.5, 2.5, 6, 9, 14];
        const halfOf = (x) => HALF.includes(x) ? x : (x === 25 ? 2.5 : null);
        const halfCols = cols.map((_, i) => i).filter(i => {
            const s = colStat[i];
            return s.numFrac >= 0.7 && s.nums.length && s.nums.every(x => halfOf(x) != null) && s.nums.some(x => x !== 0);
        });
        const hasHalf = halfCols.length >= 2;

        take('hsn', byHead(/hsn|sac/));
        take('part', byHead(/part/));
        take('qty', byHead(/qty|quant/));
        take('rate', byHead(/unit\s*rate|^rate|\brate\b|price/, (s, i) => !(hasHalf && halfCols.includes(i))));
        if (role.rate == null) take('rate', byHead(/mrp/));
        take('unit', byHead(/^(unit|uom)$|\buom\b|^unit\b(?!.*rate)/));
        take('pct', byHead(/gst\s*%|tax\s*%/, s => s.pctFrac > 0.4));
        if (role.pct == null) { const i = cols.findIndex((_, j) => !used.has(j) && colStat[j].pctFrac >= 0.6); take('pct', i); }
        if (hasHalf) { role.half = halfCols[0]; used.add(halfCols[0]); used.add(halfCols[1]); }
        // money columns used to work out each line's net (taxable) value
        take('taxable', byHead(/taxable/, s => s.numFrac >= 0.5));
        take('gstAmt', byHead(/(gst|tax)\s*amt|total\s*tax/, s => s.numFrac >= 0.5));
        take('discPct', byHead(/disc.*%|%.*disc/, s => s.numFrac >= 0.5));
        if (role.discPct == null) take('discAmt', byHead(/scheme|discount/, s => s.numFrac >= 0.5));
        take('gross', byHead(/gross|amoun|amt/, (s, i) => !/net|gst|tax|scheme|disc|total/.test(s.head) && (role.rate == null || i > role.rate) && s.numFrac >= 0.5));

        // identifier columns by content
        const idCols = cols.map((_, i) => i).filter(i => !used.has(i) && colStat[i].idFrac >= 0.6 && colStat[i].decFrac < 0.3 && colStat[i].medLen >= 6);
        if (role.hsn == null && role.part == null) {
            if (idCols.length >= 2) { take('part', idCols[0]); take('hsn', idCols[1]); }
            else if (idCols.length === 1) take('hsn', idCols[0]);
        } else if (role.hsn == null) take('hsn', idCols.find(i => i !== role.part));
        else if (role.part == null) { const c = idCols.find(i => i !== role.hsn && cols[i].x0 < cols[role.hsn].x0); if (c != null) take('part', c); }

        // unit by content
        if (role.unit == null) take('unit', cols.findIndex((_, i) => !used.has(i) && colStat[i].alphaShortFrac >= 0.6 && i > 0));
        // quantity by content: numeric column next to the unit column, else first numeric column after identifiers
        const numericCols = cols.map((_, i) => i).filter(i => !used.has(i) && colStat[i].numFrac >= 0.6 && colStat[i].idFrac < 0.6);
        if (role.qty == null) {
            let cand = null;
            if (role.unit != null) {
                const around = numericCols.filter(i => Math.abs(i - role.unit) === 1);
                cand = around.sort((a, b) => colStat[a].med - colStat[b].med)[0];
            }
            if (cand == null) { const minX = Math.max(...['hsn', 'part'].map(r => role[r] != null ? role[r] : -1)); cand = numericCols.find(i => i > minX && colStat[i].med < 5000); }
            take('qty', cand);
        }
        if (role.rate == null) {
            const q = role.qty != null ? role.qty : -1;
            const cand = numericCols.find(i => i > q && !used.has(i) && colStat[i].med > 0 && !(colStat[i].intFrac === 1 && colStat[i].med < 20 && role.qty != null));
            take('rate', cand);
        }

        // discount column whose header was unreadable: a decimal column of small values between the amount and the GST columns
        if (role.discPct == null && role.discAmt == null && role.gross != null) {
            const stop = [role.pct, role.gstAmt, role.half].filter(v => v != null);
            const lim = stop.length ? Math.min(...stop) : cols.length;
            const c = cols.findIndex((_, i) => i > role.gross && i < lim && !used.has(i) && colStat[i].numFrac >= 0.6 && colStat[i].decFrac >= 0.4 && colStat[i].nums.length && colStat[i].nums.filter(v => v > 0 && (v < 100 || (Number.isInteger(v) && v >= 1000 && v < 10000))).length / colStat[i].nums.length >= 0.8);
            if (c >= 0) take('discPct', c);
        }
        {
            const rem = cols.map((_, i) => i).filter(i => !used.has(i) && colStat[i].numFrac >= 0.6 && colStat[i].idFrac < 0.6 && (role.rate == null || i > role.rate));
            if (rem.length) role.total = rem[rem.length - 1];
        }

        // name: everything left of the first role column (minus serial numbers)
        const roleCols = ['part', 'hsn', 'qty', 'unit', 'rate'].map(r => role[r]).filter(i => i != null);
        const firstRoleCol = roleCols.length ? Math.min(...roleCols) : cols.length;
        const nameLimit = firstRoleCol < cols.length ? cols[firstRoleCol].x0 : Infinity;

        // left edge of the product names: drops the serial-number column and stray border noise
        const firstAlpha = table.rows.map(r => r.w.find(w => (w.t.match(/[A-Za-z]/g) || []).length >= 3)).filter(Boolean).map(w => w.x0);
        const rowsN = table.rows.length;
        const nameStart = firstAlpha.length ? median(firstAlpha) - 6 : 0;

        out.debug = { skew, cols: cols.length, role, stats: colStat.map(c => ({ n: +c.numFrac.toFixed(2), d: +c.decFrac.toFixed(2), m: c.med, h: c.head })), head: headText, spacing: table.spacing };

        // --- build rows ---
        const rows = [];
        grid.forEach((cells, ri) => {
            const all = table.rows[ri].w.filter(w => !isJunk(w.t));
            let nameToks = all.filter(w => w.xc < nameLimit);
            if (rowsN >= 4) nameToks = nameToks.filter(w => w.x1 > nameStart - 4);
            else while (nameToks.length > 1 && /^\d{1,3}[.)|]*$/.test(tidy(nameToks[0].t))) nameToks.shift();
            const name = nameToks.map(w => tidy(w.t)).filter(Boolean).join(' ').replace(/\s+/g, ' ').replace(/^[^A-Za-z0-9(]+/, '').trim();
            const get = (r) => role[r] != null ? cells[role[r]].map(w => w.t).join(' ').trim() : '';
            const getTok = (r) => role[r] != null ? cells[role[r]] : [];

            let part = tidy(get('part')).replace(/[()\s]/g, '');
            let hsn = tidy(get('hsn')).replace(/[^0-9]/g, '');
            if (hsn && hsn.length > 8) hsn = hsn.slice(0, 8);
            // the recogniser sometimes drops decimal points ("1,906.00" -> "190600"): restore them using column/row evidence
            const rowNums = all.filter(w => w.xc >= nameLimit && isNum(w.t) && !/^\d{7,}$/.test(tidy(w.t)));
            const rowDec = rowNums.length ? rowNums.filter(w => /\.\d{1,2}$/.test(numFix(w.t))).length / rowNums.length : 0;
            const fixDec = (txt, ci) => {
                const t = numFix(txt);
                if (!/^\d[\d,]*$/.test(t)) return txt;
                const digits = t.replace(/,/g, '');
                const colDec = ci != null ? colStat[ci].decFrac : 0;
                if (digits.length >= 3 && ((colDec >= 0.5) || (rowDec >= 0.7 && (/00$/.test(digits) || digits.length >= 5)))) return digits.slice(0, -2) + '.' + digits.slice(-2);
                return txt;
            };
            let qty = role.qty != null ? toNum(fixDec(get('qty'), role.qty)) : null;
            let rate = role.rate != null ? toNum(fixDec(get('rate'), role.rate)) : null;
            let qtyGuessed = false;
            if ((qty == null || qty <= 0) && rate) {
                // quantity unreadable: infer it from a printed amount (amount = qty x rate)
                const amts = all.filter(w => w.xc >= nameLimit && isNum(w.t)).map(w => toNum(fixDec(w.t, null))).filter(v => v != null);
                const near = (a, b) => Math.abs(a - b) <= Math.max(0.6, b * 0.005);
                if (amts.filter(v => near(v, rate)).length >= 2) { qty = 1; qtyGuessed = true; }
                else {
                    for (const v of amts) { const k = v / rate; if (k >= 2 && k <= 999 && Math.abs(k - Math.round(k)) < 0.01) { qty = Math.round(k); qtyGuessed = true; break; } }
                }
            }
            const unit = tidy(get('unit')).replace(/[^A-Za-z]/g, '');
            const money = (r) => role[r] != null ? toNum(fixDec(get(r), role[r])) : null;
            const gross = money('gross'), discPctRaw = money('discPct'), discAmtRaw = money('discAmt');
            const gstAmtRaw = money('gstAmt'), lineTotal = money('total'), taxableCol = money('taxable');

            let gst = null, gstSure = false;
            if (role.pct != null && isPct(get('pct'))) { const v = toNum(get('pct')); gst = nearSlab(v); gstSure = GST_SLABS.includes(v); }
            else if (role.half != null && toNum(cells[role.half].map(w => w.t).join(' ')) != null) { const hv = halfOf(toNum(cells[role.half].map(w => w.t).join(' '))); const v = (hv == null ? 0 : hv) * 2; gst = nearSlab(v); gstSure = hv != null && GST_SLABS.includes(v); }
            else if (out.gstDefault != null) { gst = out.gstDefault; gstSure = true; }
            else if (qty != null && rate != null) {
                // no GST column on the bill: find which rate explains a tax amount printed on the row (e.g. 2.5% of 3000 = 75)
                const base = qty * rate;
                const vals = all.filter(w => isNum(w.t) && !isPct(w.t)).map(w => toNum(w.t));
                const tryRates = [[2.5, 5], [6, 12], [9, 18], [14, 28], [5, 5], [12, 12], [18, 18], [28, 28]];
                for (const [r, full] of tryRates) {
                    const target = base * r / 100;
                    if (vals.some(v => Math.abs(v - target) <= Math.max(0.6, target * 0.004))) { gst = full; gstSure = true; break; }
                }
            }

            // net (taxable) value of the line: prefer what the bill itself prints, otherwise derive it
            const near2 = (a, b, t) => Math.abs(a - b) <= Math.max(t || 0.6, Math.abs(b) * 0.004);
            let net = null, netSrc = '';
            if (taxableCol != null) { net = taxableCol; netSrc = 'taxable value on the bill'; }
            else if (lineTotal != null && gstAmtRaw != null && gstAmtRaw > 0 && lineTotal > gstAmtRaw && (gst == null || near2((lineTotal - gstAmtRaw) * gst / 100, gstAmtRaw, 1))) { net = lineTotal - gstAmtRaw; netSrc = 'line total − GST'; }
            else if (gross != null && discPctRaw != null) { net = gross * (1 - discPctRaw / 100); netSrc = 'amount − discount %'; }
            else if (gross != null && discAmtRaw != null) { net = gross - discAmtRaw; netSrc = 'amount − discount'; }
            else if (lineTotal != null && qty != null && rate != null && near2(lineTotal, qty * rate, 1)) { net = lineTotal; netSrc = 'line amount'; }
            else if (lineTotal != null && gst != null && qty != null && rate != null && near2(lineTotal / (1 + gst / 100), qty * rate, 1)) { net = lineTotal / (1 + gst / 100); netSrc = 'line total ÷ (1 + GST)'; }
            if (net == null && qty != null && rate != null) { net = qty * rate; netSrc = 'qty × rate'; }
            if (net != null) net = Math.round((net + Number.EPSILON) * 100) / 100;
            // discount % shown to the user
            let discPct = discPctRaw;
            if (discPct == null && gross != null && net != null && gross > net + 0.005) discPct = Math.round(((1 - net / gross) * 100 + Number.EPSILON) * 100) / 100;
            if (discPct == null) discPct = 0;
            // GST amount printed on the bill, if it agrees with net x rate
            let gstAmt = null;
            if (gstAmtRaw != null && net != null && gst != null && near2(net * gst / 100, gstAmtRaw, 1)) gstAmt = gstAmtRaw;
            // amount printed on the bill should equal qty x rate — if not, something was misread
            const grossMismatch = gross != null && qty != null && rate != null && !near2(gross, qty * rate, 1);

            const conf = (toks) => toks.length ? Math.min(...toks.map(t => t.c)) : 100;
            const flags = {
                name: !name || name.length < 3 || conf(nameToks) < 45,
                part: role.part != null && (!part || conf(getTok('part')) < 50),
                hsn: !hsn || hsn.length < 4 || conf(getTok('hsn')) < 50,
                qty: qty == null || qty <= 0 || qtyGuessed || qty >= 1000 || grossMismatch || conf(getTok('qty')) < 40,
                rate: rate == null || rate >= 100000 || grossMismatch || conf(getTok('rate')) < 40,
                gst: gst == null || !gstSure,
                net: net == null
            };
            if (!name && qty == null) return;
            if (/^\W*(?:\w{1,2}\W+)?total\b/i.test(name)) return;
            rows.push({ name, part, hsn, qty: qty == null ? '' : qty, unit, rate: rate == null ? '' : rate, gst: gst == null ? 18 : gst, discPct, discAmt: discAmtRaw != null && discPctRaw == null ? discAmtRaw : null, net: net == null ? '' : net, netSrc, gstAmt, gross, flags });
        });

        // a line whose discount could not be read: bills usually use one discount per GST slab, so borrow the common one
        if (role.discPct != null) {
            const byRate = {};
            rows.forEach(r => { if (r.netSrc !== 'qty × rate' && r.discPct > 0) (byRate[r.gst] = byRate[r.gst] || []).push(r.discPct); });
            rows.forEach(r => {
                if (r.netSrc !== 'qty × rate' || !(r.qty > 0) || r.rate === '') return;
                const arr = byRate[r.gst]; if (!arr || arr.length < 3) return;
                const top = arr.slice().sort((a, b) => arr.filter(v => v === b).length - arr.filter(v => v === a).length)[0];
                if (arr.filter(v => Math.abs(v - top) < 0.05).length / arr.length < 0.8) return;
                r.discPct = top; r.net = Math.round((r.qty * r.rate * (1 - top / 100) + Number.EPSILON) * 100) / 100;
                r.netSrc = 'estimated from the usual discount for this GST rate'; r.gstAmt = null; r.flags.net = true;
            });
        }
        // net came from qty x rate although the bill prints discount / tax columns: the printed values were unreadable
        if (role.discPct != null || role.discAmt != null || role.gstAmt != null) rows.forEach(r => { if (r.netSrc === 'qty × rate') r.flags.net = true; });
        out.rows = rows;
        out.doc = parseDoc(lines, table, opts);
        if (!rows.length) out.warnings.push('No item rows could be read from this image.');
        return out;
    }


    // ---------- document header + printed totals ----------
    const MONEY = /^-?\d[\d,]*\.\d{2}$/;
    const money2 = (t) => { const s = numFix(t); return MONEY.test(s) ? parseFloat(s.replace(/,/g, '')) : null; };
    const lineText = (l) => l.w.map(w => w.t).join(' ');
    const decimalsOf = (l) => l.w.map(w => money2(w.t)).filter(v => v != null);
    const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
    const GSTIN_RE = /\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]/;

    function parseDoc(lines, table, opts) {
        const own = String((opts && opts.ownGstin) || '').toUpperCase();
        const doc = { supplierName: '', supplierGstin: '', date: '', charges: [], roundOff: 0, declared: { taxable: null, tax: null, grand: null }, slabs: [] };
        const H = median(lines.flatMap(l => l.w.map(w => w.h))) || 20;

        // supplier GSTIN: first valid GSTIN that is not our own. OCR often confuses look-alike characters
        // (Z/2, O/0, S/5 ...) and splits the number with spaces ("3 7 KQSPS..."), so repair each position by type.
        const D2L = { 0: 'O', 1: 'I', 5: 'S', 8: 'B', 2: 'Z', 6: 'G' }, L2D = { O: '0', I: '1', L: '1', S: '5', B: '8', Z: '2', G: '6', Q: '0' };
        const fixGstin = (g) => {
            let o = '';
            for (let i = 0; i < 15; i++) {
                let c = g[i];
                const digitPos = i < 2 || (i >= 7 && i <= 10);
                if (i === 13) c = ('Z27'.indexOf(c) >= 0) ? 'Z' : c;
                else if (digitPos) c = L2D[c] || c;
                else if (i >= 2 && i <= 6 || i === 11) c = D2L[c] || c;
                o += c;
            }
            return o;
        };
        let gLine = -1;
        for (let i = 0; i < lines.length && !doc.supplierGstin; i++) {
            const t = lineText(lines[i]).toUpperCase().replace(/[^A-Z0-9]/g, '');
            for (let k = 0; k + 15 <= t.length; k++) {
                const g = fixGstin(t.slice(k, k + 15));
                const labelled = [i - 2, i - 1, i].some(j => j >= 0 && /GST/i.test(lineText(lines[j])));
                if (new RegExp('^' + GSTIN_RE.source + '$').test(g) && g !== own && 'PCFHABGJLT'.indexOf(g[5]) >= 0 && +g.slice(0, 2) >= 1 && +g.slice(0, 2) <= 38 && (labelled || t.slice(k, k + 15) === g)) { doc.supplierGstin = g; gLine = i; break; }
            }
        }

        // supplier name: the tallest clearly-read text near the top of the page
        const limit = gLine >= 0 ? gLine : Math.min(lines.length, 14);
        const cands = [];
        for (let i = 0; i < limit; i++) {
            const l = lines[i];
            const kept = l.w.filter(w => {
                const letters = (w.t.match(/[A-Za-z]/g) || []).length;
                return (w.c >= 70 && letters >= 2) || (w.c >= 35 && letters >= 5 && /^[A-Z.&'-]+$/.test(tidy(w.t).replace(/^['"`]+/, '')));
            });
            if (!kept.length) continue;
            const t = kept.map(w => tidy(w.t).replace(/^['"`]+/, '')).join(' ').replace(/\s+/g, ' ').trim();
            const letters = (t.match(/[A-Za-z]/g) || []).length;
            if (letters < 4 || (t.match(/\d/g) || []).length > letters * 0.2) continue;
            if (/tax\s*invoice|original|duplicate|triplicate|copy|godown|address|d\.?\s*no|h\.?\s*no|phone|tel\b|email|gstin|pan\b|irn|status|invoice|date|vehicle|transport|pradesh|andhra|telangana|karnataka|tamil|nadu|kerala|maharashtra|road|street|nagar|colony|district|near\b|opp\b|plot|floor|market|vijayawada|hyderabad|eluru|guntur|chennai|bangalore|bengaluru|mumbai|delhi|\bpin\b|\d{6}/i.test(t)) continue;
            cands.push({ t, h: median(kept.map(w => w.h)), y: l.y, x0: kept[0].x0, i });
        }
        let best = null;
        cands.forEach(c => { if (!best || c.h > best.h * 1.12) best = c; });
        if (best) {
            // words of one visual line can land in neighbouring clusters: join similar-height neighbours in reading order
            const group = cands.filter(c => Math.abs(c.y - best.y) <= best.h * 1.3 && c.h >= best.h * 0.7 && c.h <= best.h * 1.3).sort((a, b) => a.x0 - b.x0);
            doc.supplierName = group.map(c => c.t).join(' ').replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.)]+$/g, '').replace(/\s+/g, ' ').trim();
        }

        // invoice date
        const toIso = (d, m, y) => { d = +d; m = +m; y = +y; if (y < 100) y += 2000; if (m < 1 || m > 12 || d < 1 || d > 31) return ''; return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); };
        const dateRe = /(\d{1,2})\s*[-\/.]\s*(\d{1,2})\s*[-\/.]\s*(\d{4})/;
        for (let i = 0; i < Math.min(lines.length, Math.max(40, limit + 25)) && !doc.date; i++) {
            const t = lineText(lines[i]);
            if (/ack/i.test(t)) continue;
            if (/date|dt\b/i.test(t)) { const m = t.match(dateRe); if (m) doc.date = toIso(m[1], m[2], m[3]); }
        }
        if (!doc.date) for (let i = 0; i < Math.min(lines.length, 40); i++) { const t = lineText(lines[i]); if (/ack/i.test(t)) continue; const m = t.match(dateRe); if (m) { doc.date = toIso(m[1], m[2], m[3]); if (doc.date) break; } }

        // everything below the first item row: other charges, round-off, tax summary, grand total
        const rowSet = new Set(table.rows);
        const after = lines.filter(l => l.y >= table.rows[0].y && !rowSet.has(l));
        const lastAmt = (l) => { const d = decimalsOf(l); return d.length ? d[d.length - 1] : null; };
        after.forEach(l => {
            const t = lineText(l);
            const amt = lastAmt(l);
            if (amt == null) return;
            if (/freight|forwarding|packing|courier|insurance|loading|handling|cartage|transport(?:ation)?\s*charge/i.test(t)) {
                const label = t.split(/\s+/).map(w => w.replace(/[^A-Za-z&]/g, '')).filter(w => /^[A-Za-z]{3,}$/.test(w) && !/^(add|nos)$/i.test(w) || w === '&').join(' ').replace(/\s+/g, ' ').trim() || 'Freight';
                doc.charges.push({ label, amount: amt, gstRate: 0 });
            } else if (/round(?:ed)?\s*off/i.test(t)) {
                doc.roundOff = /\(\s*-\s*\)|less|minus/i.test(t) ? -Math.abs(amt) : Math.abs(amt);
            } else if (/tcs/i.test(t) && amt > 0) {
                doc.charges.push({ label: 'TCS', amount: amt, gstRate: 0 });
            }
        });
        // printed tax summary rows:  [taxable, cgst, sgst, total tax]  (rate may be unreadable -> infer from tax/taxable)
        after.forEach(l => {
            const d = decimalsOf(l); const t = lineText(l);
            if (d.length >= 2 && /\btotal\b/i.test(t) && !/grand|amount|before/i.test(t) && d.length >= 3 && doc.declared.taxable == null) {
                doc.declared.taxable = d[0]; doc.declared.tax = d[d.length - 1];
            } else if (d.length >= 3 && d[0] > d[d.length - 1]) {
                const ratio = d[d.length - 1] / d[0] * 100;
                const slab = GST_SLABS.find(r => r > 0 && Math.abs(ratio - r) < 0.35);
                if (slab != null) doc.slabs.push({ rate: slab, taxable: d[0], tax: d[d.length - 1] });
            }
        });
        after.forEach(l => {
            const t = lineText(l); const amt = lastAmt(l);
            if (amt == null) return;
            if (/(taxable\s*(amt|amount|value)|before\s*tax)/i.test(t) && doc.declared.taxable == null) doc.declared.taxable = amt;
            else if (/total\s*tax/i.test(t) && doc.declared.tax == null) doc.declared.tax = amt;
            if (/grand\s*total|invoice\s*amount|net\s*(payable|amount)/i.test(t)) doc.declared.grand = decimalsOf(l).reduce((a, b) => Math.max(a, b), 0) || amt;
        });
        if (doc.declared.taxable == null && doc.slabs.length) doc.declared.taxable = r2(doc.slabs.reduce((a, s) => a + s.taxable, 0));
        if (doc.declared.tax == null && doc.slabs.length) doc.declared.tax = r2(doc.slabs.reduce((a, s) => a + s.tax, 0));
        return doc;
    }

    function findInvoiceNo(lines) {
        for (let i = 0; i < Math.min(lines.length, lines.length); i++) {
            const txt = lines[i].w.map(w => w.t).join(' ');
            if (!/(?:oice|bill)\s*(no|number|#)/i.test(txt)) continue;
            // candidate tokens on this line and the next two (skewed / merged rows)
            const cand = [];
            for (let j = i; j <= Math.min(i + 2, lines.length - 1); j++) lines[j].w.forEach(w => cand.push(w));
            const m = cand.filter(w => /^[A-Za-z0-9][A-Za-z0-9\-\/]{4,}$/.test(tidy(w.t)) && /\d/.test(w.t) && !/^(invoice|number)$/i.test(w.t) && !/^\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}$/.test(w.t));
            if (m.length) {
                // prefer the first candidate that follows the label on the same line
                let tok = tidy(m[0].t);
                // join "AKT0170/" + "2026"
                const idx = cand.indexOf(m[0]);
                if (/[\/\-]$/.test(tok) && cand[idx + 1]) tok += tidy(cand[idx + 1].t);
                return tok;
            }
        }
        return '';
    }

    function findDocGst(text) {
        let m = text.match(/(?:CGST|SGST)\s*@?\s*(\d+(?:\.\d+)?)\s*%/i);
        if (m) return nearSlab(parseFloat(m[1]) * 2);
        m = text.match(/IGST\s*@?\s*(\d+(?:\.\d+)?)\s*%/i);
        if (m && parseFloat(m[1]) > 0) return nearSlab(parseFloat(m[1]));
        return null;
    }

    // ---------- matching against inventory ----------
    const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 1);
    function similarity(a, b) {
        const A = new Set(words(a)), B = new Set(words(b));
        if (!A.size || !B.size) return 0;
        let i = 0; A.forEach(w => { if (B.has(w)) i++; });
        return i / (A.size + B.size - i);
    }

    function editDist1(a, b) {
        if (a === b) return true;
        if (Math.abs(a.length - b.length) > 1) return false;
        let i = 0, j = 0, d = 0;
        while (i < a.length && j < b.length) {
            if (a[i] === b[j]) { i++; j++; continue; }
            if (++d > 1) return false;
            if (a.length === b.length) { i++; j++; } else if (a.length > b.length) i++; else j++;
        }
        return d + (a.length - i) + (b.length - j) <= 1;
    }

    // Returns { status: 'part'|'hsn'|'new', item, candidates[] }
    function matchInventory(row, inventory) {
        const p = norm(row.part), h = String(row.hsn || '').replace(/\D/g, '');
        if (p) {
            const hit = inventory.find(i => i.partNumber && norm(i.partNumber) === p);
            if (hit) return { status: 'part', item: hit, candidates: [hit] };
        }
        if (p.length >= 6) {
            // one OCR slip (a wrong/missing digit) in the part number
            const near = inventory.find(i => i.partNumber && editDist1(norm(i.partNumber), p));
            if (near) return { status: 'hsn', item: near, candidates: [near], near: true };
        }
        let cands = h ? inventory.filter(i => i.hsn && String(i.hsn).replace(/\D/g, '') === h) : [];
        // an item with a different part number is a different product
        cands = cands.filter(i => !(p && i.partNumber && norm(i.partNumber) !== p));
        cands = cands.map(i => ({ i, s: similarity(row.name, i.name) })).sort((a, b) => b.s - a.s);
        if (cands.length) {
            const best = cands[0];
            return { status: 'hsn', item: best.s >= 0.3 || cands.length === 1 && !p && !best.i.partNumber ? best.i : null, candidates: cands.map(c => c.i) };
        }
        return { status: 'new', item: null, candidates: [] };
    }

    const api = { parse, parseDoc, matchInventory, similarity, estimateSkew, clusterLines, GST_SLABS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.BillScanParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
