-- Language of the emails and signing page for each signer ('th' or 'en').
ALTER TABLE signers ADD COLUMN lang TEXT NOT NULL DEFAULT 'th';
