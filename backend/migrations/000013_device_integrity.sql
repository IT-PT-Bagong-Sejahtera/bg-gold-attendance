ALTER TABLE attendance_policy_modes DROP CHECK chk_policy_modes_mode;
ALTER TABLE attendance_policy_modes ADD CONSTRAINT chk_policy_modes_mode CHECK (mode IN ('ANYWHERE','LOCATION_ONLY','GEOFENCE','DYNAMIC_QR','WIFI','SELFIE','FACE_VERIFICATION','DEVICE_INTEGRITY'));
