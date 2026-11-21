// /api/link: cipta invite link Telegram unik untuk seorang pelawat landing page.
// Page panggil sekali semasa dimuat. Kalau gagal, page guna link statik (LINKS) sedia ada.
import { json, now, isBot, normAd, getCookie, tg, LINK_TTL_SECONDS, MAX_LINKS_PER_IP_PER_HOUR } from "../_lib.js";

const FB_COOKIE = /^fb\.\d\.\d{10,16}\.[\w.-]{1,300}$/;

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "GET" && request.method !== "POST") return json({ ok: false, error: "method" }, 405);
  if (!env.DB || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHANNEL_ID) {
    return json({ ok: false, error: "belum_disetup" }, 503);
  }

  const reqUrl = new URL(request.url);
  let body = {};
  if (request.method === "POST") {
    try { body = await request.json(); } catch (_) { body = {}; }
  }

  // Kemas kini cookie Pixel untuk link yang sudah dicipta (dihantar semasa klik)
  if (body.update) {
    const h = String(body.update);
    let fbp = FB_COOKIE.test(body.fbp || "") ? body.fbp : null;
    let fbc = FB_COOKIE.test(body.fbc || "") ? body.fbc : null;
    if (/^[\w-]{8,64}$/.test(h) && (fbp || fbc)) {
      await env.DB.prepare(
        "UPDATE links SET fbp = COALESCE(fbp, ?), fbc = COALESCE(fbc, ?) WHERE invite_link = ? AND used_at IS NULL"
      ).bind(fbp, fbc, "https://t.me/+" + h).run();
    }
    return json({ ok: true });
  }

  const ad = normAd(body.ad || reqUrl.searchParams.get("ad"));
  if (!ad) return json({ ok: false, error: "ad_tidak_sah" }, 400);

  const ua = request.headers.get("user-agent") || "";
  if (isBot(ua)) return json({ ok: false, error: "bot" }, 403);

  const ip = request.headers.get("cf-connecting-ip") || "";
  const t = now();

  // Had kasar per IP supaya orang tak boleh habiskan link
  if (ip) {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM links WHERE ip = ? AND created_at > ?")
      .bind(ip, t - 3600).first();
    if (row && row.n >= MAX_LINKS_PER_IP_PER_HOUR) return json({ ok: false, error: "terlalu_banyak" }, 429);
  }

  // URL penuh landing page (dari page; kalau tiada, guna Referer)
  let pageUrl = String(body.url || request.headers.get("referer") || "").slice(0, 1000);
  if (!/^https:\/\//.test(pageUrl)) pageUrl = reqUrl.origin + "/?ad=" + ad;

  // _fbc: cookie > dari page > bina dari fbclid
  let fbc = getCookie(request, "_fbc") || body.fbc || null;
  if (fbc && !FB_COOKIE.test(fbc)) fbc = null;
  if (!fbc) {
    let fbclid = body.fbclid || null;
    if (!fbclid) { try { fbclid = new URL(pageUrl).searchParams.get("fbclid"); } catch (_) {} }
    if (fbclid && /^[\w.-]{1,300}$/.test(fbclid)) fbc = `fb.1.${Date.now()}.${fbclid}`;
  }
  let fbp = getCookie(request, "_fbp") || body.fbp || null;
  if (fbp && !FB_COOKIE.test(fbp)) fbp = null;

  // Cipta link: guna sekali sahaja, luput sendiri
  const tag = Math.random().toString(36).slice(2, 8);
  const expire = t + LINK_TTL_SECONDS;
  const res = await tg(env, "createChatInviteLink", {
    chat_id: env.TELEGRAM_CHANNEL_ID,
    name: `${ad} ${tag}`.slice(0, 32),
    expire_date: expire,
    member_limit: 1,
  }, 5000);
  if (!res.ok || !res.result || !res.result.invite_link) {
    console.log("createChatInviteLink gagal", JSON.stringify(res).slice(0, 300));
    return json({ ok: false, error: "telegram", detail: res.description || null }, 502);
  }
  const link = res.result.invite_link;

  await env.DB.prepare(
    "INSERT INTO links (invite_link, ad, created_at, expire_at, fbc, fbp, ip, ua, url) VALUES (?,?,?,?,?,?,?,?,?)"
  ).bind(link, ad, t, expire, fbc, fbp, ip || null, ua.slice(0, 500), pageUrl).run();

  // Kemas sekali-sekala: buang rekod link lama yang tak pernah dipakai (> 30 hari)
  if (Math.random() < 0.02) {
    context.waitUntil(env.DB.prepare("DELETE FROM links WHERE used_at IS NULL AND created_at < ?").bind(t - 30 * 86400).run());
  }

  const hash = link.split("/+").pop().split("/joinchat/").pop();
  return json({ ok: true, hash, expire_at: expire });
}
