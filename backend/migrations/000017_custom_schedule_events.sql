ALTER TABLE shifts
    ADD COLUMN schedule_type VARCHAR(16) NOT NULL DEFAULT 'SHIFT' AFTER title,
    ADD COLUMN showroom_name VARCHAR(180) NULL AFTER role_name,
    ADD CONSTRAINT chk_shifts_schedule_type CHECK (schedule_type IN ('SHIFT', 'EVENT'));
