INSERT INTO permissions(code, description)
VALUES ('employee.create', 'Create employee accounts')
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT IGNORE INTO role_permissions(role_id, permission_code)
SELECT r.id, 'employee.create'
FROM roles r
WHERE r.code IN ('OWNER', 'ADMIN', 'HR', 'SUPERVISOR');
