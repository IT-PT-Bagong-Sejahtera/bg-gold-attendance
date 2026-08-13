CREATE TABLE dynamic_qr_consumptions (
    nonce_id BINARY(16) NOT NULL,
    membership_id BINARY(16) NOT NULL,
    consumed_at DATETIME(6) NOT NULL,
    PRIMARY KEY (nonce_id, membership_id),
    KEY idx_dynamic_qr_consumer (membership_id, consumed_at),
    CONSTRAINT fk_dynamic_qr_consumption_nonce FOREIGN KEY (nonce_id) REFERENCES dynamic_qr_nonces(id) ON DELETE CASCADE,
    CONSTRAINT fk_dynamic_qr_consumption_membership FOREIGN KEY (membership_id) REFERENCES organization_memberships(id)
) ENGINE=InnoDB;
