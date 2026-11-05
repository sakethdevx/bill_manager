import * as github from './github.js';
import * as localfs from './localfs.js';
import { githubConfigured } from './github.js';

export function backend() {
    if (githubConfigured()) return github;
    if (!process.env.VERCEL && process.env.NODE_ENV !== 'production') return localfs;   // local development
    const e = new Error('Storage is not configured (set GITHUB_TOKEN and GITHUB_REPO)'); e.code = 'NO_STORAGE'; throw e;
}
export const backendName = () => githubConfigured() ? 'github' : 'local folder (.data/)';
