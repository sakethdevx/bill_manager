# Bill Manager Deployment Guide

Quick steps to deploy this app with persistent, small-text storage.

1) Install dependencies for local development (optional):

```bash
npm init -y
npm install @vercel/kv @supabase/supabase-js
```

1) Vercel (dashboard):
   - In Vercel, Import Project → choose `saketh-005/bill_manager`.
   - Deploy the project. The `api/` folder will be deployed as serverless functions.

## Deploying Bill Manager (current implementation)

 This project uses a static client served on Vercel plus two serverless endpoints in `/api/` backed by Supabase (Postgres). The client authenticates with Supabase Auth (anon key) and persists app state to a single `app_state` row via the server API.

 Quick checklist

- Create a Supabase project
- Create the `app_state` table and seed a `main` row
- Add required environment variables to Vercel
- Push to GitHub and import the repo into Vercel

 1) Supabase setup

 a) Create a Supabase project at <https://app.supabase.com/>

 b) In the Supabase SQL editor run the minimal schema:

 ```sql
 create table if not exists public.app_state (
   id text primary key,
   payload jsonb
 );

 insert into public.app_state (id, payload)
 values ('main', jsonb_build_object('bills', '[]'::jsonb, 'inventory', '[]'::jsonb, 'stockHistory', '[]'::jsonb))
 on conflict (id) do nothing;
 ```

 c) (Optional) Enable Email/Password auth if you want to create users. The app expects you to create users in the Supabase dashboard for single-user login (no signup UI).

 1) Vercel environment variables (required)

 Set these in your Vercel project (Environment → Project Variables). Use the **service role** key only for server-side variables.

- `SUPABASE_URL` — your Supabase project URL (public)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon/public key (client-side)
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase **service_role** key (server-side only)
- `API_KEY` — a long random secret used by server to gate POST writes (recommended)

 Notes:

- `SUPABASE_SERVICE_ROLE_KEY` must remain secret; never expose it to the browser.
- The repo's serverless `/api/state` implementation accepts writes if the request contains either:
  - `x-api-key: <API_KEY>` header matching the Vercel secret, OR
  - `Authorization: Bearer <access_token>` with a valid Supabase user token.

 1) API endpoints

- `/api/config` — returns public values used by the client (`SUPABASE_URL` and anon key). The client loads this on startup and constructs the Supabase client.
- `/api/state` — GET returns the full app state (bills, inventory, stockHistory). POST upserts the JSON payload into the `app_state` row. POSTs require either `x-api-key` or a Supabase bearer token.

 1) Client behavior

- The client (see `supabase-config.js`) fetches `/api/config` to bootstrap the Supabase client with the anon key.
- After sign-in the client calls `/api/state` with an `Authorization: Bearer <token>` header so the server validates the user before persisting.

 1) Deploying

- Push your code to GitHub (this repo). In Vercel: Import Project → choose your GitHub repo → Deploy.
- Ensure Vercel environment variables (above) are set before deploying so server functions can access Supabase.

 1) Security & best practices

- Use `API_KEY` to protect write access to `/api/state` if you are not relying on Supabase user tokens.
- Rotate the service role key if it was ever committed or exposed.
- For production, consider implementing Supabase Row Level Security (RLS) and a dedicated table structure instead of a single JSON row.

 1) Troubleshooting

- If `/api/state` returns an error about missing table, confirm the `app_state` table exists and that `SUPABASE_SERVICE_ROLE_KEY` is set in Vercel.
- If client login does not work, verify `NEXT_PUBLIC_SUPABASE_ANON_KEY` is set and that the user exists in Supabase Auth (created manually via dashboard).

 1) Example client POST (when using `API_KEY`)

 ```js
 await fetch('/api/state', {
   method: 'POST',
   headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.API_KEY },
   body: JSON.stringify({ bills, inventory, stockHistory })
 });
 ```

 If you'd like, I can add a tiny health-check endpoint, scheduled export job, or a one-click DB export button.
