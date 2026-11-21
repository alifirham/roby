# Roby Sultan Gold Flip: landing page + link unik Telegram + Meta CAPI

Landing page iklan Meta ke channel Telegram @robysultangoldflip. Live di https://robysultan.pages.dev (Cloudflare Pages, auto-deploy dari `main`).

## Cara ia berfungsi
1. Pelawat buka `/?ad=B03`. Page terus guna link statik dalam `LINKS` (supaya butang sentiasa jalan).
2. Serentak, page panggil `/api/link`. Bot cipta invite link unik (sekali guna, luput 24 jam, nama `B03 xxxxxx`). Page tukar butang ke link unik itu (disimpan dalam sessionStorage).
3. Pelawat join channel. Telegram hantar update ke `/api/telegram`. Bot padankan link → kod iklan, rekod join, hantar `Subscribe` ke Meta CAPI.
4. Join dari link lain (statik/Telegram Ads/organik) direkod sebagai "lain", tidak dihantar ke CAPI. Orang keluar channel turut direkod.

## Fail
| Fail | Fungsi |
|---|---|
| `index.html` | Landing page. Pixel `PageView` + `Lead` kekal. Ambil link unik dari `/api/link`, fallback ke `LINKS`. |
| `functions/_lib.js` | Kod kongsi: hash, panggil Telegram, hantar CAPI, jadual D1. |
| `functions/api/link.js` | `POST/GET /api/link?ad=B03`: cipta link unik, simpan IP/UA/fbc/fbp/URL. |
| `functions/api/telegram.js` | Webhook bot (disahkan dengan `secret_token`). Rekod join/keluar, hantar `Subscribe`. |
| `functions/api/report.js` | `GET /api/report?key=..&date=YYYY-MM-DD[&format=text]`: laporan harian waktu Malaysia. |
| `functions/api/setup-webhook.js` | `GET /api/setup-webhook?key=..`: cipta jadual D1, sambung webhook, semak status bot. `&action=info` = semak sahaja. |
| `functions/api/capi-resend.js` | `GET /api/capi-resend?key=..[&dry=1]`: hantar semula `Subscribe` yang belum/gagal dihantar (≤ 7 hari). |
| `functions/api/debug.js` | `GET /api/debug?key=..`: 10 link & 10 event terakhir, untuk semak masalah. |
| `schema.sql` | Rujukan struktur jadual D1 (dicipta automatik oleh setup-webhook). |

## Binding & env var (Cloudflare Pages → Settings → Bindings / Variables and Secrets)
Set untuk **Production** dan **Preview**.

| Nama | Jenis | Isi |
|---|---|---|
| `DB` | D1 binding | database D1 `robysultan` |
| `TELEGRAM_BOT_TOKEN` | Secret | token dari @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Secret | rentetan rawak (A-Z, a-z, 0-9, `_`, `-`), 20–60 aksara |
| `TELEGRAM_CHANNEL_ID` | Text | `@robysultangoldflip` |
| `META_PIXEL_ID` | Text | `1130995922869434` |
| `META_CAPI_TOKEN` | Secret | token Conversions API (boleh kosong dulu) |
| `META_TEST_EVENT_CODE` | Text (pilihan) | kod dari Events Manager → Test Events. **Buang selepas ujian.** |
| `META_API_VERSION` | Text (pilihan) | versi Graph API, lalai `v24.0` |
| `REPORT_KEY` | Secret | kunci rawak untuk report/setup/resend |

`TEST_TELEGRAM_API_BASE` / `TEST_META_API_BASE` hanya untuk ujian lokal. Jangan set di Cloudflare.

## Cara uji
1. Buka `https://<preview>/api/setup-webhook?key=REPORT_KEY` → semua mesti "ada"/"sedia", `boleh_cipta_link: true`.
2. Buka `https://<preview>/?ad=B03` → tekan lama butang Join, salin link → mesti `t.me/+...` yang bukan `74wuphP2Fr5mMzE1`.
3. Join dengan akaun ujian → `/api/report?key=..&format=text` tunjuk `B03: 1`.
4. Dengan `META_TEST_EVENT_CODE` → `Subscribe` muncul di Events Manager → Test Events.
5. Buang `TELEGRAM_BOT_TOKEN` sementara (redeploy) → butang guna link statik semula.

## Nota penting
- Akaun Telegram yang pernah join melalui link lain akan dikira melalui link asal itu bila join semula (tingkah laku Telegram). Jadi untuk ujian, guna akaun yang belum pernah join.
- Webhook bot hanya boleh tunjuk ke satu URL. Selepas merge ke `main`, buka `https://robysultan.pages.dev/api/setup-webhook?key=..` supaya webhook beralih ke production.

## Nota had
- Link unik luput sendiri selepas 24 jam, jadi tiada link aktif yang bertimbun. Rekod link tak dipakai > 30 hari dipadam automatik.
- Had kasar 20 link / IP / jam. Lebih dari itu, page guna link statik.
- Kalau Telegram tolak (cth. 429 terlalu banyak permintaan), page guna link statik. Join tetap berlaku, cuma direkod sebagai "lain".
