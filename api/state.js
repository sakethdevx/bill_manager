import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

const supabase = SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
    : null;

// Requires a Supabase table `app_state(id text primary key, payload jsonb)`
export default async function handler(req, res) {
    if (!supabase) return res.status(500).json({ error: 'SUPABASE_URL or SUPABASE_KEY not configured' });

    try {
        if (req.method === 'GET') {
            const { data, error } = await supabase.from('app_state').select('payload').eq('id', 'main').single();
            if (error && error.code !== 'PGRST116') return res.status(500).json({ error });
            const payload = data && data.payload ? data.payload : { bills: [], inventory: [], stockHistory: [] };
            return res.status(200).json(payload);
        }

        if (req.method === 'POST') {
            const body = req.body || {};
            const { error } = await supabase.from('app_state').upsert({ id: 'main', payload: body }, { returning: 'minimal' });
            if (error) return res.status(500).json({ error });
            return res.status(200).json({ ok: true });
        }

        res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('Supabase error:', err);
        res.status(500).json({ error: err.message || 'Internal error' });
    }
}
