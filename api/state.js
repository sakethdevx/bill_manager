import { kv } from '@vercel/kv';

export default async function handler(req, res) {
    try {
        if (req.method === 'GET') {
            const state = await kv.get('bill_manager_state');
            const parsed = state ? JSON.parse(state) : { bills: [], inventory: [], stockHistory: [] };
            return res.status(200).json(parsed);
        }

        if (req.method === 'POST') {
            const body = req.body || {};
            await kv.set('bill_manager_state', JSON.stringify(body));
            return res.status(200).json({ ok: true });
        }

        res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('KV error:', err);
        res.status(500).json({ error: err.message || 'Internal error' });
    }
}
