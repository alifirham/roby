// /api/setup-webhook?key=...            -> sambung webhook bot ke domain yang sedang dibuka + semak status
// /api/setup-webhook?key=...&action=info -> semak status sahaja (tak ubah apa-apa)
import { json, checkKey, tg, ensureSchema } from "../_lib.js";

export async function onRequestGet({ request, env }) {
  if (!checkKey(request, env)) return json({ ok: false, error: "kunci salah" }, 401);

  const missing = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_CHANNEL_ID", "META_PIXEL_ID", "REPORT_KEY"]
    .filter((k) => !env[k]);
  const out = {
    ok: true,
    secret_tiada: missing,
    meta_capi_token: env.META_CAPI_TOKEN ? "ada" : "belum ada (CAPI dilangkau)",
    meta_test_event_code: env.META_TEST_EVENT_CODE ? "ada (mod ujian)" : "tiada",
    d1_binding_DB: env.DB ? "ada" : "TIADA",
  };
  if (env.DB) {
    try { await ensureSchema(env); out.d1_jadual = "sedia"; } catch (e) { out.d1_jadual = "ralat: " + e.message; }
  }
  if (!env.TELEGRAM_BOT_TOKEN) return json({ ...out, ok: false });

  const url = new URL(request.url);
  if (url.searchParams.get("action") !== "info") {
    if (!env.TELEGRAM_WEBHOOK_SECRET) return json({ ...out, ok: false, error: "TELEGRAM_WEBHOOK_SECRET kosong" }, 400);
    out.setWebhook = await tg(env, "setWebhook", {
      url: `${url.origin}/api/telegram`,
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ["chat_member", "my_chat_member"],
      max_connections: 20,
    });
  }

  const me = await tg(env, "getMe");
  out.bot = me.ok ? "@" + me.result.username : me.description;
  const info = await tg(env, "getWebhookInfo");
  if (info.ok) {
    const w = info.result;
    out.webhook = {
      url: w.url,
      allowed_updates: w.allowed_updates,
      pending: w.pending_update_count,
      ralat_terakhir: w.last_error_message || null,
    };
  }
  if (env.TELEGRAM_CHANNEL_ID && me.ok) {
    const m = await tg(env, "getChatMember", { chat_id: env.TELEGRAM_CHANNEL_ID, user_id: me.result.id });
    out.bot_dalam_channel = m.ok
      ? { status: m.result.status, boleh_cipta_link: !!m.result.can_invite_users }
      : m.description;
  }
  return json(out);
}
