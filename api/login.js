import { checkCredentials, setSessionCookie, loginGate, loginFailed, loginOk } from '../lib/session.js';

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const gate = loginGate(req);
    if (gate.locked) return res.status(429).json({ error: `Too many attempts. Try again in ${gate.wait}s.` });
    const { username, password, remember } = req.body || {};
    const r = checkCredentials(username, password);
    if (r.error) return res.status(500).json({ error: r.error });
    if (r.denied) {
        loginFailed(gate.ip);
        await new Promise(ok => setTimeout(ok, 500));
        return res.status(401).json({ error: 'Wrong email/username or password' });
    }
    loginOk(gate.ip);
    setSessionCookie(req, res, r.session, !!remember);
    res.status(200).json({ ok: true, user: r.session.user, role: r.session.role });
}
