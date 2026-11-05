// Zero-dependency dev server: serves ./public and runs ./api/*.js handlers
// with the same (req, res) signature Vercel uses.  Usage: npm run dev
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const apiDir = path.join(root, 'api');
const PORT = Number(process.env.PORT) || 3000;

// Load .env / .env.local (does not override real environment variables)
for (const f of ['.env', '.env.local']) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
}

const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2'
};

async function readBody(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) return undefined;
    return (req.headers['content-type'] || '').includes('application/json') ? JSON.parse(raw) : raw;
}

function shim(res) {
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (obj) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); return res; };
    res.send = (body) => { res.end(typeof body === 'object' && !Buffer.isBuffer(body) ? JSON.stringify(body) : body); return res; };
    return res;
}

async function handleApi(req, res, pathname) {
    const name = pathname.replace(/^\/api\//, '').replace(/\/$/, '');
    const file = path.join(apiDir, name + '.js');
    if (!name || name.includes('..') || !file.startsWith(apiDir) || !fs.existsSync(file)) {
        return shim(res).status(404).json({ error: 'Not found' });
    }
    try {
        req.body = await readBody(req);
        // cache-bust by mtime so edits to api files are picked up without restarting
        const mod = await import(pathToFileURL(file).href + '?v=' + fs.statSync(file).mtimeMs);
        await mod.default(req, shim(res));
    } catch (err) {
        console.error(`[api/${name}]`, err);
        if (!res.headersSent) shim(res).status(500).json({ error: err.message || 'Internal error' });
    }
}

function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    let file = path.join(publicDir, rel);
    if (!file.startsWith(publicDir)) { res.statusCode = 403; return res.end('Forbidden'); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        // extensionless URLs fall back to the app shell
        if (path.extname(rel)) { res.statusCode = 404; return res.end('Not found'); }
        file = path.join(publicDir, 'index.html');
    }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(file).pipe(res);
}

http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    const t = Date.now();
    res.on('finish', () => console.log(`${req.method} ${pathname} ${res.statusCode} ${Date.now() - t}ms`));
    if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);
    serveStatic(req, res, pathname);
}).listen(PORT, () => {
    console.log(`\n  Bill Manager dev server\n  → http://localhost:${PORT}\n`);
});
