/* ============ LEDGR — static single-file app ============ */
// Data layer (localStorage) + router + views.

const PRESET = {
  INDIAN: { NIFTY: 1, BANKNIFTY: 1, SENSEX: 1, FINNIFTY: 1, MIDCPNIFTY: 1, BANKEX: 1 },
  FOREX: {
    XAUUSD: 100, XAGUSD: 5000,
    EURUSD: 100000, GBPUSD: 100000, USDJPY: 100000, AUDUSD: 100000,
    USDCAD: 100000, USDCHF: 100000, NZDUSD: 100000,
    EURGBP: 100000, EURJPY: 100000, GBPJPY: 100000,
    BTCUSD: 1, ETHUSD: 1,
  },
};

const LS = {
  get: (k, def) => { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function initData() {
  if (!LS.get("ledgr_accounts")) {
    LS.set("ledgr_accounts", [
      { account_id: uid("acc"), name: "Demo", type: "DEMO", created_at: new Date().toISOString() },
      { account_id: uid("acc"), name: "Real", type: "REAL", created_at: new Date().toISOString() },
    ]);
  }
  if (!LS.get("ledgr_trades")) LS.set("ledgr_trades", []);
  if (!LS.get("ledgr_journal")) LS.set("ledgr_journal", []);
  if (!LS.get("ledgr_custom_instruments")) LS.set("ledgr_custom_instruments", []);
  if (!LS.get("ledgr_active_account")) LS.set("ledgr_active_account", "ALL");
  if (!LS.get("ledgr_entered")) LS.set("ledgr_entered", false);
}

const getAccounts = () => LS.get("ledgr_accounts", []);
const getTrades = () => LS.get("ledgr_trades", []);
const getJournal = () => LS.get("ledgr_journal", []);
const getCustomInstruments = () => LS.get("ledgr_custom_instruments", []);
const getActiveAccount = () => LS.get("ledgr_active_account", "ALL");

/* ========== SUPABASE CLOUD SYNC ========== */
let supa = null;
let currentUser = null;
let cloudStatus = "offline"; // offline | syncing | synced | error

function initSupabase() {
  const cfg = window.LEDGR_SUPABASE || {};
  if (!cfg.url || !cfg.anon || !window.supabase) return;
  supa = window.supabase.createClient(cfg.url, cfg.anon, {
    auth: { detectSessionInUrl: true, persistSession: true, autoRefreshToken: true, flowType: "implicit" },
  });
}

function setCloudStatus(s) {
  cloudStatus = s;
  const el = document.getElementById("cloud-status");
  if (!el) return;
  const icons = {
    offline: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/><line x1="3" y1="3" x2="21" y2="21"/></svg>`,
    syncing: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,
    synced: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/><polyline points="9 14 11 16 15 12" stroke="currentColor"/></svg>`,
    error: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  };
  el.className = `cloud-status ${s}`;
  el.innerHTML = icons[s] || "";
  el.title = { offline: "Offline — local only", syncing: "Syncing...", synced: "Synced to cloud", error: "Sync error" }[s];
}

async function initAuth() {
  if (!supa) { setCloudStatus("offline"); return; }

  // Subscribe to auth changes FIRST before anything else
  supa.auth.onAuthStateChange(async (event, sess) => {
    const was = currentUser;
    currentUser = sess?.user || null;
    if (event === "SIGNED_IN" && !was) {
      await firstSignInSync();
      startRealtime();
      document.getElementById("landing").classList.add("hidden");
      document.getElementById("app").classList.remove("hidden");
      if (!location.hash || location.hash.includes("access_token")) location.hash = "#/dashboard";
    }
    if (event === "SIGNED_OUT") stopRealtime();
    updateUserBadge();
    renderRoute();
  });

  // Get current session
  const { data: { session } } = await supa.auth.getSession();
  currentUser = session?.user || null;

  // If token is in the URL hash (OAuth redirect), wait for Supabase to parse it
  // then poll for the session since onAuthStateChange may fire before we subscribed
  if (location.hash.includes("access_token")) {
    // Show loading state on landing
    document.getElementById("landing").classList.remove("hidden");
    document.getElementById("app").classList.add("hidden");
    const cta = document.getElementById("landing-cta-row");
    const topRight = document.getElementById("landing-nav-right");
    if (cta) cta.innerHTML = `<span class="muted small mono" id="auth-loading-msg">• Signing you in…</span>`;
    if (topRight) topRight.innerHTML = "";

    // Poll up to 4 seconds for Supabase to establish the session
    for (let i = 0; i < 8; i++) {
      await new Promise(r => setTimeout(r, 500));
      const { data: { session: s } } = await supa.auth.getSession();
      if (s?.user) {
        currentUser = s.user;
        await firstSignInSync();
        startRealtime();
        document.getElementById("landing").classList.add("hidden");
        document.getElementById("app").classList.remove("hidden");
        location.hash = "#/dashboard";
        updateUserBadge();
        renderRoute();
        return;
      }
    }
    // If still no session after 4s, show landing with buttons
    updateUserBadge();
    renderLandingCTA();
    return;
  }

  if (currentUser) {
    await pullAllFromCloud();
    startRealtime();
  }
  updateUserBadge();
}

async function signInGoogle() {
  if (!supa) return toast("Cloud sync not configured", "error");
  const redirect = "https://safwan-4411.github.io/TRADING-JOURNAL-/";
  const { error } = await supa.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: redirect },
  });
  if (error) toast(error.message, "error");
}
async function signOut() {
  if (!supa) return;
  await supa.auth.signOut();
  currentUser = null;
  updateUserBadge();
  toast("Signed out");
  renderRoute();
}

async function firstSignInSync() {
  if (!currentUser || !supa) return;
  setCloudStatus("syncing");
  try {
    const { count } = await supa.from("trades").select("*", { count: "exact", head: true });
    const hasLocal = getTrades().length > 0 || getJournal().length > 0 || getCustomInstruments().length > 0;
    if ((count || 0) === 0 && hasLocal) {
      await pushLocalToCloud();
      toast("Local data uploaded to cloud");
    } else {
      await pullAllFromCloud();
      toast("Cloud data loaded");
    }
    setCloudStatus("synced");
  } catch (e) {
    console.error(e);
    setCloudStatus("error");
    toast("Sync failed", "error");
  }
}

async function pullAllFromCloud() {
  if (!currentUser || !supa) return;
  setCloudStatus("syncing");
  try {
    const [accs, trades, jrnl, inst] = await Promise.all([
      supa.from("accounts").select("*").order("created_at"),
      supa.from("trades").select("*").order("created_at", { ascending: false }),
      supa.from("journal").select("*").order("created_at", { ascending: false }),
      supa.from("custom_instruments").select("*"),
    ]);
    if (accs.error || trades.error || jrnl.error || inst.error) throw new Error("Read failed");
    // Strip user_id from local copy (not needed client-side)
    LS.set("ledgr_accounts", accs.data.map(stripUserId));
    LS.set("ledgr_trades", trades.data.map(stripUserId));
    LS.set("ledgr_journal", jrnl.data.map(stripUserId));
    LS.set("ledgr_custom_instruments", inst.data.map(stripUserId));
    // Ensure at least one account exists
    if (getAccounts().length === 0) {
      const seed = [
        { account_id: uid("acc"), name: "Demo", type: "DEMO", created_at: new Date().toISOString() },
        { account_id: uid("acc"), name: "Real", type: "REAL", created_at: new Date().toISOString() },
      ];
      LS.set("ledgr_accounts", seed);
      await supa.from("accounts").upsert(seed.map((a) => ({ ...a, user_id: currentUser.id })));
    }
    setCloudStatus("synced");
  } catch (e) {
    console.error(e);
    setCloudStatus("error");
  }
}

async function pushLocalToCloud() {
  if (!currentUser || !supa) return;
  const uid_ = currentUser.id;
  const accs = getAccounts().map((a) => ({ ...a, user_id: uid_ }));
  const trades = getTrades().map((t) => ({ ...t, user_id: uid_ }));
  const jrnl = getJournal().map((j) => ({ ...j, user_id: uid_ }));
  const inst = getCustomInstruments().map((i) => ({ ...i, user_id: uid_ }));
  if (accs.length) await supa.from("accounts").upsert(accs);
  if (trades.length) await supa.from("trades").upsert(trades);
  if (jrnl.length) await supa.from("journal").upsert(jrnl);
  if (inst.length) await supa.from("custom_instruments").upsert(inst);
}

function stripUserId(o) { const { user_id, ...rest } = o; return rest; }

function withUser(obj) { return { ...obj, user_id: currentUser?.id }; }

async function cloudUpsert(table, row) {
  if (!currentUser || !supa) return;
  setCloudStatus("syncing");
  const { error } = await supa.from(table).upsert(withUser(row));
  setCloudStatus(error ? "error" : "synced");
  if (error) console.error("upsert", table, error);
}
async function cloudDelete(table, keyCol, keyVal) {
  if (!currentUser || !supa) return;
  setCloudStatus("syncing");
  const { error } = await supa.from(table).delete().eq(keyCol, keyVal);
  setCloudStatus(error ? "error" : "synced");
  if (error) console.error("delete", table, error);
}
async function cloudDeleteTradesByAccount(accountId) {
  if (!currentUser || !supa) return;
  await supa.from("trades").delete().eq("account_id", accountId);
}

function updateUserBadge() {
  const badge = document.getElementById("user-badge");
  if (!badge) return;
  const hasSupabase = !!(window.LEDGR_SUPABASE?.url && window.LEDGR_SUPABASE?.anon);

  if (!currentUser) {
    if (hasSupabase) {
      badge.classList.remove("hidden");
      badge.innerHTML = `
        <button class="header-signin" onclick="signInGoogle()">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.37-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          <span>Sign in to sync</span>
        </button>`;
      badge.onclick = null;
    } else {
      badge.classList.add("hidden");
    }
    renderLandingCTA();
    return;
  }
  badge.classList.remove("hidden");
  const u = currentUser;
  const name = u.user_metadata?.full_name || u.email?.split("@")[0] || "User";
  const pic = u.user_metadata?.avatar_url;
  const initial = (name[0] || "?").toUpperCase();
  badge.innerHTML = `
    ${pic ? `<img src="${pic}" alt="" />` : `<span class="initial">${initial}</span>`}
    <span>${escapeHTML(name)}</span>
  `;
  badge.onclick = toggleUserMenu;
  renderLandingCTA();
}

let userMenuOpen = false;
function toggleUserMenu() {
  const badge = document.getElementById("user-badge");
  if (!badge) return;
  userMenuOpen = !userMenuOpen;
  const existing = document.querySelector(".user-menu");
  if (existing) existing.remove();
  if (!userMenuOpen) return;
  const u = currentUser;
  const menu = document.createElement("div");
  menu.className = "user-menu";
  menu.innerHTML = `
    <div class="menu-info">
      <strong>${escapeHTML(u.user_metadata?.full_name || u.email || "User")}</strong>
      <span>${escapeHTML(u.email || "")}</span>
    </div>
    <button onclick="pullAllFromCloud().then(()=>{toast('Synced');renderRoute()})">
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
      Refresh from cloud
    </button>
    <button class="danger" onclick="signOut();toggleUserMenu()">
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      Sign out
    </button>`;
  badge.appendChild(menu);
  setTimeout(() => {
    document.addEventListener("click", closeMenuOnce, { once: true });
  }, 10);
}
function closeMenuOnce(e) {
  if (e.target.closest(".user-badge")) return;
  userMenuOpen = false;
  document.querySelectorAll(".user-menu").forEach((m) => m.remove());
}

function renderLandingCTA() {
  const cta = document.getElementById("landing-cta-row");
  const topRight = document.getElementById("landing-nav-right");
  if (!cta || !topRight) return;
  const hasSupabase = !!(window.LEDGR_SUPABASE?.url && window.LEDGR_SUPABASE?.anon);

  if (currentUser) {
    topRight.innerHTML = `<button class="btn-primary" onclick="enterApp()">Open App →</button>`;
    cta.innerHTML = `
      <button class="btn-primary btn-lg" onclick="enterApp()">Go to Dashboard →</button>
      <span class="muted small mono">• Signed in as ${escapeHTML(currentUser.email || "")}</span>`;
    return;
  }
  if (hasSupabase) {
    topRight.innerHTML = `<button class="landing-signin-btn" onclick="signInGoogle()">Sign in</button>`;
    cta.innerHTML = `
      <button class="google-btn" onclick="signInGoogle()">
        <svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.37-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
        Continue with Google
      </button>
      <button class="landing-signin-btn" onclick="enterApp()">Skip — use offline</button>`;
  } else {
    topRight.innerHTML = `<button class="btn-primary" onclick="enterApp()">Open App</button>`;
    cta.innerHTML = `
      <button class="btn-primary btn-lg" onclick="enterApp()">Start Journaling →</button>
      <span class="muted small mono">• 100% local · No signup needed</span>`;
  }
}

/* ========== FORMATTERS ========== */
const USD_TO_INR = 84;  // update periodically to match live rate

const FOREX_SYMBOLS = new Set([
  "XAUUSD","XAGUSD","EURUSD","GBPUSD","USDJPY","AUDUSD",
  "USDCAD","USDCHF","NZDUSD","EURGBP","EURJPY","GBPJPY","BTCUSD","ETHUSD"
]);

function isForex(market, instrument) {
  if (market === "FOREX") return true;
  if (instrument && FOREX_SYMBOLS.has(String(instrument).toUpperCase())) return true;
  return false;
}

function toINR(profit, market, instrument) {
  return isForex(market, instrument) ? Number(profit) * USD_TO_INR : Number(profit);
}

function totalINR(trades) {
  return trades.reduce((s, t) => s + toINR(t.profit, t.market, t.instrument), 0);
}

function formatTradeMoney(profit, market, instrument) {
  const num = Number(profit || 0);
  const sign = num > 0 ? "+" : num < 0 ? "-" : "";
  const fx = isForex(market, instrument);
  const abs = Math.abs(num).toLocaleString(fx ? "en-US" : "en-IN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const sym = fx ? "$" : "₹";
  return `${sign}${sym}${abs}`;
}

function formatINR(n) {
  const num = Number(n || 0);
  const sign = num > 0 ? "+" : num < 0 ? "-" : "";
  const abs = Math.abs(num).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}₹${abs}`;
}
function formatINRShort(n) {
  const num = Number(n || 0);
  const sign = num > 0 ? "+" : num < 0 ? "-" : "";
  const abs = Math.abs(num).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return `${sign}₹${abs}`;
}
function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}
function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ========== INSTRUMENT LOOKUP ========== */
function allInstruments() {
  const custom = getCustomInstruments();
  const out = { INDIAN: [], FOREX: [] };
  for (const [m, items] of Object.entries(PRESET)) {
    for (const [sym, mult] of Object.entries(items)) {
      out[m].push({ symbol: sym, multiplier: mult, preset: true });
    }
  }
  for (const c of custom) {
    if (!out[c.market]) out[c.market] = [];
    out[c.market].push({ symbol: c.symbol, multiplier: c.multiplier, preset: false });
  }
  return out;
}
function getMultiplier(market, symbol) {
  if (PRESET[market] && PRESET[market][symbol] != null) return PRESET[market][symbol];
  const c = getCustomInstruments().find((x) => x.market === market && x.symbol === symbol);
  return c ? c.multiplier : 1;
}
function computeProfit(type, entry, exit, lot, multiplier) {
  const e = Number(entry), x = Number(exit), l = Number(lot), m = Number(multiplier);
  if (!e || !x || !l || !m) return 0;
  const p = type === "SELL" ? (e - x) * l * m : (x - e) * l * m;
  return Math.round(p * 100) / 100;
}

/* ========== TOAST ========== */
function toast(msg, type = "success") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = `toast ${type}`;
  setTimeout(() => t.classList.add("hidden"), 2200);
}

/* ========== MODAL ========== */
let modalConfirm = null;
function openModal({ title, bodyHTML, confirmText = "Save", onConfirm, hideConfirm = false }) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML = bodyHTML;
  const footer = document.getElementById("modal-footer");
  footer.innerHTML = "";
  const cancel = document.createElement("button");
  cancel.className = "btn-outline"; cancel.textContent = "Cancel";
  cancel.onclick = closeModal;
  footer.appendChild(cancel);
  if (!hideConfirm) {
    const ok = document.createElement("button");
    ok.className = "btn-primary"; ok.textContent = confirmText;
    ok.onclick = () => { onConfirm && onConfirm(); };
    footer.appendChild(ok);
  }
  modalConfirm = onConfirm;
  document.getElementById("modal-backdrop").classList.remove("hidden");
}
function closeModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById("modal-backdrop").classList.add("hidden");
  modalConfirm = null;
}
function confirmDialog({ title, message, danger = true, onOk }) {
  const bodyHTML = `<p style="color:var(--muted);font-size:13px;line-height:1.6">${escapeHTML(message)}</p>`;
  openModal({
    title,
    bodyHTML,
    confirmText: danger ? "Delete" : "Confirm",
    onConfirm: () => { closeModal(); onOk && onOk(); },
  });
  const footerBtn = document.querySelector("#modal-footer .btn-primary");
  if (danger && footerBtn) { footerBtn.className = "btn-danger"; }
}

/* ========== ICONS ========== */
const ICONS = {
  dashboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  history: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><polyline points="12 7 12 12 15 15"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  journal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
  filter: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`,
  x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  arrowUp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>`,
  arrowDown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="7" x2="17" y2="17"/><polyline points="17 7 17 17 7 17"/></svg>`,
  chevronLeft: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`,
  chevronRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
  trophy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>`,
  target: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
  tUp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>`,
  tDown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></svg>`,
};

/* ========== ROUTER ========== */
const ROUTES = [
  { path: "dashboard", label: "Dashboard", icon: ICONS.dashboard, render: renderDashboard },
  { path: "add-trade", label: "Add Trade", icon: ICONS.plus, render: renderAddTrade },
  { path: "history", label: "History", icon: ICONS.history, render: renderHistory },
  { path: "calendar", label: "Calendar", icon: ICONS.calendar, render: renderCalendar },
  { path: "journal", label: "Journal", icon: ICONS.journal, render: renderJournal },
  { path: "settings", label: "Settings", icon: ICONS.settings, render: renderSettings },
];

function currentPath() {
  const h = location.hash.replace(/^#\/?/, "");
  return ROUTES.find((r) => r.path === h) ? h : "dashboard";
}

function navigate(path) {
  location.hash = `#/${path}`;
}

function renderNav() {
  const p = currentPath();
  const html = ROUTES.map((r) => `
    <a class="nav-link ${p === r.path ? "active" : ""}" href="#/${r.path}">
      ${r.icon}<span>${r.label}</span>
    </a>`).join("");
  document.getElementById("main-nav").innerHTML = html;
  document.getElementById("mobile-nav").innerHTML = html;
}

function renderAccountSwitcher() {
  const sel = document.getElementById("acc-switcher");
  const accs = getAccounts();
  const active = getActiveAccount();
  sel.innerHTML = `<option value="ALL">All accounts</option>` +
    accs.map((a) => `<option value="${a.account_id}" ${a.account_id === active ? "selected" : ""}>${escapeHTML(a.name)} · ${a.type}</option>`).join("");
}

function setActiveAccount(id) {
  LS.set("ledgr_active_account", id);
  renderRoute();
}

function enterApp() {
  document.getElementById("landing").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  location.hash = "#/dashboard";
  renderRoute();
}

function showLanding() {
  document.getElementById("landing").classList.remove("hidden");
  document.getElementById("app").classList.add("hidden");
}

function renderRoute() {
  renderNav();
  renderAccountSwitcher();
  const path = currentPath();
  ROUTES.forEach((r) => {
    const el = document.getElementById(`page-${r.path}`);
    if (r.path === path) {
      el.classList.remove("hidden");
      r.render(el);
    } else {
      el.classList.add("hidden");
    }
  });
  window.scrollTo({ top: 0, behavior: "instant" });
}

/* ========== FILTER HELPERS ========== */
function filterTradesByAccount(trades) {
  const acc = getActiveAccount();
  if (acc === "ALL") return trades;
  return trades.filter((t) => t.account_id === acc);
}
function sortTradesDesc(trades) {
  return [...trades].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

/* ========== STATS ========== */
function computeStats(trades) {
  const total = totalINR(trades);
  const wins = trades.filter((t) => t.profit > 0).length;
  const losses = trades.filter((t) => t.profit < 0).length;
  const win_rate = trades.length ? Math.round((wins / trades.length) * 1000) / 10 : 0;
  const byDate = {};
  const byInstrument = {};
  for (const t of trades) {
    const d = new Date(t.created_at).toISOString().slice(0, 10);
    const inr = toINR(t.profit, t.market, t.instrument);
    byDate[d] = (byDate[d] || 0) + inr;
    byInstrument[t.instrument] = (byInstrument[t.instrument] || 0) + inr;
  }
  let best = { date: null, profit: 0 }, worst = { date: null, profit: 0 };
  for (const [d, p] of Object.entries(byDate)) {
    if (p > best.profit || best.date === null) best = { date: d, profit: Math.round(p * 100) / 100 };
    if (p < worst.profit || worst.date === null) worst = { date: d, profit: Math.round(p * 100) / 100 };
  }
  return {
    total_profit: Math.round(total * 100) / 100,
    trade_count: trades.length, wins, losses, win_rate,
    best_day: best, worst_day: worst,
    by_instrument: Object.entries(byInstrument).map(([k, v]) => ({ instrument: k, profit: Math.round(v * 100) / 100 })),
    byDate,
  };
}

/* ========== PAGE: DASHBOARD ========== */
function renderDashboard(el) {
  const trades = filterTradesByAccount(getTrades());
  const stats = computeStats(trades);
  const recent = sortTradesDesc(trades).slice(0, 5);
  // last 14 days
  const today = new Date();
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, profit: stats.byDate[key] || 0 });
  }
  const maxAbs = Math.max(1, ...days.map((d) => Math.abs(d.profit)));

  const totalTone = stats.total_profit > 0 ? "accent-green" : stats.total_profit < 0 ? "accent-red" : "";
  const worstTone = stats.worst_day.profit < 0 ? "accent-red" : "muted-3";

  el.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Dashboard</h1>
        <div class="page-subtitle">Your trading overview</div>
      </div>
      <a class="btn-primary" href="#/add-trade">Add Trade ${ICONS.plus}</a>
    </div>

    <div class="grid-4" style="margin-bottom:24px">
      ${statCard(stats.total_profit >= 0 ? ICONS.tUp : ICONS.tDown, "Total P&L", formatINR(stats.total_profit), `${stats.trade_count} trades`, totalTone)}
      ${statCard(ICONS.target, "Win Rate", `${stats.win_rate}%`, `${stats.wins}W · ${stats.losses}L`)}
      ${statCard(ICONS.trophy, "Best Day", stats.best_day.date ? formatINR(stats.best_day.profit) : "—", stats.best_day.date || "No trades yet", "accent-green")}
      ${statCard(ICONS.tDown, "Worst Day", stats.worst_day.date ? formatINR(stats.worst_day.profit) : "—", stats.worst_day.date || "—", worstTone)}
    </div>

    <div style="display:grid;grid-template-columns:1fr;gap:20px;margin-bottom:24px" class="dash-lower">
      <div class="card">
        <div class="card-body">
          <div class="flex-between" style="margin-bottom:12px">
            <h2 class="font-heading semibold" style="font-size:15px">Last 14 Days</h2>
            <span class="mono small muted-3">Daily P&amp;L</span>
          </div>
          <div class="chart-container">
            ${days.map((d) => {
              const h = Math.abs(d.profit) / maxAbs * 100;
              const cls = d.profit >= 0 ? "green" : "red";
              const label = d.date.slice(5);
              return `
                <div class="chart-bar-wrap">
                  <div class="chart-bar-area">
                    ${d.profit !== 0 ? `<div class="chart-tooltip">${formatINRShort(d.profit)}</div>` : ""}
                    <div class="chart-bar ${cls}" style="height:${d.profit === 0 ? 2 : Math.max(h, 3)}%"></div>
                  </div>
                  <div class="chart-x">${label}</div>
                </div>`;
            }).join("")}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-body">
          <h2 class="font-heading semibold" style="font-size:15px;margin-bottom:14px">By Instrument</h2>
          ${stats.by_instrument.length === 0
            ? `<div class="muted-2 small center" style="padding:32px 0">No trades yet</div>`
            : stats.by_instrument.map((i) => `
              <div class="flex-between" style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
                <span class="semibold small">${escapeHTML(i.instrument)}</span>
                <span class="mono small ${i.profit >= 0 ? "accent-green" : "accent-red"}">${formatINR(i.profit)}</span>
              </div>
            `).join("")}
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        <div class="flex-between" style="margin-bottom:14px">
          <h2 class="font-heading semibold" style="font-size:15px">Recent Trades</h2>
          <a class="link-muted" href="#/history">View all →</a>
        </div>
        ${recent.length === 0
          ? `<div class="center" style="padding:40px 0">
              <p class="muted-2 small" style="margin-bottom:10px">No trades logged yet.</p>
              <a class="link" href="#/add-trade">Log your first trade →</a>
            </div>`
          : recent.map((t) => tradeRowCompact(t)).join("")}
      </div>
    </div>
  `;
  // desktop dashboard two-column at lg
  if (window.innerWidth >= 1024) {
    el.querySelector(".dash-lower").style.gridTemplateColumns = "2fr 1fr";
  }
}

function statCard(icon, label, val, sub, tone = "") {
  return `
    <div class="stat-card">
      <div class="stat-card-top">
        <span class="stat-card-label">${label}</span>
        <span class="stat-card-icon">${icon}</span>
      </div>
      <div class="stat-card-val ${tone}">${val}</div>
      ${sub ? `<div class="stat-card-sub">${escapeHTML(sub)}</div>` : ""}
    </div>`;
}

function tradeRowCompact(t) {
  return `
    <div class="flex-between" style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
      <div class="flex-center">
        <span class="chip">${escapeHTML(t.instrument)}</span>
        <span class="chip ${t.trade_type === "BUY" ? "buy" : "sell"}">${t.trade_type}</span>
      </div>
      <div style="text-align:right">
        <div class="mono semibold ${t.profit >= 0 ? "accent-green" : "accent-red"}" style="font-size:13px">${formatTradeMoney(t.profit, t.market, t.instrument)}</div>
        <div class="mono tiny muted-2">${formatDate(t.created_at)}</div>
      </div>
    </div>`;
}

/* ========== PAGE: ADD TRADE ========== */
let addTradeState = {
  market: "INDIAN",
  instrument: "NIFTY",
  tradeType: "BUY",
  accountId: "",
  entry: "", exit: "", lot: "", strike: "", notes: "",
};

function renderAddTrade(el) {
  const accs = getAccounts();
  if (!addTradeState.accountId && accs.length) {
    const active = getActiveAccount();
    addTradeState.accountId = active !== "ALL" ? active : accs[0].account_id;
  }
  const insts = allInstruments();
  const list = insts[addTradeState.market] || [];
  if (!list.some((i) => i.symbol === addTradeState.instrument)) {
    addTradeState.instrument = list[0]?.symbol || "";
  }
  const currentInst = list.find((i) => i.symbol === addTradeState.instrument);
  const m = currentInst?.multiplier || 0;
  const preview = computeProfit(addTradeState.tradeType, addTradeState.entry, addTradeState.exit, addTradeState.lot, m);
  const previewIsForex = addTradeState.market === "FOREX";
  const previewINR = previewIsForex ? toINR(preview, "FOREX") : null;

  el.innerHTML = `
    <div class="container-md">
      <div class="page-header">
        <div>
          <h1 class="page-title">Add Trade</h1>
          <div class="page-subtitle">Profit is calculated automatically based on instrument.</div>
        </div>
      </div>

      <form id="add-trade-form" class="stack">
        <div class="form-card">
          <div class="grid-2">
            <div>
              <label class="label">Account</label>
              <div class="form-row-inline">
                <select id="at-account" class="select">
                  ${accs.map((a) => `<option value="${a.account_id}" ${a.account_id === addTradeState.accountId ? "selected" : ""}>${escapeHTML(a.name)} · ${a.type}</option>`).join("")}
                </select>
                <button type="button" class="btn-outline" style="padding:10px 12px" onclick="promptAddAccount()">${ICONS.plus}</button>
              </div>
            </div>
            <div>
              <label class="label">Market</label>
              <div class="seg">
                <button type="button" class="${addTradeState.market === "INDIAN" ? "active" : ""}" onclick="setMarket('INDIAN')">Indian</button>
                <button type="button" class="${addTradeState.market === "FOREX" ? "active" : ""}" onclick="setMarket('FOREX')">Forex / Crypto</button>
              </div>
            </div>
          </div>

          <div class="grid-2">
            <div>
              <label class="label">Instrument</label>
              <div class="form-row-inline">
                <select id="at-instrument" class="select mono">
                  ${list.map((i) => `<option value="${i.symbol}" ${i.symbol === addTradeState.instrument ? "selected" : ""}>${i.symbol} ×${i.multiplier}${i.preset ? "" : " · custom"}</option>`).join("")}
                </select>
                <button type="button" class="btn-outline" style="padding:10px 12px" onclick="promptAddInstrument('${addTradeState.market}')">${ICONS.plus}</button>
              </div>
            </div>
            <div>
              <label class="label">Trade Type</label>
              <div class="seg">
                <button type="button" class="${addTradeState.tradeType === "BUY" ? "active green" : ""}" onclick="setTradeType('BUY')">${ICONS.arrowUp} BUY</button>
                <button type="button" class="${addTradeState.tradeType === "SELL" ? "active red" : ""}" onclick="setTradeType('SELL')">${ICONS.arrowDown} SELL</button>
              </div>
            </div>
          </div>

          ${addTradeState.market === "INDIAN" ? `
            <div>
              <label class="label">Strike <span class="normal">(optional — e.g. 22500 CE, 45000 PE)</span></label>
              <input id="at-strike" class="input mono" type="text" placeholder="22500 CE" value="${escapeHTML(addTradeState.strike)}" />
            </div>` : ""}

          <div class="grid-3">
            <div>
              <label class="label">Entry Price</label>
              <input id="at-entry" class="input mono" type="number" step="any" placeholder="0.00" value="${addTradeState.entry}" />
            </div>
            <div>
              <label class="label">Exit Price</label>
              <input id="at-exit" class="input mono" type="number" step="any" placeholder="0.00" value="${addTradeState.exit}" />
            </div>
            <div>
              <label class="label">${addTradeState.market === "INDIAN" ? "Quantity" : "Lot Size"}</label>
              <input id="at-lot" class="input mono" type="number" step="any" placeholder="${addTradeState.market === "INDIAN" ? "Total qty (e.g. 75)" : "0"}" value="${addTradeState.lot}" />
            </div>
          </div>

          <div>
            <label class="label">Notes</label>
            <textarea id="at-notes" class="textarea" placeholder="Setup, reasoning, emotion...">${escapeHTML(addTradeState.notes)}</textarea>
          </div>
        </div>

        <div class="profit-preview">
          <div>
            <div class="preview-label">Calculated P&amp;L</div>
            <div class="preview-meta">${addTradeState.market} · ${escapeHTML(addTradeState.instrument)} · ${addTradeState.tradeType} · ×${m}${previewIsForex ? ` · ≈ ${formatINR(previewINR)} @ ₹${USD_TO_INR}/$` : ""}</div>
          </div>
          <div class="preview-val ${preview >= 0 ? "accent-green" : "accent-red"}">${formatTradeMoney(preview, addTradeState.market, addTradeState.instrument)}</div>
        </div>

        <div class="row-gap-sm">
          <button type="button" class="btn-outline" onclick="navigate('dashboard')">Cancel</button>
          <button type="submit" class="btn-primary" style="flex:1">Save Trade</button>
        </div>
      </form>
    </div>
  `;

  // Bind live updates
  const bind = (id, key, fn) => {
    const e = el.querySelector(id);
    if (!e) return;
    e.addEventListener("input", () => {
      addTradeState[key] = e.value;
      updatePreview();
    });
  };
  bind("#at-entry", "entry");
  bind("#at-exit", "exit");
  bind("#at-lot", "lot");
  bind("#at-notes", "notes");
  if (addTradeState.market === "INDIAN") bind("#at-strike", "strike");

  el.querySelector("#at-account").addEventListener("change", (e) => { addTradeState.accountId = e.target.value; });
  el.querySelector("#at-instrument").addEventListener("change", (e) => {
    addTradeState.instrument = e.target.value;
    updatePreview();
  });

  el.querySelector("#add-trade-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    saveTradeFromState();
  });
}

function updatePreview() {
  const root = document.getElementById("page-add-trade");
  if (!root) return;
  const insts = allInstruments();
  const list = insts[addTradeState.market] || [];
  const inst = list.find((i) => i.symbol === addTradeState.instrument);
  const m = inst?.multiplier || 0;
  const p = computeProfit(addTradeState.tradeType, addTradeState.entry, addTradeState.exit, addTradeState.lot, m);
  const pv = root.querySelector(".preview-val");
  const pm = root.querySelector(".preview-meta");
  if (pv) {
    pv.textContent = formatTradeMoney(p, addTradeState.market, addTradeState.instrument);
    pv.className = `preview-val ${p >= 0 ? "accent-green" : "accent-red"}`;
  }
  if (pm) {
    const isFx = addTradeState.market === "FOREX";
    pm.textContent = `${addTradeState.market} · ${addTradeState.instrument} · ${addTradeState.tradeType} · ×${m}` + (isFx ? ` · ≈ ${formatINR(toINR(p, "FOREX"))} @ ₹${USD_TO_INR}/$` : "");
  }
}

function setMarket(m) {
  addTradeState.market = m;
  const insts = allInstruments();
  const list = insts[m] || [];
  if (!list.some((i) => i.symbol === addTradeState.instrument)) {
    addTradeState.instrument = list[0]?.symbol || "";
  }
  if (m !== "INDIAN") addTradeState.strike = "";
  renderRoute();
}
function setTradeType(t) {
  addTradeState.tradeType = t;
  renderRoute();
}

function saveTradeFromState() {
  if (!addTradeState.accountId) return toast("Select an account", "error");
  if (!addTradeState.entry || !addTradeState.exit || !addTradeState.lot) return toast("Fill price & lot fields", "error");
  const mult = getMultiplier(addTradeState.market, addTradeState.instrument);
  const profit = computeProfit(addTradeState.tradeType, addTradeState.entry, addTradeState.exit, addTradeState.lot, mult);
  const trade = {
    trade_id: uid("trd"),
    account_id: addTradeState.accountId,
    market: addTradeState.market,
    instrument: addTradeState.instrument,
    trade_type: addTradeState.tradeType,
    entry_price: Number(addTradeState.entry),
    exit_price: Number(addTradeState.exit),
    lot_size: Number(addTradeState.lot),
    strike_price: addTradeState.market === "INDIAN" && addTradeState.strike.trim() ? addTradeState.strike.trim() : null,
    notes: addTradeState.notes || "",
    profit, multiplier: mult,
    created_at: new Date().toISOString(),
  };
  const all = getTrades();
  all.push(trade);
  LS.set("ledgr_trades", all);
  cloudUpsert("trades", trade);
  // reset partials
  addTradeState.entry = addTradeState.exit = addTradeState.lot = addTradeState.strike = addTradeState.notes = "";
  toast("Trade logged");
  navigate("history");
}

function promptAddAccount() {
  const body = `
    <div>
      <label class="label">Name</label>
      <input id="m-acc-name" class="input" type="text" placeholder="e.g. Zerodha Live" />
    </div>
    <div>
      <label class="label">Type</label>
      <select id="m-acc-type" class="select">
        <option value="DEMO">Demo</option>
        <option value="REAL">Real</option>
        <option value="CUSTOM" selected>Custom</option>
      </select>
    </div>`;
  openModal({
    title: "Add Account",
    bodyHTML: body,
    confirmText: "Add",
    onConfirm: () => {
      const name = document.getElementById("m-acc-name").value.trim();
      const type = document.getElementById("m-acc-type").value;
      if (!name) return toast("Name required", "error");
      const list = getAccounts();
      const acc = { account_id: uid("acc"), name, type, created_at: new Date().toISOString() };
      list.push(acc);
      LS.set("ledgr_accounts", list);
      addTradeState.accountId = acc.account_id;
      setActiveAccount(acc.account_id);
      closeModal();
      toast("Account added");
    },
  });
}

function promptAddInstrument(defaultMarket = "INDIAN") {
  const body = `
    <div>
      <label class="label">Market</label>
      <select id="m-inst-market" class="select">
        <option value="INDIAN" ${defaultMarket === "INDIAN" ? "selected" : ""}>Indian</option>
        <option value="FOREX" ${defaultMarket === "FOREX" ? "selected" : ""}>Forex / Crypto</option>
      </select>
    </div>
    <div>
      <label class="label">Symbol</label>
      <input id="m-inst-sym" class="input mono" type="text" placeholder="e.g. CRUDEOIL" />
    </div>
    <div>
      <label class="label">Multiplier</label>
      <input id="m-inst-mult" class="input mono" type="number" step="any" placeholder="1" />
      <p class="hint">Profit = (exit − entry) × lot × multiplier. Indian presets use ×1 (enter total qty). Forex majors use ×100000, XAUUSD ×100, BTCUSD ×1.</p>
    </div>`;
  openModal({
    title: "Add Custom Instrument",
    bodyHTML: body,
    confirmText: "Add",
    onConfirm: () => {
      const market = document.getElementById("m-inst-market").value;
      const sym = document.getElementById("m-inst-sym").value.trim().toUpperCase();
      const mult = Number(document.getElementById("m-inst-mult").value);
      if (!sym || !mult) return toast("Symbol & multiplier required", "error");
      if (PRESET[market][sym] != null) return toast("Symbol already a preset", "error");
      const list = getCustomInstruments();
      if (list.some((x) => x.market === market && x.symbol === sym)) return toast("Already exists", "error");
      const inst = { instrument_id: uid("inst"), market, symbol: sym, multiplier: mult, created_at: new Date().toISOString() };
      list.push(inst);
      LS.set("ledgr_custom_instruments", list);
      cloudUpsert("custom_instruments", inst);
      addTradeState.market = market;
      addTradeState.instrument = sym;
      closeModal();
      toast("Instrument added");
      renderRoute();
    },
  });
}

/* ========== PAGE: HISTORY ========== */
let historyFilters = { instrument: "ALL", start: "", end: "", open: false };

function renderHistory(el) {
  let trades = filterTradesByAccount(getTrades());
  if (historyFilters.instrument !== "ALL") trades = trades.filter((t) => t.instrument === historyFilters.instrument);
  if (historyFilters.start) trades = trades.filter((t) => t.created_at.slice(0, 10) >= historyFilters.start);
  if (historyFilters.end) trades = trades.filter((t) => t.created_at.slice(0, 10) <= historyFilters.end);
  trades = sortTradesDesc(trades);
  const total = totalINR(trades);
  const instSet = Array.from(new Set(getTrades().map((t) => t.instrument))).sort();
  const accs = getAccounts();
  const accMap = Object.fromEntries(accs.map((a) => [a.account_id, a.name]));

  const hasFilters = historyFilters.instrument !== "ALL" || historyFilters.start || historyFilters.end;

  el.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Trade History</h1>
        <div class="page-subtitle">${trades.length} trades · latest first</div>
      </div>
      <button class="btn-secondary" onclick="toggleHistoryFilters()">${ICONS.filter} ${historyFilters.open ? "Hide filters" : "Filters"}${hasFilters ? `<span style="width:6px;height:6px;border-radius:50%;background:var(--green);margin-left:4px"></span>` : ""}</button>
    </div>

    ${historyFilters.open ? `
      <div class="filters-panel" style="margin-bottom:20px">
        <div>
          <label class="label">Instrument</label>
          <select id="f-inst" class="select mono" onchange="historyFilters.instrument = this.value; renderRoute()">
            <option value="ALL">ALL</option>
            ${instSet.map((i) => `<option value="${i}" ${historyFilters.instrument === i ? "selected" : ""}>${i}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="label">Start date</label>
          <input class="input mono" type="date" value="${historyFilters.start}" onchange="historyFilters.start = this.value; renderRoute()" />
        </div>
        <div>
          <label class="label">End date</label>
          <input class="input mono" type="date" value="${historyFilters.end}" onchange="historyFilters.end = this.value; renderRoute()" />
        </div>
        <div style="display:flex;align-items:flex-end">
          <button class="btn-outline" style="width:100%" onclick="clearHistoryFilters()">${ICONS.x} Clear</button>
        </div>
      </div>` : ""}

    <div class="card no-hover" style="padding:0;overflow:hidden">
      ${trades.length === 0
        ? `<div style="padding:64px 20px;text-align:center"><p class="muted-2 small">No trades match your filter.</p></div>`
        : trades.map((t) => `
          <div class="trade-row">
            <div class="trade-left">
              <div class="trade-profit ${t.profit >= 0 ? "accent-green" : "accent-red"}">${formatTradeMoney(t.profit, t.market, t.instrument)}</div>
              <div class="trade-meta">
                <span class="chip">${escapeHTML(t.instrument)}</span>
                ${t.strike_price ? `<span class="chip outline">${escapeHTML(t.strike_price)}</span>` : ""}
                <span class="chip ${t.trade_type === "BUY" ? "buy" : "sell"}">${t.trade_type}</span>
                <span class="chip small-mono">${t.entry_price} → ${t.exit_price} · ${t.lot_size} ${t.market === "INDIAN" ? "qty" : "lot"}</span>
                ${accMap[t.account_id] ? `<span class="tiny muted-3 mono">· ${escapeHTML(accMap[t.account_id])}</span>` : ""}
              </div>
            </div>
            <div class="trade-right">
              <div class="trade-date">${formatDate(t.created_at)}</div>
              <button class="icon-btn danger trade-delete" onclick="deleteTrade('${t.trade_id}')" title="Delete">${ICONS.trash}</button>
            </div>
          </div>`).join("")}
      ${trades.length > 0 ? (() => {
        const forexTrades = trades.filter(t => isForex(t.market, t.instrument));
        const indianTrades = trades.filter(t => !isForex(t.market, t.instrument));
        const forexUSD = forexTrades.reduce((s,t) => s + Number(t.profit), 0);
        const indianINR = indianTrades.reduce((s,t) => s + Number(t.profit), 0);
        const hasMix = forexTrades.length > 0 && indianTrades.length > 0;
        const fSign = forexUSD >= 0 ? "accent-green" : "accent-red";
        const iSign = indianINR >= 0 ? "accent-green" : "accent-red";
        return `
        <div class="total-row" style="flex-direction:column;align-items:stretch;gap:6px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span class="total-label">Total P&L (INR)</span>
            <span class="total-val ${total >= 0 ? "accent-green" : "accent-red"}">${formatINR(total)}</span>
          </div>
          ${hasMix ? `
          <div style="display:flex;justify-content:flex-end;gap:16px">
            <span style="font-size:11px;color:var(--muted)">Indian: <span class="${iSign}">${formatINR(indianINR)}</span></span>
            <span style="font-size:11px;color:var(--muted)">Forex: <span class="${fSign}">${forexUSD >= 0 ? "+" : ""}$${Math.abs(forexUSD).toFixed(2)}</span></span>
            <span style="font-size:11px;opacity:0.4">@ ₹${USD_TO_INR}/$</span>
          </div>` : ""}
        </div>`;
      })() : ""}
    </div>
  `;
}
function toggleHistoryFilters() { historyFilters.open = !historyFilters.open; renderRoute(); }
function clearHistoryFilters() { historyFilters = { instrument: "ALL", start: "", end: "", open: true }; renderRoute(); }
function deleteTrade(id) {
  confirmDialog({
    title: "Delete trade?",
    message: "This permanently removes the trade. It cannot be undone.",
    onOk: () => {
      const all = getTrades().filter((t) => t.trade_id !== id);
      LS.set("ledgr_trades", all);
      cloudDelete("trades", "trade_id", id);
      toast("Trade deleted");
      renderRoute();
    },
  });
}

/* ========== PAGE: CALENDAR ========== */
let calView = { y: new Date().getFullYear(), m: new Date().getMonth() };

function renderCalendar(el) {
  const trades = filterTradesByAccount(getTrades());
  const byDate = {};
  for (const t of trades) {
    const d = new Date(t.created_at).toISOString().slice(0, 10);
    if (!byDate[d]) byDate[d] = { profit: 0, count: 0 };
    byDate[d].profit += toINR(t.profit, t.market, t.instrument);
    byDate[d].count += 1;
  }
  const cells = monthMatrix(calView.y, calView.m);
  const allValues = cells.filter(Boolean).map((d) => Math.abs((byDate[isoDate(d)] || { profit: 0 }).profit));
  const maxAbs = Math.max(0, ...allValues);

  let monthTotal = 0, monthCount = 0, best = 0, worst = 0;
  cells.forEach((c) => {
    if (!c) return;
    const v = byDate[isoDate(c)];
    if (!v) return;
    monthTotal += v.profit;
    monthCount += v.count;
    best = Math.max(best, v.profit);
    worst = Math.min(worst, v.profit);
  });
  const monthName = new Date(calView.y, calView.m).toLocaleString("en-IN", { month: "long", year: "numeric" });

  el.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Calendar</h1>
        <div class="page-subtitle">Daily P&amp;L heatmap</div>
      </div>
      <div class="cal-nav">
        <button class="icon-btn" onclick="shiftMonth(-1)">${ICONS.chevronLeft}</button>
        <div class="cal-month">${monthName}</div>
        <button class="icon-btn" onclick="shiftMonth(1)">${ICONS.chevronRight}</button>
      </div>
    </div>

    <div class="grid-4" style="margin-bottom:20px">
      ${statCard(ICONS.tUp, "Month Total", formatINR(monthTotal), null, monthTotal >= 0 ? "accent-green" : "accent-red")}
      ${statCard(ICONS.target, "Trades", String(monthCount), null)}
      ${statCard(ICONS.trophy, "Best Day", best ? formatINR(best) : "—", null, "accent-green")}
      ${statCard(ICONS.tDown, "Worst Day", worst ? formatINR(worst) : "—", null, worst < 0 ? "accent-red" : "muted-3")}
    </div>

    <div class="card no-hover" style="padding:20px;margin-bottom:20px">
      <div class="cal-grid" style="margin-bottom:8px">
        ${["S","M","T","W","T","F","S"].map((d) => `<div class="tiny muted-3 mono center">${d}</div>`).join("")}
      </div>
      <div class="cal-grid">
        ${cells.map((c) => {
          if (!c) return `<div></div>`;
          const iso = isoDate(c);
          const hit = byDate[iso];
          const style = hit ? heatmapStyle(hit.profit, maxAbs) : "background:rgba(39,39,42,0.3)";
          return `
            <div class="cal-cell" style="${style}">
              <div class="day-num">${c.getDate()}</div>
              ${hit ? `<div class="day-pnl">${formatINRShort(hit.profit)}</div>` : ""}
            </div>`;
        }).join("")}
      </div>
      <div class="cal-legend">
        <span>LESS</span>
        <div class="cal-legend-swatch">
          <div style="background:var(--red)"></div>
          <div style="background:rgba(239,68,68,0.4)"></div>
          <div style="background:rgba(39,39,42,0.5)"></div>
          <div style="background:rgba(16,185,129,0.4)"></div>
          <div style="background:var(--green)"></div>
        </div>
        <span>MORE</span>
      </div>
    </div>

    <div class="card no-hover" style="padding:20px">
      <h2 class="font-heading semibold" style="font-size:15px;margin-bottom:10px">Daily Breakdown</h2>
      ${Object.keys(byDate).length === 0
        ? `<div class="center muted-2 small" style="padding:24px 0">No trades yet</div>`
        : Object.entries(byDate).sort((a,b) => b[0].localeCompare(a[0])).map(([d, v]) => `
          <div class="flex-between" style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
            <div>
              <div class="mono small">${new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</div>
              <div class="tiny muted-3 mono">${v.count} trade${v.count !== 1 ? "s" : ""}</div>
            </div>
            <span class="mono semibold ${v.profit >= 0 ? "accent-green" : "accent-red"}">${formatINR(v.profit)}</span>
          </div>
        `).join("")}
    </div>
  `;
}
function monthMatrix(y, m) {
  const first = new Date(y, m, 1);
  const startDay = first.getDay();
  const daysIn = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(new Date(y, m, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function heatmapStyle(profit, maxAbs) {
  if (profit === 0 || maxAbs === 0) return "background:rgba(39,39,42,0.5)";
  const ratio = Math.min(1, Math.abs(profit) / maxAbs);
  const color = profit > 0 ? "16,185,129" : "239,68,68";
  const alpha = 0.15 + ratio * 0.85;
  return `background:rgba(${color}, ${alpha}); color:${ratio > 0.5 ? (profit > 0 ? "#000" : "#fff") : "#fff"}`;
}
function shiftMonth(dir) {
  let m = calView.m + dir, y = calView.y;
  if (m < 0) { m = 11; y--; }
  if (m > 11) { m = 0; y++; }
  calView = { y, m };
  renderRoute();
}

/* ========== PAGE: JOURNAL ========== */
let journalTab = "entries";

function renderJournal(el) {
  const entries = getJournal();
  const trades = sortTradesDesc(filterTradesByAccount(getTrades()));
  const accs = getAccounts();
  const accMap = Object.fromEntries(accs.map((a) => [a.account_id, a.name]));

  el.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Journal</h1>
        <div class="page-subtitle">Daily reflections &amp; trade notes</div>
      </div>
      <button class="btn-primary" onclick="promptNewJournalEntry()">${ICONS.plus} New Entry</button>
    </div>

    <div class="tabs-list">
      <button class="tab ${journalTab === "entries" ? "active" : ""}" onclick="journalTab = 'entries'; renderRoute()">Daily Entries</button>
      <button class="tab ${journalTab === "trade-notes" ? "active" : ""}" onclick="journalTab = 'trade-notes'; renderRoute()">Trade Notes</button>
    </div>

    ${journalTab === "entries" ? `
      ${entries.length === 0
        ? `<div class="empty-state"><p>No entries yet. Start writing your first reflection.</p></div>`
        : `<div class="stack">${entries.map((e) => `
          <div class="journal-entry">
            <div class="journal-entry-head">
              <div>
                <div class="journal-title">${escapeHTML(e.title)}</div>
                <div class="journal-date">${escapeHTML(e.entry_date)}</div>
              </div>
              <div class="journal-actions">
                <button class="icon-btn" onclick="promptEditJournalEntry('${e.entry_id}')" title="Edit">${ICONS.edit}</button>
                <button class="icon-btn danger" onclick="deleteJournalEntry('${e.entry_id}')" title="Delete">${ICONS.trash}</button>
              </div>
            </div>
            <div class="journal-content">${escapeHTML(e.content)}</div>
          </div>
        `).join("")}</div>`}
    ` : `
      ${trades.length === 0
        ? `<div class="empty-state"><p>No trades yet.</p></div>`
        : `<div class="stack">${trades.map((t) => `
          <div class="journal-entry">
            <div class="journal-entry-head">
              <div class="trade-meta">
                <span class="chip">${escapeHTML(t.instrument)}</span>
                ${t.strike_price ? `<span class="chip outline">${escapeHTML(t.strike_price)}</span>` : ""}
                <span class="chip ${t.trade_type === "BUY" ? "buy" : "sell"}">${t.trade_type}</span>
                <span class="mono small ${t.profit >= 0 ? "accent-green" : "accent-red"}">${formatTradeMoney(t.profit, t.market, t.instrument)}</span>
                <span class="tiny muted-3 mono">${formatDate(t.created_at)}</span>
                ${accMap[t.account_id] ? `<span class="tiny muted-3 mono">· ${escapeHTML(accMap[t.account_id])}</span>` : ""}
              </div>
              <div class="journal-actions">
                <button class="icon-btn" onclick="promptEditTradeNotes('${t.trade_id}')" title="Edit notes">${ICONS.edit}</button>
              </div>
            </div>
            <div class="journal-content">${t.notes ? escapeHTML(t.notes) : `<span class="muted-3" style="font-style:italic">No notes yet — click edit to add.</span>`}</div>
          </div>
        `).join("")}</div>`}
    `}
  `;
}
function promptNewJournalEntry() {
  const today = new Date().toISOString().slice(0, 10);
  const body = `
    <div><label class="label">Date</label><input id="je-date" class="input mono" type="date" value="${today}" /></div>
    <div><label class="label">Title</label><input id="je-title" class="input" placeholder="Morning pre-market plan" /></div>
    <div><label class="label">Notes</label><textarea id="je-content" class="textarea" placeholder="What's the setup? What's the risk? How do I feel today?"></textarea></div>
  `;
  openModal({
    title: "New Journal Entry", bodyHTML: body, confirmText: "Save",
    onConfirm: () => {
      const title = document.getElementById("je-title").value.trim();
      const content = document.getElementById("je-content").value.trim();
      const entry_date = document.getElementById("je-date").value;
      if (!title || !content) return toast("Title & content required", "error");
      const list = getJournal();
      list.unshift({ entry_id: uid("jrn"), title, content, entry_date, created_at: new Date().toISOString() });
      LS.set("ledgr_journal", list);
      cloudUpsert("journal", list[0]);
      closeModal();
      toast("Entry added");
      renderRoute();
    },
  });
}
function promptEditJournalEntry(id) {
  const e = getJournal().find((x) => x.entry_id === id);
  if (!e) return;
  const body = `
    <div><label class="label">Date</label><input id="je-date" class="input mono" type="date" value="${e.entry_date}" /></div>
    <div><label class="label">Title</label><input id="je-title" class="input" value="${escapeHTML(e.title)}" /></div>
    <div><label class="label">Notes</label><textarea id="je-content" class="textarea">${escapeHTML(e.content)}</textarea></div>
  `;
  openModal({
    title: "Edit Entry", bodyHTML: body, confirmText: "Save",
    onConfirm: () => {
      const list = getJournal();
      const idx = list.findIndex((x) => x.entry_id === id);
      list[idx] = { ...list[idx],
        title: document.getElementById("je-title").value.trim(),
        content: document.getElementById("je-content").value.trim(),
        entry_date: document.getElementById("je-date").value };
      LS.set("ledgr_journal", list);
      cloudUpsert("journal", list[idx]);
      closeModal();
      toast("Updated");
      renderRoute();
    },
  });
}
function deleteJournalEntry(id) {
  confirmDialog({
    title: "Delete entry?",
    message: "This permanently removes this journal entry.",
    onOk: () => {
      LS.set("ledgr_journal", getJournal().filter((x) => x.entry_id !== id));
      cloudDelete("journal", "entry_id", id);
      toast("Deleted");
      renderRoute();
    },
  });
}
function promptEditTradeNotes(id) {
  const t = getTrades().find((x) => x.trade_id === id);
  if (!t) return;
  const body = `
    <div><label class="label">Notes</label><textarea id="tn-notes" class="textarea" style="min-height:140px">${escapeHTML(t.notes || "")}</textarea></div>
  `;
  openModal({
    title: "Edit Trade Notes", bodyHTML: body, confirmText: "Save",
    onConfirm: () => {
      const list = getTrades();
      const idx = list.findIndex((x) => x.trade_id === id);
      list[idx] = { ...list[idx], notes: document.getElementById("tn-notes").value };
      LS.set("ledgr_trades", list);
      cloudUpsert("trades", list[idx]);
      closeModal();
      toast("Notes updated");
      renderRoute();
    },
  });
}

/* ========== PAGE: SETTINGS ========== */
let settingsTab = "accounts";

function renderSettings(el) {
  const accs = getAccounts();
  const insts = allInstruments();

  el.innerHTML = `
    <div class="container-lg">
      <div class="page-header">
        <div>
          <h1 class="page-title">Settings</h1>
          <div class="page-subtitle">Manage accounts &amp; instruments</div>
        </div>
      </div>

      <div class="tabs-list">
        <button class="tab ${settingsTab === "accounts" ? "active" : ""}" onclick="settingsTab = 'accounts'; renderRoute()">Accounts</button>
        <button class="tab ${settingsTab === "instruments" ? "active" : ""}" onclick="settingsTab = 'instruments'; renderRoute()">Instruments</button>
        <button class="tab ${settingsTab === "data" ? "active" : ""}" onclick="settingsTab = 'data'; renderRoute()">Data</button>
      </div>

      ${settingsTab === "accounts" ? `
        <div class="card no-hover" style="padding:0">
          <div class="subcard-header">
            <div>
              <h2>Trading Accounts</h2>
              <p>Separate your demo and live capital. Deleting an account also removes its trades.</p>
            </div>
            <button class="btn-primary" onclick="promptAddAccount()">${ICONS.plus} Add</button>
          </div>
          ${accs.map((a) => `
            <div class="account-row">
              <div>
                <strong>${escapeHTML(a.name)}</strong>
                <div class="account-type">${a.type}</div>
              </div>
              <button class="icon-btn danger" ${accs.length <= 1 ? "disabled style=\"opacity:.3;cursor:not-allowed\"" : ""} onclick="deleteAccount('${a.account_id}')" title="${accs.length <= 1 ? "Keep at least one account" : "Delete"}">${ICONS.trash}</button>
            </div>
          `).join("")}
        </div>
      ` : ""}

      ${settingsTab === "instruments" ? `
        <div class="card no-hover" style="padding:0">
          <div class="subcard-header">
            <div>
              <h2>Instruments</h2>
              <p>Preset instruments are built-in. Add custom symbols with your own multiplier.</p>
            </div>
            <button class="btn-primary" onclick="promptAddInstrument('INDIAN')">${ICONS.plus} Add</button>
          </div>
          <div class="card-body grid-2">
            ${["INDIAN","FOREX"].map((m) => `
              <div>
                <h3 class="tiny muted-3 uppercase semibold" style="margin-bottom:10px">${m === "INDIAN" ? "Indian" : "Forex / Crypto"}</h3>
                ${(insts[m] || []).map((i) => `
                  <div class="inst-row">
                    <div class="flex-center">
                      <span class="inst-symbol">${i.symbol}</span>
                      ${!i.preset ? `<span class="chip">CUSTOM</span>` : ""}
                    </div>
                    <div class="flex-center" style="gap:10px">
                      <span class="inst-mult">×${i.multiplier}</span>
                      ${!i.preset ? `<button class="icon-btn danger" style="width:26px;height:26px" onclick="deleteCustomInstrument('${i.symbol}','${m}')">${ICONS.trash}</button>` : ""}
                    </div>
                  </div>
                `).join("")}
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}

      ${settingsTab === "data" ? `
        <div class="card no-hover" style="padding:0">
          <div class="subcard-header">
            <div>
              <h2>Data</h2>
              <p>Your data lives in this browser's local storage. Export to backup, import to restore.</p>
            </div>
          </div>
          <div class="card-body" style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn-secondary" onclick="exportData()">Download backup (.json)</button>
            <button class="btn-secondary" onclick="document.getElementById('imp-file').click()">Import backup</button>
            <input id="imp-file" type="file" accept=".json" style="display:none" onchange="importData(event)" />
            <button class="btn-danger" onclick="confirmReset()">Reset everything</button>
          </div>
          <div class="card-body" style="padding-top:0">
            <p class="hint">Total trades: ${getTrades().length} · Journal entries: ${getJournal().length} · Custom instruments: ${getCustomInstruments().length}</p>
          </div>
        </div>
      ` : ""}
    </div>
  `;
}

function deleteAccount(id) {
  if (getAccounts().length <= 1) return toast("Keep at least one account", "error");
  confirmDialog({
    title: "Delete account?",
    message: "This permanently deletes the account and all its trades. Journal entries are kept.",
    onOk: () => {
      LS.set("ledgr_accounts", getAccounts().filter((a) => a.account_id !== id));
      LS.set("ledgr_trades", getTrades().filter((t) => t.account_id !== id));
      if (getActiveAccount() === id) LS.set("ledgr_active_account", "ALL");
      cloudDelete("accounts", "account_id", id);
      cloudDeleteTradesByAccount(id);
      toast("Account deleted");
      renderRoute();
    },
  });
}

function deleteCustomInstrument(sym, market) {
  confirmDialog({
    title: `Delete ${sym}?`,
    message: "Your existing trades with this symbol stay intact; you just won't be able to pick it from the dropdown.",
    onOk: () => {
      const target = getCustomInstruments().find((c) => c.symbol === sym && c.market === market);
      LS.set("ledgr_custom_instruments", getCustomInstruments().filter((c) => !(c.symbol === sym && c.market === market)));
      if (target) cloudDelete("custom_instruments", "instrument_id", target.instrument_id);
      toast("Removed");
      renderRoute();
    },
  });
}

function exportData() {
  const blob = {
    exported_at: new Date().toISOString(),
    accounts: getAccounts(),
    trades: getTrades(),
    journal: getJournal(),
    custom_instruments: getCustomInstruments(),
    active_account: getActiveAccount(),
  };
  const b = new Blob([JSON.stringify(blob, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(b);
  const a = document.createElement("a");
  a.href = url; a.download = `ledgr-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast("Backup downloaded");
}

function importData(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.accounts || !data.trades) throw new Error();
      confirmDialog({
        title: "Import backup?",
        message: "This replaces your current accounts, trades, journal and custom instruments.",
        onOk: () => {
          LS.set("ledgr_accounts", data.accounts);
          LS.set("ledgr_trades", data.trades);
          LS.set("ledgr_journal", data.journal || []);
          LS.set("ledgr_custom_instruments", data.custom_instruments || []);
          LS.set("ledgr_active_account", data.active_account || "ALL");
          toast("Imported");
          renderRoute();
        },
      });
    } catch {
      toast("Invalid backup file", "error");
    }
  };
  reader.readAsText(file);
  ev.target.value = "";
}

function confirmReset() {
  confirmDialog({
    title: "Reset all data?",
    message: "Wipes every account, trade, journal entry and custom instrument from this browser. Cannot be undone.",
    onOk: () => {
      ["ledgr_accounts", "ledgr_trades", "ledgr_journal", "ledgr_custom_instruments", "ledgr_active_account", "ledgr_entered"]
        .forEach((k) => localStorage.removeItem(k));
      initData();
      toast("Reset complete");
      location.hash = "";
      showLanding();
    },
  });
}

/* ========== BOOT ========== */
initData();
initSupabase();

// PWA — register service worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

// PWA — install prompt
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  showInstallButton();
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  hideInstallButton();
  toast("Installed — find LEDGR on your home screen");
});
function showInstallButton() {
  let b = document.getElementById("install-btn");
  if (b) return;
  b = document.createElement("button");
  b.id = "install-btn";
  b.className = "btn-secondary";
  b.style.cssText = "position:fixed;bottom:24px;left:24px;z-index:90;padding:8px 14px;font-size:12px;display:inline-flex;gap:6px;align-items:center";
  b.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Install app`;
  b.onclick = async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === "accepted") hideInstallButton();
    deferredInstallPrompt = null;
  };
  document.body.appendChild(b);
}
function hideInstallButton() {
  const b = document.getElementById("install-btn");
  if (b) b.remove();
}

// Realtime sync — subscribe to changes after sign-in
let realtimeChannel = null;
function startRealtime() {
  if (!supa || !currentUser) return;
  if (realtimeChannel) return;
  realtimeChannel = supa
    .channel("ledgr-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "trades", filter: `user_id=eq.${currentUser.id}` }, () => debouncedPull())
    .on("postgres_changes", { event: "*", schema: "public", table: "accounts", filter: `user_id=eq.${currentUser.id}` }, () => debouncedPull())
    .on("postgres_changes", { event: "*", schema: "public", table: "journal", filter: `user_id=eq.${currentUser.id}` }, () => debouncedPull())
    .on("postgres_changes", { event: "*", schema: "public", table: "custom_instruments", filter: `user_id=eq.${currentUser.id}` }, () => debouncedPull())
    .subscribe();
}
function stopRealtime() {
  if (realtimeChannel) { supa.removeChannel(realtimeChannel); realtimeChannel = null; }
}
let pullTimeout = null;
function debouncedPull() {
  clearTimeout(pullTimeout);
  pullTimeout = setTimeout(async () => {
    await pullAllFromCloud();
    renderRoute();
  }, 600);
}

function handleBoot() {
  // Only skip landing if there's an explicit non-auth route in the hash
  // (i.e., user navigated directly to a page like #/dashboard or #/history)
  const hashIsRoute = location.hash && !location.hash.includes("access_token") && !location.hash.includes("error=") && location.hash.match(/#\/(dashboard|add-trade|history|calendar|journal|settings)/);
  if (hashIsRoute) {
    document.getElementById("landing").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
    renderRoute();
  } else {
    // Always show landing on fresh load / OAuth callback
    document.getElementById("landing").classList.remove("hidden");
    document.getElementById("app").classList.add("hidden");
    renderLandingCTA();
  }
}

handleBoot();
initAuth();

window.addEventListener("hashchange", () => {
  if (location.hash.includes("access_token") || location.hash.includes("error=")) return;
  // If app shell is visible, just re-render the route
  const appVisible = !document.getElementById("app").classList.contains("hidden");
  if (appVisible) {
    renderRoute();
  }
});

// Inject spin keyframe
(() => {
  const s = document.createElement("style");
  s.textContent = "@keyframes spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }";
  document.head.appendChild(s);
})();
