# LEDGR — Trading Journal (Static Build)

A fully offline, pure **HTML + CSS + JavaScript** trading journal. No server, no database, no signup. All your data lives in your browser's `localStorage`.

## What's in this folder
- `index.html` — the app shell (open this file to use)
- `styles.css` — dark-mode styling
- `app.js` — all logic (routing, data layer, profit calc, UI rendering)

## How to run locally
Just double-click `index.html` — it opens in your browser.

> Tip: for best performance, serve it over a local web server:
> ```
> # Python 3
> python3 -m http.server 8000
> # then open http://localhost:8000
> ```

## How to deploy (any static host works)

### Netlify (drag & drop)
1. Go to https://app.netlify.com/drop
2. Drag this whole folder onto the page → done, you get a live URL.

### GitHub Pages
1. Create a new repo, upload these three files to the root.
2. Settings → Pages → Source: `main` branch, root folder → Save.
3. Your site lives at `https://<username>.github.io/<repo>/`.

### Vercel
1. `vercel login` then `vercel` in this folder → accept defaults.

### Hostinger / cPanel / any shared hosting
1. Upload the three files (`index.html`, `styles.css`, `app.js`) via FTP/File Manager into `public_html/` (or a subfolder).
2. Visit the URL.

## Features
- Multi-account (Demo / Real / Custom) with switcher in nav
- Markets: **Indian** (NIFTY, BANKNIFTY, SENSEX, FINNIFTY, MIDCPNIFTY, BANKEX — multiplier ×1, you enter total quantity) and **Forex/Crypto** (XAUUSD, XAGUSD, 10 forex pairs, BTCUSD, ETHUSD — with proper multipliers)
- Strike price (text, e.g. "22500 CE") for Indian trades
- Add custom instruments with your own multiplier
- Auto profit calc, green for profit / red for loss, latest first
- Trade history filters (instrument, date range) + running total
- Monthly heatmap calendar + daily breakdown
- Journal: daily entries + per-trade notes
- Dashboard stats: total P&L, win rate, best/worst day, last-14-day chart, per-instrument breakdown
- **Backup & restore** via JSON export/import (Settings → Data)
- Reset-all option

## Data storage
Everything is saved in `localStorage` under these keys:
- `ledgr_accounts`
- `ledgr_trades`
- `ledgr_journal`
- `ledgr_custom_instruments`
- `ledgr_active_account`

**Clearing your browser data will wipe the journal.** Use Settings → Data → "Download backup" periodically.

## Profit formula
`profit = (exit − entry) × lot/qty × multiplier`, inverted for SELL.

- Indian: multiplier = 1, so profit = (exit − entry) × total quantity
- Forex pairs: multiplier = 100,000
- XAUUSD: 100, XAGUSD: 5,000
- BTCUSD / ETHUSD: 1

---
Built as a minimal, local-first alternative to heavy trading-journal SaaS.
