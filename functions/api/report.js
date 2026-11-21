// /api/report?date=YYYY-MM-DD&key=...  (tambah &format=text untuk teks ringkas)
// Join & keluar channel untuk satu hari waktu Malaysia (00:00-23:59 UTC+8).
import { json, checkKey, mytDayRange, mytToday } from "../_lib.js";

export async function onRequestGet({ request, env }) {
  if (!checkKey(request, env)) return json({ ok: false, error: "kunci salah" }, 401);
  if (!env.DB) return json({ ok: false, error: "tiada DB" }, 503);

  const url = new URL(request.url);
  const date = url.searchParams.get("date") || mytToday();
  const range = mytDayRange(date);
  if (!range) return json({ ok: false, error: "format tarikh: YYYY-MM-DD" }, 400);

  const { results } = await env.DB.prepare(
    `SELECT type, source, COALESCE(ad, '') AS ad, COALESCE(invite_name, '') AS name,
            COALESCE(capi_status, 'menunggu') AS capi, COUNT(*) AS n
       FROM events WHERE ts >= ? AND ts < ?
      GROUP BY type, source, ad, name, capi`
  ).bind(range[0], range[1]).all();

  const r = {
    ok: true,
    date,
    zon: "waktu Malaysia (UTC+8)",
    join: { jumlah: 0, iklan_meta_jumlah: 0, iklan_meta_ikut_iklan: {}, iklan_jumlah: 0, ikut_iklan: {}, fallback_jumlah: 0, fallback_ikut_iklan: {}, lain_jumlah: 0, lain_ikut_link: {}, organik: 0 },
    keluar: { jumlah: 0, ikut_iklan: {}, lain: 0 },
    bersih: 0,
    capi: { berjaya: 0, gagal: 0, tiada_token: 0, ulang: 0, menunggu: 0 },
    links_dicipta: 0,
  };

  for (const x of results) {
    if (x.type === "join") {
      r.join.jumlah += x.n;
      if (x.source === "iklan") {
        r.join.iklan_jumlah += x.n;
        r.join.ikut_iklan[x.ad] = (r.join.ikut_iklan[x.ad] || 0) + x.n;
        if (x.capi in r.capi) r.capi[x.capi] += x.n;
      } else if (x.source === "fallback") {
        r.join.fallback_jumlah += x.n;
        r.join.fallback_ikut_iklan[x.ad] = (r.join.fallback_ikut_iklan[x.ad] || 0) + x.n;
      } else if (x.source === "link_lain") {
        r.join.lain_jumlah += x.n;
        const k = x.name || "(tanpa nama)";
        r.join.lain_ikut_link[k] = (r.join.lain_ikut_link[k] || 0) + x.n;
      } else {
        r.join.lain_jumlah += x.n;
        r.join.organik += x.n;
      }
    } else if (x.type === "leave") {
      r.keluar.jumlah += x.n;
      if (x.ad) r.keluar.ikut_iklan[x.ad] = (r.keluar.ikut_iklan[x.ad] || 0) + x.n;
      else r.keluar.lain += x.n;
    }
  }
  r.bersih = r.join.jumlah - r.keluar.jumlah;
  r.join.iklan_meta_jumlah = r.join.iklan_jumlah + r.join.fallback_jumlah;
  for (const o of [r.join.ikut_iklan, r.join.fallback_ikut_iklan])
    for (const k in o) r.join.iklan_meta_ikut_iklan[k] = (r.join.iklan_meta_ikut_iklan[k] || 0) + o[k];

  const lc = await env.DB.prepare("SELECT COUNT(*) AS n FROM links WHERE created_at >= ? AND created_at < ?")
    .bind(range[0], range[1]).first();
  r.links_dicipta = lc ? lc.n : 0;

  if (url.searchParams.get("format") === "text") {
    const line = (o) => Object.keys(o).sort().map((k) => `  ${k}: ${o[k]}`).join("\n") || "  -";
    const t = [
      `Report ${date} (waktu Malaysia)`,
      `Join jumlah: ${r.join.jumlah}`,
      `Jumlah dari iklan Meta: ${r.join.iklan_meta_jumlah} (link unik ${r.join.iklan_jumlah} + fallback ${r.join.fallback_jumlah})`,
      Object.keys(r.join.iklan_meta_ikut_iklan).sort().map((k) =>
        `  ${k}: ${r.join.iklan_meta_ikut_iklan[k]} (unik ${r.join.ikut_iklan[k] || 0} + fallback ${r.join.fallback_ikut_iklan[k] || 0})`
      ).join("\n") || "  -",
      `Join sumber lain: ${r.join.lain_jumlah} (organik/tanpa link: ${r.join.organik})`,
      line(r.join.lain_ikut_link),
      `Sub keluar: ${r.keluar.jumlah}`,
      line(r.keluar.ikut_iklan),
      `  bukan dari iklan: ${r.keluar.lain}`,
      `Bersih: ${r.bersih}`,
      `CAPI Subscribe: berjaya ${r.capi.berjaya}, gagal ${r.capi.gagal}, tiada token ${r.capi.tiada_token}, ulang ${r.capi.ulang}, menunggu ${r.capi.menunggu}`,
      `Link unik dicipta: ${r.links_dicipta}`,
      "",
    ].join("\n");
    return new Response(t, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
  return json(r);
}
