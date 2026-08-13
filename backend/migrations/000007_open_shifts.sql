ALTER TABLE shifts ADD COLUMN is_open BOOLEAN NOT NULL DEFAULT FALSE AFTER published_at;

CREATE TABLE shift_requests (
    id BINARY(16) PRIMARY KEY,
    organization_id BINARY(16) NOT NULL,
    shift_id BINARY(16) NOT NULL,
    membership_id BINARY(16) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    reason VARCHAR(500) NULL,
    requested_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    decided_at DATETIME(6) NULL,
    decided_by BINARY(16) NULL,
    decision_reason VARCHAR(500) NULL,
    UNIQUE KEY uq_shift_request_member (shift_id, membership_id),
    KEY idx_shift_requests_queue (organization_id, status, requested_at),
    CONSTRAINT fk_shift_requests_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_shift_requests_shift FOREIGN KEY (shift_id) REFERENCES shifts(id),
    CONSTRAINT fk_shift_requests_membership FOREIGN KEY (membership_id) REFERENCES organization_memberships(id),
    CONSTRAINT fk_shift_requests_decider FOREIGN KEY (decided_by) REFERENCES users(id),
    CONSTRAINT chk_shift_requests_status CHECK (status IN ('PENDING','APPROVED','REJECTED','WITHDRAWN'))
) ENGINE=InnoDB;
