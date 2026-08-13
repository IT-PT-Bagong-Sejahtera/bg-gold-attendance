CREATE TABLE dynamic_qr_nonces (
    id BINARY(16) PRIMARY KEY,
    organization_id BINARY(16) NOT NULL,
    section_id BINARY(16) NOT NULL,
    created_by BINARY(16) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    KEY idx_dynamic_qr_expiry (organization_id, section_id, expires_at),
    CONSTRAINT fk_dynamic_qr_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_dynamic_qr_section FOREIGN KEY (section_id) REFERENCES sections(id),
    CONSTRAINT fk_dynamic_qr_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;
