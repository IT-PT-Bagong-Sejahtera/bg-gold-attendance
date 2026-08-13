ALTER TABLE attachments ADD COLUMN deleted_at DATETIME(6) NULL AFTER retention_until;
CREATE INDEX idx_attachments_retention ON attachments(deleted_at,retention_until);
