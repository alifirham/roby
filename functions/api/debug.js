// /api/debug?key=...  -> 10 link unik & 10 event terakhir (untuk semak masalah). Tiada data peribadi penuh.
import { json, checkKey } from "../_lib.js";

const myt = (t) => (t ? new Date((t + 8 * 3600) * 1000).toISOString().slice(0, 19).replace("T", " ") : null);

export async function onRequestGet({ request, env }) {
  if (!checkKey(request, env)) return json({ ok: false, error: "kunci salah" }, 401);
  const links = await env.DB.prepare(
    "SELECT id, ad, invite_link, created_at, used_at, fbp IS NOT NULL AS ada_fbp, fbc IS NOT NULL AS ada_fbc, substr(ua,1,60) AS ua FROM links ORDER BY id DESC LIMIT 10"
  ).all();
  const events = await env.DB.prepare(
    "SELECT id, type, ts, source, ad, link_id, invite_name, capi_status, substr(capi_detail,1,300) AS detail, substr(user_hash,1,8) AS user FROM events ORDER BY id DESC LIMIT 10"
  ).all();
  return json({
    ok: true,
    links: links.results.map((l) => ({ ...l, created_at: myt(l.created_at), used_at: myt(l.used_at) })),
    events: events.results.map((e) => ({ ...e, ts: myt(e.ts) })),
  });
}
