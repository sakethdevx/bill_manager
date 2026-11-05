// Data layout + merge logic, independent of where the files live (GitHub or local folder).
//
//   data/meta.json                      { schema, maxInvoiceNo, openingStock }
//   data/inventory.json                 [ item, ... ]
//   data/bills/<FY>/<YYYY-MM>.json      [ bill, ... ]          (FY = "2026-27", Apr-Mar)
//   data/purchases/<FY>/<YYYY-MM>.json
//   data/stock-history/<FY>/<YYYY-MM>.json
import { backend } from './backend.js';

export const COLLS = {
    bills: { dir: 'bills', when: r => r.date || r.timestamp || r.createdAt },
    purchases: { dir: 'purchases', when: r => r.date || r.createdAt || r.timestamp },
    stockHistory: { dir: 'stock-history', when: r => r.timestamp || r.date || r.createdAt }
};
const LIMITS = { perColl: 3000, record: 120_000, id: 160 };
const META_PATH = 'data/meta.json', INV_PATH = 'data/inventory.json';

const istNow = () => new Date(Date.now() + 5.5 * 3600 * 1000);
export function monthKey(when) {
    const m = String(when || '').match(/^(\d{4})-(\d{2})/);
    if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${m[2]}`;
    const n = istNow(); return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function fyOf(key) {
    const y = +key.slice(0, 4), mo = +key.slice(5, 7);
    const s = mo >= 4 ? y : y - 1;
    return `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
}
export const currentFy = () => { const n = istNow(); return fyOf(`${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}`); };
export const prevFy = (fy) => { const s = +fy.slice(0, 4) - 1; return `${s}-${String(s + 1).slice(2)}`; };
export const shardPath = (coll, rec) => { const k = monthKey(COLLS[coll].when(rec)); return `data/${COLLS[coll].dir}/${fyOf(k)}/${k}.json`; };

const sortKey = (r) => String(r.timestamp || r.createdAt || r.date || '');
const byNewest = (a, b) => sortKey(b).localeCompare(sortKey(a)) || String(b.id).localeCompare(String(a.id));
const serialize = (arr) => arr.length ? '[\n' + arr.map(r => JSON.stringify(r)).join(',\n') + '\n]\n' : '[]\n';
const parseArr = (text) => { try { const v = JSON.parse(text); return Array.isArray(v) ? v : []; } catch (e) { return []; } };

async function pool(items, n, fn) {
    const out = new Array(items.length); let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const j = i++; out[j] = await fn(items[j], j); } }));
    return out;
}

// ------------------------------------------------------------------ read
const SHARD_RE = /^data\/(bills|purchases|stock-history)\/(\d{4}-\d{2})\/(\d{4}-\d{2})\.json$/;
export async function loadState({ scope = 'recent' } = {}) {
    const be = backend();
    const snap = await be.snapshot();
    const fysAll = new Set();
    for (const p of snap.files.keys()) { const m = p.match(SHARD_RE); if (m) fysAll.add(m[2]); }
    const cur = currentFy();
    const want = scope === 'all' ? null : new Set([cur, prevFy(cur)]);
    const fys = [...fysAll].sort().reverse();

    const readJson = async (p, fallback) => { const sha = snap.files.get(p); if (!sha) return fallback; try { return JSON.parse(await be.read(p, sha)); } catch (e) { return fallback; } };
    const meta = await readJson(META_PATH, {});
    const inventory = parseArr(snap.files.has(INV_PATH) ? await be.read(INV_PATH, snap.files.get(INV_PATH)) : '[]');

    const out = { bills: [], purchases: [], stockHistory: [] };
    const dirToColl = { bills: 'bills', purchases: 'purchases', 'stock-history': 'stockHistory' };
    const paths = [...snap.files.keys()].filter(p => { const m = p.match(SHARD_RE); return m && (!want || want.has(m[2])); }).sort().reverse();
    const arrays = await pool(paths, 8, p => be.read(p, snap.files.get(p)).then(parseArr));
    paths.forEach((p, i) => out[dirToColl[p.match(SHARD_RE)[1]]].push(...arrays[i]));
    const loadedFys = scope === 'all' ? fys : fys.filter(f => want.has(f));
    if (!loadedFys.includes(cur)) loadedFys.unshift(cur);
    return { head: snap.head, fys, loadedFys, scope, currentFy: cur, state: { ...out, inventory, meta: { maxInvoiceNo: 0, openingStock: {}, ...meta } } };
}

export async function headOnly() { return backend().head(); }

// ------------------------------------------------------------------ validate
function badRequest(msg) { const e = new Error(msg); e.status = 400; return e; }
export function validateChanges(ch) {
    if (!ch || typeof ch !== 'object') throw badRequest('Missing changes');
    const clean = { meta: {} };
    for (const c of [...Object.keys(COLLS), 'inventory']) {
        const src = ch[c] || {};
        const ups = Array.isArray(src.upserts) ? src.upserts : [], rem = Array.isArray(src.removes) ? src.removes : [];
        if (ups.length > LIMITS.perColl || rem.length > LIMITS.perColl) throw badRequest(`Too many ${c} changes in one request`);
        clean[c] = {
            upserts: ups.map(r => {
                if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.id !== 'string' || !r.id || r.id.length > LIMITS.id) throw badRequest(`Invalid ${c} record`);
                if (JSON.stringify(r).length > LIMITS.record) throw badRequest(`${c} record is too large`);
                return r;
            }),
            removes: rem.map(r => {
                if (!r || typeof r.id !== 'string' || !r.id || r.id.length > LIMITS.id) throw badRequest(`Invalid ${c} removal`);
                const ref = r.ref && typeof r.ref === 'object' ? r.ref : {};
                return { id: r.id, ref: { date: str(ref.date), timestamp: str(ref.timestamp), createdAt: str(ref.createdAt) } };
            })
        };
    }
    const os = ch.meta && ch.meta.openingStock;
    if (os && typeof os === 'object') {
        clean.meta.openingStock = {};
        for (const [k, v] of Object.entries(os)) if (/^\d{4}$/.test(k) && (v === null || Number.isFinite(Number(v)))) clean.meta.openingStock[k] = v === null ? null : Number(v);
    }
    return clean;
}
const str = (v) => typeof v === 'string' ? v.slice(0, 40) : undefined;

// ------------------------------------------------------------------ write
const invNum = (v) => { const n = parseInt(String(v || '').replace(/\D/g, ''), 10); return Number.isNaN(n) ? 0 : n; };

function describe(ch, user) {
    const parts = [];
    const one = (c, label, field) => {
        const u = ch[c].upserts, r = ch[c].removes;
        if (u.length === 1 && !r.length) parts.push(`${label} ${u[0][field] || u[0].name || u[0].id}`);
        else if (u.length || r.length) parts.push(`${label}s +${u.length}/-${r.length}`);
    };
    one('bills', 'Bill', 'invoiceNo'); one('purchases', 'Purchase', 'purchaseNo');
    if (ch.inventory.upserts.length || ch.inventory.removes.length) parts.push(`Inventory ~${ch.inventory.upserts.length}/-${ch.inventory.removes.length}`);
    if (ch.stockHistory.upserts.length) parts.push(`Stock log +${ch.stockHistory.upserts.length}`);
    if (Object.keys(ch.meta).length) parts.push('Settings');
    return (parts.join('; ') || 'Update') + ` [${user}]`;
}

export async function applyChanges(rawChanges, user = 'owner') {
    const ch = validateChanges(rawChanges);
    const be = backend();
    for (let attempt = 0; attempt < 5; attempt++) {
        const snap = await be.snapshot();
        const originals = new Map(), next = new Map();
        const load = async (p) => {
            if (next.has(p)) return next.get(p);
            const sha = snap.files.get(p);
            const text = sha ? await be.read(p, sha) : null;
            originals.set(p, text);
            const arr = text ? parseArr(text) : [];
            next.set(p, arr); return arr;
        };
        const metaText = snap.files.has(META_PATH) ? await be.read(META_PATH, snap.files.get(META_PATH)) : null;
        let meta = { schema: 1, maxInvoiceNo: 0, openingStock: {} };
        try { meta = { ...meta, ...JSON.parse(metaText || '{}') }; } catch (e) { }
        const renumbered = [];

        for (const coll of Object.keys(COLLS)) {
            const touched = new Set();
            for (const r of ch[coll].removes) {
                const p = shardPath(coll, r.ref); const arr = await load(p);
                const i = arr.findIndex(x => x.id === r.id); if (i >= 0) { arr.splice(i, 1); touched.add(p); }
            }
            for (const rec of ch[coll].upserts) {
                const p = shardPath(coll, rec); const arr = await load(p);
                const i = arr.findIndex(x => x.id === rec.id);
                if (coll === 'bills' && i < 0 && rec.invoiceNo != null && arr.some(x => x.invoiceNo === rec.invoiceNo)) {
                    // two devices picked the same number: give the newcomer the next free one
                    const used = Math.max(meta.maxInvoiceNo || 0, ...arr.map(x => invNum(x.invoiceNo)), ...ch.bills.upserts.map(x => invNum(x.invoiceNo)));
                    const from = rec.invoiceNo; rec.invoiceNo = String(used + 1).padStart(3, '0');
                    renumbered.push({ id: rec.id, from, to: rec.invoiceNo });
                }
                if (i >= 0) arr[i] = rec; else arr.push(rec);
                touched.add(p);
            }
            touched.forEach(p => next.get(p).sort(byNewest));
        }
        // inventory: one file, order preserved (new items appended)
        {
            const inv = await load(INV_PATH);
            ch.inventory.removes.forEach(r => { const i = inv.findIndex(x => x.id === r.id); if (i >= 0) inv.splice(i, 1); });
            ch.inventory.upserts.forEach(rec => { const i = inv.findIndex(x => x.id === rec.id); if (i >= 0) inv[i] = rec; else inv.push(rec); });
        }
        // meta
        ch.bills.upserts.forEach(b => { meta.maxInvoiceNo = Math.max(meta.maxInvoiceNo || 0, invNum(b.invoiceNo)); });
        if (ch.meta.openingStock) {
            meta.openingStock = { ...(meta.openingStock || {}), ...ch.meta.openingStock };
            Object.keys(meta.openingStock).forEach(k => { if (meta.openingStock[k] === null) delete meta.openingStock[k]; });
        }

        const files = new Map();
        for (const [p, arr] of next) {
            const text = arr.length || p === INV_PATH ? serialize(arr) : null;      // empty month -> remove the file
            const before = originals.get(p);
            if (text === (before == null ? null : before) || (text == null && before == null)) continue;
            files.set(p, text);
        }
        const metaOut = JSON.stringify(meta, null, 2) + '\n';
        if (metaOut !== metaText) files.set(META_PATH, metaOut);
        if (!files.size) return { head: snap.head, parent: snap.head, noop: true, renumbered };
        try {
            const res = await be.commit(snap, files, describe(ch, user));
            return { head: res.head, parent: snap.head, renumbered, meta };
        } catch (e) {
            if (e.code === 'CONFLICT') { await new Promise(r => setTimeout(r, 150 * (attempt + 1))); continue; }
            throw e;
        }
    }
    const e = new Error('The data changed too often while saving - please try again'); e.status = 409; throw e;
}
