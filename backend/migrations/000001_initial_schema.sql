CREATE TABLE users (
    id BINARY(16) PRIMARY KEY,
    email VARCHAR(254) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(160) NOT NULL,
    locale VARCHAR(16) NOT NULL DEFAULT 'id-ID',
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_users_email (email),
    CONSTRAINT chk_users_status CHECK (status IN ('INVITED', 'ACTIVE', 'DISABLED'))
) ENGINE=InnoDB;

CREATE TABLE organizations (
    id BINARY(16) PRIMARY KEY,
    code VARCHAR(40) NOT NULL,
    name VARCHAR(160) NOT NULL,
    timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Jakarta',
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_organizations_code (code),
    CONSTRAINT chk_organizations_status CHECK (status IN ('ACTIVE', 'SUSPENDED'))
) ENGINE=InnoDB;

CREATE TABLE roles (
    id BINARY(16) PRIMARY KEY,
    organization_id BINARY(16) NULL,
    code VARCHAR(40) NOT NULL,
    name VARCHAR(100) NOT NULL,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_roles_scope_code (organization_id, code),
    CONSTRAINT fk_roles_organization FOREIGN KEY (organization_id) REFERENCES organizations(id)
) ENGINE=InnoDB;

CREATE TABLE permissions (
    code VARCHAR(80) PRIMARY KEY,
    description VARCHAR(255) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE role_permissions (
    role_id BINARY(16) NOT NULL,
    permission_code VARCHAR(80) NOT NULL,
    PRIMARY KEY (role_id, permission_code),
    CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_code) REFERENCES permissions(code) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE organization_memberships (
    id BINARY(16) PRIMARY KEY,
    organization_id BINARY(16) NOT NULL,
    user_id BINARY(16) NOT NULL,
    employee_number VARCHAR(64) NOT NULL,
    job_title VARCHAR(120) NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    joined_at DATE NULL,
    ended_at DATE NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_memberships_org_user (organization_id, user_id),
    UNIQUE KEY uq_memberships_employee_number (organization_id, employee_number),
    KEY idx_memberships_user_status (user_id, status),
    CONSTRAINT fk_memberships_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_memberships_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT chk_memberships_status CHECK (status IN ('INVITED', 'ACTIVE', 'INACTIVE'))
) ENGINE=InnoDB;

CREATE TABLE membership_roles (
    membership_id BINARY(16) NOT NULL,
    role_id BINARY(16) NOT NULL,
    PRIMARY KEY (membership_id, role_id),
    CONSTRAINT fk_membership_roles_membership FOREIGN KEY (membership_id) REFERENCES organization_memberships(id) ON DELETE CASCADE,
    CONSTRAINT fk_membership_roles_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE sections (
    id BINARY(16) PRIMARY KEY,
    organization_id BINARY(16) NOT NULL,
    code VARCHAR(40) NOT NULL,
    name VARCHAR(160) NOT NULL,
    address VARCHAR(500) NULL,
    timezone VARCHAR(64) NULL,
    latitude DECIMAL(10,7) NULL,
    longitude DECIMAL(10,7) NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_sections_org_code (organization_id, code),
    KEY idx_sections_org_status (organization_id, status),
    CONSTRAINT fk_sections_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT chk_sections_status CHECK (status IN ('ACTIVE', 'INACTIVE'))
) ENGINE=InnoDB;

CREATE TABLE section_memberships (
    section_id BINARY(16) NOT NULL,
    membership_id BINARY(16) NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (section_id, membership_id),
    CONSTRAINT fk_section_memberships_section FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE,
    CONSTRAINT fk_section_memberships_membership FOREIGN KEY (membership_id) REFERENCES organization_memberships(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE attendance_policies (
    id BINARY(16) PRIMARY KEY,
    organization_id BINARY(16) NOT NULL,
    name VARCHAR(160) NOT NULL,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    early_clock_in_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    late_clock_in_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    early_clock_out_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    late_clock_out_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    prevent_early_clock_in BOOLEAN NOT NULL DEFAULT FALSE,
    auto_clock_out BOOLEAN NOT NULL DEFAULT FALSE,
    unscheduled_requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
    selfie_required BOOLEAN NOT NULL DEFAULT FALSE,
    minimum_location_accuracy_meters DECIMAL(8,2) NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_attendance_policies_org_name_version (organization_id, name, version),
    CONSTRAINT fk_attendance_policies_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT chk_attendance_policies_status CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED'))
) ENGINE=InnoDB;

CREATE TABLE attendance_policy_modes (
    policy_id BINARY(16) NOT NULL,
    mode VARCHAR(40) NOT NULL,
    settings JSON NULL,
    PRIMARY KEY (policy_id, mode),
    CONSTRAINT fk_policy_modes_policy FOREIGN KEY (policy_id) REFERENCES attendance_policies(id) ON DELETE CASCADE,
    CONSTRAINT chk_policy_modes_mode CHECK (mode IN ('ANYWHERE', 'LOCATION_ONLY', 'GEOFENCE', 'DYNAMIC_QR', 'WIFI', 'SELFIE', 'FACE_VERIFICATION'))
) ENGINE=InnoDB;

CREATE TABLE policy_assignments (
    id BINARY(16) PRIMARY KEY,
    organization_id BINARY(16) NOT NULL,
    policy_id BINARY(16) NOT NULL,
    section_id BINARY(16) NULL,
    membership_id BINARY(16) NULL,
    valid_from DATETIME(6) NULL,
    valid_until DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    KEY idx_policy_assignment_resolve (organization_id, membership_id, section_id, valid_from, valid_until),
    CONSTRAINT fk_policy_assignments_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_policy_assignments_policy FOREIGN KEY (policy_id) REFERENCES attendance_policies(id),
    CONSTRAINT fk_policy_assignments_section FOREIGN KEY (section_id) REFERENCES sections(id),
    CONSTRAINT fk_policy_assignments_membership FOREIGN KEY (membership_id) REFERENCES organization_memberships(id),
    CONSTRAINT chk_policy_assignment_target CHECK (NOT (section_id IS NOT NULL AND membership_id IS NOT NULL))
) ENGINE=InnoDB;

CREATE TABLE shifts (
    id BINARY(16) PRIMARY KEY,
    organization_id BINARY(16) NOT NULL,
    section_id BINARY(16) NOT NULL,
    title VARCHAR(160) NOT NULL,
    role_name VARCHAR(120) NULL,
    starts_at DATETIME(6) NOT NULL,
    ends_at DATETIME(6) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
    published_at DATETIME(6) NULL,
    created_by BINARY(16) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    KEY idx_shifts_org_range (organization_id, starts_at, ends_at),
    KEY idx_shifts_section_range (section_id, starts_at, ends_at),
    CONSTRAINT fk_shifts_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_shifts_section FOREIGN KEY (section_id) REFERENCES sections(id),
    CONSTRAINT fk_shifts_creator FOREIGN KEY (created_by) REFERENCES users(id),
    CONSTRAINT chk_shifts_range CHECK (ends_at > starts_at),
    CONSTRAINT chk_shifts_status CHECK (status IN ('DRAFT', 'PUBLISHED', 'CANCELLED'))
) ENGINE=InnoDB;

CREATE TABLE shift_assignments (
    id BINARY(16) PRIMARY KEY,
    shift_id BINARY(16) NOT NULL,
    membership_id BINARY(16) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'ASSIGNED',
    acknowledged_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_shift_assignment (shift_id, membership_id),
    KEY idx_shift_assignments_membership (membership_id),
    CONSTRAINT fk_shift_assignments_shift FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
    CONSTRAINT fk_shift_assignments_membership FOREIGN KEY (membership_id) REFERENCES organization_memberships(id),
    CONSTRAINT chk_shift_assignments_status CHECK (status IN ('ASSIGNED', 'ACKNOWLEDGED', 'CANCELLED'))
) ENGINE=InnoDB;

CREATE TABLE refresh_sessions (
    id BINARY(16) PRIMARY KEY,
    user_id BINARY(16) NOT NULL,
    active_organization_id BINARY(16) NOT NULL,
    token_hash BINARY(32) NOT NULL,
    user_agent VARCHAR(500) NULL,
    ip_address VARBINARY(16) NULL,
    expires_at DATETIME(6) NOT NULL,
    rotated_at DATETIME(6) NULL,
    revoked_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    KEY idx_refresh_sessions_user (user_id, revoked_at, expires_at),
    CONSTRAINT fk_refresh_sessions_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_refresh_sessions_organization FOREIGN KEY (active_organization_id) REFERENCES organizations(id)
) ENGINE=InnoDB;

CREATE TABLE password_reset_tokens (
    id BINARY(16) PRIMARY KEY,
    user_id BINARY(16) NOT NULL,
    token_hash BINARY(32) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    used_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_password_reset_hash (token_hash),
    CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE attachments (
    id BINARY(16) PRIMARY KEY,
    organization_id BINARY(16) NOT NULL,
    owner_user_id BINARY(16) NOT NULL,
    purpose VARCHAR(40) NOT NULL,
    object_key VARCHAR(500) NOT NULL,
    content_type VARCHAR(120) NOT NULL,
    size_bytes BIGINT UNSIGNED NULL,
    checksum_sha256 BINARY(32) NULL,
    finalized_at DATETIME(6) NULL,
    retention_until DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_attachments_object_key (object_key),
    KEY idx_attachments_owner (organization_id, owner_user_id, purpose),
    CONSTRAINT fk_attachments_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_attachments_owner FOREIGN KEY (owner_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE attendance_state (
    membership_id BINARY(16) PRIMARY KEY,
    organization_id BINARY(16) NOT NULL,
    state VARCHAR(24) NOT NULL DEFAULT 'NOT_STARTED',
    active_shift_id BINARY(16) NULL,
    last_event_id BINARY(16) NULL,
    version BIGINT UNSIGNED NOT NULL DEFAULT 0,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    KEY idx_attendance_state_org (organization_id, state),
    CONSTRAINT fk_attendance_state_membership FOREIGN KEY (membership_id) REFERENCES organization_memberships(id),
    CONSTRAINT fk_attendance_state_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_attendance_state_shift FOREIGN KEY (active_shift_id) REFERENCES shifts(id),
    CONSTRAINT chk_attendance_state CHECK (state IN ('NOT_STARTED', 'WORKING', 'ON_BREAK', 'COMPLETED', 'PENDING'))
) ENGINE=InnoDB;

CREATE TABLE attendance_events (
    id BINARY(16) PRIMARY KEY,
    organization_id BINARY(16) NOT NULL,
    membership_id BINARY(16) NOT NULL,
    shift_id BINARY(16) NULL,
    section_id BINARY(16) NULL,
    policy_id BINARY(16) NOT NULL,
    action_type VARCHAR(32) NOT NULL,
    decision VARCHAR(24) NOT NULL,
    server_recorded_at DATETIME(6) NOT NULL,
    reason VARCHAR(500) NULL,
    policy_snapshot JSON NOT NULL,
    source VARCHAR(24) NOT NULL DEFAULT 'MOBILE',
    source_key VARCHAR(160) NULL,
    created_by BINARY(16) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_attendance_event_source (organization_id, source, source_key),
    KEY idx_attendance_events_member_time (membership_id, server_recorded_at),
    KEY idx_attendance_events_org_time (organization_id, server_recorded_at),
    CONSTRAINT fk_attendance_events_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_attendance_events_membership FOREIGN KEY (membership_id) REFERENCES organization_memberships(id),
    CONSTRAINT fk_attendance_events_shift FOREIGN KEY (shift_id) REFERENCES shifts(id),
    CONSTRAINT fk_attendance_events_section FOREIGN KEY (section_id) REFERENCES sections(id),
    CONSTRAINT fk_attendance_events_policy FOREIGN KEY (policy_id) REFERENCES attendance_policies(id),
    CONSTRAINT fk_attendance_events_creator FOREIGN KEY (created_by) REFERENCES users(id),
    CONSTRAINT chk_attendance_events_action CHECK (action_type IN ('CLOCK_IN', 'CLOCK_OUT', 'START_BREAK', 'END_BREAK', 'WORK_MORE', 'AUTO_CLOCK_OUT', 'CORRECTION')),
    CONSTRAINT chk_attendance_events_decision CHECK (decision IN ('APPROVED', 'PENDING', 'REJECTED'))
) ENGINE=InnoDB;

ALTER TABLE attendance_state
    ADD CONSTRAINT fk_attendance_state_last_event FOREIGN KEY (last_event_id) REFERENCES attendance_events(id);

CREATE TABLE attendance_evidence (
    event_id BINARY(16) PRIMARY KEY,
    latitude DECIMAL(10,7) NULL,
    longitude DECIMAL(10,7) NULL,
    accuracy_meters DECIMAL(8,2) NULL,
    location_captured_at DATETIME(6) NULL,
    attachment_id BINARY(16) NULL,
    device_id BINARY(16) NULL,
    ip_address VARBINARY(16) NULL,
    wifi_ssid VARCHAR(64) NULL,
    wifi_bssid_hash BINARY(32) NULL,
    integrity_verdict JSON NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT fk_attendance_evidence_event FOREIGN KEY (event_id) REFERENCES attendance_events(id),
    CONSTRAINT fk_attendance_evidence_attachment FOREIGN KEY (attachment_id) REFERENCES attachments(id)
) ENGINE=InnoDB;

CREATE TABLE idempotency_keys (
    id BINARY(16) PRIMARY KEY,
    organization_id BINARY(16) NOT NULL,
    user_id BINARY(16) NOT NULL,
    scope VARCHAR(80) NOT NULL,
    idempotency_key VARCHAR(160) NOT NULL,
    request_hash BINARY(32) NOT NULL,
    response_status SMALLINT UNSIGNED NULL,
    response_body JSON NULL,
    expires_at DATETIME(6) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_idempotency_actor_scope_key (organization_id, user_id, scope, idempotency_key),
    KEY idx_idempotency_expiry (expires_at),
    CONSTRAINT fk_idempotency_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_idempotency_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE attendance_requests (
    id BINARY(16) PRIMARY KEY,
    organization_id BINARY(16) NOT NULL,
    attendance_event_id BINARY(16) NOT NULL,
    membership_id BINARY(16) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    requested_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    decided_at DATETIME(6) NULL,
    UNIQUE KEY uq_attendance_request_event (attendance_event_id),
    KEY idx_attendance_requests_org_status (organization_id, status, requested_at),
    CONSTRAINT fk_attendance_requests_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_attendance_requests_event FOREIGN KEY (attendance_event_id) REFERENCES attendance_events(id),
    CONSTRAINT fk_attendance_requests_membership FOREIGN KEY (membership_id) REFERENCES organization_memberships(id),
    CONSTRAINT chk_attendance_requests_status CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'))
) ENGINE=InnoDB;

CREATE TABLE attendance_decisions (
    id BINARY(16) PRIMARY KEY,
    request_id BINARY(16) NOT NULL,
    decided_by BINARY(16) NOT NULL,
    decision VARCHAR(24) NOT NULL,
    reason VARCHAR(500) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_attendance_decision_request (request_id),
    CONSTRAINT fk_attendance_decisions_request FOREIGN KEY (request_id) REFERENCES attendance_requests(id),
    CONSTRAINT fk_attendance_decisions_actor FOREIGN KEY (decided_by) REFERENCES users(id),
    CONSTRAINT chk_attendance_decisions_decision CHECK (decision IN ('APPROVED', 'REJECTED'))
) ENGINE=InnoDB;

CREATE TABLE attendance_corrections (
    id BINARY(16) PRIMARY KEY,
    organization_id BINARY(16) NOT NULL,
    original_event_id BINARY(16) NOT NULL,
    correction_event_id BINARY(16) NOT NULL,
    reason VARCHAR(500) NOT NULL,
    created_by BINARY(16) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_attendance_correction_event (correction_event_id),
    CONSTRAINT fk_attendance_corrections_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_attendance_corrections_original FOREIGN KEY (original_event_id) REFERENCES attendance_events(id),
    CONSTRAINT fk_attendance_corrections_correction FOREIGN KEY (correction_event_id) REFERENCES attendance_events(id),
    CONSTRAINT fk_attendance_corrections_actor FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE device_registrations (
    id BINARY(16) PRIMARY KEY,
    organization_id BINARY(16) NOT NULL,
    user_id BINARY(16) NOT NULL,
    platform VARCHAR(24) NOT NULL,
    push_token VARCHAR(500) NULL,
    device_label VARCHAR(160) NULL,
    last_seen_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    revoked_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    KEY idx_devices_user (organization_id, user_id, revoked_at),
    CONSTRAINT fk_devices_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_devices_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT chk_devices_platform CHECK (platform IN ('ANDROID', 'IOS', 'WEB'))
) ENGINE=InnoDB;

ALTER TABLE attendance_evidence
    ADD CONSTRAINT fk_attendance_evidence_device FOREIGN KEY (device_id) REFERENCES device_registrations(id);

CREATE TABLE audit_logs (
    id BINARY(16) PRIMARY KEY,
    organization_id BINARY(16) NOT NULL,
    actor_user_id BINARY(16) NOT NULL,
    action VARCHAR(120) NOT NULL,
    resource_type VARCHAR(80) NOT NULL,
    resource_id BINARY(16) NULL,
    metadata JSON NULL,
    request_id VARCHAR(64) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    KEY idx_audit_org_time (organization_id, created_at),
    KEY idx_audit_resource (organization_id, resource_type, resource_id),
    CONSTRAINT fk_audit_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

INSERT INTO permissions(code, description) VALUES
('organization.manage', 'Manage organization settings'),
('employee.read', 'View employees'),
('employee.manage', 'Manage employees'),
('section.read', 'View work locations'),
('section.manage', 'Manage work locations'),
('policy.read', 'View attendance policies'),
('policy.manage', 'Manage attendance policies'),
('shift.read', 'View schedules'),
('shift.manage', 'Manage schedules'),
('attendance.own', 'Submit and view own attendance'),
('attendance.read', 'View organization attendance'),
('attendance.approve', 'Approve attendance requests'),
('attendance.correct', 'Create attendance corrections'),
('report.read', 'View and export reports'),
('audit.read', 'View audit history');
