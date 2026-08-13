package controllers

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/bg-gold/attendance-api/common"
	"github.com/bg-gold/attendance-api/config"
	"github.com/bg-gold/attendance-api/middlewares"
	"github.com/bg-gold/attendance-api/services/attendance"
	"github.com/bg-gold/attendance-api/services/auth"
	internalmail "github.com/bg-gold/attendance-api/services/mail"
	"github.com/go-chi/chi/v5"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type Server struct {
	db           *sql.DB
	authService  *auth.Service
	tokenService *auth.TokenService
	resolver     *auth.Resolver
	attendance   *attendance.Service
	objects      ObjectStore
	objectBucket string
	environment  string
	resetSender  internalmail.AccountSender
	pushSender   PushSender
	faceProvider FaceProvider
	ocrProvider  OCRProvider
	router       chi.Router
}

func New(cfg config.Config, db *sql.DB) (*Server, error) {
	tokens := auth.NewTokenService(cfg.AccessTokenSecret, cfg.AccessTokenTTL, cfg.RefreshTokenTTL)
	objects, err := minio.New(cfg.MinIO.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.MinIO.AccessKey, cfg.MinIO.SecretKey, ""),
		Secure: cfg.MinIO.UseSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("configure evidence storage: %w", err)
	}
	var resetSender internalmail.AccountSender
	if cfg.Mail.Host != "" && cfg.Mail.FromEmail != "" {
		resetSender = internalmail.NewSMTP(cfg.Mail)
	}
	var pushSender PushSender
	if cfg.FCM.ProjectID != "" && cfg.FCM.ServiceAccountFile != "" {
		pushSender, err = newFCMSender(context.Background(), cfg.FCM)
		if err != nil {
			return nil, err
		}
	}
	var integrityVerifier attendance.IntegrityVerifier
	if cfg.PlayIntegrity.PackageName != "" && cfg.PlayIntegrity.ServiceAccountFile != "" {
		integrityVerifier, err = newPlayIntegrityVerifier(context.Background(), cfg.PlayIntegrity)
		if err != nil {
			return nil, err
		}
	}
	s := &Server{
		db:           db,
		authService:  auth.NewService(db, tokens),
		tokenService: tokens,
		resolver:     auth.NewResolver(db),
		attendance:   attendance.NewService(db, firstNonEmpty(cfg.DynamicQRSecret, cfg.AccessTokenSecret)),
		objects:      objects,
		objectBucket: cfg.MinIO.Bucket,
		environment:  cfg.Environment,
		resetSender:  resetSender,
		pushSender:   pushSender,
		ocrProvider:  newHTTPReceiptOCR(cfg.OCR),
		router:       chi.NewRouter(),
	}
	s.attendance.SetIntegrityVerifier(integrityVerifier)
	s.router.Use(middlewares.RequestContext, middlewares.Recoverer, middlewares.CORS(cfg.CORSAllowedOrigins), middlewares.AccessLog)
	s.routes()
	return s, nil
}

func (s *Server) Handler() http.Handler { return s.router }

func (s *Server) SetPasswordResetSender(sender internalmail.AccountSender) {
	s.resetSender = sender
}

func (s *Server) SetIntegrityVerifier(verifier attendance.IntegrityVerifier) {
	s.attendance.SetIntegrityVerifier(verifier)
}

func (s *Server) SetOCRProvider(provider OCRProvider) { s.ocrProvider = provider }

func (s *Server) routes() {
	s.router.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), time.Second)
		defer cancel()
		if err := s.db.PingContext(ctx); err != nil {
			httpx.WriteError(w, r, &httpx.Error{Status: http.StatusServiceUnavailable, Code: "DATABASE_UNAVAILABLE", Message: "Database belum tersedia.", Err: err})
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"status": "ok", "time": time.Now().UTC()})
	})

	s.router.Route("/api/v1", func(api chi.Router) {
		api.Post("/auth/login", s.login)
		api.Post("/auth/refresh", s.refresh)
		api.Post("/auth/password/forgot", s.forgotPassword)
		api.Post("/auth/password/reset", s.resetPassword)
		api.Group(func(protected chi.Router) {
			protected.Use(s.authenticate)
			protected.Post("/auth/logout", s.logout)
			protected.Get("/me", s.me)
			protected.Get("/me/organizations", s.myOrganizations)
			protected.Post("/me/active-organization", s.switchOrganization)
			protected.Get("/me/attendance/today", require("attendance.own", s.attendanceToday))
			protected.Get("/me/attendance/history", require("attendance.own", s.attendanceHistory))
			protected.Get("/me/shifts", require("shift.read", s.myShifts))
			protected.Get("/me/open-shifts", require("shift.read", s.myOpenShifts))
			protected.Post("/shifts/{shiftID}/requests", require("shift.read", s.requestOpenShift))
			protected.Get("/me/attendance-policy", require("policy.read", s.myAttendancePolicy))
			protected.Post("/attendance/actions", require("attendance.own", s.submitAttendance))
			protected.Post("/sections/{sectionID}/dynamic-qr", require("attendance.read", s.issueDynamicQR))
			protected.Get("/me/requests", require("attendance.own", s.myAttendanceRequests))
			protected.Get("/attendance/requests", require("attendance.approve", s.listAttendanceRequests))
			protected.Get("/attendance/records", require("attendance.read", s.listAttendanceRecords))
			protected.Get("/attendance/timesheets", require("attendance.read", s.listTimesheetSummaries))
			protected.Get("/attendance/report", require("attendance.read", s.supervisorAttendanceReport))
			protected.Get("/reports/attendance.csv", require("report.read", s.exportAttendanceCSV))
			protected.Get("/reports/timesheets.csv", require("report.read", s.exportTimesheetsCSV))
			protected.Post("/attendance/requests/{requestID}/decision", require("attendance.approve", s.decideAttendanceRequest))
			protected.Post("/attendance/corrections", require("attendance.correct", s.createAttendanceCorrection))
			protected.Post("/attachments/attendance-selfie", require("attendance.own", s.uploadAttendanceSelfie))
			protected.Post("/attachments/claim-receipt", require("claim.own", s.uploadClaimReceipt))
			protected.Post("/attachments/face-image", require("attendance.own", s.uploadFaceImage))
			protected.Post("/me/face/enroll", require("attendance.own", s.enrollFace))
			protected.Post("/me/face/verify", require("attendance.own", s.verifyFace))
			protected.Get("/employees", require("employee.read", s.listEmployees))
			protected.Post("/employees", require("employee.manage", s.createEmployee))
			protected.Patch("/employees/{employeeID}", require("employee.manage", s.updateEmployee))
			protected.Post("/employees/{employeeID}/activate", require("employee.manage", s.activateEmployee))
			protected.Post("/employees/{employeeID}/deactivate", require("employee.manage", s.deactivateEmployee))
			protected.Get("/sections", require("section.read", s.listSections))
			protected.Post("/sections", require("section.manage", s.createSection))
			protected.Patch("/sections/{sectionID}", require("section.manage", s.updateSection))
			protected.Post("/sections/{sectionID}/deactivate", require("section.manage", s.deactivateSection))
			protected.Post("/sections/{sectionID}/activate", require("section.manage", s.activateSection))
			protected.Get("/policies", require("policy.read", s.listPolicies))
			protected.Post("/policies", require("policy.manage", s.createPolicy))
			protected.Patch("/policies/{policyID}", require("policy.manage", s.updatePolicy))
			protected.Post("/policies/{policyID}/archive", require("policy.manage", s.archivePolicy))
			protected.Get("/shifts", require("shift.read", s.listShifts))
			protected.Post("/shifts", require("shift.manage", s.createShift))
			protected.Post("/shifts/{shiftID}/publish", require("shift.manage", s.publishShift))
			protected.Post("/shifts/{shiftID}/unpublish", require("shift.manage", s.unpublishShift))
			protected.Get("/shift-requests", require("shift.manage", s.listShiftRequests))
			protected.Post("/shift-requests/{requestID}/decision", require("shift.manage", s.decideShiftRequest))
			protected.Get("/leave-types", require("leave.own", s.listLeaveTypes))
			protected.Post("/leave-types", require("leave.manage", s.createLeaveType))
			protected.Get("/me/leave-balances", require("leave.own", s.myLeaveBalances))
			protected.Post("/leave-balances", require("leave.manage", s.setLeaveBalance))
			protected.Get("/me/leave-requests", require("leave.own", s.myLeaveRequests))
			protected.Post("/me/leave-requests", require("leave.own", s.createLeaveRequest))
			protected.Post("/me/leave-requests/{requestID}/withdraw", require("leave.own", s.withdrawLeaveRequest))
			protected.Get("/leave-requests", require("leave.read", s.listLeaveRequests))
			protected.Post("/leave-requests/{requestID}/decision", require("leave.approve", s.decideLeaveRequest))
			protected.Get("/claim-types", require("claim.own", s.listClaimTypes))
			protected.Post("/claim-types", require("claim.manage", s.createClaimType))
			protected.Get("/me/claims", require("claim.own", s.myClaims))
			protected.Post("/me/claims", require("claim.own", s.createClaim))
			protected.Post("/me/claims/{claimID}/withdraw", require("claim.own", s.withdrawClaim))
			protected.Get("/claims", require("claim.read", s.listClaims))
			protected.Post("/claims/{claimID}/decision", require("claim.approve", s.decideClaim))
			protected.Get("/claims/{claimID}/receipt-url", require("claim.own", s.claimReceiptURL))
			protected.Post("/announcements", require("announcement.manage", s.createAnnouncement))
			protected.Get("/me/announcements", require("announcement.read", s.myAnnouncements))
			protected.Post("/me/announcements/{announcementID}/receipt", require("announcement.read", s.updateAnnouncementReceipt))
			protected.Get("/me/notifications", require("notification.own", s.myNotifications))
			protected.Get("/me/notifications/unread-count", require("notification.own", s.notificationUnreadCount))
			protected.Post("/me/notifications/{notificationID}/read", require("notification.own", s.readNotification))
			protected.Post("/me/devices", require("notification.own", s.registerDevice))
			protected.Delete("/me/devices/{deviceID}", require("notification.own", s.revokeDevice))
			protected.Get("/audit-logs", require("audit.read", s.listAuditLogs))
		})
	})
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func (s *Server) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := strings.TrimSpace(r.Header.Get("Authorization"))
		if !strings.HasPrefix(header, "Bearer ") {
			httpx.WriteError(w, r, &httpx.Error{Status: http.StatusUnauthorized, Code: "UNAUTHENTICATED", Message: "Silakan masuk kembali."})
			return
		}
		claims, err := s.tokenService.ParseAccess(strings.TrimSpace(strings.TrimPrefix(header, "Bearer ")))
		if err != nil {
			httpx.WriteError(w, r, &httpx.Error{Status: http.StatusUnauthorized, Code: "UNAUTHENTICATED", Message: "Sesi sudah tidak berlaku.", Err: err})
			return
		}
		principal, err := s.resolver.Resolve(r.Context(), claims)
		if err != nil {
			httpx.WriteError(w, r, &httpx.Error{Status: http.StatusUnauthorized, Code: "UNAUTHENTICATED", Message: "Sesi sudah tidak berlaku.", Err: err})
			return
		}
		*r = *r.WithContext(auth.WithPrincipal(r.Context(), principal))
		next.ServeHTTP(w, r)
	})
}

func require(permission string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.PrincipalFrom(r.Context())
		if err != nil || !principal.Can(permission) {
			httpx.WriteError(w, r, &httpx.Error{Status: http.StatusForbidden, Code: "FORBIDDEN", Message: "Anda tidak memiliki izin untuk tindakan ini."})
			return
		}
		next(w, r)
	}
}

type loginRequest struct {
	Email          string `json:"email"`
	Password       string `json:"password"`
	OrganizationID string `json:"organizationId"`
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var input loginRequest
	if !httpx.DecodeJSON(w, r, &input) {
		return
	}
	pair, err := s.authService.Login(r.Context(), auth.LoginInput{Email: input.Email, Password: input.Password, OrganizationID: input.OrganizationID, UserAgent: r.UserAgent()})
	if errors.Is(err, auth.ErrInvalidCredentials) {
		httpx.WriteError(w, r, &httpx.Error{Status: http.StatusUnauthorized, Code: "INVALID_CREDENTIALS", Message: "Email atau kata sandi tidak sesuai."})
		return
	}
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": pair, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) refresh(w http.ResponseWriter, r *http.Request) {
	var input struct {
		RefreshToken string `json:"refreshToken"`
	}
	if !httpx.DecodeJSON(w, r, &input) {
		return
	}
	pair, err := s.authService.Refresh(r.Context(), input.RefreshToken)
	if errors.Is(err, auth.ErrInvalidCredentials) {
		httpx.WriteError(w, r, &httpx.Error{Status: http.StatusUnauthorized, Code: "INVALID_REFRESH_TOKEN", Message: "Sesi sudah tidak berlaku."})
		return
	}
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": pair, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	principal, _ := auth.PrincipalFrom(r.Context())
	if err := s.authService.Logout(r.Context(), principal.SessionID); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	principal, _ := auth.PrincipalFrom(r.Context())
	var response struct {
		ID             string   `json:"id"`
		Email          string   `json:"email"`
		FullName       string   `json:"fullName"`
		MembershipID   string   `json:"membershipId"`
		OrganizationID string   `json:"organizationId"`
		Timezone       string   `json:"timezone"`
		EmployeeNumber string   `json:"employeeNumber"`
		Roles          []string `json:"roles"`
	}
	err := s.db.QueryRowContext(r.Context(), `
		SELECT BIN_TO_UUID(u.id), u.email, u.full_name, BIN_TO_UUID(m.id), BIN_TO_UUID(m.organization_id), o.timezone, m.employee_number
		FROM users u JOIN organization_memberships m ON m.user_id = u.id JOIN organizations o ON o.id = m.organization_id
		WHERE u.id = UUID_TO_BIN(?) AND m.id = UUID_TO_BIN(?)`, principal.UserID, principal.MembershipID).
		Scan(&response.ID, &response.Email, &response.FullName, &response.MembershipID, &response.OrganizationID, &response.Timezone, &response.EmployeeNumber)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	response.Roles = []string{}
	rows, err := s.db.QueryContext(r.Context(), `SELECT r.code FROM membership_roles mr JOIN roles r ON r.id = mr.role_id WHERE mr.membership_id = UUID_TO_BIN(?) ORDER BY r.code`, principal.MembershipID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var role string
		if err := rows.Scan(&role); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		response.Roles = append(response.Roles, role)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": response, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) myOrganizations(w http.ResponseWriter, r *http.Request) {
	principal, _ := auth.PrincipalFrom(r.Context())
	rows, err := s.db.QueryContext(r.Context(), `
		SELECT BIN_TO_UUID(o.id), o.code, o.name, o.timezone
		FROM organizations o JOIN organization_memberships m ON m.organization_id = o.id
		WHERE m.user_id = UUID_TO_BIN(?) AND m.status = 'ACTIVE' AND o.status = 'ACTIVE'
		ORDER BY o.name`, principal.UserID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer rows.Close()
	type item struct {
		ID       string `json:"id"`
		Code     string `json:"code"`
		Name     string `json:"name"`
		Timezone string `json:"timezone"`
	}
	items := []item{}
	for rows.Next() {
		var value item
		if err := rows.Scan(&value.ID, &value.Code, &value.Name, &value.Timezone); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		items = append(items, value)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": items, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) switchOrganization(w http.ResponseWriter, r *http.Request) {
	principal, _ := auth.PrincipalFrom(r.Context())
	var input struct {
		OrganizationID string `json:"organizationId"`
	}
	if !httpx.DecodeJSON(w, r, &input) {
		return
	}
	pair, err := s.authService.SwitchOrganization(r.Context(), principal.SessionID, principal.UserID, input.OrganizationID)
	if errors.Is(err, auth.ErrInvalidCredentials) {
		httpx.WriteError(w, r, &httpx.Error{Status: http.StatusForbidden, Code: "ORGANIZATION_ACCESS_DENIED", Message: "Organisasi tidak tersedia untuk akun ini."})
		return
	}
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": pair, "requestId": httpx.RequestID(r.Context())})
}
