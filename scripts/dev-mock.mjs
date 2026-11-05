// `npm run dev:mock` - runs the dev server against an in-memory fake GitHub API (to try the real GitHub code path offline)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const mock = spawn(process.execPath, [path.join(here, 'mock-github.mjs'), '4010'], { stdio: 'inherit' });
await new Promise(r => setTimeout(r, 500));
const dev = spawn(process.execPath, [path.join(here, 'dev.mjs')], { stdio: 'inherit', env: { ...process.env, GITHUB_API_URL: 'http://localhost:4010', GITHUB_REPO: 'mock/data', GITHUB_TOKEN: 'testtoken' } });
const stop = () => { mock.kill(); dev.kill(); process.exit(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop); dev.on('exit', stop);
