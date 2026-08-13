package controllers_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bg-gold/attendance-api/config"
	"github.com/bg-gold/attendance-api/controllers"
	"github.com/bg-gold/attendance-api/database"
	"github.com/bg-gold/attendance-api/helpers"
	"golang.org/x/crypto/bcrypt"
)

func TestAttendanceClockInIdempotencyAndClockOut(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}
	if !strings.Contains(strings.ToLower(dsn), "_test") {
		t.Fatal("integration test refuses a DSN without _test in its database name")
	}
	email, password := os.Getenv("TEST_ADMIN_EMAIL"), os.Getenv("TEST_ADMIN_PASSWORD")
	if email == "" || password == "" {
		t.Fatal("TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD are required")
	}
	db, err := database.Open(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	resetAttendance(t, db, email)
	cfg := config.Config{HTTPAddr: ":0", MySQLDSN: dsn, AccessTokenSecret: "integration-test-access-secret-at-least-32-bytes", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour, CORSAllowedOrigins: []string{"http://localhost"}, MinIO: config.MinIOConfig{Endpoint: "localhost:19000", AccessKey: "test", SecretKey: "test", Bucket: "test-evidence"}}
	api, err := controllers.New(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(api.Handler())
	defer host.Close()
	token := login(t, host.URL, email, password)

	capturedAt := time.Now().UTC()
	clockIn := doAction(t, host.URL, token, "integration-clock-in", "CLOCK_IN", capturedAt)
	if clockIn.Data.AttendanceState != "WORKING" || clockIn.Data.Decision != "APPROVED" || clockIn.Replay {
		t.Fatalf("unexpected clock-in response: %+v", clockIn)
	}
	if delta := time.Since(clockIn.Data.RecordedAt); delta < -time.Second || delta > 5*time.Second {
		t.Fatalf("recordedAt is not server time: %v", delta)
	}
	replay := doAction(t, host.URL, token, "integration-clock-in", "CLOCK_IN", capturedAt)
	if !replay.Replay || replay.Data.ActionID != clockIn.Data.ActionID {
		t.Fatalf("idempotent replay did not return original event: %+v", replay)
	}
	clockOut := doAction(t, host.URL, token, "integration-clock-out", "CLOCK_OUT", time.Now().UTC())
	if clockOut.Data.AttendanceState != "COMPLETED" {
		t.Fatalf("unexpected clock-out state: %s", clockOut.Data.AttendanceState)
	}
	duplicateStatus, duplicateBody := doActionStatus(t, host.URL, token, "integration-second-clock-in", "CLOCK_IN")
	if duplicateStatus != http.StatusConflict || !bytes.Contains(duplicateBody, []byte(`"code":"ALREADY_CLOCKED_IN_TODAY"`)) {
		t.Fatalf("second daily clock-in should be rejected: status=%d body=%s", duplicateStatus, duplicateBody)
	}

	var events int
	if err := db.QueryRow(`SELECT COUNT(*) FROM attendance_events e JOIN organization_memberships m ON m.id=e.membership_id JOIN users u ON u.id=m.user_id WHERE u.email=?`, email).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if events != 2 {
		t.Fatalf("expected two immutable events, got %d", events)
	}
	var audits int
	if err := db.QueryRow(`SELECT COUNT(*) FROM audit_logs a JOIN users u ON u.id=a.actor_user_id WHERE u.email=? AND a.action='attendance.action'`, email).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if audits != 2 {
		t.Fatalf("expected two attendance audits, got %d", audits)
	}
}

func TestAutoClockOutWorkerIsScheduledAndIdempotent(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}
	if !strings.Contains(strings.ToLower(dsn), "_test") {
		t.Fatal("integration test refuses a DSN without _test in its database name")
	}
	email, password := os.Getenv("TEST_ADMIN_EMAIL"), os.Getenv("TEST_ADMIN_PASSWORD")
	db, err := database.Open(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	resetAttendance(t, db, email)
	var membershipID []byte
	var originalStartsAt, originalEndsAt time.Time
	if err = db.QueryRow(`SELECT m.id,s.starts_at,s.ends_at FROM organization_memberships m JOIN users u ON u.id=m.user_id JOIN shift_assignments sa ON sa.membership_id=m.id JOIN shifts s ON s.id=sa.shift_id WHERE u.email=? ORDER BY s.created_at LIMIT 1`, email).Scan(&membershipID, &originalStartsAt, &originalEndsAt); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Second)
	if _, err = db.Exec(`UPDATE attendance_policies p JOIN policy_assignments pa ON pa.policy_id=p.id JOIN organization_memberships m ON m.organization_id=pa.organization_id SET p.auto_clock_out=TRUE,p.late_clock_out_minutes=0 WHERE m.id=? AND p.status='ACTIVE'`, membershipID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE shifts s JOIN shift_assignments sa ON sa.shift_id=s.id SET s.starts_at=?,s.ends_at=?,s.status='PUBLISHED',sa.status='ASSIGNED' WHERE sa.membership_id=?`, now.Add(-2*time.Hour), now.Add(-time.Hour), membershipID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = db.Exec(`UPDATE attendance_policies p JOIN policy_assignments pa ON pa.policy_id=p.id JOIN organization_memberships m ON m.organization_id=pa.organization_id SET p.auto_clock_out=FALSE WHERE m.id=?`, membershipID)
		_, _ = db.Exec(`UPDATE shifts s JOIN shift_assignments sa ON sa.shift_id=s.id SET s.starts_at=?,s.ends_at=? WHERE sa.membership_id=?`, originalStartsAt, originalEndsAt, membershipID)
		_ = db.Close()
	}()
	cfg := config.Config{Environment: "test", AccessTokenSecret: "integration-test-access-secret-at-least-32-bytes", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour, CORSAllowedOrigins: []string{"http://localhost"}, MinIO: config.MinIOConfig{Endpoint: "localhost:19000", AccessKey: "test", SecretKey: "test", Bucket: "test-evidence"}}
	api, err := controllers.New(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(api.Handler())
	defer host.Close()
	token := login(t, host.URL, email, password)
	clockIn := doAction(t, host.URL, token, "integration-auto-clock-in", "CLOCK_IN", now.Add(-2*time.Hour))
	if clockIn.Data.AttendanceState != "WORKING" {
		t.Fatalf("clock-in before auto worker failed: %+v", clockIn)
	}
	count, err := api.RunAutoClockOutOnce(context.Background(), now)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("expected one automatic clock-out, got %d", count)
	}
	count, err = api.RunAutoClockOutOnce(context.Background(), now.Add(time.Minute))
	if err != nil || count != 0 {
		t.Fatalf("automatic clock-out was not idempotent: count=%d err=%v", count, err)
	}
	status, body := authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/me/attendance/today", token, nil)
	if status != http.StatusOK || !bytes.Contains(body, []byte(`"state":"COMPLETED"`)) || !bytes.Contains(body, []byte(`"actionType":"AUTO_CLOCK_OUT"`)) {
		t.Fatalf("automatic clock-out not visible in attendance state: %d %s", status, body)
	}
	var events, audits int
	var recordedAt time.Time
	if err = db.QueryRow(`SELECT COUNT(*),MAX(server_recorded_at) FROM attendance_events WHERE membership_id=? AND action_type='AUTO_CLOCK_OUT' AND source='SYSTEM'`, membershipID).Scan(&events, &recordedAt); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM audit_logs WHERE action='attendance.auto_clock_out' AND resource_id IN (SELECT id FROM attendance_events WHERE membership_id=? AND action_type='AUTO_CLOCK_OUT')`, membershipID).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if events != 1 || audits != 1 || !recordedAt.Equal(now.Add(-time.Hour)) {
		t.Fatalf("unexpected automatic event evidence: events=%d audits=%d recordedAt=%s", events, audits, recordedAt)
	}
}

func TestWorkMoreAndUnscheduledBreakApprovalStates(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}
	if !strings.Contains(strings.ToLower(dsn), "_test") {
		t.Fatal("integration test refuses a DSN without _test in its database name")
	}
	email, password := os.Getenv("TEST_ADMIN_EMAIL"), os.Getenv("TEST_ADMIN_PASSWORD")
	db, err := database.Open(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	var membershipID, organizationID, userID, sectionID []byte
	if err = db.QueryRow(`SELECT m.id,m.organization_id,m.user_id,s.id FROM organization_memberships m JOIN users u ON u.id=m.user_id JOIN sections s ON s.organization_id=m.organization_id AND s.status='ACTIVE' WHERE u.email=? ORDER BY s.created_at LIMIT 1`, email).Scan(&membershipID, &organizationID, &userID, &sectionID); err != nil {
		t.Fatal(err)
	}
	resetAttendance(t, db, email)
	shiftID, _ := identity.NewUUID()
	assignmentID, _ := identity.NewUUID()
	if _, err = db.Exec(`INSERT INTO shifts(id,organization_id,section_id,title,starts_at,ends_at,status,published_at,created_by) VALUES(UUID_TO_BIN(?),?,?,?,DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 60 MINUTE),DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 7 HOUR),'PUBLISHED',UTC_TIMESTAMP(6),?)`, shiftID, organizationID, sectionID, "Approval state test shift", userID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO shift_assignments(id,shift_id,membership_id) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),?)`, assignmentID, shiftID, membershipID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE attendance_policies p JOIN policy_assignments pa ON pa.policy_id=p.id JOIN organization_memberships m ON m.organization_id=pa.organization_id SET p.work_more_requires_approval=TRUE,p.unscheduled_break_requires_approval=TRUE WHERE m.id=? AND p.status='ACTIVE'`, membershipID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		resetAttendance(t, db, email)
		_, _ = db.Exec(`DELETE FROM shifts WHERE id=UUID_TO_BIN(?)`, shiftID)
		_, _ = db.Exec(`UPDATE attendance_policies p JOIN policy_assignments pa ON pa.policy_id=p.id JOIN organization_memberships m ON m.organization_id=pa.organization_id SET p.work_more_requires_approval=FALSE,p.unscheduled_break_requires_approval=FALSE,p.prevent_unscheduled_break=FALSE,p.scheduled_break_start_offset_minutes=NULL,p.scheduled_break_end_offset_minutes=NULL WHERE m.id=?`, membershipID)
		_ = db.Close()
	}()
	cfg := config.Config{Environment: "test", AccessTokenSecret: "integration-test-access-secret-at-least-32-bytes", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour, CORSAllowedOrigins: []string{"http://localhost"}, MinIO: config.MinIOConfig{Endpoint: "localhost:19000", AccessKey: "test", SecretKey: "test", Bucket: "test-evidence"}}
	api, err := controllers.New(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(api.Handler())
	defer host.Close()
	token := login(t, host.URL, email, password)
	doAction(t, host.URL, token, "approval-depth-clock-in", "CLOCK_IN", time.Now().UTC())
	doAction(t, host.URL, token, "approval-depth-clock-out", "CLOCK_OUT", time.Now().UTC())

	workMore := doActionWithReason(t, host.URL, token, "approval-depth-work-more-1", "WORK_MORE", "Menyelesaikan stok opname")
	if workMore.Data.Decision != "PENDING" || workMore.Data.AttendanceState != "PENDING" {
		t.Fatalf("work-more was not held for approval: %+v", workMore)
	}
	requestID := latestRequestID(t, host.URL, token, "WORK_MORE")
	status, body := authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/attendance/requests/"+requestID+"/decision", token, map[string]string{"decision": "REJECTED", "reason": "Pekerjaan dapat dilanjutkan besok"})
	if status != http.StatusOK {
		t.Fatalf("reject work-more status %d: %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/me/attendance/today", token, nil)
	if status != http.StatusOK || !bytes.Contains(body, []byte(`"state":"COMPLETED"`)) {
		t.Fatalf("rejected work-more did not restore completed state: %d %s", status, body)
	}

	workMore = doActionWithReason(t, host.URL, token, "approval-depth-work-more-2", "WORK_MORE", "Penyelesaian pesanan mendesak")
	requestID = latestRequestID(t, host.URL, token, "WORK_MORE")
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/attendance/requests/"+requestID+"/decision", token, map[string]string{"decision": "APPROVED"})
	if status != http.StatusOK || workMore.Data.Decision != "PENDING" {
		t.Fatalf("approve work-more status %d: %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/me/attendance/today", token, nil)
	if status != http.StatusOK || !bytes.Contains(body, []byte(`"state":"WORKING"`)) {
		t.Fatalf("approved work-more did not enter working state: %d %s", status, body)
	}

	breakStart := doAction(t, host.URL, token, "approval-depth-break", "START_BREAK", time.Now().UTC())
	if breakStart.Data.Decision != "PENDING" {
		t.Fatalf("unscheduled break was not held for approval: %+v", breakStart)
	}
	requestID = latestRequestID(t, host.URL, token, "START_BREAK")
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/attendance/requests/"+requestID+"/decision", token, map[string]string{"decision": "APPROVED"})
	if status != http.StatusOK {
		t.Fatalf("approve break status %d: %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/me/attendance/today", token, nil)
	if status != http.StatusOK || !bytes.Contains(body, []byte(`"state":"ON_BREAK"`)) {
		t.Fatalf("approved break did not enter on-break state: %d %s", status, body)
	}
	endBreak := doAction(t, host.URL, token, "approval-depth-end-break", "END_BREAK", time.Now().UTC())
	if endBreak.Data.AttendanceState != "WORKING" {
		t.Fatalf("end break did not return to work: %+v", endBreak)
	}
	if _, err = db.Exec(`UPDATE shifts sh JOIN attendance_state st ON st.active_shift_id=sh.id SET sh.starts_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 60 MINUTE),sh.ends_at=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 7 HOUR) WHERE st.membership_id=?`, membershipID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE attendance_policies p JOIN attendance_events e ON e.policy_id=p.id JOIN attendance_state st ON st.last_event_id=e.id SET p.unscheduled_break_requires_approval=FALSE,p.prevent_unscheduled_break=TRUE,p.scheduled_break_start_offset_minutes=120,p.scheduled_break_end_offset_minutes=180 WHERE st.membership_id=?`, membershipID); err != nil {
		t.Fatal(err)
	}
	status, body = doActionStatus(t, host.URL, token, "scheduled-break-outside", "START_BREAK")
	if status != http.StatusUnprocessableEntity || !bytes.Contains(body, []byte(`"code":"OUTSIDE_BREAK_WINDOW"`)) {
		t.Fatalf("guarded break outside window status %d: %s", status, body)
	}
	if _, err = db.Exec(`UPDATE attendance_policies p JOIN attendance_events e ON e.policy_id=p.id JOIN attendance_state st ON st.last_event_id=e.id SET p.scheduled_break_start_offset_minutes=0,p.scheduled_break_end_offset_minutes=120 WHERE st.membership_id=?`, membershipID); err != nil {
		t.Fatal(err)
	}
	scheduledBreak := doAction(t, host.URL, token, "scheduled-break-inside", "START_BREAK", time.Now().UTC())
	if scheduledBreak.Data.Decision != "APPROVED" || scheduledBreak.Data.AttendanceState != "ON_BREAK" {
		t.Fatalf("scheduled break should start directly: %+v", scheduledBreak)
	}
	doAction(t, host.URL, token, "scheduled-break-end", "END_BREAK", time.Now().UTC())
}

func TestTimesheetSummaryAppliesPolicyBreakRounding(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}
	if !strings.Contains(strings.ToLower(dsn), "_test") {
		t.Fatal("integration test refuses a DSN without _test in its database name")
	}
	email, password := os.Getenv("TEST_ADMIN_EMAIL"), os.Getenv("TEST_ADMIN_PASSWORD")
	db, err := database.Open(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	resetAttendance(t, db, email)
	var organizationID, membershipID, userID, policyID string
	if err = db.QueryRow(`SELECT BIN_TO_UUID(m.organization_id),BIN_TO_UUID(m.id),BIN_TO_UUID(m.user_id) FROM organization_memberships m JOIN users u ON u.id=m.user_id WHERE u.email=?`, email).Scan(&organizationID, &membershipID, &userID); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT BIN_TO_UUID(p.id) FROM attendance_policies p JOIN policy_assignments pa ON pa.policy_id=p.id WHERE pa.organization_id=UUID_TO_BIN(?) AND p.status='ACTIVE' ORDER BY pa.membership_id IS NOT NULL DESC,pa.section_id IS NOT NULL DESC LIMIT 1`, organizationID).Scan(&policyID); err != nil {
		t.Fatal(err)
	}
	location, _ := time.LoadLocation("Asia/Jakarta")
	day := time.Now().In(location)
	at := func(hour, minute int) time.Time {
		return time.Date(day.Year(), day.Month(), day.Day(), hour, minute, 0, 0, location).UTC()
	}
	insert := func(action string, recordedAt time.Time, snapshot string) {
		t.Helper()
		id, _ := identity.NewUUID()
		if _, insertErr := db.Exec(`INSERT INTO attendance_events(id,organization_id,membership_id,policy_id,action_type,decision,server_recorded_at,policy_snapshot,source,created_by) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),?,'APPROVED',?,?,'MOBILE',UUID_TO_BIN(?))`, id, organizationID, membershipID, policyID, action, recordedAt, snapshot, userID); insertErr != nil {
			t.Fatal(insertErr)
		}
	}
	insert("CLOCK_IN", at(9, 0), `{}`)
	insert("START_BREAK", at(12, 0), `{"BreakRoundingMinutes":15}`)
	insert("END_BREAK", at(12, 22), `{}`)
	insert("CLOCK_OUT", at(17, 0), `{}`)
	cfg := config.Config{Environment: "test", AccessTokenSecret: "integration-test-access-secret-at-least-32-bytes", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour, CORSAllowedOrigins: []string{"http://localhost"}, MinIO: config.MinIOConfig{Endpoint: "localhost:19000", AccessKey: "test", SecretKey: "test", Bucket: "test-evidence"}}
	api, err := controllers.New(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(api.Handler())
	defer host.Close()
	token := login(t, host.URL, email, password)
	from, to := at(0, 0), at(23, 59).Add(time.Minute)
	status, body := authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/attendance/timesheets?from="+from.Format(time.RFC3339)+"&to="+to.Format(time.RFC3339), token, nil)
	if status != http.StatusOK || !bytes.Contains(body, []byte(`"grossMinutes":480`)) || !bytes.Contains(body, []byte(`"actualBreakMinutes":22`)) || !bytes.Contains(body, []byte(`"roundedBreakMinutes":15`)) || !bytes.Contains(body, []byte(`"netMinutes":465`)) {
		t.Fatalf("unexpected rounded timesheet %d: %s", status, body)
	}
	reportStatus, reportHeaders, reportBody := authorizedRaw(t, host.URL+"/api/v1/reports/timesheets.csv?from="+from.Format(time.RFC3339)+"&to="+to.Format(time.RFC3339), token)
	if reportStatus != http.StatusOK || !strings.HasPrefix(reportHeaders.Get("Content-Type"), "text/csv") || !strings.Contains(reportHeaders.Get("Content-Disposition"), "bg-gold-timesheets.csv") || !bytes.HasPrefix(reportBody, []byte{0xEF, 0xBB, 0xBF}) || !bytes.Contains(reportBody, []byte("rounded_break_minutes,net_minutes")) || !bytes.Contains(reportBody, []byte(",22,15,465")) {
		t.Fatalf("unexpected timesheet CSV status=%d headers=%v body=%q", reportStatus, reportHeaders, reportBody)
	}
	reportStatus, _, reportBody = authorizedRaw(t, host.URL+"/api/v1/reports/attendance.csv?from="+from.Format(time.RFC3339)+"&to="+to.Format(time.RFC3339), token)
	if reportStatus != http.StatusOK || !bytes.Contains(reportBody, []byte("employee_number,employee_name,action,decision")) || !bytes.Contains(reportBody, []byte("CLOCK_IN,APPROVED")) {
		t.Fatalf("unexpected attendance CSV status=%d body=%q", reportStatus, reportBody)
	}
	reportUserID, _ := identity.NewUUID()
	reportMembershipID, _ := identity.NewUUID()
	reportEmail := "report-denied-" + strings.ReplaceAll(time.Now().UTC().Format("150405.000000"), ".", "") + "@bggold.local"
	reportPassword := "Report-Denied-2026!"
	hash, _ := bcrypt.GenerateFromPassword([]byte(reportPassword), bcrypt.DefaultCost)
	if _, err = db.Exec(`INSERT INTO users(id,email,password_hash,full_name) VALUES(UUID_TO_BIN(?),?,?,'Report Permission Test')`, reportUserID, reportEmail, string(hash)); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO organization_memberships(id,organization_id,user_id,employee_number) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),'REPORT-DENIED')`, reportMembershipID, organizationID, reportUserID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO membership_roles(membership_id,role_id) SELECT UUID_TO_BIN(?),id FROM roles WHERE organization_id=UUID_TO_BIN(?) AND code='EMPLOYEE'`, reportMembershipID, organizationID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = db.Exec(`DELETE FROM refresh_sessions WHERE user_id=UUID_TO_BIN(?)`, reportUserID)
		_, _ = db.Exec(`DELETE FROM membership_roles WHERE membership_id=UUID_TO_BIN(?)`, reportMembershipID)
		_, _ = db.Exec(`DELETE FROM organization_memberships WHERE id=UUID_TO_BIN(?)`, reportMembershipID)
		_, _ = db.Exec(`DELETE FROM users WHERE id=UUID_TO_BIN(?)`, reportUserID)
	}()
	employeeToken := login(t, host.URL, reportEmail, reportPassword)
	reportStatus, _, _ = authorizedRaw(t, host.URL+"/api/v1/reports/timesheets.csv", employeeToken)
	if reportStatus != http.StatusForbidden {
		t.Fatalf("employee without report.read exported a report: %d", reportStatus)
	}
}

func TestRefreshRotationReplayRevokesSessionAndLogout(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}
	if !strings.Contains(strings.ToLower(dsn), "_test") {
		t.Fatal("integration test refuses a DSN without _test in its database name")
	}
	email, password := os.Getenv("TEST_ADMIN_EMAIL"), os.Getenv("TEST_ADMIN_PASSWORD")
	if email == "" || password == "" {
		t.Fatal("TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD are required")
	}
	db, err := database.Open(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cfg := config.Config{AccessTokenSecret: "integration-test-access-secret-at-least-32-bytes", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour, CORSAllowedOrigins: []string{"http://localhost"}, MinIO: config.MinIOConfig{Endpoint: "localhost:19000", AccessKey: "test", SecretKey: "test", Bucket: "test-evidence"}}
	api, err := controllers.New(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(api.Handler())
	defer host.Close()
	pair := loginTokens(t, host.URL, email, password)
	next, status := refreshToken(t, host.URL, pair.RefreshToken)
	if status != http.StatusOK {
		t.Fatalf("first refresh status %d", status)
	}
	_, status = refreshToken(t, host.URL, pair.RefreshToken)
	if status != http.StatusUnauthorized {
		t.Fatalf("refresh replay status %d", status)
	}
	_, status = refreshToken(t, host.URL, next.RefreshToken)
	if status != http.StatusUnauthorized {
		t.Fatalf("rotated token remained valid after replay: %d", status)
	}

	pair = loginTokens(t, host.URL, email, password)
	request, _ := http.NewRequest(http.MethodPost, host.URL+"/api/v1/auth/logout", nil)
	request.Header.Set("Authorization", "Bearer "+pair.AccessToken)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("logout status %d", response.StatusCode)
	}
	request, _ = http.NewRequest(http.MethodGet, host.URL+"/api/v1/me", nil)
	request.Header.Set("Authorization", "Bearer "+pair.AccessToken)
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("revoked access session status %d", response.StatusCode)
	}
}

func TestPasswordResetIsSingleUseAndRevokesSessions(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}
	if !strings.Contains(strings.ToLower(dsn), "_test") {
		t.Fatal("integration test refuses a DSN without _test in its database name")
	}
	email, oldPassword := os.Getenv("TEST_ADMIN_EMAIL"), os.Getenv("TEST_ADMIN_PASSWORD")
	if email == "" || oldPassword == "" {
		t.Fatal("TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD are required")
	}
	db, err := database.Open(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	originalHash, err := bcrypt.GenerateFromPassword([]byte(oldPassword), bcrypt.DefaultCost)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(`UPDATE users SET password_hash=? WHERE email=?`, string(originalHash), email)
		_, _ = db.Exec(`DELETE p FROM password_reset_tokens p JOIN users u ON u.id=p.user_id WHERE u.email=?`, email)
		_ = db.Close()
	})
	cfg := config.Config{Environment: "test", AccessTokenSecret: "integration-test-access-secret-at-least-32-bytes", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour, CORSAllowedOrigins: []string{"http://localhost"}, MinIO: config.MinIOConfig{Endpoint: "localhost:19000", AccessKey: "test", SecretKey: "test", Bucket: "test-evidence"}}
	api, err := controllers.New(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	resetSender := &recordingResetSender{}
	api.SetPasswordResetSender(resetSender)
	host := httptest.NewServer(api.Handler())
	defer host.Close()
	existing := loginTokens(t, host.URL, email, oldPassword)

	status, body := publicJSON(t, http.MethodPost, host.URL+"/api/v1/auth/password/forgot", map[string]string{"email": email})
	if status != http.StatusAccepted {
		t.Fatalf("forgot password status %d: %s", status, body)
	}
	var forgot struct {
		Data struct {
			Token string `json:"developmentResetToken"`
		} `json:"data"`
	}
	if err = json.Unmarshal(body, &forgot); err != nil {
		t.Fatal(err)
	}
	if forgot.Data.Token == "" {
		t.Fatal("test environment did not return a reset token")
	}
	if resetSender.calls != 1 || resetSender.recipient != email || resetSender.token != forgot.Data.Token {
		t.Fatalf("reset email sender did not receive the issued token: %+v", resetSender)
	}
	newPassword := oldPassword + "-Updated!"
	status, body = publicJSON(t, http.MethodPost, host.URL+"/api/v1/auth/password/reset", map[string]string{"token": forgot.Data.Token, "newPassword": newPassword})
	if status != http.StatusOK {
		t.Fatalf("reset password status %d: %s", status, body)
	}

	request, _ := http.NewRequest(http.MethodGet, host.URL+"/api/v1/me", nil)
	request.Header.Set("Authorization", "Bearer "+existing.AccessToken)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("old access session remained valid: %d", response.StatusCode)
	}
	_, status = refreshToken(t, host.URL, existing.RefreshToken)
	if status != http.StatusUnauthorized {
		t.Fatalf("old refresh session remained valid: %d", status)
	}
	status, _ = publicJSON(t, http.MethodPost, host.URL+"/api/v1/auth/password/reset", map[string]string{"token": forgot.Data.Token, "newPassword": newPassword + "2"})
	if status != http.StatusUnprocessableEntity {
		t.Fatalf("reused reset token status %d", status)
	}
	if loginStatus(t, host.URL, email, oldPassword) != http.StatusUnauthorized {
		t.Fatal("old password remained valid")
	}
	if loginStatus(t, host.URL, email, newPassword) != http.StatusOK {
		t.Fatal("new password was not accepted")
	}

	status, body = publicJSON(t, http.MethodPost, host.URL+"/api/v1/auth/password/forgot", map[string]string{"email": "unknown-person@bggold.local"})
	if status != http.StatusAccepted || bytes.Contains(body, []byte("developmentResetToken")) {
		t.Fatalf("unknown email response leaked account state: %d %s", status, body)
	}
	if resetSender.calls != 1 {
		t.Fatal("unknown account triggered an email delivery")
	}
}

func TestOrganizationSwitchRotatesSessionAndScopesIdentity(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}
	if !strings.Contains(strings.ToLower(dsn), "_test") {
		t.Fatal("integration test refuses a DSN without _test in its database name")
	}
	email, password := os.Getenv("TEST_ADMIN_EMAIL"), os.Getenv("TEST_ADMIN_PASSWORD")
	db, err := database.Open(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	var userID, originalOrganizationID string
	if err = db.QueryRow(`SELECT BIN_TO_UUID(u.id),BIN_TO_UUID(m.organization_id) FROM users u JOIN organization_memberships m ON m.user_id=u.id WHERE u.email=? ORDER BY m.created_at LIMIT 1`, email).Scan(&userID, &originalOrganizationID); err != nil {
		t.Fatal(err)
	}
	organizationID, _ := identity.NewUUID()
	membershipID, _ := identity.NewUUID()
	code := "ALT-" + strings.ToUpper(strings.ReplaceAll(organizationID[:8], "-", ""))
	if _, err = db.Exec(`INSERT INTO organizations(id,code,name,timezone) VALUES(UUID_TO_BIN(?),?,'BG GOLD Workshop','Asia/Makassar')`, organizationID, code); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO organization_memberships(id,organization_id,user_id,employee_number,job_title) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),'WS-001','Workshop Lead')`, membershipID, organizationID, userID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = db.Exec(`UPDATE refresh_sessions SET active_organization_id=UUID_TO_BIN(?) WHERE user_id=UUID_TO_BIN(?) AND active_organization_id=UUID_TO_BIN(?)`, originalOrganizationID, userID, organizationID)
		_, _ = db.Exec(`DELETE FROM organization_memberships WHERE id=UUID_TO_BIN(?)`, membershipID)
		_, _ = db.Exec(`DELETE FROM organizations WHERE id=UUID_TO_BIN(?)`, organizationID)
		_ = db.Close()
	}()

	cfg := config.Config{Environment: "test", AccessTokenSecret: "integration-test-access-secret-at-least-32-bytes", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour, CORSAllowedOrigins: []string{"http://localhost"}, MinIO: config.MinIOConfig{Endpoint: "localhost:19000", AccessKey: "test", SecretKey: "test", Bucket: "test-evidence"}}
	api, err := controllers.New(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(api.Handler())
	defer host.Close()
	original := loginTokens(t, host.URL, email, password)
	status, body := authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/me/organizations", original.AccessToken, nil)
	if status != http.StatusOK || !bytes.Contains(body, []byte(organizationID)) {
		t.Fatalf("organization list did not include alternate membership: %d %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/me/active-organization", original.AccessToken, map[string]string{"organizationId": organizationID})
	if status != http.StatusOK {
		t.Fatalf("switch organization status %d: %s", status, body)
	}
	var switchedEnvelope struct {
		Data tokenPair `json:"data"`
	}
	if err = json.Unmarshal(body, &switchedEnvelope); err != nil {
		t.Fatal(err)
	}
	status, _ = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/me", original.AccessToken, nil)
	if status != http.StatusUnauthorized {
		t.Fatalf("old organization access token remained valid: %d", status)
	}
	status, body = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/me", switchedEnvelope.Data.AccessToken, nil)
	if status != http.StatusOK || !bytes.Contains(body, []byte(`"organizationId":"`+organizationID+`"`)) || !bytes.Contains(body, []byte(`"employeeNumber":"WS-001"`)) || !bytes.Contains(body, []byte(`"timezone":"Asia/Makassar"`)) {
		t.Fatalf("switched identity was not organization-scoped: %d %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/me/active-organization", switchedEnvelope.Data.AccessToken, map[string]string{"organizationId": originalOrganizationID})
	if status != http.StatusOK {
		t.Fatalf("switch back status %d: %s", status, body)
	}
	var restoredEnvelope struct {
		Data tokenPair `json:"data"`
	}
	if err = json.Unmarshal(body, &restoredEnvelope); err != nil {
		t.Fatal(err)
	}
	status, _ = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/me", switchedEnvelope.Data.AccessToken, nil)
	if status != http.StatusUnauthorized {
		t.Fatalf("previous organization token remained valid after switch back: %d", status)
	}
	status, _ = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/me/active-organization", restoredEnvelope.Data.AccessToken, map[string]string{"organizationId": "00000000-0000-4000-8000-999999999999"})
	if status != http.StatusForbidden {
		t.Fatalf("non-member organization switch status %d", status)
	}
}

func TestEmployeeLifecycleRevokesAndRestoresOrganizationAccess(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}
	if !strings.Contains(strings.ToLower(dsn), "_test") {
		t.Fatal("integration test refuses a DSN without _test in its database name")
	}
	adminEmail, adminPassword := os.Getenv("TEST_ADMIN_EMAIL"), os.Getenv("TEST_ADMIN_PASSWORD")
	db, err := database.Open(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	employeeEmail := "lifecycle-" + strings.ToLower(strings.ReplaceAll(time.Now().UTC().Format("150405.000000"), ".", "")) + "@bggold.local"
	employeePassword := "Lifecycle-Test-2026!"
	var employeeID, userID string
	defer func() {
		if employeeID != "" {
			_, _ = db.Exec(`DELETE FROM audit_logs WHERE resource_id=UUID_TO_BIN(?)`, employeeID)
		}
		if userID != "" {
			_, _ = db.Exec(`DELETE FROM refresh_sessions WHERE user_id=UUID_TO_BIN(?)`, userID)
			_, _ = db.Exec(`DELETE FROM password_reset_tokens WHERE user_id=UUID_TO_BIN(?)`, userID)
		}
		if employeeID != "" {
			_, _ = db.Exec(`DELETE FROM organization_memberships WHERE id=UUID_TO_BIN(?)`, employeeID)
		}
		if userID != "" {
			_, _ = db.Exec(`DELETE FROM users WHERE id=UUID_TO_BIN(?)`, userID)
		}
		_ = db.Close()
	}()
	cfg := config.Config{Environment: "test", AccessTokenSecret: "integration-test-access-secret-at-least-32-bytes", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour, CORSAllowedOrigins: []string{"http://localhost"}, MinIO: config.MinIOConfig{Endpoint: "localhost:19000", AccessKey: "test", SecretKey: "test", Bucket: "test-evidence"}}
	api, err := controllers.New(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	inviteSender := &recordingResetSender{}
	api.SetPasswordResetSender(inviteSender)
	host := httptest.NewServer(api.Handler())
	defer host.Close()
	adminToken := login(t, host.URL, adminEmail, adminPassword)
	status, body := authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/employees", adminToken, map[string]any{"email": employeeEmail, "fullName": "Lifecycle Employee", "employeeNumber": "LC-" + time.Now().UTC().Format("150405"), "jobTitle": "Gold Operations", "roles": []string{"EMPLOYEE"}})
	if status != http.StatusCreated {
		t.Fatalf("create employee status %d: %s", status, body)
	}
	var created struct {
		Data struct {
			ID                     string `json:"id"`
			InvitationStatus       string `json:"invitationStatus"`
			DevelopmentInviteToken string `json:"developmentInviteToken"`
		} `json:"data"`
	}
	if err = json.Unmarshal(body, &created); err != nil {
		t.Fatal(err)
	}
	employeeID = created.Data.ID
	if created.Data.InvitationStatus != "SENT" || created.Data.DevelopmentInviteToken == "" || inviteSender.invitationCalls != 1 || inviteSender.invitationRecipient != employeeEmail || inviteSender.invitationToken != created.Data.DevelopmentInviteToken {
		t.Fatalf("employee invitation was not dispatched: response=%+v sender=%+v", created.Data, inviteSender)
	}
	if loginStatus(t, host.URL, employeeEmail, employeePassword) != http.StatusUnauthorized {
		t.Fatal("invited employee could log in before creating a password")
	}
	var membershipStatus string
	if err = db.QueryRow(`SELECT status FROM organization_memberships WHERE id=UUID_TO_BIN(?)`, employeeID).Scan(&membershipStatus); err != nil || membershipStatus != "INVITED" {
		t.Fatalf("new invitation membership status=%s err=%v", membershipStatus, err)
	}
	status, body = publicJSON(t, http.MethodPost, host.URL+"/api/v1/auth/password/reset", map[string]string{"token": created.Data.DevelopmentInviteToken, "newPassword": employeePassword})
	if status != http.StatusOK {
		t.Fatalf("invited employee could not create password: %d %s", status, body)
	}
	if err = db.QueryRow(`SELECT BIN_TO_UUID(user_id) FROM organization_memberships WHERE id=UUID_TO_BIN(?)`, employeeID).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	employeeToken := login(t, host.URL, employeeEmail, employeePassword)
	updatedEmployeeNumber := "LCU-" + time.Now().UTC().Format("150405")
	status, body = authorizedJSON(t, http.MethodPatch, host.URL+"/api/v1/employees/"+employeeID, adminToken, map[string]any{"fullName": "Lifecycle Employee Updated", "employeeNumber": updatedEmployeeNumber, "jobTitle": "Shift Supervisor", "roles": []string{"SUPERVISOR"}})
	if status != http.StatusOK || !bytes.Contains(body, []byte(`"roles":["SUPERVISOR"]`)) {
		t.Fatalf("update employee status %d: %s", status, body)
	}
	status, _ = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/me", employeeToken, nil)
	if status != http.StatusUnauthorized {
		t.Fatalf("role update did not revoke existing employee session: %d", status)
	}
	employeeToken = login(t, host.URL, employeeEmail, employeePassword)
	status, body = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/employees", adminToken, nil)
	if status != http.StatusOK || !bytes.Contains(body, []byte(`"fullName":"Lifecycle Employee Updated"`)) || !bytes.Contains(body, []byte(`"employeeNumber":"`+updatedEmployeeNumber+`"`)) || !bytes.Contains(body, []byte(`"roles":["SUPERVISOR"]`)) {
		t.Fatalf("updated employee was not projected: %d %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/employees/"+employeeID+"/deactivate", adminToken, nil)
	if status != http.StatusOK || !bytes.Contains(body, []byte(`"status":"INACTIVE"`)) {
		t.Fatalf("deactivate employee status %d: %s", status, body)
	}
	status, _ = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/me", employeeToken, nil)
	if status != http.StatusUnauthorized {
		t.Fatalf("deactivated employee session remained active: %d", status)
	}
	if loginStatus(t, host.URL, employeeEmail, employeePassword) != http.StatusUnauthorized {
		t.Fatal("deactivated employee could still log in to the organization")
	}
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/employees/"+employeeID+"/activate", adminToken, nil)
	if status != http.StatusOK || !bytes.Contains(body, []byte(`"status":"ACTIVE"`)) {
		t.Fatalf("activate employee status %d: %s", status, body)
	}
	if loginStatus(t, host.URL, employeeEmail, employeePassword) != http.StatusOK {
		t.Fatal("reactivated employee could not log in")
	}
	var auditCount int
	if err = db.QueryRow(`SELECT COUNT(*) FROM audit_logs WHERE resource_id=UUID_TO_BIN(?) AND action IN ('employee.create','employee.update','employee.deactivate','employee.activate')`, employeeID).Scan(&auditCount); err != nil {
		t.Fatal(err)
	}
	if auditCount != 4 {
		t.Fatalf("expected lifecycle audit trail, got %d entries", auditCount)
	}
}

func TestTargetedPolicyReplacementIsDeterministic(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}
	if !strings.Contains(strings.ToLower(dsn), "_test") {
		t.Fatal("integration test refuses a DSN without _test in its database name")
	}
	email, password := os.Getenv("TEST_ADMIN_EMAIL"), os.Getenv("TEST_ADMIN_PASSWORD")
	db, err := database.Open(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	var membershipID string
	if err = db.QueryRow(`SELECT BIN_TO_UUID(m.id) FROM organization_memberships m JOIN users u ON u.id=m.user_id WHERE u.email=?`, email).Scan(&membershipID); err != nil {
		t.Fatal(err)
	}
	createdIDs := []string{}
	defer func() {
		for _, id := range createdIDs {
			_, _ = db.Exec(`DELETE FROM audit_logs WHERE resource_id=UUID_TO_BIN(?)`, id)
			_, _ = db.Exec(`DELETE FROM policy_assignments WHERE policy_id=UUID_TO_BIN(?)`, id)
			_, _ = db.Exec(`DELETE FROM attendance_policy_modes WHERE policy_id=UUID_TO_BIN(?)`, id)
			_, _ = db.Exec(`DELETE FROM attendance_policies WHERE id=UUID_TO_BIN(?)`, id)
		}
		_ = db.Close()
	}()
	cfg := config.Config{Environment: "test", AccessTokenSecret: "integration-test-access-secret-at-least-32-bytes", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour, CORSAllowedOrigins: []string{"http://localhost"}, MinIO: config.MinIOConfig{Endpoint: "localhost:19000", AccessKey: "test", SecretKey: "test", Bucket: "test-evidence"}}
	api, err := controllers.New(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(api.Handler())
	defer host.Close()
	token := login(t, host.URL, email, password)

	createPolicy := func(name string, selfie bool) string {
		t.Helper()
		status, body := authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/policies", token, map[string]any{
			"name": name, "modes": []string{"ANYWHERE"}, "selfieRequired": selfie,
			"minimumLocationAccuracyMeters": 55, "membershipId": membershipID,
			"earlyClockInMinutes": 30, "lateClockInMinutes": 15,
			"earlyClockOutMinutes": 10, "lateClockOutMinutes": 20,
			"preventEarlyClockIn": true, "preventLateClockIn": true,
			"preventEarlyClockOut": true, "preventLateClockOut": true,
			"preventUnscheduledBreak":          true,
			"scheduledBreakStartOffsetMinutes": 180, "scheduledBreakEndOffsetMinutes": 240,
		})
		if status != http.StatusCreated {
			t.Fatalf("create targeted policy status %d: %s", status, body)
		}
		var envelope struct {
			Data struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		if err := json.Unmarshal(body, &envelope); err != nil {
			t.Fatal(err)
		}
		createdIDs = append(createdIDs, envelope.Data.ID)
		return envelope.Data.ID
	}
	firstID := createPolicy("Targeted Policy First "+time.Now().UTC().Format("150405"), false)
	status, body := authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/me/attendance-policy", token, nil)
	if status != http.StatusOK || !bytes.Contains(body, []byte(firstID)) {
		t.Fatalf("first targeted policy did not resolve: %d %s", status, body)
	}
	secondID := createPolicy("Targeted Policy Second "+time.Now().UTC().Format("150405"), true)
	status, body = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/me/attendance-policy", token, nil)
	if status != http.StatusOK || !bytes.Contains(body, []byte(secondID)) ||
		!bytes.Contains(body, []byte(`"selfieRequired":true`)) ||
		!bytes.Contains(body, []byte(`"earlyClockInMinutes":30`)) ||
		!bytes.Contains(body, []byte(`"lateClockInMinutes":15`)) ||
		!bytes.Contains(body, []byte(`"earlyClockOutMinutes":10`)) ||
		!bytes.Contains(body, []byte(`"lateClockOutMinutes":20`)) ||
		!bytes.Contains(body, []byte(`"preventEarlyClockIn":true`)) ||
		!bytes.Contains(body, []byte(`"preventLateClockIn":true`)) ||
		!bytes.Contains(body, []byte(`"preventEarlyClockOut":true`)) ||
		!bytes.Contains(body, []byte(`"preventLateClockOut":true`)) ||
		!bytes.Contains(body, []byte(`"preventUnscheduledBreak":true`)) {
		t.Fatalf("replacement targeted policy did not resolve: %d %s", status, body)
	}
	var archivedCount int
	if err = db.QueryRow(`SELECT COUNT(*) FROM attendance_policies p JOIN policy_assignments pa ON pa.policy_id=p.id WHERE p.id=UUID_TO_BIN(?) AND p.status='ARCHIVED' AND pa.valid_until IS NOT NULL`, firstID).Scan(&archivedCount); err != nil {
		t.Fatal(err)
	}
	if archivedCount != 1 {
		t.Fatal("previous targeted policy was not closed atomically")
	}
}

func TestSectionLifecycleIsOrganizationScoped(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}
	if !strings.Contains(strings.ToLower(dsn), "_test") {
		t.Fatal("integration test refuses a DSN without _test in its database name")
	}
	email, password := os.Getenv("TEST_ADMIN_EMAIL"), os.Getenv("TEST_ADMIN_PASSWORD")
	db, err := database.Open(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var organizationID string
	if err = db.QueryRow(`SELECT BIN_TO_UUID(m.organization_id) FROM organization_memberships m JOIN users u ON u.id=m.user_id WHERE u.email=? LIMIT 1`, email).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	sectionID, alternateOrganizationID, alternateSectionID := "", "", ""
	defer func() {
		if sectionID != "" {
			_, _ = db.Exec(`DELETE FROM audit_logs WHERE resource_id=UUID_TO_BIN(?)`, sectionID)
			_, _ = db.Exec(`DELETE FROM sections WHERE id=UUID_TO_BIN(?)`, sectionID)
		}
		if alternateSectionID != "" {
			_, _ = db.Exec(`DELETE FROM sections WHERE id=UUID_TO_BIN(?)`, alternateSectionID)
		}
		if alternateOrganizationID != "" {
			_, _ = db.Exec(`DELETE FROM organizations WHERE id=UUID_TO_BIN(?)`, alternateOrganizationID)
		}
	}()
	cfg := config.Config{Environment: "test", AccessTokenSecret: "integration-test-access-secret-at-least-32-bytes", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour, CORSAllowedOrigins: []string{"http://localhost"}, MinIO: config.MinIOConfig{Endpoint: "localhost:19000", AccessKey: "test", SecretKey: "test", Bucket: "test-evidence"}}
	api, err := controllers.New(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(api.Handler())
	defer host.Close()
	token := login(t, host.URL, email, password)
	code := "WH" + time.Now().UTC().Format("150405")
	status, body := authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/sections", token, map[string]any{"code": code, "name": "Warehouse Test", "address": "Surabaya", "timezone": "Asia/Jakarta", "latitude": -7.25, "longitude": 112.75})
	if status != http.StatusCreated {
		t.Fatalf("create section status %d: %s", status, body)
	}
	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err = json.Unmarshal(body, &created); err != nil {
		t.Fatal(err)
	}
	sectionID = created.Data.ID
	status, body = authorizedJSON(t, http.MethodPatch, host.URL+"/api/v1/sections/"+sectionID, token, map[string]any{"code": code + "U", "name": "Warehouse Updated", "address": "Sidoarjo", "timezone": "Asia/Makassar", "latitude": -7.35, "longitude": 112.70})
	if status != http.StatusOK || !bytes.Contains(body, []byte(`"name":"Warehouse Updated"`)) {
		t.Fatalf("update section status %d: %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/sections/"+sectionID+"/deactivate", token, nil)
	if status != http.StatusOK || !bytes.Contains(body, []byte(`"status":"INACTIVE"`)) {
		t.Fatalf("deactivate section status %d: %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/sections/"+sectionID+"/activate", token, nil)
	if status != http.StatusOK || !bytes.Contains(body, []byte(`"status":"ACTIVE"`)) {
		t.Fatalf("activate section status %d: %s", status, body)
	}
	alternateOrganizationID, _ = identity.NewUUID()
	alternateSectionID, _ = identity.NewUUID()
	if _, err = db.Exec(`INSERT INTO organizations(id,code,name,timezone) VALUES(UUID_TO_BIN(?),?,'Alternate Scope','Asia/Jakarta')`, alternateOrganizationID, "SCOPE-"+strings.ToUpper(alternateOrganizationID[:8])); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO sections(id,organization_id,code,name,status) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),'FOREIGN','Foreign Section','ACTIVE')`, alternateSectionID, alternateOrganizationID); err != nil {
		t.Fatal(err)
	}
	status, _ = authorizedJSON(t, http.MethodPatch, host.URL+"/api/v1/sections/"+alternateSectionID, token, map[string]any{"code": "HACK", "name": "Wrong Scope", "timezone": "Asia/Jakarta"})
	if status != http.StatusNotFound {
		t.Fatalf("cross-organization section update status %d", status)
	}
	var audits int
	if err = db.QueryRow(`SELECT COUNT(*) FROM audit_logs WHERE resource_id=UUID_TO_BIN(?) AND action IN ('section.create','section.update','section.deactivate','section.activate')`, sectionID).Scan(&audits); err != nil || audits != 4 {
		t.Fatalf("section audit count=%d err=%v", audits, err)
	}
}

func TestShiftConflictAndPublicationLifecycle(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}
	if !strings.Contains(strings.ToLower(dsn), "_test") {
		t.Fatal("integration test refuses a DSN without _test in its database name")
	}
	email, password := os.Getenv("TEST_ADMIN_EMAIL"), os.Getenv("TEST_ADMIN_PASSWORD")
	db, err := database.Open(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var membershipID, sectionID string
	if err = db.QueryRow(`SELECT BIN_TO_UUID(m.id),BIN_TO_UUID(sm.section_id) FROM organization_memberships m JOIN users u ON u.id=m.user_id JOIN section_memberships sm ON sm.membership_id=m.id WHERE u.email=? ORDER BY sm.is_primary DESC LIMIT 1`, email).Scan(&membershipID, &sectionID); err != nil {
		t.Fatal(err)
	}
	createdIDs := []string{}
	defer func() {
		for _, id := range createdIDs {
			_, _ = db.Exec(`DELETE FROM audit_logs WHERE resource_id=UUID_TO_BIN(?)`, id)
			_, _ = db.Exec(`DELETE FROM shift_assignments WHERE shift_id=UUID_TO_BIN(?)`, id)
			_, _ = db.Exec(`DELETE FROM shifts WHERE id=UUID_TO_BIN(?)`, id)
		}
	}()
	cfg := config.Config{Environment: "test", AccessTokenSecret: "integration-test-access-secret-at-least-32-bytes", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour, CORSAllowedOrigins: []string{"http://localhost"}, MinIO: config.MinIOConfig{Endpoint: "localhost:19000", AccessKey: "test", SecretKey: "test", Bucket: "test-evidence"}}
	api, err := controllers.New(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(api.Handler())
	defer host.Close()
	token := login(t, host.URL, email, password)
	startsAt := time.Now().UTC().Add(48 * time.Hour).Truncate(time.Minute)
	endsAt := startsAt.Add(8 * time.Hour)
	create := func(title string, publish bool) (int, []byte, string) {
		status, body := authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/shifts", token, map[string]any{"sectionId": sectionID, "title": title, "startsAt": startsAt, "endsAt": endsAt, "publish": publish, "membershipIds": []string{membershipID}})
		if status != http.StatusCreated {
			return status, body, ""
		}
		var envelope struct {
			Data struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		if err := json.Unmarshal(body, &envelope); err != nil {
			t.Fatal(err)
		}
		createdIDs = append(createdIDs, envelope.Data.ID)
		return status, body, envelope.Data.ID
	}
	status, body, firstID := create("Published Conflict Source", true)
	if status != http.StatusCreated {
		t.Fatalf("first shift status %d: %s", status, body)
	}
	status, body, _ = create("Published Conflict Rejected", true)
	if status != http.StatusConflict || !bytes.Contains(body, []byte(`"code":"SHIFT_CONFLICT"`)) {
		t.Fatalf("overlapping published shift status %d: %s", status, body)
	}
	status, body, draftID := create("Overlapping Draft", false)
	if status != http.StatusCreated {
		t.Fatalf("overlapping draft status %d: %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/shifts/"+draftID+"/publish", token, nil)
	if status != http.StatusConflict || !bytes.Contains(body, []byte(`"code":"SHIFT_CONFLICT"`)) {
		t.Fatalf("conflicting draft publish status %d: %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/shifts/"+firstID+"/unpublish", token, nil)
	if status != http.StatusOK || !bytes.Contains(body, []byte(`"status":"DRAFT"`)) {
		t.Fatalf("unpublish shift status %d: %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/shifts/"+draftID+"/publish", token, nil)
	if status != http.StatusOK || !bytes.Contains(body, []byte(`"status":"PUBLISHED"`)) {
		t.Fatalf("publish replacement shift status %d: %s", status, body)
	}
	from, to := startsAt.Add(-time.Hour), endsAt.Add(time.Hour)
	status, body = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/me/shifts?from="+from.Format(time.RFC3339)+"&to="+to.Format(time.RFC3339), token, nil)
	if status != http.StatusOK || !bytes.Contains(body, []byte(draftID)) || bytes.Contains(body, []byte(firstID)) {
		t.Fatalf("personal published schedule projection status %d: %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/shifts?from="+from.Format(time.RFC3339)+"&to="+to.Format(time.RFC3339), token, nil)
	if status != http.StatusOK || !bytes.Contains(body, []byte(`"participants"`)) || !bytes.Contains(body, []byte(`"membershipId":"`+membershipID+`"`)) {
		t.Fatalf("manager shift participants missing status %d: %s", status, body)
	}
}

func TestPendingAttendanceApprovalAndAppendOnlyCorrection(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}
	if !strings.Contains(strings.ToLower(dsn), "_test") {
		t.Fatal("integration test refuses a DSN without _test in its database name")
	}
	email, password := os.Getenv("TEST_ADMIN_EMAIL"), os.Getenv("TEST_ADMIN_PASSWORD")
	db, err := database.Open(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	resetAttendance(t, db, email)
	var membershipID []byte
	if err = db.QueryRow(`SELECT m.id FROM organization_memberships m JOIN users u ON u.id=m.user_id WHERE u.email=?`, email).Scan(&membershipID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE attendance_policies p JOIN policy_assignments pa ON pa.policy_id=p.id JOIN organization_memberships m ON m.organization_id=pa.organization_id SET p.unscheduled_requires_approval=TRUE WHERE m.id=?`, membershipID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE shift_assignments SET status='CANCELLED' WHERE membership_id=?`, membershipID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(`UPDATE attendance_policies p JOIN policy_assignments pa ON pa.policy_id=p.id JOIN organization_memberships m ON m.organization_id=pa.organization_id SET p.unscheduled_requires_approval=FALSE WHERE m.id=?`, membershipID)
		_, _ = db.Exec(`UPDATE shift_assignments SET status='ASSIGNED' WHERE membership_id=?`, membershipID)
	})
	cfg := config.Config{AccessTokenSecret: "integration-test-access-secret-at-least-32-bytes", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour, CORSAllowedOrigins: []string{"http://localhost"}, MinIO: config.MinIOConfig{Endpoint: "localhost:19000", AccessKey: "test", SecretKey: "test", Bucket: "test-evidence"}}
	api, err := controllers.New(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(api.Handler())
	defer host.Close()
	token := login(t, host.URL, email, password)
	pending := doAction(t, host.URL, token, "integration-pending-clock-in", "CLOCK_IN", time.Now().UTC())
	if pending.Data.Decision != "PENDING" || pending.Data.AttendanceState != "PENDING" {
		t.Fatalf("expected pending clock-in: %+v", pending)
	}
	status, body := authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/me/requests", token, nil)
	if status != http.StatusOK {
		t.Fatalf("list own requests status %d: %s", status, body)
	}
	var list struct {
		Data []struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"data"`
	}
	if err = json.Unmarshal(body, &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Data) != 1 || list.Data[0].Status != "PENDING" {
		t.Fatalf("unexpected request list: %s", body)
	}
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/attendance/requests/"+list.Data[0].ID+"/decision", token, map[string]string{"decision": "APPROVED"})
	if status != http.StatusOK {
		t.Fatalf("approve status %d: %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/attendance/requests?status=APPROVED", token, nil)
	if status != http.StatusOK || !bytes.Contains(body, []byte(list.Data[0].ID)) || !bytes.Contains(body, []byte(`"source":"MOBILE"`)) {
		t.Fatalf("approved attendance detail is not queryable: status=%d body=%s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/me/attendance/today", token, nil)
	if status != http.StatusOK {
		t.Fatal(status)
	}
	var today struct {
		Data struct {
			State        string `json:"state"`
			LatestEvents []struct {
				ID       string `json:"id"`
				Decision string `json:"decision"`
			} `json:"latestEvents"`
		} `json:"data"`
	}
	if err = json.Unmarshal(body, &today); err != nil {
		t.Fatal(err)
	}
	if today.Data.State != "WORKING" || len(today.Data.LatestEvents) == 0 || today.Data.LatestEvents[0].Decision != "APPROVED" {
		t.Fatalf("approval not reflected in state/history: %s", body)
	}
	correction := map[string]any{"originalEventId": pending.Data.ActionID, "correctedActionType": "CLOCK_IN", "correctedRecordedAt": time.Now().UTC().Add(-5 * time.Minute), "reason": "Perbaikan waktu berdasarkan bukti supervisor"}
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/attendance/corrections", token, correction)
	if status != http.StatusCreated {
		t.Fatalf("correction status %d: %s", status, body)
	}
	var links, originalPending int
	if err = db.QueryRow(`SELECT COUNT(*) FROM attendance_corrections WHERE original_event_id=UUID_TO_BIN(?)`, pending.Data.ActionID).Scan(&links); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM attendance_events WHERE id=UUID_TO_BIN(?) AND action_type='CLOCK_IN' AND decision='PENDING'`, pending.Data.ActionID).Scan(&originalPending); err != nil {
		t.Fatal(err)
	}
	if links != 1 || originalPending != 1 {
		t.Fatalf("append-only correction invariant failed: links=%d originalPending=%d", links, originalPending)
	}
	status, body = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/attendance/records", token, nil)
	if status != http.StatusOK {
		t.Fatalf("manager attendance records status %d: %s", status, body)
	}
	var records struct {
		Data []struct {
			ID               string `json:"id"`
			EmployeeName     string `json:"employeeName"`
			LatestCorrection *struct {
				CorrectedActionType string `json:"correctedActionType"`
				Reason              string `json:"reason"`
			} `json:"latestCorrection"`
		} `json:"data"`
	}
	if err = json.Unmarshal(body, &records); err != nil {
		t.Fatal(err)
	}
	var correctedRecordFound bool
	for _, record := range records.Data {
		if record.ID == pending.Data.ActionID && record.EmployeeName != "" && record.LatestCorrection != nil && record.LatestCorrection.CorrectedActionType == "CLOCK_IN" && record.LatestCorrection.Reason != "" {
			correctedRecordFound = true
		}
	}
	if !correctedRecordFound {
		t.Fatalf("manager record did not expose latest correction: %s", body)
	}
}

type actionEnvelope struct {
	Data struct {
		ActionID        string    `json:"actionId"`
		Decision        string    `json:"decision"`
		AttendanceState string    `json:"attendanceState"`
		RecordedAt      time.Time `json:"recordedAt"`
	} `json:"data"`
	Replay bool `json:"idempotentReplay"`
}

func login(t *testing.T, baseURL, email, password string) string {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"email": email, "password": password})
	response, err := http.Post(baseURL+"/api/v1/auth/login", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("login status %d", response.StatusCode)
	}
	var envelope struct {
		Data struct {
			AccessToken string `json:"accessToken"`
		} `json:"data"`
	}
	if err = json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatal(err)
	}
	return envelope.Data.AccessToken
}

type tokenPair struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
}

func loginTokens(t *testing.T, baseURL, email, password string) tokenPair {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"email": email, "password": password})
	response, err := http.Post(baseURL+"/api/v1/auth/login", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("login status %d", response.StatusCode)
	}
	var envelope struct {
		Data tokenPair `json:"data"`
	}
	if err = json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatal(err)
	}
	return envelope.Data
}

func refreshToken(t *testing.T, baseURL, token string) (tokenPair, int) {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"refreshToken": token})
	response, err := http.Post(baseURL+"/api/v1/auth/refresh", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var envelope struct {
		Data tokenPair `json:"data"`
	}
	_ = json.NewDecoder(response.Body).Decode(&envelope)
	return envelope.Data, response.StatusCode
}

func authorizedJSON(t *testing.T, method, url, token string, payload any) (int, []byte) {
	t.Helper()
	var body *bytes.Reader
	if payload == nil {
		body = bytes.NewReader(nil)
	} else {
		encoded, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequest(method, url, body)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var decoded json.RawMessage
	if err = json.NewDecoder(response.Body).Decode(&decoded); err != nil && response.StatusCode != http.StatusNoContent {
		t.Fatal(err)
	}
	return response.StatusCode, decoded
}

func authorizedRaw(t *testing.T, url, token string) (int, http.Header, []byte) {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return response.StatusCode, response.Header, body
}

type recordingResetSender struct {
	calls               int
	recipient           string
	token               string
	invitationCalls     int
	invitationRecipient string
	invitationToken     string
}

func (s *recordingResetSender) SendInvitation(_ context.Context, recipient, token string) error {
	s.invitationCalls++
	s.invitationRecipient = recipient
	s.invitationToken = token
	return nil
}

func (s *recordingResetSender) SendPasswordReset(_ context.Context, recipient, token string) error {
	s.calls++
	s.recipient = recipient
	s.token = token
	return nil
}

func publicJSON(t *testing.T, method, url string, payload any) (int, []byte) {
	t.Helper()
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest(method, url, bytes.NewReader(encoded))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var decoded json.RawMessage
	if err = json.NewDecoder(response.Body).Decode(&decoded); err != nil {
		t.Fatal(err)
	}
	return response.StatusCode, decoded
}

func loginStatus(t *testing.T, baseURL, email, password string) int {
	t.Helper()
	status, _ := publicJSON(t, http.MethodPost, baseURL+"/api/v1/auth/login", map[string]string{"email": email, "password": password})
	return status
}

func doAction(t *testing.T, baseURL, token, key, action string, capturedAt time.Time) actionEnvelope {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"type": action, "evidence": map[string]any{"location": map[string]any{"latitude": -6.2, "longitude": 106.8, "accuracyMeters": 10, "capturedAt": capturedAt}}})
	request, _ := http.NewRequest(http.MethodPost, baseURL+"/api/v1/attendance/actions", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Idempotency-Key", key)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated && response.StatusCode != http.StatusOK {
		var value any
		_ = json.NewDecoder(response.Body).Decode(&value)
		t.Fatalf("action status %d: %#v", response.StatusCode, value)
	}
	var envelope actionEnvelope
	if err = json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatal(err)
	}
	return envelope
}

func doActionWithReason(t *testing.T, baseURL, token, key, action, reason string) actionEnvelope {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"type": action, "reason": reason, "evidence": map[string]any{"location": map[string]any{"latitude": -6.2, "longitude": 106.8, "accuracyMeters": 10, "capturedAt": time.Now().UTC()}}})
	request, _ := http.NewRequest(http.MethodPost, baseURL+"/api/v1/attendance/actions", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Idempotency-Key", key)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated && response.StatusCode != http.StatusOK {
		var value any
		_ = json.NewDecoder(response.Body).Decode(&value)
		t.Fatalf("action status %d: %#v", response.StatusCode, value)
	}
	var envelope actionEnvelope
	if err = json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatal(err)
	}
	return envelope
}

func doActionStatus(t *testing.T, baseURL, token, key, action string) (int, []byte) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"type": action, "evidence": map[string]any{"location": map[string]any{"latitude": -6.2, "longitude": 106.8, "accuracyMeters": 10, "capturedAt": time.Now().UTC()}}})
	request, _ := http.NewRequest(http.MethodPost, baseURL+"/api/v1/attendance/actions", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Idempotency-Key", key)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var decoded json.RawMessage
	if err = json.NewDecoder(response.Body).Decode(&decoded); err != nil {
		t.Fatal(err)
	}
	return response.StatusCode, decoded
}

func latestRequestID(t *testing.T, baseURL, token, actionType string) string {
	t.Helper()
	status, body := authorizedJSON(t, http.MethodGet, baseURL+"/api/v1/me/requests", token, nil)
	if status != http.StatusOK {
		t.Fatalf("list requests status %d: %s", status, body)
	}
	var envelope struct {
		Data []struct {
			ID         string `json:"id"`
			ActionType string `json:"actionType"`
			Status     string `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		t.Fatal(err)
	}
	for _, item := range envelope.Data {
		if item.ActionType == actionType && item.Status == "PENDING" {
			return item.ID
		}
	}
	t.Fatalf("pending %s request not found: %s", actionType, body)
	return ""
}

func resetAttendance(t *testing.T, db *sql.DB, email string) {
	t.Helper()
	var membershipID []byte
	if err := db.QueryRow(`SELECT m.id FROM organization_memberships m JOIN users u ON u.id=m.user_id WHERE u.email=?`, email).Scan(&membershipID); err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	statements := []string{`DELETE a FROM attendance_decisions a JOIN attendance_requests r ON r.id=a.request_id WHERE r.membership_id=?`, `DELETE FROM attendance_requests WHERE membership_id=?`, `DELETE c FROM attendance_corrections c JOIN attendance_events e ON e.id=c.original_event_id WHERE e.membership_id=?`, `DELETE FROM attendance_state WHERE membership_id=?`, `DELETE ev FROM attendance_evidence ev JOIN attendance_events e ON e.id=ev.event_id WHERE e.membership_id=?`, `DELETE al FROM audit_logs al JOIN users u ON u.id=al.actor_user_id JOIN organization_memberships m ON m.user_id=u.id WHERE m.id=? AND al.action LIKE 'attendance.%'`, `DELETE FROM attendance_events WHERE membership_id=?`, `DELETE k FROM idempotency_keys k JOIN users u ON u.id=k.user_id JOIN organization_memberships m ON m.user_id=u.id WHERE m.id=? AND k.scope='attendance.action'`}
	for _, statement := range statements {
		if _, err = tx.Exec(statement, membershipID); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = tx.Exec(`UPDATE attendance_policies p JOIN policy_assignments pa ON pa.policy_id=p.id JOIN organization_memberships m ON m.organization_id=pa.organization_id SET p.unscheduled_requires_approval=FALSE,p.work_more_requires_approval=FALSE,p.unscheduled_break_requires_approval=FALSE,p.prevent_unscheduled_break=FALSE,p.scheduled_break_start_offset_minutes=NULL,p.scheduled_break_end_offset_minutes=NULL WHERE m.id=?`, membershipID); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(`UPDATE shift_assignments SET status='ASSIGNED' WHERE membership_id=?`, membershipID); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
}
