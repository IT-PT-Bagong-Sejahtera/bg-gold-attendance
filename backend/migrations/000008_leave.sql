CREATE TABLE leave_types (
    id BINARY(16) PRIMARY KEY,
    organization_id BINARY(16) NOT NULL,
    code VARCHAR(40) NOT NULL,
    name VARCHAR(120) NOT NULL,
    paid BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_leave_type_code (organization_id, code),
    CONSTRAINT fk_leave_types_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT chk_leave_types_status CHECK (status IN ('ACTIVE','INACTIVE'))
) ENGINE=InnoDB;

CREATE TABLE leave_balances (
    id BINARY(16) PRIMARY KEY,
    organization_id BINARY(16) NOT NULL,
    membership_id BINARY(16) NOT NULL,
    leave_type_id BINARY(16) NOT NULL,
    balance_year SMALLINT UNSIGNED NOT NULL,
    entitlement_days DECIMAL(6,2) NOT NULL DEFAULT 0,
    used_days DECIMAL(6,2) NOT NULL DEFAULT 0,
    pending_days DECIMAL(6,2) NOT NULL DEFAULT 0,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_leave_balance (membership_id, leave_type_id, balance_year),
    KEY idx_leave_balances_org_year (organization_id, balance_year),
    CONSTRAINT fk_leave_balances_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_leave_balances_membership FOREIGN KEY (membership_id) REFERENCES organization_memberships(id),
    CONSTRAINT fk_leave_balances_type FOREIGN KEY (leave_type_id) REFERENCES leave_types(id),
    CONSTRAINT chk_leave_balance_nonnegative CHECK (entitlement_days >= 0 AND used_days >= 0 AND pending_days >= 0 AND used_days + pending_days <= entitlement_days)
) ENGINE=InnoDB;

CREATE TABLE leave_requests (
    id BINARY(16) PRIMARY KEY,
    organization_id BINARY(16) NOT NULL,
    membership_id BINARY(16) NOT NULL,
    leave_type_id BINARY(16) NOT NULL,
    starts_on DATE NOT NULL,
    ends_on DATE NOT NULL,
    total_days DECIMAL(6,2) NOT NULL,
    reason VARCHAR(500) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    requested_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    withdrawn_at DATETIME(6) NULL,
    KEY idx_leave_requests_member_range (membership_id, starts_on, ends_on),
    KEY idx_leave_requests_queue (organization_id, status, requested_at),
    CONSTRAINT fk_leave_requests_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_leave_requests_membership FOREIGN KEY (membership_id) REFERENCES organization_memberships(id),
    CONSTRAINT fk_leave_requests_type FOREIGN KEY (leave_type_id) REFERENCES leave_types(id),
    CONSTRAINT chk_leave_requests_range CHECK (ends_on >= starts_on),
    CONSTRAINT chk_leave_requests_days CHECK (total_days > 0),
    CONSTRAINT chk_leave_requests_status CHECK (status IN ('PENDING','APPROVED','REJECTED','WITHDRAWN'))
) ENGINE=InnoDB;

CREATE TABLE leave_request_allocations (
    request_id BINARY(16) NOT NULL,
    balance_id BINARY(16) NOT NULL,
    days DECIMAL(6,2) NOT NULL,
    PRIMARY KEY (request_id, balance_id),
    CONSTRAINT fk_leave_allocations_request FOREIGN KEY (request_id) REFERENCES leave_requests(id) ON DELETE CASCADE,
    CONSTRAINT fk_leave_allocations_balance FOREIGN KEY (balance_id) REFERENCES leave_balances(id),
    CONSTRAINT chk_leave_allocations_days CHECK (days > 0)
) ENGINE=InnoDB;

CREATE TABLE leave_decisions (
    id BINARY(16) PRIMARY KEY,
    request_id BINARY(16) NOT NULL,
    decision VARCHAR(24) NOT NULL,
    reason VARCHAR(500) NULL,
    decided_by BINARY(16) NOT NULL,
    decided_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_leave_decision_request (request_id),
    CONSTRAINT fk_leave_decisions_request FOREIGN KEY (request_id) REFERENCES leave_requests(id),
    CONSTRAINT fk_leave_decisions_user FOREIGN KEY (decided_by) REFERENCES users(id),
    CONSTRAINT chk_leave_decision CHECK (decision IN ('APPROVED','REJECTED'))
) ENGINE=InnoDB;

INSERT IGNORE INTO permissions(code,description) VALUES
('leave.own','Create and view own leave requests'),
('leave.read','View organization leave requests'),
('leave.approve','Approve or reject leave requests'),
('leave.manage','Manage leave types and balances');

INSERT IGNORE INTO role_permissions(role_id,permission_code)
SELECT r.id,p.code FROM roles r JOIN permissions p
WHERE (r.code='EMPLOYEE' AND p.code='leave.own')
   OR (r.code='SUPERVISOR' AND p.code IN ('leave.own','leave.read','leave.approve'))
   OR (r.code='HR' AND p.code IN ('leave.own','leave.read','leave.approve','leave.manage'))
   OR (r.code IN ('OWNER','ADMIN') AND p.code IN ('leave.own','leave.read','leave.approve','leave.manage'));
