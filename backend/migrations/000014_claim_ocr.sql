ALTER TABLE claims
    ADD COLUMN ocr_provider VARCHAR(80) NULL AFTER ocr_status,
    ADD COLUMN ocr_result JSON NULL AFTER ocr_provider;
