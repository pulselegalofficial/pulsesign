-- Company seals (ตราประทับ), folders for completed documents, and staff-only
-- attachments kept beside a document.

-- A signer who affixes a company seal states which entity it belongs to and
-- confirms they may seal on its behalf. The SHA-256 of the seal image is kept
-- as evidence and printed on the certificate.
ALTER TABLE signers ADD COLUMN stamp_entity TEXT;
ALTER TABLE signers ADD COLUMN stamp_sha256 TEXT;
ALTER TABLE signers ADD COLUMN stamp_authority_at INTEGER;

-- Folders only organise documents in the dashboard. Moving a document between
-- folders changes nothing in the document, its hashes or its audit trail.
CREATE TABLE folders (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
ALTER TABLE documents ADD COLUMN folder_id TEXT;
CREATE INDEX documents_folder ON documents (folder_id);

-- Files staff keep with a document for reference (supporting documents,
-- receipts). Stored in R2 under docs/<id>/attachments/, never stamped into the
-- signed PDF, so they do not affect hash_before or hash_final. Staff only:
-- not shown to signers and not returned by /verify.
CREATE TABLE attachments (
  id            TEXT PRIMARY KEY,
  doc_id        TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size          INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  r2_key        TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  uploaded_by   TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX attachments_doc ON attachments (doc_id, created_at);
