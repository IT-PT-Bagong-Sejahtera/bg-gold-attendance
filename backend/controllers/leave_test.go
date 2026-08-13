package controllers

import (
	"testing"
	"time"
)

func TestLeaveDaysByYearExcludesWeekendsAndSplitsYears(t *testing.T) {
	start, _ := time.Parse(leaveDateLayout, "2027-12-30")
	end, _ := time.Parse(leaveDateLayout, "2028-01-04")
	days := leaveDaysByYear(start, end)
	if days[2027] != 2 || days[2028] != 2 {
		t.Fatalf("unexpected yearly allocation: %#v", days)
	}
}

func TestParseLeaveRangeRejectsReverseAndOversizedRanges(t *testing.T) {
	if _, _, err := parseLeaveRange("2026-08-12", "2026-08-11"); err == nil {
		t.Fatal("reverse range was accepted")
	}
	if _, _, err := parseLeaveRange("2026-01-01", "2027-01-03"); err == nil {
		t.Fatal("oversized range was accepted")
	}
}
