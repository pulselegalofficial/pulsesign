-- Pulse Sign schema. Times are Unix epoch milliseconds (UTC).

-- Staff who can sign in to the dashboard. Rows are created on first sign-in;
-- who may sign in at all is decided by STAFF_EMAILS.
CREATE TABLE users (
  email       TEXT PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);

-- One-time sign-in links. Only the SHA-256 of the token is stored.
CREATE TABLE login_tokens (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);
CREATE INDEX login_tokens_email ON login_tokens (email, expires_at);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);

-- Sequential document numbers per Buddhist-era year (PS-2569-0001).
CREATE TABLE counters (
  name   TEXT PRIMARY KEY,
  value  INTEGER NOT NULL
);

CREATE TABLE documents (
  id            TEXT PRIMARY KEY,
  owner_email   TEXT NOT NULL,
  title         TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  file_key      TEXT NOT NULL,
  file_size     INTEGER NOT NULL,
  pages         INTEGER NOT NULL,
  lang          TEXT NOT NULL DEFAULT 'th',
  -- draft | sent | opened | completed | declined | cancelled | expired
  status        TEXT NOT NULL,
  sequential    INTEGER NOT NULL DEFAULT 1,
  subject       TEXT NOT NULL DEFAULT '',
  message       TEXT NOT NULL DEFAULT '',
  expiry_days   INTEGER NOT NULL DEFAULT 14,
  -- SHA-256 of the uploaded file.
  hash_before   TEXT NOT NULL,
  -- SHA-256 of the final file people download (stamped pages + certificate).
  -- Kept here rather than printed on the certificate, since a file cannot
  -- contain its own hash; /verify looks it up.
  hash_final    TEXT,
  final_key     TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  sent_at       INTEGER,
  expires_at    INTEGER,
  completed_at  INTEGER
);
CREATE INDEX documents_owner ON documents (owner_email, updated_at DESC);
CREATE INDEX documents_hash_final ON documents (hash_final);

CREATE TABLE signers (
  id               TEXT PRIMARY KEY,
  doc_id           TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  position         INTEGER NOT NULL,
  name             TEXT NOT NULL,
  email            TEXT NOT NULL,
  -- waiting | sent | opened | signed | declined
  status           TEXT NOT NULL DEFAULT 'waiting',
  -- Signing link. Only the hash is stored; a reminder issues a new link.
  token_hash       TEXT UNIQUE,
  otp_hash         TEXT,
  otp_expires_at   INTEGER,
  otp_attempts     INTEGER NOT NULL DEFAULT 0,
  otp_sent_count   INTEGER NOT NULL DEFAULT 0,
  otp_last_sent_at INTEGER,
  -- Browser session issued after a correct OTP (HttpOnly cookie).
  session_hash     TEXT,
  session_expires  INTEGER,
  otp_verified_at  INTEGER,
  consent_at       INTEGER,
  signed_at        INTEGER,
  declined_at      INTEGER,
  decline_reason   TEXT,
  ip               TEXT,
  user_agent       TEXT
);
CREATE INDEX signers_doc ON signers (doc_id, position);

CREATE TABLE fields (
  id            TEXT PRIMARY KEY,
  doc_id        TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  signer_pos    INTEGER NOT NULL,
  -- sig | initial | name | date
  type          TEXT NOT NULL,
  page          INTEGER NOT NULL,
  -- Position and size as fractions (0..1) of the page as displayed.
  x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL,
  -- Text for name/date; R2 key of the PNG for sig/initial.
  value         TEXT,
  filled_at     INTEGER
);
CREATE INDEX fields_doc ON fields (doc_id);

-- Append-only audit trail. Never updated or deleted.
CREATE TABLE events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id       TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  at           INTEGER NOT NULL,
  -- created | sent | opened | otp_sent | otp_verified | otp_failed | consent
  -- | signed | declined | reminded | cancelled | expired | completed
  type         TEXT NOT NULL,
  actor_name   TEXT NOT NULL,
  actor_email  TEXT,
  detail       TEXT,
  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX events_doc ON events (doc_id, id);
