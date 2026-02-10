Vercel deployment + Vercel KV setup

Quick steps to deploy this app with persistent, small-text storage using Vercel KV:

1. Install dependencies for local development (optional):

```bash
npm init -y
npm install @vercel/kv
```

1. Create a Vercel project (connect to this repo) and add a Vercel KV instance:
   - In the Vercel Dashboard, go to your project → "Integrations" → add "KV" (or search "KV").
   - Bind the KV instance to your project following the dashboard steps. Vercel will make the KV available to serverless functions.

2. Environment / local dev:
   - For local testing with Vercel CLI, follow Vercel's docs to configure KV locally (you may need to set `VERCEL_KV_REST_URL` / `VERCEL_KV_REST_TOKEN` or use `vercel dev` which provides bindings).

3. How it works in this repo:
   - `api/state.js` exposes a simple GET/POST API backed by Vercel KV key `bill_manager_state`.
   - The client (`app.js`) fetches `/api/state` on load and POSTs the full state to `/api/state` when saving.

4. Deploy:
   - Push your branch and deploy from the Vercel dashboard, or run:

```bash
vercel --prod
```

Notes / alternatives:

- If you prefer SQL-like queries or relational features, use Supabase (Postgres) instead.
- For a single-device, zero-backend option, `localStorage` is still the easiest choice.
