// Tiny in-memory imitation of the parts of the GitHub REST API that lib/github.js uses.
// Used by tests:  node scripts/mock-github.mjs [port]     then  GITHUB_API_URL=http://localhost:<port> GITHUB_REPO=o/r GITHUB_TOKEN=testtoken
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.argv[2] || process.env.MOCK_PORT) || 4010;
const TOKEN = process.env.MOCK_TOKEN || 'testtoken';
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const blobs = new Map(), trees = new Map(), commits = new Map();
let headSha = null;
const stats = { requests: 0, commits: 0, conflicts: 0 };
let failNext = 0;

const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const newTree = (map) => { const sha = sha1(JSON.stringify([...map].sort())); trees.set(sha, new Map(map)); return sha; };
function makeCommit(treeSha, parents, message) {
    const sha = sha1(treeSha + parents.join() + message + Math.random());
    commits.set(sha, { tree: treeSha, parents, message }); stats.commits++; return sha;
}

http.createServer(async (req, res) => {
    stats.requests++;
    const url = new URL(req.url, 'http://x');
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    const p = url.pathname;
    if (p === '/__stats') return send(res, 200, { ...stats, head: headSha });
    if (p === '/__fail') { failNext = Number(url.searchParams.get('n') || 1); return send(res, 200, { failNext }); }
    if (p === '/__inject') {                       // simulate another device committing: set <path> to <content>
        const base = headSha ? new Map(trees.get(commits.get(headSha).tree)) : new Map();
        const bsha = sha1(body.content); blobs.set(bsha, body.content); base.set(body.path, bsha);
        headSha = makeCommit(newTree(base), headSha ? [headSha] : [], 'injected'); return send(res, 200, { head: headSha });
    }
    if (p === '/__dump') { const t = headSha ? trees.get(commits.get(headSha).tree) : new Map(); const out = {}; for (const [k, v] of t) out[k] = blobs.get(v); return send(res, 200, { head: headSha, files: out }); }
    if ((req.headers.authorization || '') !== `Bearer ${TOKEN}`) return send(res, 401, { message: 'Bad credentials' });
    if (failNext > 0) { failNext--; return send(res, 502, { message: 'Bad gateway (simulated)' }); }

    let m;
    if ((m = p.match(/^\/repos\/([^/]+)\/([^/]+)\/(.*)$/))) {
        const rest = m[3];
        if (rest.startsWith('commits/') && req.method === 'GET') {
            if (!headSha) return send(res, 409, { message: 'Git Repository is empty.' });
            return send(res, 200, { sha: headSha, commit: { tree: { sha: commits.get(headSha).tree } } });
        }
        if ((m = rest.match(/^git\/trees\/([0-9a-f]+)$/)) && req.method === 'GET') {
            const t = trees.get(m[1]); if (!t) return send(res, 404, { message: 'Not Found' });
            return send(res, 200, { sha: m[1], truncated: false, tree: [...t].map(([path, sha]) => ({ path, mode: '100644', type: 'blob', sha })) });
        }
        if ((m = rest.match(/^git\/blobs\/([0-9a-f]+)$/)) && req.method === 'GET') {
            if (!blobs.has(m[1])) return send(res, 404, { message: 'Not Found' });
            return send(res, 200, { sha: m[1], encoding: 'base64', content: Buffer.from(blobs.get(m[1])).toString('base64') });
        }
        if (rest === 'git/blobs' && req.method === 'POST') {
            const sha = sha1(body.content); blobs.set(sha, body.content); return send(res, 201, { sha });
        }
        if (rest === 'git/trees' && req.method === 'POST') {
            const base = body.base_tree ? new Map(trees.get(body.base_tree)) : new Map();
            body.tree.forEach(e => { if (e.sha == null) base.delete(e.path); else base.set(e.path, e.sha); });
            return send(res, 201, { sha: newTree(base) });
        }
        if (rest === 'git/commits' && req.method === 'POST') {
            return send(res, 201, { sha: makeCommit(body.tree, body.parents, body.message) });
        }
        if (rest.startsWith('git/refs/heads/') && req.method === 'PATCH') {
            const c = commits.get(body.sha); if (!c) return send(res, 422, { message: 'Object does not exist' });
            if (headSha && c.parents[0] !== headSha) { stats.conflicts++; return send(res, 422, { message: 'Update is not a fast forward' }); }
            headSha = body.sha; return send(res, 200, { object: { sha: headSha } });
        }
        if (rest.startsWith('contents/') && req.method === 'PUT') {
            if (headSha) return send(res, 422, { message: 'repo not empty (mock)' });
            const path = decodeURIComponent(rest.slice('contents/'.length));
            const text = Buffer.from(body.content, 'base64').toString('utf8'); const bsha = sha1(text); blobs.set(bsha, text);
            headSha = makeCommit(newTree(new Map([[path, bsha]])), [], body.message);
            return send(res, 201, { commit: { sha: headSha } });
        }
    }
    send(res, 404, { message: 'Not Found (mock): ' + req.method + ' ' + p });
}).listen(PORT, () => console.log(`mock GitHub on http://localhost:${PORT}`));
