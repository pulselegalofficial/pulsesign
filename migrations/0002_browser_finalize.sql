-- Download link for the signed PDF, sent in the completion email. Resend
-- fetches the attachment from it, so the Worker never base64-encodes the PDF.
-- Only the SHA-256 of the token is stored.
ALTER TABLE documents ADD COLUMN final_token_hash TEXT;
ALTER TABLE documents ADD COLUMN final_token_expires INTEGER;
