package main

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/bg-gold/attendance-api/database"
	"github.com/bg-gold/attendance-api/helpers"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	ctx := context.Background()
	dsn := strings.TrimSpace(os.Getenv("MYSQL_DSN"))
	email := strings.ToLower(strings.TrimSpace(os.Getenv("SEED_ADMIN_EMAIL")))
	password := os.Getenv("SEED_ADMIN_PASSWORD")
	if dsn == "" || email == "" || len(password) < 12 {
		slog.Error("seed requires MYSQL_DSN, SEED_ADMIN_EMAIL, and SEED_ADMIN_PASSWORD with at least 12 characters")
		os.Exit(1)
	}
	db, err := database.Open(ctx, dsn)
	if err != nil {
		fail("connect database", err)
	}
	defer db.Close()
	if err := database.Migrate(ctx, db); err != nil {
		fail("migrate database", err)
	}
	if err := seed(ctx, db, email, password); err != nil {
		fail("seed database", err)
	}
	slog.Info("seed complete", "organization", "BG-GOLD", "adminEmail", email)
}

func seed(ctx context.Context, db *sql.DB, email, password string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	orgID := "00000000-0000-4000-8000-000000000001"
	userID := "00000000-0000-4000-8000-000000000002"
	membershipID := "00000000-0000-4000-8000-000000000003"
	sectionID := "00000000-0000-4000-8000-000000000004"
	policyID := "00000000-0000-4000-8000-000000000005"
	assignmentID := "00000000-0000-4000-8000-000000000006"
	shiftID := "00000000-0000-4000-8000-000000000007"
	shiftAssignmentID := "00000000-0000-4000-8000-000000000008"

	if _, err = tx.ExecContext(ctx, `INSERT INTO organizations(id,code,name,timezone) VALUES(UUID_TO_BIN(?),'BG-GOLD','BG GOLD','Asia/Jakarta') ON DUPLICATE KEY UPDATE name=VALUES(name),timezone=VALUES(timezone)`, orgID); err != nil {
		return err
	}
	if err = tx.QueryRowContext(ctx, `SELECT BIN_TO_UUID(id) FROM organizations WHERE code='BG-GOLD'`).Scan(&orgID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO users(id,email,password_hash,full_name) VALUES(UUID_TO_BIN(?),?,?,'Administrator BG GOLD') ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash),full_name=VALUES(full_name),status='ACTIVE'`, userID, email, string(hash)); err != nil {
		return err
	}
	if err = tx.QueryRowContext(ctx, `SELECT BIN_TO_UUID(id) FROM users WHERE email=?`, email).Scan(&userID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO organization_memberships(id,organization_id,user_id,employee_number,job_title) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),'BG-0001','System Administrator') ON DUPLICATE KEY UPDATE job_title=VALUES(job_title),status='ACTIVE'`, membershipID, orgID, userID); err != nil {
		return err
	}
	if err = tx.QueryRowContext(ctx, `SELECT BIN_TO_UUID(id) FROM organization_memberships WHERE organization_id=UUID_TO_BIN(?) AND user_id=UUID_TO_BIN(?)`, orgID, userID).Scan(&membershipID); err != nil {
		return err
	}

	rolePermissions := map[string][]string{
		"OWNER":      {"*"},
		"ADMIN":      {"organization.manage", "employee.read", "employee.manage", "section.read", "section.manage", "policy.read", "policy.manage", "shift.read", "shift.manage", "attendance.own", "attendance.read", "attendance.approve", "attendance.correct", "report.read", "audit.read", "leave.own", "leave.read", "leave.approve", "leave.manage", "claim.own", "claim.read", "claim.approve", "claim.manage", "announcement.read", "announcement.manage", "notification.own"},
		"HR":         {"employee.read", "employee.manage", "section.read", "policy.read", "policy.manage", "shift.read", "shift.manage", "attendance.own", "attendance.read", "attendance.approve", "attendance.correct", "report.read", "audit.read", "leave.own", "leave.read", "leave.approve", "leave.manage", "claim.own", "claim.read", "claim.approve", "claim.manage", "announcement.read", "announcement.manage", "notification.own"},
		"SUPERVISOR": {"employee.read", "section.read", "policy.read", "shift.read", "shift.manage", "attendance.own", "attendance.read", "attendance.approve", "report.read", "leave.own", "leave.read", "leave.approve", "claim.own", "claim.read", "claim.approve", "announcement.read", "announcement.manage", "notification.own"},
		"EMPLOYEE":   {"section.read", "policy.read", "shift.read", "attendance.own", "leave.own", "claim.own", "announcement.read", "notification.own"},
	}
	roleIDs := map[string]string{}
	for code, permissions := range rolePermissions {
		roleID, _ := identity.NewUUID()
		if _, err = tx.ExecContext(ctx, `INSERT INTO roles(id,organization_id,code,name,is_system) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),?,?,TRUE) ON DUPLICATE KEY UPDATE name=VALUES(name)`, roleID, orgID, code, title(code)); err != nil {
			return err
		}
		if err = tx.QueryRowContext(ctx, `SELECT BIN_TO_UUID(id) FROM roles WHERE organization_id=UUID_TO_BIN(?) AND code=?`, orgID, code).Scan(&roleID); err != nil {
			return err
		}
		roleIDs[code] = roleID
		if _, err = tx.ExecContext(ctx, `DELETE FROM role_permissions WHERE role_id=UUID_TO_BIN(?)`, roleID); err != nil {
			return err
		}
		if len(permissions) == 1 && permissions[0] == "*" {
			if _, err = tx.ExecContext(ctx, `INSERT INTO role_permissions(role_id,permission_code) SELECT UUID_TO_BIN(?),code FROM permissions`, roleID); err != nil {
				return err
			}
		} else {
			for _, permission := range permissions {
				if _, err = tx.ExecContext(ctx, `INSERT INTO role_permissions(role_id,permission_code) VALUES(UUID_TO_BIN(?),?)`, roleID, permission); err != nil {
					return err
				}
			}
		}
	}
	if _, err = tx.ExecContext(ctx, `INSERT IGNORE INTO membership_roles(membership_id,role_id) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?))`, membershipID, roleIDs["OWNER"]); err != nil {
		return err
	}

	if _, err = tx.ExecContext(ctx, `INSERT INTO sections(id,organization_id,code,name,address,timezone,status) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),'HQ','BG GOLD Head Office','Indonesia','Asia/Jakarta','ACTIVE') ON DUPLICATE KEY UPDATE name=VALUES(name),status='ACTIVE'`, sectionID, orgID); err != nil {
		return err
	}
	if err = tx.QueryRowContext(ctx, `SELECT BIN_TO_UUID(id) FROM sections WHERE organization_id=UUID_TO_BIN(?) AND code='HQ'`, orgID).Scan(&sectionID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT IGNORE INTO section_memberships(section_id,membership_id,is_primary) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),TRUE)`, sectionID, membershipID); err != nil {
		return err
	}

	if _, err = tx.ExecContext(ctx, `INSERT INTO attendance_policies(id,organization_id,name,version,selfie_required,minimum_location_accuracy_meters,status) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),'Anywhere Default',1,FALSE,100,'ACTIVE') ON DUPLICATE KEY UPDATE status='ACTIVE'`, policyID, orgID); err != nil {
		return err
	}
	if err = tx.QueryRowContext(ctx, `SELECT BIN_TO_UUID(id) FROM attendance_policies WHERE organization_id=UUID_TO_BIN(?) AND name='Anywhere Default' AND version=1`, orgID).Scan(&policyID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT IGNORE INTO attendance_policy_modes(policy_id,mode) VALUES(UUID_TO_BIN(?),'ANYWHERE')`, policyID); err != nil {
		return err
	}
	var existing int
	err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM policy_assignments WHERE organization_id=UUID_TO_BIN(?) AND policy_id=UUID_TO_BIN(?) AND section_id IS NULL AND membership_id IS NULL`, orgID, policyID).Scan(&existing)
	if err != nil {
		return err
	}
	if existing == 0 {
		if _, err = tx.ExecContext(ctx, `INSERT INTO policy_assignments(id,organization_id,policy_id) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?))`, assignmentID, orgID, policyID); err != nil {
			return err
		}
	}

	jakarta, _ := time.LoadLocation("Asia/Jakarta")
	now := time.Now().In(jakarta)
	starts := time.Date(now.Year(), now.Month(), now.Day(), 9, 0, 0, 0, jakarta).UTC()
	ends := starts.Add(8 * time.Hour)
	if _, err = tx.ExecContext(ctx, `INSERT INTO shifts(id,organization_id,section_id,title,starts_at,ends_at,status,published_at,created_by) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),'Shift Operasional',?,?,'PUBLISHED',UTC_TIMESTAMP(6),UUID_TO_BIN(?)) ON DUPLICATE KEY UPDATE starts_at=VALUES(starts_at),ends_at=VALUES(ends_at),status='PUBLISHED'`, shiftID, orgID, sectionID, starts, ends, userID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO shift_assignments(id,shift_id,membership_id) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?)) ON DUPLICATE KEY UPDATE status='ASSIGNED'`, shiftAssignmentID, shiftID, membershipID); err != nil {
		return err
	}
	return tx.Commit()
}

func title(code string) string     { return strings.Title(strings.ToLower(code)) }
func fail(stage string, err error) { fmt.Fprintln(os.Stderr, stage+":", err); os.Exit(1) }
