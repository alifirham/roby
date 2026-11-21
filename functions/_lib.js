// Kod kongsi untuk semua endpoint /api/*. Fail ini bukan route (tiada onRequest).

// Link statik per iklan (SAMA dengan LINKS dalam index.html). Kalau tukar LINKS, tukar di sini juga.
export const STATIC_LINKS = {
  B01: "NJhU4ecLvyo2MGM9",
  C01: "yqoM0S3CWTlhYTJl",
  B03: "74wuphP2Fr5mMzE1",
  A01: "9-7atk2jM-RmZmE1",
};

// Telegram sorok hujung link yang bukan dicipta bot (cth. "https://t.me/+74wuphP2...").
// Padankan awalan itu dengan STATIC_LINKS -> kod iklan, atau null.
export function staticAdFor(inviteLink) {
  const m = /\/(?:\+|joinchat\/)([\w-]+)/.exec(String(inviteLink || ""));
  if (!m || m[1].length < 4) return null;
  for (const [ad, hash] of Object.entries(STATIC_LINKS)) if (hash.startsWith(m[1])) return ad;
  return null;
}

export const LINK_TTL_SECONDS = 24 * 3600;      // link unik luput sendiri selepas 24 jam
export const MAX_LINKS_PER_IP_PER_HOUR = 20;    // had kasar anti-spam (ramai pengguna mobile kongsi IP)
export const MYT_OFFSET_SECONDS = 8 * 3600;     // waktu Malaysia UTC+8
const DEFAULT_GRAPH_VERSION = "v24.0";

// Jadual D1 (sama dengan schema.sql). Dicipta automatik oleh /api/setup-webhook.
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS links (id INTEGER PRIMARY KEY AUTOINCREMENT, invite_link TEXT NOT NULL UNIQUE, ad TEXT NOT NULL, created_at INTEGER NOT NULL, expire_at INTEGER NOT NULL, fbc TEXT, fbp TEXT, ip TEXT, ua TEXT, url TEXT, used_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS links_ip_created ON links(ip, created_at)`,
  `CREATE INDEX IF NOT EXISTS links_created ON links(created_at)`,
  `CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, update_id INTEGER UNIQUE, type TEXT NOT NULL, ts INTEGER NOT NULL, user_hash TEXT NOT NULL, source TEXT NOT NULL, ad TEXT, link_id INTEGER, invite_name TEXT, capi_status TEXT, capi_detail TEXT, event_id TEXT)`,
  `CREATE INDEX IF NOT EXISTS events_ts ON events(ts)`,
  `CREATE INDEX IF NOT EXISTS events_user ON events(user_hash, type)`,
];

export async function ensureSchema(env) {
  await env.DB.batch(SCHEMA.map((q) => env.DB.prepare(q)));
}

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

export function now() {
  return Math.floor(Date.now() / 1000);
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Banding rentetan tanpa bocor masa (untuk kunci/secret)
export function safeEqual(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function checkKey(request, env) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") || request.headers.get("x-report-key");
  return safeEqual(key, env.REPORT_KEY);
}

export function getCookie(request, name) {
  const c = request.headers.get("cookie") || "";
  const m = c.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

// Crawler / bot / preview link, jangan cipta invite link untuk mereka
export function isBot(ua) {
  if (!ua) return true;
  return /bot|crawl|spider|slurp|facebookexternalhit|facebookcatalog|meta-externalagent|meta-externalfetcher|preview|headless|lighthouse|curl|wget|python|go-http|java\/|okhttp|axios|node-fetch/i.test(ua);
}

export function normAd(v) {
  const ad = String(v || "").trim().toUpperCase();
  return /^[A-Z0-9_-]{1,12}$/.test(ad) ? ad : null;
}

// Panggil Telegram Bot API
export async function tg(env, method, params = {}, timeoutMs = 8000) {
  try {
    const r = await fetch(`${env.TEST_TELEGRAM_API_BASE || "https://api.telegram.org"}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return await r.json();
  } catch (e) {
    return { ok: false, description: "fetch error: " + (e && e.message) };
  }
}

// Hari (YYYY-MM-DD) waktu Malaysia -> julat unix saat [mula, tamat)
export function mytDayRange(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || "");
  if (!m) return null;
  const start = Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000 - MYT_OFFSET_SECONDS;
  return [start, start + 86400];
}

export function mytToday() {
  return new Date((now() + MYT_OFFSET_SECONDS) * 1000).toISOString().slice(0, 10);
}

/**
 * Hantar satu event Subscribe ke Meta Conversions API.
 * link = baris dari jadual links; ev = { ts, user_hash, event_id }
 * Pulang { status: 'berjaya'|'gagal'|'tiada_token', detail }
 */
export async function sendSubscribe(env, link, ev) {
  if (!env.META_CAPI_TOKEN || !env.META_PIXEL_ID) {
    return { status: "tiada_token", detail: !env.META_PIXEL_ID ? "META_PIXEL_ID kosong" : "META_CAPI_TOKEN kosong" };
  }
  const user_data = { external_id: [ev.user_hash] };
  if (link.ip) user_data.client_ip_address = link.ip;
  if (link.ua) user_data.client_user_agent = link.ua;
  if (link.fbc) user_data.fbc = link.fbc;
  if (link.fbp) user_data.fbp = link.fbp;

  const body = {
    data: [
      {
        event_name: "Subscribe",
        event_time: ev.ts,
        event_id: ev.event_id,
        action_source: "website",
        event_source_url: link.url || "https://robysultan.pages.dev/",
        user_data,
        custom_data: { content_name: link.ad },
      },
    ],
  };
  if (env.META_TEST_EVENT_CODE) body.test_event_code = env.META_TEST_EVENT_CODE;

  const ver = env.META_API_VERSION || DEFAULT_GRAPH_VERSION;
  try {
    const r = await fetch(
      `${env.TEST_META_API_BASE || "https://graph.facebook.com"}/${ver}/${env.META_PIXEL_ID}/events?access_token=${encodeURIComponent(env.META_CAPI_TOKEN)}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) }
    );
    const txt = await r.text();
    const detail = (env.META_TEST_EVENT_CODE ? "[test] " : "") + txt.slice(0, 500);
    return { status: r.ok ? "berjaya" : "gagal", detail };
  } catch (e) {
    return { status: "gagal", detail: "fetch error: " + (e && e.message) };
  }
}
