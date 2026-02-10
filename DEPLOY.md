Vercel deployment + backend options

Quick steps to deploy this app with persistent, small-text storage.

1) Install dependencies for local development (optional):

```bash
npm init -y
npm install @vercel/kv @supabase/supabase-js
```

1) Vercel (dashboard):
   - In Vercel, Import Project → choose `saketh-005/bill_manager`.
   - Deploy the project. The `api/` folder will be deployed as serverless functions.

2) Choose a backend option:

- Vercel KV (if available): install KV integration in Vercel Marketplace and bind it to the project. The existing `api/state.js` will work with KV.
- Supabase (recommended for structured data / SQL): follow the Supabase steps below and use the Supabase-backed API included in this repo.
- Local only: `localStorage` — no backend required.

1) Supabase setup (if you choose Supabase):

  a) Create a Supabase project at <https://app.supabase.com/>

  b) In the SQL editor, run:

```sql
create table app_state (
  id text primary key,
  payload jsonb
);

insert into app_state (id, payload) values ('main', jsonb_build_object('bills', '[]'::jsonb, 'inventory', '[]'::jsonb, 'stockHistory', '[]'::jsonb)) on conflict do nothing;
```

  c) In Project Settings → API, copy the `URL` and the **service_role** key. Add these to Vercel Project Environment Variables:

- `SUPABASE_URL` = your Supabase project URL
- `SUPABASE_SERVICE_KEY` = your Supabase service_role key

  d) Redeploy the Vercel project. The serverless API at `/api/state` will read/write the single `app_state` row.

Notes:

- Keep the `SUPABASE_SERVICE_KEY` secret and only set it in Vercel's project settings (server-side only).
- Supabase gives you SQL access and a free tier suitable for small apps.

If you want, I can also add an optional `x-api-key` check to the API to limit access to authorized requests.

API protection (recommended)

1. In Vercel Project → Settings → Environment Variables add an `API_KEY` (mark as secret). Use a long random string.
2. The server API will require a request header `x-api-key: <API_KEY>` for POST requests to `/api/state`.
3. Example fetch from client (if you must):

```js
fetch('/api/state', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': '<YOUR_API_KEY>' },
  body: JSON.stringify(state)
});
```

If `API_KEY` is not set, the API will allow writes (not recommended for public deployments).
