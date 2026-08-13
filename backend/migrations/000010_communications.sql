CREATE TABLE announcements (
    id BINARY(16) PRIMARY KEY,
    organization_id BINARY(16) NOT NULL,
    title VARCHAR(180) NOT NULL,
    body TEXT NOT NULL,
    priority VARCHAR(16) NOT NULL DEFAULT 'NORMAL',
    requires_acknowledgment BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    publish_at DATETIME(6) NULL,
    expires_at DATETIME(6) NULL,
    created_by BINARY(16) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    KEY idx_announcements_org_state (organization_id,status,publish_at),
    CONSTRAINT fk_announcements_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_announcements_creator FOREIGN KEY (created_by) REFERENCES users(id),
    CONSTRAINT chk_announcements_priority CHECK (priority IN ('NORMAL','IMPORTANT','URGENT')),
    CONSTRAINT chk_announcements_status CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED'))
) ENGINE=InnoDB;

CREATE TABLE announcement_audiences (
    id BINARY(16) PRIMARY KEY,
    announcement_id BINARY(16) NOT NULL,
    audience_type VARCHAR(20) NOT NULL,
    role_code VARCHAR(40) NULL,
    section_id BINARY(16) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    KEY idx_announcement_audiences_announcement (announcement_id),
    CONSTRAINT fk_announcement_audiences_announcement FOREIGN KEY (announcement_id) REFERENCES announcements(id),
    CONSTRAINT fk_announcement_audiences_section FOREIGN KEY (section_id) REFERENCES sections(id),
    CONSTRAINT chk_announcement_audience_type CHECK (audience_type IN ('ALL','ROLE','SECTION'))
) ENGINE=InnoDB;

CREATE TABLE announcement_receipts (
    announcement_id BINARY(16) NOT NULL,
    membership_id BINARY(16) NOT NULL,
    read_at DATETIME(6) NULL,
    acknowledged_at DATETIME(6) NULL,
    PRIMARY KEY (announcement_id,membership_id),
    CONSTRAINT fk_announcement_receipts_announcement FOREIGN KEY (announcement_id) REFERENCES announcements(id),
    CONSTRAINT fk_announcement_receipts_membership FOREIGN KEY (membership_id) REFERENCES organization_memberships(id)
) ENGINE=InnoDB;

CREATE TABLE notifications (
    id BINARY(16) PRIMARY KEY,
    organization_id BINARY(16) NOT NULL,
    membership_id BINARY(16) NOT NULL,
    kind VARCHAR(50) NOT NULL,
    title VARCHAR(180) NOT NULL,
    body VARCHAR(1000) NOT NULL,
    resource_type VARCHAR(40) NULL,
    resource_id BINARY(16) NULL,
    read_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    KEY idx_notifications_member_read (membership_id,read_at,created_at),
    CONSTRAINT fk_notifications_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_notifications_member FOREIGN KEY (membership_id) REFERENCES organization_memberships(id)
) ENGINE=InnoDB;

CREATE TABLE notification_outbox (
    id BINARY(16) PRIMARY KEY,
    notification_id BINARY(16) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    available_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    locked_at DATETIME(6) NULL,
    sent_at DATETIME(6) NULL,
    last_error VARCHAR(500) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    KEY idx_notification_outbox_work (status,available_at,locked_at),
    CONSTRAINT fk_notification_outbox_notification FOREIGN KEY (notification_id) REFERENCES notifications(id),
    CONSTRAINT chk_notification_outbox_status CHECK (status IN ('PENDING','PROCESSING','SENT','FAILED'))
) ENGINE=InnoDB;

ALTER TABLE device_registrations ADD COLUMN push_token_hash BINARY(32) NULL AFTER push_token;
CREATE UNIQUE INDEX uq_devices_org_push_hash ON device_registrations(organization_id,push_token_hash);

INSERT IGNORE INTO permissions(code,description) VALUES
('announcement.read','Read scoped announcements'),
('announcement.manage','Manage organization announcements'),
('notification.own','Manage own notifications and devices');

INSERT IGNORE INTO role_permissions(role_id,permission_code)
SELECT r.id,p.code FROM roles r JOIN permissions p ON p.code IN ('announcement.read','announcement.manage','notification.own') WHERE r.code IN ('OWNER','ADMIN','HR');
INSERT IGNORE INTO role_permissions(role_id,permission_code)
SELECT r.id,p.code FROM roles r JOIN permissions p ON p.code IN ('announcement.read','announcement.manage','notification.own') WHERE r.code='SUPERVISOR';
INSERT IGNORE INTO role_permissions(role_id,permission_code)
SELECT r.id,p.code FROM roles r JOIN permissions p ON p.code IN ('announcement.read','notification.own') WHERE r.code='EMPLOYEE';
