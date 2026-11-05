# Bill Manager - BALAJI SAI AUTO MOBILES

A comprehensive web-based bill management system with inventory tracking and stock management features.

## Features

### 📄 Bill Management

- Create new bills with automatic invoice numbering
- Add customer details (name, phone, address, transport)
- Add multiple items per bill with quantity and rates
- Automatic calculation of total amounts
- View detailed bill information
- Export bills to CSV format
- Print-friendly bill view
- Delete bills with confirmation

### 📦 Inventory Management

- Add new items with item code, name, rate, and description
- Track current stock levels for each item
- Edit existing inventory items
- Delete items from inventory
- Export inventory to CSV format
- Automatic stock updates when bills are created

### 📊 Stock Management (Optional Feature)

- Three stock operations:
  - **Add Stock**: Increase inventory
  - **Remove Stock**: Decrease inventory
  - **Set Stock**: Set absolute stock level
- Track stock changes with reasons/notes
- Complete stock history with timestamps
- View last 50 stock transactions
- Export stock history to CSV format
- Automatic stock tracking from bill creation

## Technology Stack

- **HTML5**: Structure and layout
- **CSS3**: Modern, responsive styling
- **JavaScript (Vanilla)**: Application logic
- **Vercel functions + a private GitHub repo**: login and data storage (see below); the browser keeps an offline copy

## Run locally

```bash
cp .env.example .env   # set APP_USERNAME / APP_PASSWORD (leave the GitHub values empty for local work)
npm run dev            # http://localhost:3000  (PORT=4000 npm run dev to change)
npm run dev:mock       # same, but talks to an in-memory fake GitHub API (tests the real storage code)
npm run test:store     # self-check of the storage layer
```

`npm run dev` starts a small dependency-free server (`scripts/dev.mjs`) that serves `public/` and runs the
functions in `api/` the same way Vercel does (try `http://localhost:3000/api/health`). Secrets go in `.env` (git-ignored).
Without `GITHUB_TOKEN`/`GITHUB_REPO`, data is kept in a local `.data/` folder so you can develop offline.

## Project layout

```
public/    static frontend (index.html, app.js, ui.js, styles.css, ...)
api/       serverless functions (Vercel): /api/login, /api/logout, /api/me, /api/state, /api/save, /api/health
lib/       session cookies, GitHub / local-folder storage backends, data sharding + merge logic
public/sync.js   sign-in screen logic, loading, diff-based saving, offline queue, sync status pill
scripts/   dev server, GitHub API mock for tests
vercel.json
```

## Deploy to Vercel

Import the repo in Vercel (or run `vercel`). No build step; `public/` is served as static files and `api/` as functions.

> **Storage:** data is saved as JSON files in a **private GitHub repository** by the server functions. Set the
> environment variables listed in `DEPLOY.md` (website login + GitHub token + repo) before the first deploy.

## Installation

1. Clone or download this repository to your computer
2. No installation required - it's a standalone web application!
3. Simply open `index.html` in any modern web browser

```bash
# If you have the files, just open:
open index.html  # macOS
start index.html # Windows
xdg-open index.html # Linux
```

## Usage

### Creating a Bill

1. Click on **"Bills"** tab in the navigation
2. Click **"+ New Bill"** button
3. Fill in the invoice details (invoice number is auto-generated)
4. Enter customer information
5. Click **"+ Add Item"** to add items
   - Select from existing inventory items, or
   - Choose "Custom Item" to enter manually
6. Items from inventory will auto-fill rate and deduct stock
7. Review the total amount
8. Click **"Save Bill"** to create the bill

### Managing Inventory

1. Click on **"Inventory"** tab
2. Click **"+ Add Item"** button
3. Enter item details:
   - Item Name (required)
   - Item Code (auto-generated if not provided)
   - Unit Rate (required)
   - Current Stock (optional)
   - Description (optional)
4. Click **"Add Item"** to save
5. Use **Edit** to modify items or **Delete** to remove them

### Stock Management

1. Click on **"Stock Management"** tab
2. Select an item from the dropdown
3. Choose action:
   - **Add Stock**: For purchases or restocking
   - **Remove Stock**: For sales, damages, or adjustments
   - **Set Stock**: To set exact stock level
4. Enter quantity
5. Add a reason/note (optional)
6. Click **"Update Stock"**
7. View complete history in the table below

### Exporting Data

- **Export Bills**: Click "📥 Export Bills" button in Bills section
- **Export Inventory**: Click "📥 Export Inventory" button in Inventory section
- **Export Stock History**: Click "📥 Export History" button in Stock Management section

All exports are in CSV format and can be opened in Excel or Google Sheets.

## Data Storage

Records are committed to a private GitHub repository (one commit per change, so the git history is also an audit trail):

```
data/meta.json                     counters, opening stock
data/inventory.json                all items
data/bills/2026-27/2026-11.json    one file per month and financial year
data/purchases/...  data/stock-history/...
```

The app loads the current and previous financial year on start; older years load on demand (sync status pill -> *Load older years*).
Changes made offline or during an outage are kept on the device and uploaded automatically once the connection is back.
See `DEPLOY.md` for the setup.

## Future Enhancements

Potential features for future versions:

- 📱 Offline PWA support
- 🔐 Multi-user support with authentication
- ☁️ Cloud backup and sync
- 📊 Analytics and reports
- 💳 Payment tracking
- 📧 Email bills to customers
- 🖨️ PDF export
- 📱 Mobile app version

## Troubleshooting

### Data Not Saving

- Look at the status pill in the top bar: *Saved* means the change is in the GitHub repo; *Not saved (n)* means n changes are waiting for a connection and will upload automatically
- If it says *Save error*, click the pill for the message (usually an expired or mis-scoped `GITHUB_TOKEN`)
- Check the browser console and the Vercel function logs

### Items Not Showing in Bill Form

- Make sure you've added items to Inventory first
- Refresh the page

### Export Not Working

- Ensure you have data to export
- Check if browser blocks downloads
- Try a different browser

## License

Free to use and modify for personal and commercial purposes.

## Support

For issues or questions, please check:

- Browser console for error messages
- Ensure JavaScript is enabled
- Try incognito/private mode to rule out extensions

---

**Created for BALAJI SAI AUTO MOBILES**  
*A simple, efficient, and powerful bill management solution*
