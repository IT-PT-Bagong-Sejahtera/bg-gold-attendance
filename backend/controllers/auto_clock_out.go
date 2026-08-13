package controllers

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"time"

	"github.com/bg-gold/attendance-api/helpers"
	"github.com/bg-gold/attendance-api/services/auth"
)

type autoClockOutCandidate struct {
	MembershipID   string
	OrganizationID string
	UserID         string
	ShiftID        string
	SectionID      string
	PolicyID       string
	PolicySnapshot string
	Cutoff         time.Time
}

func (s *Server) RunWorkers(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	if count, err := s.RunAutoClockOutOnce(ctx, time.Now().UTC()); err != nil {
		slog.Error("auto clock-out worker failed", "error", err)
	} else if count > 0 {
		slog.Info("auto clock-out worker completed", "events", count)
	}
	if count, err := s.RunNotificationOutboxOnce(ctx, time.Now().UTC()); err != nil {
		slog.Error("notification outbox worker failed", "error", err)
	} else if count > 0 {
		slog.Info("notification outbox worker completed", "notifications", count)
	}
	if count, err := s.RunAttachmentRetentionOnce(ctx, time.Now().UTC()); err != nil {
		slog.Error("attachment retention worker failed", "error", err)
	} else if count > 0 {
		slog.Info("attachment retention worker completed", "objects", count)
	}
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			if count, err := s.RunAutoClockOutOnce(ctx, now.UTC()); err != nil {
				slog.Error("auto clock-out worker failed", "error", err)
			} else if count > 0 {
				slog.Info("auto clock-out worker completed", "events", count)
			}
			if count, err := s.RunNotificationOutboxOnce(ctx, now.UTC()); err != nil {
				slog.Error("notification outbox worker failed", "error", err)
			} else if count > 0 {
				slog.Info("notification outbox worker completed", "notifications", count)
			}
			if count, err := s.RunAttachmentRetentionOnce(ctx, now.UTC()); err != nil {
				slog.Error("attachment retention worker failed", "error", err)
			} else if count > 0 {
				slog.Info("attachment retention worker completed", "objects", count)
			}
		}
	}
}

func (s *Server) RunAutoClockOutOnce(ctx context.Context, now time.Time) (int, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT BIN_TO_UUID(st.membership_id),BIN_TO_UUID(st.organization_id),BIN_TO_UUID(m.user_id),BIN_TO_UUID(st.active_shift_id),BIN_TO_UUID(sh.section_id),BIN_TO_UUID(ev.policy_id),CAST(ev.policy_snapshot AS CHAR),DATE_ADD(sh.ends_at,INTERVAL p.late_clock_out_minutes MINUTE) FROM attendance_state st JOIN organization_memberships m ON m.id=st.membership_id JOIN shifts sh ON sh.id=st.active_shift_id JOIN attendance_events ev ON ev.id=st.last_event_id JOIN attendance_policies p ON p.id=ev.policy_id WHERE st.state IN ('WORKING','ON_BREAK') AND p.auto_clock_out=TRUE AND DATE_ADD(sh.ends_at,INTERVAL p.late_clock_out_minutes MINUTE)<=?`, now.UTC())
	if err != nil {
		return 0, fmt.Errorf("query auto clock-out candidates: %w", err)
	}
	defer rows.Close()
	candidates := []autoClockOutCandidate{}
	for rows.Next() {
		var candidate autoClockOutCandidate
		if err = rows.Scan(&candidate.MembershipID, &candidate.OrganizationID, &candidate.UserID, &candidate.ShiftID, &candidate.SectionID, &candidate.PolicyID, &candidate.PolicySnapshot, &candidate.Cutoff); err != nil {
			return 0, fmt.Errorf("scan auto clock-out candidate: %w", err)
		}
		candidates = append(candidates, candidate)
	}
	if err = rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate auto clock-out candidates: %w", err)
	}
	completed := 0
	for _, candidate := range candidates {
		created, err := s.autoClockOutCandidate(ctx, candidate)
		if err != nil {
			return completed, err
		}
		if created {
			completed++
		}
	}
	return completed, nil
}

func (s *Server) autoClockOutCandidate(ctx context.Context, candidate autoClockOutCandidate) (bool, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return false, fmt.Errorf("begin auto clock-out: %w", err)
	}
	defer tx.Rollback()
	var state, activeShiftID string
	err = tx.QueryRowContext(ctx, `SELECT state,BIN_TO_UUID(active_shift_id) FROM attendance_state WHERE membership_id=UUID_TO_BIN(?) FOR UPDATE`, candidate.MembershipID).Scan(&state, &activeShiftID)
	if err != nil {
		return false, fmt.Errorf("lock auto clock-out state: %w", err)
	}
	if (state != "WORKING" && state != "ON_BREAK") || activeShiftID != candidate.ShiftID {
		return false, nil
	}
	eventID, _ := identity.NewUUID()
	sourceKey := "auto-clock-out:" + candidate.ShiftID + ":" + candidate.MembershipID
	result, err := tx.ExecContext(ctx, `INSERT IGNORE INTO attendance_events(id,organization_id,membership_id,shift_id,section_id,policy_id,action_type,decision,server_recorded_at,reason,policy_snapshot,source,source_key,created_by) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),'AUTO_CLOCK_OUT','APPROVED',?,'Clock-out otomatis sesuai kebijakan shift',?,'SYSTEM',?,UUID_TO_BIN(?))`, eventID, candidate.OrganizationID, candidate.MembershipID, candidate.ShiftID, candidate.SectionID, candidate.PolicyID, candidate.Cutoff.UTC(), candidate.PolicySnapshot, sourceKey, candidate.UserID)
	if err != nil {
		return false, fmt.Errorf("insert auto clock-out event: %w", err)
	}
	inserted, _ := result.RowsAffected()
	if inserted == 0 {
		return false, nil
	}
	if _, err = tx.ExecContext(ctx, `UPDATE attendance_state SET state='COMPLETED',active_shift_id=NULL,last_event_id=UUID_TO_BIN(?),version=version+1 WHERE membership_id=UUID_TO_BIN(?)`, eventID, candidate.MembershipID); err != nil {
		return false, fmt.Errorf("complete auto clock-out state: %w", err)
	}
	principal := auth.Principal{UserID: candidate.UserID, OrganizationID: candidate.OrganizationID, MembershipID: candidate.MembershipID}
	metadata := map[string]any{"automated": true, "shiftId": candidate.ShiftID, "scheduledAt": candidate.Cutoff.UTC()}
	if err = insertAudit(ctx, tx, principal, "attendance.auto_clock_out", "attendance_event", eventID, metadata); err != nil {
		return false, fmt.Errorf("audit auto clock-out: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return false, fmt.Errorf("commit auto clock-out: %w", err)
	}
	return true, nil
}
