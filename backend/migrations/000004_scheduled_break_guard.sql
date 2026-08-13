ALTER TABLE attendance_policies
    ADD COLUMN prevent_unscheduled_break BOOLEAN NOT NULL DEFAULT FALSE AFTER unscheduled_break_requires_approval;
