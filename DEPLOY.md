# Deploying Bill Manager (Vercel + private GitHub data repo)

The website and API run on Vercel. Your data lives in a **separate, private GitHub repository** (it can belong to a
different GitHub account). Only the Vercel functions can reach it, using a token kept in environment variables.

## 1. Create the data repository

On the GitHub account that should hold the data:

1. **New repository** -> name e.g. `bill-manager-data` -> **Private** -> tick **Add a README file** -> Create.
2. Keep 2-factor authentication on for that account.

## 2. Create an access token (limited to that one repo)

On the same account: *Settings -> Developer settings -> Personal access tokens -> Fine-grained tokens -> Generate new token*

- **Repository access:** *Only select repositories* -> pick `bill-manager-data`
- **Permissions -> Repository permissions:** **Contents: Read and write** (nothing else is needed)
- **Expiration:** the longest allowed (1 year). Put a reminder in your calendar to create a new token and replace
  `GITHUB_TOKEN` in Vercel before it expires - saving stops working when it does.
- Copy the token (starts with `github_pat_`).

## 3. Environment variables (Vercel -> Project -> Settings -> Environment Variables)

| Name | Value |
|---|---|
| `APP_USERNAME` | the login name / email you will type on the sign-in page |
| `APP_PASSWORD` | the password (use a long one) |
| `SESSION_SECRET` | any random 32+ characters (`openssl rand -hex 32`) - signs the login cookie |
| `GITHUB_TOKEN` | the token from step 2 |
| `GITHUB_REPO` | `owner/name`, e.g. `my-shop-account/bill-manager-data` |
| `GITHUB_BRANCH` | `main` (optional, default `main`) |

Add them for *Production* (and *Preview* if you use previews), then **redeploy** so the functions see them.
Changing `SESSION_SECRET` or the password signs everybody out.

## 4. Deploy

Import the code repo in Vercel (no build command, output is `public/`). Open the site, sign in, and the first save
creates `data/…` in the data repo.

### Bringing over data you already entered in the browser

If the data repo is empty and this browser still holds the old local data, the app asks *"Upload the data stored in
this browser?"* right after sign-in. Say yes once; the old copy is kept under `bm_demo_state_uploaded` in the
browser's storage as a safety copy.

## How it behaves

- Every change is one commit in the data repo ("Bill 012", "Purchase PUR-0004", ...). The history is your audit trail and
  undo log; each commit also keeps the files consistent (a sale updates the bill, stock and stock log together).
- Two devices can work at once: changes are merged record by record. If both devices pick the same bill number, the
  second one is renumbered automatically and you are told.
- The pill in the top bar shows *Saved*, *Saving...* or *Not saved (n)*. Unsaved changes stay on the device and upload
  when the connection returns (also after a reload).
- Other devices pick up changes when you return to the tab (and once a minute).

## Local development

`cp .env.example .env`, set `APP_USERNAME` / `APP_PASSWORD`, leave `GITHUB_*` empty and run `npm run dev` - data is then
kept in `.data/`. `npm run dev:mock` runs against an in-memory fake GitHub API so the real GitHub code path can be tried
offline, and `npm run test:store` checks the storage layer.

## Not included yet

- Per-user logins and roles (the session already carries a role; routes check it).
- Cancelling bills instead of deleting them (a deleted bill remains in the git history of the data repo).
- Storing scanned bill photos (only the extracted values are saved).
