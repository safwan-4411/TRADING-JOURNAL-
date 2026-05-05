# LEDGR Supabase Setup — one-time steps

Follow these **in order**. Takes ~5 minutes.

## 1. Run the SQL schema

In your Supabase dashboard → **SQL Editor** → **New query** → paste this whole block → click **Run**.

```sql
-- ===== LEDGR schema =====
create table if not exists public.accounts (
  account_id   text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  type         text not null default 'CUSTOM',
  created_at   timestamptz not null default now()
);
create index if not exists accounts_user_idx on public.accounts(user_id);

create table if not exists public.trades (
  trade_id     text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  account_id   text,
  market       text,
  instrument   text,
  trade_type   text,
  entry_price  numeric,
  exit_price   numeric,
  lot_size     numeric,
  strike_price text,
  notes        text,
  profit       numeric,
  multiplier   numeric,
  created_at   timestamptz not null default now()
);
create index if not exists trades_user_idx on public.trades(user_id);
create index if not exists trades_acct_idx on public.trades(account_id);

create table if not exists public.journal (
  entry_id     text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  title        text not null,
  content      text not null,
  entry_date   date not null,
  created_at   timestamptz not null default now()
);
create index if not exists journal_user_idx on public.journal(user_id);

create table if not exists public.custom_instruments (
  instrument_id text primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  market        text not null,
  symbol        text not null,
  multiplier    numeric not null,
  created_at    timestamptz not null default now()
);
create index if not exists cinst_user_idx on public.custom_instruments(user_id);

-- ===== Row Level Security =====
alter table public.accounts            enable row level security;
alter table public.trades              enable row level security;
alter table public.journal             enable row level security;
alter table public.custom_instruments  enable row level security;

-- Owners can do everything on their own rows
drop policy if exists "own rows"      on public.accounts;
drop policy if exists "own rows"      on public.trades;
drop policy if exists "own rows"      on public.journal;
drop policy if exists "own rows"      on public.custom_instruments;

create policy "own rows" on public.accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.trades
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.journal
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.custom_instruments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

## 2. Enable Google sign-in

Supabase dashboard → **Authentication → Providers → Google** → toggle **Enable**.

You have two options:

**Option A — Use Supabase's managed Google (easiest, zero setup):**
Just flip the "Enable Sign in with Google" toggle. Supabase uses its own Google app — works immediately. *(This may show a Supabase-branded consent screen.)*

**Option B — Use your own Google OAuth credentials (branded):**
1. Go to https://console.cloud.google.com → create a new project
2. **APIs & Services → OAuth consent screen** → External → fill app name → Save
3. **APIs & Services → Credentials → Create Credentials → OAuth Client ID**
   - Application type: **Web application**
   - Authorized redirect URI: `https://tulfelapbujixfcuaoyv.supabase.co/auth/v1/callback`
4. Copy **Client ID** and **Client Secret** → paste them into Supabase Google provider → **Save**.

## 3. Set your Site URL & Redirect URLs

Supabase dashboard → **Authentication → URL Configuration**.

- **Site URL:** `https://safwan-4411.github.io/TRADING-JOURNAL-/`
- **Redirect URLs:** add every URL where the app will run, one per line:
  ```
  https://safwan-4411.github.io/TRADING-JOURNAL-/
  https://safwan-4411.github.io/TRADING-JOURNAL-/**
  http://localhost:8000
  http://localhost:8000/**
  ```

## 4. Done

Open `index.html`. Click **Continue with Google** on the landing page. You're in and your data syncs across every device you sign in from.

---

### Troubleshooting

| Problem | Fix |
|---|---|
| "Invalid API key" | URL and anon key must be from the **same project**. Re-copy both from Settings → API. |
| "redirect_uri_mismatch" | Add the exact URL (including trailing paths) to Authentication → URL Configuration → Redirect URLs. |
| Signed in but data isn't syncing | Check that all 4 tables exist and RLS is enabled (run the SQL again, it's idempotent). |
| Stuck on callback page | Supabase sends you back with `#access_token=...` in the URL; make sure you're opening `index.html` via http(s) — file:// origins sometimes break OAuth. |
