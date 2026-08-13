CREATE TABLE face_enrollments (
    id BINARY(16) PRIMARY KEY,
    organization_id BINARY(16) NOT NULL,
    membership_id BINARY(16) NOT NULL,
    provider VARCHAR(80) NOT NULL,
    provider_subject VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    enrolled_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_face_enrollment_member (membership_id),
    CONSTRAINT fk_face_enrollment_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_face_enrollment_member FOREIGN KEY (membership_id) REFERENCES organization_memberships(id),
    CONSTRAINT chk_face_enrollment_status CHECK (status IN ('ACTIVE','REVOKED'))
) ENGINE=InnoDB;

CREATE TABLE face_verifications (
    id BINARY(16) PRIMARY KEY,
    organization_id BINARY(16) NOT NULL,
    membership_id BINARY(16) NOT NULL,
    enrollment_id BINARY(16) NOT NULL,
    attachment_id BINARY(16) NOT NULL,
    provider VARCHAR(80) NOT NULL,
    provider_reference VARCHAR(255) NULL,
    similarity_score DECIMAL(6,5) NOT NULL,
    liveness_passed BOOLEAN NOT NULL,
    verified BOOLEAN NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    KEY idx_face_verifications_member (membership_id,expires_at),
    CONSTRAINT fk_face_verification_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_face_verification_member FOREIGN KEY (membership_id) REFERENCES organization_memberships(id),
    CONSTRAINT fk_face_verification_enrollment FOREIGN KEY (enrollment_id) REFERENCES face_enrollments(id),
    CONSTRAINT fk_face_verification_attachment FOREIGN KEY (attachment_id) REFERENCES attachments(id)
) ENGINE=InnoDB;

ALTER TABLE attendance_evidence ADD COLUMN face_verification_id BINARY(16) NULL AFTER attachment_id;
ALTER TABLE attendance_evidence ADD CONSTRAINT fk_attendance_evidence_face_verification FOREIGN KEY (face_verification_id) REFERENCES face_verifications(id);
