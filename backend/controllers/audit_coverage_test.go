package controllers

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// This test makes audit intent explicit at the router boundary. Adding a new
// state-changing endpoint without either transactional audit evidence or a
// documented exclusion fails the suite.
func TestEveryMutationRouteHasAnAuditDisposition(t *testing.T) {
	audited := map[string]string{
		"POST /shifts/{shiftID}/requests":                 "shift.request",
		"POST /attendance/actions":                        "attendance.action",
		"POST /sections/{sectionID}/dynamic-qr":           "attendance.dynamic_qr.issue",
		"POST /attendance/requests/{requestID}/decision":  "attendance.request.decision",
		"POST /attendance/corrections":                    "attendance.correction.create",
		"POST /me/face/enroll":                            "face.enroll",
		"POST /employees":                                 "employee.create",
		"PATCH /employees/{employeeID}":                   "employee.update",
		"POST /employees/{employeeID}/activate":           "employee.activate",
		"POST /employees/{employeeID}/deactivate":         "employee.deactivate",
		"POST /sections":                                  "section.create",
		"PATCH /sections/{sectionID}":                     "section.update",
		"POST /sections/{sectionID}/deactivate":           "section.deactivate",
		"POST /sections/{sectionID}/activate":             "section.activate",
		"POST /policies":                                  "policy.create",
		"PATCH /policies/{policyID}":                      "policy.update",
		"POST /policies/{policyID}/archive":               "policy.archive",
		"POST /shifts":                                    "shift.create",
		"PATCH /shifts/{shiftID}/participants":            "shift.participants.update",
		"POST /shifts/{shiftID}/publish":                  "shift.publish",
		"POST /shifts/{shiftID}/unpublish":                "shift.unpublish",
		"POST /shift-requests/{requestID}/decision":       "shift.request.decide",
		"POST /leave-types":                               "leave.type.create",
		"POST /leave-balances":                            "leave.balance.set",
		"POST /me/leave-requests":                         "leave.request.create",
		"POST /me/leave-requests/{requestID}/withdraw":    "leave.request.withdraw",
		"POST /leave-requests/{requestID}/decision":       "leave.request.decide",
		"POST /claim-types":                               "claim.type.create",
		"POST /me/claims":                                 "claim.request.create",
		"POST /me/claims/{claimID}/withdraw":              "claim.request.withdraw",
		"POST /claims/{claimID}/decision":                 "claim.request.decide",
		"POST /announcements":                             "announcement.create",
		"POST /me/announcements/{announcementID}/receipt": "announcement.acknowledge",
	}
	exempt := map[string]string{
		"POST /auth/login":                             "session creation is security telemetry, not an organization-domain mutation",
		"POST /auth/refresh":                           "token rotation is covered by the session-family security tests",
		"POST /auth/password/forgot":                   "the non-enumerating public flow has no reliable organization or actor context",
		"POST /auth/password/reset":                    "the public token flow has no authenticated organization context and revokes all sessions",
		"POST /auth/logout":                            "session revocation is covered by the revocation integration test",
		"POST /me/active-organization":                 "session context rotation is covered by the organization-switch integration test",
		"POST /attachments/attendance-selfie":          "staged private media is finalized and referenced by the audited attendance action",
		"POST /attachments/claim-receipt":              "staged private media is finalized and referenced by the audited claim request",
		"POST /attachments/face-image":                 "staged private media is finalized and referenced by audited enrollment or attendance",
		"POST /me/face/verify":                         "five-minute evidence is referenced by the audited attendance action",
		"POST /me/notifications/{notificationID}/read": "personal delivery-state acknowledgement is not a business-record mutation",
		"POST /me/devices":                             "push-token delivery plumbing is intentionally excluded from business audit metadata",
		"DELETE /me/devices/{deviceID}":                "push-token revocation is covered by notification integration and stores no token in audit metadata",
	}

	routes := mutationRoutes(t, "server.go")
	for route := range routes {
		marker, isAudited := audited[route]
		reason, isExempt := exempt[route]
		if isAudited == isExempt {
			t.Errorf("route %s must have exactly one audit disposition", route)
			continue
		}
		if isAudited && !nonTestGoSourcesContain(t, marker) {
			t.Errorf("route %s declares audit action %q but no production source contains it", route, marker)
		}
		if isExempt && len(strings.TrimSpace(reason)) < 24 {
			t.Errorf("route %s needs a meaningful audit exclusion rationale", route)
		}
	}
	for route := range audited {
		if !routes[route] {
			t.Errorf("stale audited route classification: %s", route)
		}
	}
	for route := range exempt {
		if !routes[route] {
			t.Errorf("stale exempt route classification: %s", route)
		}
	}
}

func mutationRoutes(t *testing.T, name string) map[string]bool {
	t.Helper()
	parsed, err := parser.ParseFile(token.NewFileSet(), name, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	routes := map[string]bool{}
	ast.Inspect(parsed, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok || len(call.Args) < 2 {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || (selector.Sel.Name != "Post" && selector.Sel.Name != "Patch" && selector.Sel.Name != "Delete") {
			return true
		}
		literal, ok := call.Args[0].(*ast.BasicLit)
		if !ok || literal.Kind != token.STRING {
			return true
		}
		path, err := strconv.Unquote(literal.Value)
		if err != nil {
			t.Fatal(err)
		}
		routes[strings.ToUpper(selector.Sel.Name)+" "+path] = true
		return true
	})
	return routes
}

func nonTestGoSourcesContain(t *testing.T, marker string) bool {
	t.Helper()
	patterns := []string{"*.go", filepath.Join("..", "services", "attendance", "*.go")}
	for _, pattern := range patterns {
		files, err := filepath.Glob(pattern)
		if err != nil {
			t.Fatal(err)
		}
		for _, name := range files {
			if strings.HasSuffix(name, "_test.go") {
				continue
			}
			content, err := os.ReadFile(name)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(content), marker) {
				return true
			}
		}
	}
	return false
}
