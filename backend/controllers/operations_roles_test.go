package controllers

import "testing"

func TestNormalizeRoleCodes(t *testing.T) {
	roles := normalizeRoleCodes([]string{" employee ", "SUPERVISOR", "Employee", ""})
	if len(roles) != 2 || roles[0] != "EMPLOYEE" || roles[1] != "SUPERVISOR" {
		t.Fatalf("unexpected normalized roles: %#v", roles)
	}
}

func TestCreatedRoleHierarchy(t *testing.T) {
	if err := validateCreatedRoles(false, []string{"EMPLOYEE"}); err != nil {
		t.Fatalf("supervisor should create employee: %v", err)
	}
	if err := validateCreatedRoles(false, []string{"SUPERVISOR"}); err == nil {
		t.Fatal("supervisor must not create supervisor")
	}
	if err := validateCreatedRoles(true, []string{"SUPERVISOR"}); err != nil {
		t.Fatalf("superadmin should create supervisor: %v", err)
	}
	if err := validateCreatedRoles(true, []string{"OWNER"}); err == nil {
		t.Fatal("superadmin must not create another superadmin")
	}
}

func TestUpdatedRoleHierarchy(t *testing.T) {
	if err := validateUpdatedRoles(false, false, false, []string{"EMPLOYEE"}); err != nil {
		t.Fatalf("manager should update a regular employee: %v", err)
	}
	if err := validateUpdatedRoles(false, false, false, []string{"SUPERVISOR"}); err == nil {
		t.Fatal("non-owner must not promote a supervisor")
	}
	if err := validateUpdatedRoles(false, false, true, []string{"EMPLOYEE"}); err == nil {
		t.Fatal("non-owner must not modify a privileged account")
	}
	if err := validateUpdatedRoles(true, false, false, []string{"SUPERVISOR"}); err != nil {
		t.Fatalf("superadmin should promote a supervisor: %v", err)
	}
	if err := validateUpdatedRoles(true, false, false, []string{"OWNER"}); err == nil {
		t.Fatal("superadmin must not grant owner to a second account")
	}
	if err := validateUpdatedRoles(true, true, true, []string{"OWNER"}); err != nil {
		t.Fatalf("existing superadmin should retain owner: %v", err)
	}
}
