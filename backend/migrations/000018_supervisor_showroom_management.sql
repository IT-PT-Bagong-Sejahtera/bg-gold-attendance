INSERT IGNORE INTO role_permissions(role_id, permission_code)
SELECT r.id, 'section.manage'
FROM roles r
WHERE r.code = 'SUPERVISOR';
