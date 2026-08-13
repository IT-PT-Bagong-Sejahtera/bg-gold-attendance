CREATE TABLE claim_types (
    id BINARY(16) PRIMARY KEY,
    organization_id BINARY(16) NOT NULL,
    code VARCHAR(30) NOT NULL,
    name VARCHAR(120) NOT NULL,
    receipt_required BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_claim_types_org_code (organization_id, code),
    KEY idx_claim_types_org_status (organization_id, status),
    CONSTRAINT fk_claim_types_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT chk_claim_types_status CHECK (status IN ('ACTIVE','ARCHIVED'))
) ENGINE=InnoDB;

CREATE TABLE claims (
    id BINARY(16) PRIMARY KEY,
    organization_id BINARY(16) NOT NULL,
    membership_id BINARY(16) NOT NULL,
    claim_type_id BINARY(16) NOT NULL,
    attachment_id BINARY(16) NULL,
    title VARCHAR(160) NOT NULL,
    amount DECIMAL(14,2) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'IDR',
    incurred_on DATE NOT NULL,
    notes VARCHAR(1000) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    ocr_status VARCHAR(24) NOT NULL DEFAULT 'NOT_CONFIGURED',
    requested_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_claim_attachment (attachment_id),
    KEY idx_claims_org_status_date (organization_id, status, requested_at),
    KEY idx_claims_member_date (membership_id, requested_at),
    CONSTRAINT fk_claims_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_claims_member FOREIGN KEY (membership_id) REFERENCES organization_memberships(id),
    CONSTRAINT fk_claims_type FOREIGN KEY (claim_type_id) REFERENCES claim_types(id),
    CONSTRAINT fk_claims_attachment FOREIGN KEY (attachment_id) REFERENCES attachments(id),
    CONSTRAINT chk_claims_amount CHECK (amount > 0),
    CONSTRAINT chk_claims_status CHECK (status IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')),
    CONSTRAINT chk_claims_ocr_status CHECK (ocr_status IN ('NOT_CONFIGURED','PENDING','COMPLETE','FAILED'))
) ENGINE=InnoDB;

CREATE TABLE claim_decisions (
    id BINARY(16) PRIMARY KEY,
    claim_id BINARY(16) NOT NULL,
    decision VARCHAR(20) NOT NULL,
    reason VARCHAR(500) NULL,
    decided_by BINARY(16) NOT NULL,
    decided_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    KEY idx_claim_decisions_claim (claim_id, decided_at),
    CONSTRAINT fk_claim_decisions_claim FOREIGN KEY (claim_id) REFERENCES claims(id),
    CONSTRAINT fk_claim_decisions_actor FOREIGN KEY (decided_by) REFERENCES users(id),
    CONSTRAINT chk_claim_decisions_value CHECK (decision IN ('APPROVED','REJECTED'))
) ENGINE=InnoDB;

INSERT IGNORE INTO permissions(code,description) VALUES
('claim.own','Manage own claims'),
('claim.read','Read organization claims'),
('claim.approve','Approve organization claims'),
('claim.manage','Manage claim types');

INSERT IGNORE INTO role_permissions(role_id,permission_code)
SELECT r.id,p.code FROM roles r JOIN permissions p ON p.code IN ('claim.own','claim.read','claim.approve','claim.manage') WHERE r.code IN ('OWNER','ADMIN','HR');
INSERT IGNORE INTO role_permissions(role_id,permission_code)
SELECT r.id,p.code FROM roles r JOIN permissions p ON p.code IN ('claim.own','claim.read','claim.approve') WHERE r.code='SUPERVISOR';
INSERT IGNORE INTO role_permissions(role_id,permission_code)
SELECT r.id,p.code FROM roles r JOIN permissions p ON p.code='claim.own' WHERE r.code='EMPLOYEE';
