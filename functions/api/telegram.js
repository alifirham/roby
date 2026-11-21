// /api/telegram: webhook bot Telegram. Rekod join/keluar channel dan hantar Subscribe ke Meta CAPI.
import { json, sha256, safeEqual, sendSubscribe } from "../_lib.js";

function isIn(m) {
  if (!m) return false;
  if (m.status === "creator" || m.status === "administrator" || m.status === "member") return true;
  return m.status === "restricted" && !!m.is_member;
}

function isOurChannel(chat, env) {
  const want = String(env.TELEGRAM_CHANNEL_ID || "").trim();
  if (!want || !chat) return false;
  if (want.startsWith("@")) return (chat.username || "").toLowerCase() === want.slice(1).toLowerCase();
  return String(chat.id) === want;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!env.TELEGRAM_WEBHOOK_SECRET || !safeEqual(secret, env.TELEGRAM_WEBHOOK_SECRET)) {
    return json({ ok: false }, 401);
  }
  if (!env.DB) return json({ ok: false, error: "tiada DB" }, 503);

  let upd;
  try { upd = await request.json(); } catch (_) { return json({ ok: true }); }
  const cm = upd && upd.chat_member;
  if (!cm || !isOurChannel(cm.chat, env)) return json({ ok: true });

  const user = cm.new_chat_member && cm.new_chat_member.user;
  if (!user || user.is_bot) return json({ ok: true });

  const wasIn = isIn(cm.old_chat_member);
  const nowIn = isIn(cm.new_chat_member);
  if (wasIn === nowIn) return json({ ok: true });

  const userHash = await sha256(user.id);
  const ts = cm.date || Math.floor(Date.now() / 1000);

  try {
    if (nowIn) await handleJoin(context, upd.update_id, cm, userHash, ts);
    else await handleLeave(env, upd.update_id, userHash, ts);
  } catch (e) {
    console.log("webhook error", e && e.stack);
  }
  // Sentiasa 200 supaya Telegram tak hantar semula berulang kali
  return json({ ok: true });
}

async function handleJoin(context, updateId, cm, userHash, ts) {
  const { env } = context;
  const inv = cm.invite_link || null;
  let link = null;
  if (inv && inv.invite_link) {
    link = await env.DB.prepare("SELECT * FROM links WHERE invite_link = ?").bind(inv.invite_link).first();
  }

  if (!link) {
    // Join bukan dari link unik kita: rekod sahaja, JANGAN hantar CAPI
    const source = inv ? "link_lain" : "organik";
    const name = inv ? (inv.name || inv.invite_link || "").slice(0, 100) : (cm.via_chat_folder_invite_link ? "folder" : null);
    await env.DB.prepare(
      "INSERT OR IGNORE INTO events (update_id, type, ts, user_hash, source, invite_name, capi_detail) VALUES (?,?,?,?,?,?,?)"
    ).bind(updateId, "join", ts, userHash, source, name, inv ? "invite: " + JSON.stringify(inv).slice(0, 400) : null).run();
    return;
  }

  const eventId = `sub-${link.id}-${userHash.slice(0, 16)}`;
  // Pernah dihantar Subscribe untuk orang ini? (join semula) -> jangan kira dua kali di Meta
  const prev = await env.DB.prepare(
    "SELECT id FROM events WHERE user_hash = ? AND type = 'join' AND source = 'iklan' AND capi_status IN ('berjaya','tiada_token','gagal') LIMIT 1"
  ).bind(userHash).first();

  const ins = await env.DB.prepare(
    "INSERT OR IGNORE INTO events (update_id, type, ts, user_hash, source, ad, link_id, event_id, capi_status) VALUES (?,?,?,?,?,?,?,?,?)"
  ).bind(updateId, "join", ts, userHash, "iklan", link.ad, link.id, eventId, prev ? "ulang" : null).run();
  if (!ins.meta || !ins.meta.changes) return; // update berganda

  await env.DB.prepare("UPDATE links SET used_at = ? WHERE id = ?").bind(ts, link.id).run();
  if (prev) return;

  const rowId = ins.meta.last_row_id;
  context.waitUntil((async () => {
    const r = await sendSubscribe(env, link, { ts, user_hash: userHash, event_id: eventId });
    await env.DB.prepare("UPDATE events SET capi_status = ?, capi_detail = ? WHERE id = ?")
      .bind(r.status, r.detail, rowId).run();
  })());
}

async function handleLeave(env, updateId, userHash, ts) {
  // Kalau orang ini dulu join dari iklan, catat kod iklannya sekali
  const j = await env.DB.prepare(
    "SELECT ad FROM events WHERE user_hash = ? AND type = 'join' AND ad IS NOT NULL ORDER BY ts DESC LIMIT 1"
  ).bind(userHash).first();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO events (update_id, type, ts, user_hash, source, ad) VALUES (?,?,?,?,?,?)"
  ).bind(updateId, "leave", ts, userHash, j ? "iklan" : "lain", j ? j.ad : null).run();
}

export async function onRequestGet() {
  return json({ ok: true, info: "Webhook bot Telegram. Hanya Telegram yang POST ke sini." });
}
