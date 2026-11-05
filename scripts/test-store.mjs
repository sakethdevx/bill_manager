// Quick self-check of the storage layer against the in-memory GitHub mock:  npm run test:store
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const mock = spawn(process.execPath, [path.join(here, 'mock-github.mjs'), '4011'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
Object.assign(process.env, { GITHUB_API_URL: 'http://localhost:4011', GITHUB_REPO: 'o/r', GITHUB_TOKEN: 'testtoken' });
const { applyChanges, loadState } = await import('../lib/store.js');
const E = { upserts: [], removes: [] };
try {
    await applyChanges({ bills: { upserts: [{ id: 'b1', invoiceNo: '001', date: '2026-11-03', timestamp: '2026-11-03T10:00:00Z' }], removes: [] }, purchases: E, stockHistory: E, inventory: E, meta: {} });
    const s = await loadState();
    if (s.state.bills.length !== 1 || s.state.meta.maxInvoiceNo !== 1) throw new Error('round trip failed');
    console.log('storage layer OK (commit + reload through the GitHub API mock)');
} catch (e) { console.error('FAILED', e); process.exitCode = 1; }
mock.kill();
