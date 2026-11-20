// /api/capi-resend?key=...
// Hantar semula Subscribe untuk join iklan yang status 'tiada_token' / 'gagal' / masih menunggu,
// dalam 7 hari terakhir (Meta tolak event lebih lama). Guna selepas META_CAPI_TOKEN dimasukkan.
// Tambah &dry=1 untuk lihat berapa yang akan dihantar tanpa menghantar.
import { json, checkKey, now, sendSubscribe } from "../_lib.js";

export async function onRequestGet({ request, env }) {
  if (!checkKey(request, env)) return json({ ok: false, error: "kunci salah" }, 401);
  if (!env.DB) return json({ ok: false, error: "tiada DB" }, 503);
  const dry = new URL(request.url).searchParams.get("dry") === "1";

  const minTs = now() - 7 * 86400 + 600; // margin 10 minit
  const { results } = await env.DB.prepare(
    `SELECT e.id AS eid, e.ts, e.user_hash, e.event_id, l.*
       FROM events e JOIN links l ON l.id = e.link_id
      WHERE e.type = 'join' AND e.source = 'iklan' AND e.ts >= ?
        AND (e.capi_status IS NULL OR e.capi_status IN ('tiada_token','gagal'))
      ORDER BY e.ts LIMIT 40`
  ).bind(minTs).all();

  if (dry) return json({ ok: true, akan_dihantar: results.length, nota: "maks 40 setiap panggilan" });

  const out = { berjaya: 0, gagal: 0, tiada_token: 0 };
  for (const row of results) {
    const r = await sendSubscribe(env, row, { ts: row.ts, user_hash: row.user_hash, event_id: row.event_id });
    out[r.status] = (out[r.status] || 0) + 1;
    await env.DB.prepare("UPDATE events SET capi_status = ?, capi_detail = ? WHERE id = ?").bind(r.status, r.detail, row.eid).run();
    if (r.status === "tiada_token") break;
  }
  return json({ ok: true, diproses: results.length, ...out, nota: "Kalau diproses = 40, buka URL ini sekali lagi." });
}
