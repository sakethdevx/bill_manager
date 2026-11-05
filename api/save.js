import { requireSession } from '../lib/session.js';
import { applyChanges } from '../lib/store.js';

// POST /api/save  { changes: { bills:{upserts,removes}, purchases:{...}, stockHistory:{...}, inventory:{...}, meta:{...} }, baseHead }
export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const s = requireSession(req, res, 'billing');
    if (!s) return;
    try {
        const body = req.body || {};
        const out = await applyChanges(body.changes, s.user);
        res.status(200).json({ ok: true, head: out.head, noop: !!out.noop, renumbered: out.renumbered || [], meta: out.meta || null, behind: !!(body.baseHead && out.parent && body.baseHead !== out.parent) });
    } catch (err) {
        console.error('[api/save]', err.message);
        res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : 'Could not save to storage' });
    }
}
