export default function handler(req, res) {
    // Expose only public Supabase values for client initialization
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || null;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || null;

    if (!url || !anon) {
        return res.status(500).json({ error: 'Supabase public credentials not configured' });
    }

    res.status(200).json({ url, anon });
}
