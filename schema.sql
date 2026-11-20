-- Jadual D1 untuk sistem link unik + CAPI.
-- Rujukan sahaja: jadual ini dicipta automatik bila /api/setup-webhook dibuka.
-- (Boleh juga ditampal manual dalam Cloudflare D1 > Console.)

-- Satu baris = satu invite link unik yang dicipta untuk seorang pelawat landing page
CREATE TABLE IF NOT EXISTS links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  invite_link TEXT NOT NULL UNIQUE,   -- https://t.me/+xxxx
  ad          TEXT NOT NULL,          -- kod iklan, cth. B03
  created_at  INTEGER NOT NULL,       -- unix saat
  expire_at   INTEGER NOT NULL,
  fbc         TEXT,
  fbp         TEXT,
  ip          TEXT,
  ua          TEXT,
  url         TEXT,                   -- URL penuh landing page
  used_at     INTEGER                 -- bila link dipakai untuk join
);
CREATE INDEX IF NOT EXISTS links_ip_created ON links(ip, created_at);
CREATE INDEX IF NOT EXISTS links_created ON links(created_at);

-- Satu baris = satu join atau keluar channel
CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  update_id    INTEGER UNIQUE,        -- elak rekod berganda bila Telegram hantar semula
  type         TEXT NOT NULL,         -- 'join' | 'leave'
  ts           INTEGER NOT NULL,      -- masa join/keluar (unix saat)
  user_hash    TEXT NOT NULL,         -- SHA-256 tg user id
  source       TEXT NOT NULL,         -- 'iklan' | 'link_lain' | 'organik'
  ad           TEXT,                  -- kod iklan (join iklan, atau keluar oleh orang yang dulu join dari iklan)
  link_id      INTEGER,               -- rujuk links.id
  invite_name  TEXT,                  -- nama link (untuk link bukan dicipta bot)
  capi_status  TEXT,                  -- 'berjaya' | 'gagal' | 'tiada_token' | 'ulang' | NULL
  capi_detail  TEXT,
  event_id     TEXT
);
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS events_user ON events(user_hash, type);
