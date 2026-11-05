import { getSession } from '../lib/session.js';

export default function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const s = getSession(req);
    res.status(200).json(s ? { authenticated: true, user: s.user, role: s.role } : { authenticated: false });
}
