import { requireSession } from '../lib/session.js';
import { loadState, headOnly } from '../lib/store.js';
import { backendName } from '../lib/backend.js';

// GET /api/state?scope=recent|all&since=<head>
export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    if (!requireSession(req, res, 'viewer')) return;
    try {
        const { scope = 'recent', since } = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
        if (since) { const h = await headOnly(); if (h && h === since) return res.status(200).json({ unchanged: true, head: h }); }
        const out = await loadState({ scope: scope === 'all' ? 'all' : 'recent' });
        res.status(200).json({ ...out, storage: backendName() });
    } catch (err) {
        console.error('[api/state]', err.message);
        res.status(err.status || 500).json({ error: err.code === 'NO_STORAGE' ? err.message : 'Could not load data from storage' });
    }
}
