package attendance

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/bg-gold/attendance-api/helpers"
	"github.com/bg-gold/attendance-api/services/auth"
)

type Service struct {
	db                *sql.DB
	now               func() time.Time
	dynamicQRSecret   []byte
	integrityVerifier IntegrityVerifier
}

type HistoryItem struct {
	ID         string          `json:"id"`
	ActionType Action          `json:"actionType"`
	Decision   Decision        `json:"decision"`
	RecordedAt time.Time       `json:"recordedAt"`
	Reason     *string         `json:"reason"`
	ShiftID    *string         `json:"shiftId"`
	SectionID  *string         `json:"sectionId"`
	Evidence   json.RawMessage `json:"evidence,omitempty"`
}

type Today struct {
	State         State         `json:"state"`
	ActiveShiftID *string       `json:"activeShiftId"`
	LatestEvents  []HistoryItem `json:"latestEvents"`
}

type rowQuerier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func NewService(db *sql.DB, dynamicQRSecret string) *Service {
	return &Service{db: db, now: time.Now, dynamicQRSecret: []byte(dynamicQRSecret)}
}

func (s *Service) SetIntegrityVerifier(verifier IntegrityVerifier) {
	s.integrityVerifier = verifier
}

func (s *Service) Submit(ctx context.Context, principal auth.Principal, idempotencyKey string, input ActionInput, requestID, clientIP string) (Result, bool, error) {
	if strings.TrimSpace(idempotencyKey) == "" || len(idempotencyKey) > 160 {
		return Result{}, false, errors.New("invalid idempotency key")
	}
	requestBody, err := json.Marshal(input)
	if err != nil {
		return Result{}, false, fmt.Errorf("marshal attendance request: %w", err)
	}
	requestHash := sha256.Sum256(requestBody)

	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return Result{}, false, fmt.Errorf("begin attendance transaction: %w", err)
	}
	defer tx.Rollback()

	idempotencyID, err := identity.NewUUID()
	if err != nil {
		return Result{}, false, err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT IGNORE INTO idempotency_keys(id, organization_id, user_id, scope, idempotency_key, request_hash, expires_at)
		VALUES(UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), 'attendance.action', ?, ?, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 24 HOUR))`,
		idempotencyID, principal.OrganizationID, principal.UserID, idempotencyKey, requestHash[:])
	if err != nil {
		return Result{}, false, fmt.Errorf("reserve idempotency key: %w", err)
	}
	var storedHash []byte
	var responseBody sql.NullString
	err = tx.QueryRowContext(ctx, `
		SELECT request_hash, CAST(response_body AS CHAR)
		FROM idempotency_keys
		WHERE organization_id = UUID_TO_BIN(?) AND user_id = UUID_TO_BIN(?) AND scope = 'attendance.action' AND idempotency_key = ?
		FOR UPDATE`, principal.OrganizationID, principal.UserID, idempotencyKey).Scan(&storedHash, &responseBody)
	if err != nil {
		return Result{}, false, fmt.Errorf("lock idempotency key: %w", err)
	}
	if len(storedHash) != len(requestHash) || !equalBytes(storedHash, requestHash[:]) {
		return Result{}, false, ErrIdempotencyReuse
	}
	if responseBody.Valid && responseBody.String != "" {
		var cached Result
		if err := json.Unmarshal([]byte(responseBody.String), &cached); err != nil {
			return Result{}, false, fmt.Errorf("decode idempotent response: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return Result{}, false, fmt.Errorf("commit cached attendance response: %w", err)
		}
		return cached, true, nil
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT IGNORE INTO attendance_state(membership_id, organization_id, state)
		VALUES(UUID_TO_BIN(?), UUID_TO_BIN(?), 'NOT_STARTED')`, principal.MembershipID, principal.OrganizationID); err != nil {
		return Result{}, false, fmt.Errorf("initialize attendance state: %w", err)
	}
	var state StateSnapshot
	var activeShift sql.NullString
	if err := tx.QueryRowContext(ctx, `
		SELECT state, BIN_TO_UUID(active_shift_id)
		FROM attendance_state WHERE membership_id = UUID_TO_BIN(?) FOR UPDATE`, principal.MembershipID).Scan(&state.State, &activeShift); err != nil {
		return Result{}, false, fmt.Errorf("lock attendance state: %w", err)
	}
	if activeShift.Valid {
		state.ActiveShiftID = activeShift.String
	}
	now := s.now().UTC()
	if err := ValidateTransition(state.State, input.Type); err != nil {
		return Result{}, false, err
	}
	if input.Type == ClockIn {
		alreadyRecorded, err := s.clockInRecordedToday(ctx, tx, principal, now)
		if err != nil {
			return Result{}, false, err
		}
		if alreadyRecorded {
			return Result{}, false, ErrAlreadyClockedInToday
		}
	}

	shift, err := s.resolveShift(ctx, tx, principal, input, state, now)
	if err != nil {
		return Result{}, false, err
	}
	sectionID := strings.TrimSpace(input.SectionID)
	if shift != nil {
		sectionID = shift.SectionID
	} else if sectionID == "" && strings.TrimSpace(input.Evidence.DynamicQRToken) != "" {
		claims, err := s.decodeDynamicQR(input.Evidence.DynamicQRToken, now)
		if err != nil {
			return Result{}, false, err
		}
		if claims.OrganizationID != principal.OrganizationID {
			return Result{}, false, ErrQRInvalid
		}
		sectionID = claims.SectionID
	}
	policy, err := s.resolvePolicy(ctx, tx, principal, sectionID, now)
	if err != nil {
		return Result{}, false, err
	}
	sectionLat, sectionLon, err := s.sectionCoordinates(ctx, tx, principal.OrganizationID, sectionID)
	if err != nil {
		return Result{}, false, err
	}
	if input.Evidence.AttachmentID != "" {
		if err := s.validateAttachment(ctx, tx, principal, input.Evidence.AttachmentID); err != nil {
			return Result{}, false, err
		}
	}
	if input.Evidence.DeviceID != "" {
		var deviceExists bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM device_registrations WHERE id=UUID_TO_BIN(?) AND organization_id=UUID_TO_BIN(?) AND user_id=UUID_TO_BIN(?) AND revoked_at IS NULL)`, input.Evidence.DeviceID, principal.OrganizationID, principal.UserID).Scan(&deviceExists); err != nil {
			return Result{}, false, fmt.Errorf("validate attendance device: %w", err)
		}
		if !deviceExists {
			return Result{}, false, ErrDeviceInvalid
		}
	}
	if err := ValidatePolicy(policy, shift, sectionLat, sectionLon, input, now); err != nil {
		return Result{}, false, err
	}
	if hasMode(policy, "DEVICE_INTEGRITY") {
		expectedHash := fmt.Sprintf("%x", sha256.Sum256([]byte(strings.Join([]string{
			principal.OrganizationID, principal.UserID, principal.MembershipID, idempotencyKey, string(input.Type),
		}, ":"))))
		verdict, err := s.verifyIntegrity(ctx, policy, input.Evidence.IntegrityToken, expectedHash)
		if err != nil {
			return Result{}, false, err
		}
		input.Evidence.IntegrityVerdict = verdict
	}
	if input.Evidence.FaceVerificationID != "" {
		if err := s.validateFaceVerification(ctx, tx, principal, input.Evidence.FaceVerificationID, now); err != nil {
			return Result{}, false, err
		}
	}
	if hasMode(policy, "DYNAMIC_QR") && dynamicQRAction(input.Type) {
		if err := s.consumeDynamicQR(ctx, tx, principal, sectionID, input.Evidence.DynamicQRToken, now); err != nil {
			return Result{}, false, err
		}
	}

	decision := Approved
	if (shift == nil && input.Type == ClockIn && policy.UnscheduledRequiresApproval) ||
		(input.Type == WorkMore && policy.WorkMoreRequiresApproval) ||
		(input.Type == StartBreak && policy.UnscheduledBreakRequiresApproval && !withinScheduledBreak(policy, shift, now)) {
		decision = PendingApproval
	}
	nextState := NextState(state.State, input.Type, decision)
	eventID, err := identity.NewUUID()
	if err != nil {
		return Result{}, false, err
	}
	policySnapshot, _ := json.Marshal(policy)
	shiftID := ""
	if shift != nil {
		shiftID = shift.ID
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO attendance_events(
			id, organization_id, membership_id, shift_id, section_id, policy_id, action_type,
			decision, server_recorded_at, reason, policy_snapshot, source, created_by
		) VALUES(
			UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(NULLIF(?, '')),
			UUID_TO_BIN(NULLIF(?, '')), UUID_TO_BIN(?), ?, ?, ?, NULLIF(?, ''), ?, 'MOBILE', UUID_TO_BIN(?)
		)`, eventID, principal.OrganizationID, principal.MembershipID, shiftID, sectionID, policy.ID,
		string(input.Type), string(decision), now, input.Reason, string(policySnapshot), principal.UserID)
	if err != nil {
		return Result{}, false, fmt.Errorf("insert attendance event: %w", err)
	}
	if err := s.insertEvidence(ctx, tx, eventID, input.Evidence, clientIP); err != nil {
		return Result{}, false, err
	}

	if decision == PendingApproval {
		requestIDValue, err := identity.NewUUID()
		if err != nil {
			return Result{}, false, err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO attendance_requests(id, organization_id, attendance_event_id, membership_id)
			VALUES(UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?))`,
			requestIDValue, principal.OrganizationID, eventID, principal.MembershipID); err != nil {
			return Result{}, false, fmt.Errorf("insert attendance request: %w", err)
		}
	}
	activeShiftValue := shiftID
	if nextState == Completed || nextState == NotStarted || nextState == Pending {
		activeShiftValue = ""
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE attendance_state
		SET state = ?, active_shift_id = UUID_TO_BIN(NULLIF(?, '')), last_event_id = UUID_TO_BIN(?), version = version + 1
		WHERE membership_id = UUID_TO_BIN(?)`, string(nextState), activeShiftValue, eventID, principal.MembershipID); err != nil {
		return Result{}, false, fmt.Errorf("update attendance state: %w", err)
	}

	auditID, err := identity.NewUUID()
	if err != nil {
		return Result{}, false, err
	}
	auditMetadata, _ := json.Marshal(map[string]any{"actionType": input.Type, "decision": decision, "state": nextState})
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO audit_logs(id, organization_id, actor_user_id, action, resource_type, resource_id, metadata, request_id)
		VALUES(UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), 'attendance.action', 'attendance_event', UUID_TO_BIN(?), ?, ?)`,
		auditID, principal.OrganizationID, principal.UserID, eventID, string(auditMetadata), requestID); err != nil {
		return Result{}, false, fmt.Errorf("insert attendance audit: %w", err)
	}

	result := Result{ActionID: eventID, Decision: decision, AttendanceState: nextState, RecordedAt: now, Message: resultMessage(input.Type, decision)}
	encodedResult, _ := json.Marshal(result)
	if _, err := tx.ExecContext(ctx, `
		UPDATE idempotency_keys SET response_status = 201, response_body = ?
		WHERE organization_id = UUID_TO_BIN(?) AND user_id = UUID_TO_BIN(?) AND scope = 'attendance.action' AND idempotency_key = ?`,
		string(encodedResult), principal.OrganizationID, principal.UserID, idempotencyKey); err != nil {
		return Result{}, false, fmt.Errorf("store idempotent attendance response: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Result{}, false, fmt.Errorf("commit attendance action: %w", err)
	}
	return result, false, nil
}

func (s *Service) Today(ctx context.Context, principal auth.Principal) (Today, error) {
	result := Today{State: NotStarted, LatestEvents: []HistoryItem{}}
	var activeShift sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT state, BIN_TO_UUID(active_shift_id) FROM attendance_state WHERE membership_id = UUID_TO_BIN(?)`, principal.MembershipID).
		Scan(&result.State, &activeShift)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return Today{}, fmt.Errorf("load attendance state: %w", err)
	}
	if activeShift.Valid {
		result.ActiveShiftID = &activeShift.String
	}
	if result.State == Completed {
		recordedToday, dayErr := s.clockInRecordedToday(ctx, s.db, principal, s.now().UTC())
		if dayErr != nil {
			return Today{}, dayErr
		}
		if !recordedToday {
			result.State = NotStarted
			result.ActiveShiftID = nil
		}
	}
	items, err := s.History(ctx, principal, s.now().UTC().Add(-36*time.Hour), s.now().UTC().Add(12*time.Hour), 20)
	if err != nil {
		return Today{}, err
	}
	result.LatestEvents = items
	return result, nil
}

func (s *Service) clockInRecordedToday(ctx context.Context, query rowQuerier, principal auth.Principal, now time.Time) (bool, error) {
	start, end, err := organizationDayBounds(ctx, query, principal.OrganizationID, now)
	if err != nil {
		return false, err
	}
	var exists bool
	err = query.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM attendance_events e
			LEFT JOIN attendance_requests ar ON ar.attendance_event_id=e.id
			LEFT JOIN attendance_decisions d ON d.request_id=ar.id
			WHERE e.organization_id=UUID_TO_BIN(?)
			  AND e.membership_id=UUID_TO_BIN(?)
			  AND e.action_type='CLOCK_IN'
			  AND COALESCE(d.decision,e.decision) IN ('APPROVED','PENDING')
			  AND e.server_recorded_at>=? AND e.server_recorded_at<?
		)`, principal.OrganizationID, principal.MembershipID, start, end).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("check daily clock in: %w", err)
	}
	return exists, nil
}

func organizationDayBounds(ctx context.Context, query rowQuerier, organizationID string, now time.Time) (time.Time, time.Time, error) {
	var timezoneName string
	if err := query.QueryRowContext(ctx, `SELECT timezone FROM organizations WHERE id=UUID_TO_BIN(?)`, organizationID).Scan(&timezoneName); err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("load organization timezone: %w", err)
	}
	location, err := time.LoadLocation(timezoneName)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("load organization timezone %q: %w", timezoneName, err)
	}
	local := now.In(location)
	start := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, location)
	return start.UTC(), start.AddDate(0, 0, 1).UTC(), nil
}

func (s *Service) History(ctx context.Context, principal auth.Principal, from, to time.Time, limit int) ([]HistoryItem, error) {
	items, _, err := s.HistoryPage(ctx, principal, from, to, limit, "")
	return items, err
}

type historyCursor struct {
	RecordedAt time.Time `json:"recordedAt"`
	ID         string    `json:"id"`
}

func (s *Service) HistoryPage(ctx context.Context, principal auth.Principal, from, to time.Time, limit int, cursor string) ([]HistoryItem, string, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query := `
		SELECT BIN_TO_UUID(e.id), e.action_type, COALESCE(d.decision, e.decision), e.server_recorded_at, e.reason,
		       BIN_TO_UUID(e.shift_id), BIN_TO_UUID(e.section_id),
		       JSON_OBJECT(
		         'latitude', ev.latitude, 'longitude', ev.longitude, 'accuracyMeters', ev.accuracy_meters,
		         'attachmentId', BIN_TO_UUID(ev.attachment_id)
		       )
		FROM attendance_events e
		LEFT JOIN attendance_evidence ev ON ev.event_id = e.id
		LEFT JOIN attendance_requests ar ON ar.attendance_event_id = e.id
		LEFT JOIN attendance_decisions d ON d.request_id = ar.id
		WHERE e.organization_id = UUID_TO_BIN(?) AND e.membership_id = UUID_TO_BIN(?)
		  AND e.server_recorded_at >= ? AND e.server_recorded_at < ?`
	args := []any{principal.OrganizationID, principal.MembershipID, from.UTC(), to.UTC()}
	if strings.TrimSpace(cursor) != "" {
		decoded, err := base64.RawURLEncoding.DecodeString(cursor)
		if err != nil {
			return nil, "", ErrInvalidCursor
		}
		var boundary historyCursor
		if json.Unmarshal(decoded, &boundary) != nil || boundary.RecordedAt.IsZero() || strings.TrimSpace(boundary.ID) == "" {
			return nil, "", ErrInvalidCursor
		}
		query += ` AND (e.server_recorded_at < ? OR (e.server_recorded_at = ? AND e.id < UUID_TO_BIN(?)))`
		args = append(args, boundary.RecordedAt.UTC(), boundary.RecordedAt.UTC(), boundary.ID)
	}
	query += ` ORDER BY e.server_recorded_at DESC,e.id DESC LIMIT ?`
	args = append(args, limit+1)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, "", fmt.Errorf("query attendance history: %w", err)
	}
	defer rows.Close()
	items := []HistoryItem{}
	for rows.Next() {
		var item HistoryItem
		var reason, shiftID, sectionID, evidence sql.NullString
		if err := rows.Scan(&item.ID, &item.ActionType, &item.Decision, &item.RecordedAt, &reason, &shiftID, &sectionID, &evidence); err != nil {
			return nil, "", fmt.Errorf("scan attendance history: %w", err)
		}
		if reason.Valid {
			item.Reason = &reason.String
		}
		if shiftID.Valid {
			item.ShiftID = &shiftID.String
		}
		if sectionID.Valid {
			item.SectionID = &sectionID.String
		}
		if evidence.Valid {
			item.Evidence = json.RawMessage(evidence.String)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, "", err
	}
	nextCursor := ""
	if len(items) > limit {
		items = items[:limit]
		last := items[len(items)-1]
		encoded, _ := json.Marshal(historyCursor{RecordedAt: last.RecordedAt.UTC(), ID: last.ID})
		nextCursor = base64.RawURLEncoding.EncodeToString(encoded)
	}
	return items, nextCursor, nil
}

func (s *Service) resolveShift(ctx context.Context, tx *sql.Tx, principal auth.Principal, input ActionInput, state StateSnapshot, now time.Time) (*Shift, error) {
	shiftID := strings.TrimSpace(input.ShiftID)
	if shiftID == "" && state.ActiveShiftID != "" {
		shiftID = state.ActiveShiftID
	}
	baseQuery := `
		SELECT BIN_TO_UUID(s.id), BIN_TO_UUID(s.section_id), s.starts_at, s.ends_at
		FROM shifts s JOIN shift_assignments sa ON sa.shift_id = s.id
		WHERE s.organization_id = UUID_TO_BIN(?) AND sa.membership_id = UUID_TO_BIN(?)
		  AND s.status = 'PUBLISHED' AND sa.status <> 'CANCELLED'`
	args := []any{principal.OrganizationID, principal.MembershipID}
	if shiftID != "" {
		baseQuery += " AND s.id = UUID_TO_BIN(?) LIMIT 1"
		args = append(args, shiftID)
	} else {
		baseQuery += " AND s.starts_at <= DATE_ADD(?, INTERVAL 12 HOUR) AND s.ends_at >= DATE_SUB(?, INTERVAL 12 HOUR) ORDER BY ABS(TIMESTAMPDIFF(SECOND, s.starts_at, ?)) LIMIT 1"
		args = append(args, now, now, now)
	}
	var shift Shift
	if err := tx.QueryRowContext(ctx, baseQuery, args...).Scan(&shift.ID, &shift.SectionID, &shift.StartsAt, &shift.EndsAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) && shiftID == "" {
			return nil, nil
		}
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errors.New("shift is not available for this employee")
		}
		return nil, fmt.Errorf("resolve shift: %w", err)
	}
	return &shift, nil
}

func (s *Service) resolvePolicy(ctx context.Context, tx *sql.Tx, principal auth.Principal, sectionID string, now time.Time) (Policy, error) {
	var policy Policy
	var minimumAccuracy sql.NullFloat64
	var scheduledBreakStart, scheduledBreakEnd, breakRounding sql.NullInt64
	err := tx.QueryRowContext(ctx, `
		SELECT BIN_TO_UUID(p.id), p.name, p.version, p.early_clock_in_minutes, p.late_clock_in_minutes,
		       p.early_clock_out_minutes, p.late_clock_out_minutes, p.prevent_early_clock_in,p.prevent_late_clock_in,p.prevent_early_clock_out,p.prevent_late_clock_out,
		       p.auto_clock_out, p.unscheduled_requires_approval,p.work_more_requires_approval,p.unscheduled_break_requires_approval,p.prevent_unscheduled_break,
		       p.scheduled_break_start_offset_minutes,p.scheduled_break_end_offset_minutes,p.break_rounding_minutes,
		       p.selfie_required, p.minimum_location_accuracy_meters
		FROM policy_assignments pa JOIN attendance_policies p ON p.id = pa.policy_id AND p.status = 'ACTIVE'
		WHERE pa.organization_id = UUID_TO_BIN(?)
		  AND (pa.valid_from IS NULL OR pa.valid_from <= ?)
		  AND (pa.valid_until IS NULL OR pa.valid_until > ?)
		  AND (
		    pa.membership_id = UUID_TO_BIN(?)
		    OR (pa.membership_id IS NULL AND pa.section_id = UUID_TO_BIN(NULLIF(?, '')))
		    OR (pa.membership_id IS NULL AND pa.section_id IS NULL)
		  )
		ORDER BY CASE WHEN pa.membership_id IS NOT NULL THEN 1 WHEN pa.section_id IS NOT NULL THEN 2 ELSE 3 END,COALESCE(pa.valid_from,pa.created_at) DESC
		LIMIT 1`, principal.OrganizationID, now, now, principal.MembershipID, sectionID).
		Scan(&policy.ID, &policy.Name, &policy.Version, &policy.EarlyClockInMinutes, &policy.LateClockInMinutes,
			&policy.EarlyClockOutMinutes, &policy.LateClockOutMinutes, &policy.PreventEarlyClockIn,
			&policy.PreventLateClockIn, &policy.PreventEarlyClockOut, &policy.PreventLateClockOut,
			&policy.AutoClockOut, &policy.UnscheduledRequiresApproval, &policy.WorkMoreRequiresApproval, &policy.UnscheduledBreakRequiresApproval, &policy.PreventUnscheduledBreak,
			&scheduledBreakStart, &scheduledBreakEnd, &breakRounding, &policy.SelfieRequired, &minimumAccuracy)
	if errors.Is(err, sql.ErrNoRows) {
		return Policy{}, ErrPolicyMissing
	}
	if err != nil {
		return Policy{}, fmt.Errorf("resolve attendance policy: %w", err)
	}
	if minimumAccuracy.Valid {
		policy.MinimumLocationAccuracyMeters = &minimumAccuracy.Float64
	}
	if scheduledBreakStart.Valid {
		value := uint16(scheduledBreakStart.Int64)
		policy.ScheduledBreakStartOffsetMinutes = &value
	}
	if scheduledBreakEnd.Valid {
		value := uint16(scheduledBreakEnd.Int64)
		policy.ScheduledBreakEndOffsetMinutes = &value
	}
	if breakRounding.Valid {
		value := uint16(breakRounding.Int64)
		policy.BreakRoundingMinutes = &value
	}
	policy.Modes = make(map[string]json.RawMessage)
	rows, err := tx.QueryContext(ctx, `SELECT mode, CAST(settings AS CHAR) FROM attendance_policy_modes WHERE policy_id = UUID_TO_BIN(?)`, policy.ID)
	if err != nil {
		return Policy{}, fmt.Errorf("load attendance policy modes: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var mode string
		var settings sql.NullString
		if err := rows.Scan(&mode, &settings); err != nil {
			return Policy{}, fmt.Errorf("scan attendance policy mode: %w", err)
		}
		if settings.Valid {
			policy.Modes[mode] = json.RawMessage(settings.String)
		} else {
			policy.Modes[mode] = nil
		}
	}
	return policy, rows.Err()
}

func (s *Service) sectionCoordinates(ctx context.Context, tx *sql.Tx, organizationID, sectionID string) (*float64, *float64, error) {
	if sectionID == "" {
		return nil, nil, nil
	}
	var latitude, longitude sql.NullFloat64
	err := tx.QueryRowContext(ctx, `SELECT latitude, longitude FROM sections WHERE id = UUID_TO_BIN(?) AND organization_id = UUID_TO_BIN(?) AND status = 'ACTIVE'`, sectionID, organizationID).Scan(&latitude, &longitude)
	if err != nil {
		return nil, nil, fmt.Errorf("load attendance section: %w", err)
	}
	var lat, lon *float64
	if latitude.Valid {
		value := latitude.Float64
		lat = &value
	}
	if longitude.Valid {
		value := longitude.Float64
		lon = &value
	}
	return lat, lon, nil
}

func (s *Service) validateAttachment(ctx context.Context, tx *sql.Tx, principal auth.Principal, attachmentID string) error {
	var exists bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS(
		  SELECT 1 FROM attachments
		  WHERE id = UUID_TO_BIN(?) AND organization_id = UUID_TO_BIN(?) AND owner_user_id = UUID_TO_BIN(?)
		    AND purpose = 'ATTENDANCE_SELFIE' AND finalized_at IS NOT NULL AND deleted_at IS NULL
		)`, attachmentID, principal.OrganizationID, principal.UserID).Scan(&exists); err != nil {
		return fmt.Errorf("validate attendance attachment: %w", err)
	}
	if !exists {
		return errors.New("attendance attachment is unavailable")
	}
	return nil
}

func (s *Service) validateFaceVerification(ctx context.Context, tx *sql.Tx, principal auth.Principal, id string, now time.Time) error {
	var exists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM face_verifications WHERE id=UUID_TO_BIN(?) AND organization_id=UUID_TO_BIN(?) AND membership_id=UUID_TO_BIN(?) AND verified=TRUE AND liveness_passed=TRUE AND expires_at>?)`, id, principal.OrganizationID, principal.MembershipID, now).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrFaceInvalid
	}
	return nil
}

func (s *Service) verifyIntegrity(ctx context.Context, policy Policy, token, expectedRequestHash string) (json.RawMessage, error) {
	settings := integritySettings(policy)
	token = strings.TrimSpace(token)
	if token == "" {
		if settings.FailClosed {
			return nil, ErrIntegrityRequired
		}
		encoded, _ := json.Marshal(map[string]any{"providerAvailable": s.integrityVerifier != nil, "tokenProvided": false, "failOpen": true})
		return encoded, nil
	}
	if s.integrityVerifier == nil {
		if settings.FailClosed {
			return nil, ErrIntegrityUnavailable
		}
		encoded, _ := json.Marshal(map[string]any{"providerAvailable": false, "tokenProvided": true, "failOpen": true})
		return encoded, nil
	}
	verdict, err := s.integrityVerifier.Verify(ctx, token, expectedRequestHash)
	if err != nil {
		if settings.FailClosed {
			return nil, ErrIntegrityUnavailable
		}
		encoded, _ := json.Marshal(map[string]any{"providerAvailable": false, "tokenProvided": true, "failOpen": true})
		return encoded, nil
	}
	riskScore := IntegrityRiskScore(verdict)
	if riskScore > settings.MaxRiskScore {
		return nil, ErrIntegrityFailed
	}
	encoded, err := json.Marshal(map[string]any{
		"providerAvailable": true,
		"tokenProvided":     true,
		"riskScore":         riskScore,
		"maxRiskScore":      settings.MaxRiskScore,
		"verdict":           verdict,
	})
	return encoded, err
}

func (s *Service) insertEvidence(ctx context.Context, tx *sql.Tx, eventID string, evidence Evidence, clientIP string) error {
	var latitude, longitude, accuracy, capturedAt any
	var wifiSSID, wifiBSSIDHash any
	if evidence.Location != nil {
		latitude, longitude, accuracy, capturedAt = evidence.Location.Latitude, evidence.Location.Longitude, evidence.Location.AccuracyMeters, evidence.Location.CapturedAt.UTC()
	}
	if evidence.WiFi != nil {
		wifiSSID = strings.TrimSpace(evidence.WiFi.SSID)
		hash := sha256.Sum256([]byte(normalizeBSSID(evidence.WiFi.BSSID)))
		wifiBSSIDHash = hash[:]
	}
	var integrityVerdict any
	if len(evidence.IntegrityVerdict) > 0 {
		integrityVerdict = string(evidence.IntegrityVerdict)
	}
	_, err := tx.ExecContext(ctx, `
		INSERT INTO attendance_evidence(event_id, latitude, longitude, accuracy_meters, location_captured_at, attachment_id, face_verification_id, device_id, wifi_ssid, wifi_bssid_hash, integrity_verdict, ip_address)
		VALUES(UUID_TO_BIN(?), ?, ?, ?, ?, UUID_TO_BIN(NULLIF(?, '')), UUID_TO_BIN(NULLIF(?, '')), UUID_TO_BIN(NULLIF(?, '')), ?, ?, ?, INET6_ATON(NULLIF(?, '')))`,
		eventID, latitude, longitude, accuracy, capturedAt, evidence.AttachmentID, evidence.FaceVerificationID, evidence.DeviceID, wifiSSID, wifiBSSIDHash, integrityVerdict, clientIP)
	if err != nil {
		return fmt.Errorf("insert attendance evidence: %w", err)
	}
	return nil
}

func resultMessage(action Action, decision Decision) string {
	if decision == PendingApproval {
		return "Permintaan absensi sudah dikirim untuk persetujuan."
	}
	switch action {
	case ClockIn:
		return "Clock-in berhasil dicatat."
	case ClockOut:
		return "Clock-out berhasil dicatat."
	case StartBreak:
		return "Waktu istirahat dimulai."
	case EndBreak:
		return "Waktu istirahat selesai."
	case WorkMore:
		return "Waktu kerja tambahan dimulai."
	default:
		return "Absensi berhasil dicatat."
	}
}

func equalBytes(left, right []byte) bool {
	if len(left) != len(right) {
		return false
	}
	var diff byte
	for index := range left {
		diff |= left[index] ^ right[index]
	}
	return diff == 0
}
