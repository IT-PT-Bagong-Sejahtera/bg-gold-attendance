ALTER TABLE organization_memberships
    ADD COLUMN kiosk_pin_hash VARCHAR(255) NULL AFTER job_title;

CREATE TABLE kiosk_devices (
    id BINARY(16) PRIMARY KEY,
    organization_id BINARY(16) NOT NULL,
    section_id BINARY(16) NOT NULL,
    installation_hash BINARY(32) NOT NULL,
    token_hash BINARY(32) NOT NULL,
    device_label VARCHAR(120) NOT NULL,
    platform VARCHAR(32) NULL,
    device_model VARCHAR(120) NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    activated_by BINARY(16) NOT NULL,
    activated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    last_seen_at DATETIME(6) NULL,
    revoked_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_kiosk_org_installation (organization_id, installation_hash),
    UNIQUE KEY uq_kiosk_token_hash (token_hash),
    KEY idx_kiosk_org_section_status (organization_id, section_id, status),
    CONSTRAINT fk_kiosk_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_kiosk_section FOREIGN KEY (section_id) REFERENCES sections(id),
    CONSTRAINT fk_kiosk_activated_by FOREIGN KEY (activated_by) REFERENCES users(id),
    CONSTRAINT chk_kiosk_status CHECK (status IN ('ACTIVE', 'REVOKED'))
) ENGINE=InnoDB;

ALTER TABLE attendance_evidence
    ADD COLUMN kiosk_device_id BINARY(16) NULL AFTER device_id,
    ADD CONSTRAINT fk_attendance_evidence_kiosk_device
        FOREIGN KEY (kiosk_device_id) REFERENCES kiosk_devices(id);
