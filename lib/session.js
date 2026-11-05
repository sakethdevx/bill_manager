// Session handling: one shared login read from environment variables, signed HttpOnly cookie.
// Roles are carried in the cookie payload so per-user roles can be added later without touching the routes.
import crypto from 'node:crypto';

const COOKIE = 'bm_session';
const ROLE_RANK = { viewer: 1, billing: 2, admin: 3 };
const LONG_SESSION_S = 30 * 24 * 3600;
const SHORT_SESSION_S = 12 * 3600;

function secret() {
    const s = process.env.SESSION_SECRET;
    if (s && s.length >= 16) return s;
    // Fall back to a key derived from other secrets so a missing SESSION_SECRET is not fatal
    const base = (process.env.APP_PASSWORD || '') + '|' + (process.env.GITHUB_TOKEN || '');
    if (base.length < 8) return null;
    return crypto.createHash('sha256').update('bm-session:' + base).digest('hex');
}

const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();
export function safeEqual(a, b) { return crypto.timingSafeEqual(sha(a), sha(b)); }

export function createToken(payload) {
    const key = secret(); if (!key) throw new Error('Server is missing APP_PASSWORD / SESSION_SECRET');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', key).update(body).digest('base64url');
    return body + '.' + sig;
}

export function verifyToken(token) {
    const key = secret(); if (!key || typeof token !== 'string') return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const want = crypto.createHmac('sha256', key).update(body).digest('base64url');
    if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
    try {
        const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (!p || !p.exp || p.exp < Math.floor(Date.now() / 1000)) return null;
        return p;
    } catch (e) { return null; }
}

export function parseCookies(req) {
    const out = {};
    String(req.headers.cookie || '').split(/;\s*/).forEach(kv => {
        const i = kv.indexOf('='); if (i > 0) out[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });
    return out;
}

const isSecure = (req) => req.headers['x-forwarded-proto'] === 'https' || !!process.env.VERCEL;

export function setSessionCookie(req, res, session, remember) {
    const ttl = remember ? LONG_SESSION_S : SHORT_SESSION_S;
    const token = createToken({ ...session, exp: Math.floor(Date.now() / 1000) + ttl });
    const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
    if (remember) parts.push(`Max-Age=${ttl}`);
    if (isSecure(req)) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
}
export function clearSessionCookie(req, res) {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isSecure(req) ? '; Secure' : ''}`);
}

export function getSession(req) {
    return verifyToken(parseCookies(req)[COOKIE]);
}

// Cross-site request guard for state-changing calls (cookie is SameSite=Strict as well)
function sameOrigin(req) {
    const origin = req.headers.origin; if (!origin) return true;
    try { return new URL(origin).host === req.headers.host; } catch (e) { return false; }
}

// Returns the session, or answers 401/403 and returns null.
export function requireSession(req, res, minRole = 'viewer') {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) { res.status(403).json({ error: 'Cross-origin request blocked' }); return null; }
    const s = getSession(req);
    if (!s) { res.status(401).json({ error: 'Not signed in', authenticated: false }); return null; }
    if ((ROLE_RANK[s.role] || 0) < (ROLE_RANK[minRole] || 99)) { res.status(403).json({ error: 'Your role cannot do this' }); return null; }
    return s;
}

// Shared login (later: look the user up in a users file with hashed passwords and roles)
export function checkCredentials(username, password) {
    const wantPass = process.env.APP_PASSWORD;
    if (!wantPass) return { error: 'Login is not configured on the server (set APP_USERNAME and APP_PASSWORD).' };
    const wantUser = process.env.APP_USERNAME;
    const userOk = !wantUser || safeEqual(String(username || '').trim().toLowerCase(), wantUser.trim().toLowerCase());
    const passOk = safeEqual(password || '', wantPass);
    if (userOk && passOk) return { session: { user: wantUser || 'owner', role: 'admin' } };
    return { denied: true };
}

// Best-effort brute-force slowdown (per server instance)
const fails = new Map();
export function loginGate(req) {
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'ip').split(',')[0].trim();
    const f = fails.get(ip);
    return { ip, locked: !!(f && f.until > Date.now()), wait: f ? Math.ceil((f.until - Date.now()) / 1000) : 0 };
}
export function loginFailed(ip) {
    const f = fails.get(ip) || { n: 0, until: 0 }; f.n++;
    if (f.n >= 5) { f.until = Date.now() + 60_000; f.n = 0; }
    fails.set(ip, f);
}
export function loginOk(ip) { fails.delete(ip); }
