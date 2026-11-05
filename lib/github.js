// Storage backend #1: a private GitHub repository, written with the Git Data API so that
// several files change in ONE atomic commit.  The token never leaves the server.
const MODE = '100644';
const blobCache = new Map();          // blob sha -> text  (blobs are immutable, safe to keep)
let treeCache = null;                 // { head, treeSha, files }

function cfg() {
    const token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPO;
    if (!token || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
    return { token, repo, branch: process.env.GITHUB_BRANCH || 'main', api: (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '') };
}
export const githubConfigured = () => !!cfg();

async function gh(method, path, body) {
    const c = cfg();
    const res = await fetch(c.api + path, {
        method,
        headers: {
            Authorization: `Bearer ${c.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'bill-manager', ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    if (!res.ok) {
        const err = new Error(`GitHub ${method} ${path.split('?')[0]} -> ${res.status} ${(data && data.message) || text.slice(0, 160)}`);
        err.status = res.status; throw err;
    }
    return data;
}

async function headCommit() {
    const c = cfg();
    try { return await gh('GET', `/repos/${c.repo}/commits/${encodeURIComponent(c.branch)}`); }
    catch (e) { if (e.status === 404 || e.status === 409) return null; throw e; }   // empty repo / missing branch
}

export async function head() {
    const k = await headCommit(); return k ? k.sha : null;
}

export async function snapshot() {
    const c = cfg();
    const k = await headCommit();
    if (!k) return { head: null, files: new Map(), treeSha: null };
    if (treeCache && treeCache.head === k.sha) return { head: k.sha, files: treeCache.files, treeSha: treeCache.treeSha };
    const t = await gh('GET', `/repos/${c.repo}/git/trees/${k.commit.tree.sha}?recursive=1`);
    if (t.truncated) throw new Error('Data repository is too large to list');
    const files = new Map();
    (t.tree || []).forEach(e => { if (e.type === 'blob' && e.path.startsWith('data/')) files.set(e.path, e.sha); });
    treeCache = { head: k.sha, treeSha: k.commit.tree.sha, files };
    return { head: k.sha, files, treeSha: k.commit.tree.sha };
}

export async function read(path, sha) {
    if (blobCache.has(sha)) return blobCache.get(sha);
    const c = cfg();
    const b = await gh('GET', `/repos/${c.repo}/git/blobs/${sha}`);
    const text = Buffer.from(b.content, b.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
    if (blobCache.size > 400) blobCache.delete(blobCache.keys().next().value);
    blobCache.set(sha, text);
    return text;
}

// changes: Map<path, string|null>   (null = delete).  Throws err.code === 'CONFLICT' if the branch moved.
export async function commit(snap, changes, message) {
    const c = cfg();
    let base = snap, entries = [...changes.entries()];
    if (!snap.head) {
        // brand-new empty repository: the Contents API can create the very first commit
        const [p, text] = entries.find(([, t]) => t != null) || [];
        if (!p) return { head: null };
        await gh('PUT', `/repos/${c.repo}/contents/${p.split('/').map(encodeURIComponent).join('/')}`,
            { message, content: Buffer.from(text, 'utf8').toString('base64'), branch: c.branch });
        entries = entries.filter(([q]) => q !== p);
        base = await snapshot();
        if (!entries.length) return { head: base.head };
    }
    const tree = await Promise.all(entries.map(async ([path, text]) => {
        if (text == null) return { path, mode: MODE, type: 'blob', sha: null };
        const b = await gh('POST', `/repos/${c.repo}/git/blobs`, { content: text, encoding: 'utf-8' });
        blobCache.set(b.sha, text);
        return { path, mode: MODE, type: 'blob', sha: b.sha };
    }));
    const t = await gh('POST', `/repos/${c.repo}/git/trees`, { base_tree: base.treeSha, tree });
    const k = await gh('POST', `/repos/${c.repo}/git/commits`, { message, tree: t.sha, parents: [base.head] });
    try {
        await gh('PATCH', `/repos/${c.repo}/git/refs/heads/${encodeURIComponent(c.branch)}`, { sha: k.sha, force: false });
    } catch (e) {
        if (e.status === 422 || e.status === 409) { const err = new Error('Branch moved'); err.code = 'CONFLICT'; throw err; }
        throw e;
    }
    return { head: k.sha };
}
