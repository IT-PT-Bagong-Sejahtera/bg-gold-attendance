ALTER TABLE device_registrations
    ADD COLUMN installation_id_hash BINARY(32) NULL AFTER user_id;

CREATE UNIQUE INDEX uq_devices_org_user_installation
    ON device_registrations(organization_id, user_id, installation_id_hash);
