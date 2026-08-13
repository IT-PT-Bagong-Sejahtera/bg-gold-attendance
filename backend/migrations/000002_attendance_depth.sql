ALTER TABLE attendance_policies
    ADD COLUMN work_more_requires_approval BOOLEAN NOT NULL DEFAULT FALSE AFTER unscheduled_requires_approval,
    ADD COLUMN unscheduled_break_requires_approval BOOLEAN NOT NULL DEFAULT FALSE AFTER work_more_requires_approval,
    ADD COLUMN scheduled_break_start_offset_minutes SMALLINT UNSIGNED NULL AFTER unscheduled_break_requires_approval,
    ADD COLUMN scheduled_break_end_offset_minutes SMALLINT UNSIGNED NULL AFTER scheduled_break_start_offset_minutes,
    ADD COLUMN break_rounding_minutes SMALLINT UNSIGNED NULL AFTER scheduled_break_end_offset_minutes;
