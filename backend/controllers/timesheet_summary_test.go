package controllers

import (
	"testing"
	"time"
)

func TestRoundBreakDurationNearestIncrement(t *testing.T) {
	tests := []struct {
		minutes   int
		increment uint16
		want      int
	}{
		{0, 15, 0},
		{7, 15, 0},
		{8, 15, 15},
		{22, 15, 15},
		{23, 15, 30},
		{31, 30, 30},
		{17, 0, 17},
	}
	for _, test := range tests {
		if got := roundBreakDuration(time.Duration(test.minutes)*time.Minute, test.increment); got != test.want {
			t.Errorf("roundBreakDuration(%d, %d)=%d want %d", test.minutes, test.increment, got, test.want)
		}
	}
}

func TestBuildTimesheetSummariesUsesRoundedBreakForNetTime(t *testing.T) {
	location, err := time.LoadLocation("Asia/Jakarta")
	if err != nil {
		t.Fatal(err)
	}
	at := func(hour, minute int) time.Time {
		return time.Date(2026, 8, 11, hour, minute, 0, 0, location).UTC()
	}
	base := timesheetEvent{MembershipID: "member-1", EmployeeName: "Ayu Pratama", EmployeeNumber: "BG-017", Decision: "APPROVED"}
	events := []timesheetEvent{
		withTimesheetAction(base, "CLOCK_IN", at(9, 0), 0),
		withTimesheetAction(base, "START_BREAK", at(12, 0), 15),
		withTimesheetAction(base, "END_BREAK", at(12, 22), 0),
		withTimesheetAction(base, "CLOCK_OUT", at(17, 0), 0),
		withTimesheetAction(base, "WORK_MORE", at(18, 0), 0),
		withTimesheetAction(base, "CLOCK_OUT", at(19, 0), 0),
	}
	items := buildTimesheetSummaries(events, location)
	if len(items) != 1 {
		t.Fatalf("expected one daily summary, got %d", len(items))
	}
	item := items[0]
	if item.Date != "2026-08-11" || item.GrossMinutes != 540 || item.ActualBreakMinutes != 22 || item.RoundedBreakMinutes != 15 || item.NetMinutes != 525 {
		t.Fatalf("unexpected summary: %+v", item)
	}
	if item.FirstClockIn == nil || !item.FirstClockIn.Equal(at(9, 0)) || item.LastClockOut == nil || !item.LastClockOut.Equal(at(19, 0)) {
		t.Fatalf("unexpected summary boundaries: %+v", item)
	}
}

func TestBuildTimesheetSummariesUsesOrganizationTimezoneAcrossMidnight(t *testing.T) {
	location, err := time.LoadLocation("Asia/Jakarta")
	if err != nil {
		t.Fatal(err)
	}
	at := func(day, hour, minute int) time.Time {
		return time.Date(2026, 8, day, hour, minute, 0, 0, location).UTC()
	}
	base := timesheetEvent{MembershipID: "member-night", EmployeeName: "Dewi Malam", EmployeeNumber: "BG-099", Decision: "APPROVED"}
	items := buildTimesheetSummaries([]timesheetEvent{
		withTimesheetAction(base, "CLOCK_IN", at(11, 23, 30), 0),
		withTimesheetAction(base, "CLOCK_OUT", at(12, 1, 30), 0),
	}, location)
	if len(items) != 1 || items[0].Date != "2026-08-11" || items[0].GrossMinutes != 120 {
		t.Fatalf("overnight shift must stay on its local clock-in workday: %+v", items)
	}
	if items[0].FirstClockIn == nil || !items[0].FirstClockIn.Equal(at(11, 23, 30)) || items[0].LastClockOut == nil || !items[0].LastClockOut.Equal(at(12, 1, 30)) {
		t.Fatalf("unexpected overnight boundaries: %+v", items[0])
	}
}

func withTimesheetAction(base timesheetEvent, action string, at time.Time, rounding uint16) timesheetEvent {
	base.ActionType = action
	base.RecordedAt = at
	base.Rounding = rounding
	return base
}
