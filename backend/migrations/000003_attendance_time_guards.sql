ALTER TABLE attendance_policies
    ADD COLUMN prevent_late_clock_in BOOLEAN NOT NULL DEFAULT FALSE AFTER prevent_early_clock_in,
    ADD COLUMN prevent_early_clock_out BOOLEAN NOT NULL DEFAULT FALSE AFTER prevent_late_clock_in,
    ADD COLUMN prevent_late_clock_out BOOLEAN NOT NULL DEFAULT FALSE AFTER prevent_early_clock_out;
