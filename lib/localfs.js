// Storage backend #2 (development only): a plain folder, .data/, with the same interface as the
// GitHub backend, so `npm run dev` works without any GitHub setup.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = () => path.resolve(process.env.BM_DATA_DIR || path.join(process.cwd(), '.data'));
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
let lock = Promise.resolve();

function walk(dir, base, out) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name), rel = base ? base + '/' + e.name : e.name;
        if (e.isDirectory()) walk(full, rel, out); else out.set(rel, full);
    }
}
function scan() {
    const found = new Map(); walk(path.join(root(), 'data'), 'data', found);
    const files = new Map();
    for (const [rel, full] of found) files.set(rel, sha1(fs.readFileSync(full)));
    const head = files.size ? sha1([...files].sort().map(([p, s]) => p + ':' + s).join('\n')) : null;
    return { head, files };
}

export async function head() { return scan().head; }
export async function snapshot() { return scan(); }
export async function read(p) { return fs.readFileSync(path.join(root(), p), 'utf8'); }
export async function commit(snap, changes) {
    const run = lock.then(() => {
        if (scan().head !== snap.head) { const e = new Error('Data changed'); e.code = 'CONFLICT'; throw e; }
        for (const [p, text] of changes) {
            const full = path.join(root(), p);
            if (text == null) { fs.rmSync(full, { force: true }); continue; }
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, text);
        }
        return { head: scan().head };
    });
    lock = run.catch(() => { });
    return run;
}
