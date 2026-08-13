package attendance

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"
)

func TestValidatePolicyWiFi(t *testing.T) {
	hash := sha256.Sum256([]byte("aabbccddeeff"))
	settings := json.RawMessage(fmt.Sprintf(`{"networks":[{"ssid":"BG GOLD HQ","bssidHash":"%x"}]}`, hash))
	policy := Policy{Modes: map[string]json.RawMessage{"WIFI": settings}}
	tests := []struct {
		name string
		wifi *WiFiEvidence
		want error
	}{
		{"missing", nil, ErrWiFiRequired},
		{"wrong ssid", &WiFiEvidence{SSID: "Guest", BSSID: "AA:BB:CC:DD:EE:FF"}, ErrWiFiMismatch},
		{"wrong bssid", &WiFiEvidence{SSID: "BG GOLD HQ", BSSID: "11:22:33:44:55:66"}, ErrWiFiMismatch},
		{"canonical match", &WiFiEvidence{SSID: "BG GOLD HQ", BSSID: "AA-BB-CC-DD-EE-FF"}, nil},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := ValidatePolicy(policy, nil, nil, nil, ActionInput{Type: ClockIn, Evidence: Evidence{WiFi: test.wifi}}, time.Now())
			if !errors.Is(err, test.want) {
				t.Fatalf("error=%v want=%v", err, test.want)
			}
		})
	}
}

func TestFaceVerificationFailOpenAndClosed(t *testing.T) {
	closed := Policy{Modes: map[string]json.RawMessage{"FACE_VERIFICATION": json.RawMessage(`{"failClosed":true}`)}}
	if err := ValidatePolicy(closed, nil, nil, nil, ActionInput{Type: ClockIn}, time.Now()); !errors.Is(err, ErrFaceRequired) {
		t.Fatalf("closed policy error=%v", err)
	}
	open := Policy{Modes: map[string]json.RawMessage{"FACE_VERIFICATION": json.RawMessage(`{"failClosed":false}`)}}
	if err := ValidatePolicy(open, nil, nil, nil, ActionInput{Type: ClockIn}, time.Now()); err != nil {
		t.Fatalf("open policy should allow provider fallback: %v", err)
	}
	withVerification := ActionInput{Type: ClockIn, Evidence: Evidence{FaceVerificationID: "verification-id"}}
	if err := ValidatePolicy(closed, nil, nil, nil, withVerification, time.Now()); err != nil {
		t.Fatalf("closed policy with evidence: %v", err)
	}
}

func TestDeviceIntegrityFailOpenAndClosed(t *testing.T) {
	closed := Policy{Modes: map[string]json.RawMessage{"DEVICE_INTEGRITY": json.RawMessage(`{"failClosed":true,"maxRiskScore":30}`)}}
	if err := ValidatePolicy(closed, nil, nil, nil, ActionInput{Type: ClockIn}, time.Now()); !errors.Is(err, ErrIntegrityRequired) {
		t.Fatalf("closed policy error=%v", err)
	}
	open := Policy{Modes: map[string]json.RawMessage{"DEVICE_INTEGRITY": json.RawMessage(`{"failClosed":false,"maxRiskScore":30}`)}}
	if err := ValidatePolicy(open, nil, nil, nil, ActionInput{Type: ClockIn}, time.Now()); err != nil {
		t.Fatalf("open policy should allow provider fallback: %v", err)
	}
	withToken := ActionInput{Type: ClockIn, Evidence: Evidence{IntegrityToken: "signed-token"}}
	if err := ValidatePolicy(closed, nil, nil, nil, withToken, time.Now()); err != nil {
		t.Fatalf("closed policy with token: %v", err)
	}
}

func TestIntegrityRiskScore(t *testing.T) {
	tests := []struct {
		name    string
		verdict IntegrityVerdict
		want    int
	}{
		{"trusted device", IntegrityVerdict{AppRecognized: true, Licensed: true, DeviceLabels: []string{"MEETS_DEVICE_INTEGRITY"}}, 0},
		{"basic only", IntegrityVerdict{AppRecognized: true, Licensed: true, DeviceLabels: []string{"MEETS_BASIC_INTEGRITY"}}, 25},
		{"unlicensed high activity", IntegrityVerdict{AppRecognized: true, DeviceLabels: []string{"MEETS_DEVICE_INTEGRITY"}, HighRecentActivity: true}, 40},
		{"unrecognized no integrity", IntegrityVerdict{}, 100},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := IntegrityRiskScore(test.verdict); got != test.want {
				t.Fatalf("IntegrityRiskScore()=%d want=%d", got, test.want)
			}
		})
	}
}

func TestValidateTransition(t *testing.T) {
	tests := []struct {
		name    string
		state   State
		action  Action
		wantErr bool
	}{
		{"start work", NotStarted, ClockIn, false},
		{"double clock in", Working, ClockIn, true},
		{"clock out", Working, ClockOut, false},
		{"start break", Working, StartBreak, false},
		{"end break", OnBreak, EndBreak, false},
		{"clock out on break", OnBreak, ClockOut, true},
		{"pending blocks action", Pending, ClockIn, true},
		{"work more cannot start the day", NotStarted, WorkMore, true},
		{"work more after clock out", Completed, WorkMore, false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := ValidateTransition(test.state, test.action)
			if (err != nil) != test.wantErr {
				t.Fatalf("ValidateTransition() error = %v, wantErr %v", err, test.wantErr)
			}
		})
	}
}

func TestValidatePolicyAnywhere(t *testing.T) {
	policy := Policy{Modes: map[string]json.RawMessage{"ANYWHERE": nil}}
	if err := ValidatePolicy(policy, nil, nil, nil, ActionInput{Type: ClockIn}, time.Now()); err != nil {
		t.Fatalf("ANYWHERE should not require location: %v", err)
	}
}

func TestValidatePolicyLocationAccuracy(t *testing.T) {
	maximum := 30.0
	policy := Policy{MinimumLocationAccuracyMeters: &maximum, Modes: map[string]json.RawMessage{"LOCATION_ONLY": nil}}
	input := ActionInput{Type: ClockIn, Evidence: Evidence{Location: &LocationEvidence{Latitude: -7.25, Longitude: 112.75, AccuracyMeters: 55}}}
	if err := ValidatePolicy(policy, nil, nil, nil, input, time.Now()); !errors.Is(err, ErrAccuracyTooLow) {
		t.Fatalf("expected ErrAccuracyTooLow, got %v", err)
	}
}

func TestValidatePolicyGeofence(t *testing.T) {
	sectionLat, sectionLon := -7.2575, 112.7521
	settings := json.RawMessage(`{"radiusMeters":100}`)
	policy := Policy{Modes: map[string]json.RawMessage{"GEOFENCE": settings}}
	inside := ActionInput{Type: ClockIn, Evidence: Evidence{Location: &LocationEvidence{Latitude: -7.2576, Longitude: 112.7522, AccuracyMeters: 10}}}
	if err := ValidatePolicy(policy, nil, &sectionLat, &sectionLon, inside, time.Now()); err != nil {
		t.Fatalf("inside geofence should pass: %v", err)
	}
	outside := ActionInput{Type: ClockIn, Evidence: Evidence{Location: &LocationEvidence{Latitude: -7.2675, Longitude: 112.7521, AccuracyMeters: 10}}}
	if err := ValidatePolicy(policy, nil, &sectionLat, &sectionLon, outside, time.Now()); !errors.Is(err, ErrOutsideGeofence) {
		t.Fatalf("expected ErrOutsideGeofence, got %v", err)
	}
}

func TestPreventEarlyClockIn(t *testing.T) {
	now := time.Date(2026, 8, 11, 1, 0, 0, 0, time.UTC)
	shift := &Shift{StartsAt: now.Add(2 * time.Hour)}
	policy := Policy{PreventEarlyClockIn: true, EarlyClockInMinutes: 30, Modes: map[string]json.RawMessage{"ANYWHERE": nil}}
	if err := ValidatePolicy(policy, shift, nil, nil, ActionInput{Type: ClockIn}, now); !errors.Is(err, ErrTooEarly) {
		t.Fatalf("expected ErrTooEarly, got %v", err)
	}
}

func TestAttendanceTimeGuards(t *testing.T) {
	start := time.Date(2026, 8, 11, 1, 0, 0, 0, time.UTC)
	shift := &Shift{StartsAt: start, EndsAt: start.Add(8 * time.Hour)}
	tests := []struct {
		name   string
		policy Policy
		action Action
		now    time.Time
		want   error
	}{
		{"late clock-in blocked", Policy{PreventLateClockIn: true, LateClockInMinutes: 15}, ClockIn, start.Add(16 * time.Minute), ErrTooLate},
		{"late clock-in boundary allowed", Policy{PreventLateClockIn: true, LateClockInMinutes: 15}, ClockIn, start.Add(15 * time.Minute), nil},
		{"early clock-out blocked", Policy{PreventEarlyClockOut: true, EarlyClockOutMinutes: 10}, ClockOut, shift.EndsAt.Add(-11 * time.Minute), ErrEarlyClockOut},
		{"early clock-out boundary allowed", Policy{PreventEarlyClockOut: true, EarlyClockOutMinutes: 10}, ClockOut, shift.EndsAt.Add(-10 * time.Minute), nil},
		{"late clock-out blocked", Policy{PreventLateClockOut: true, LateClockOutMinutes: 20}, ClockOut, shift.EndsAt.Add(21 * time.Minute), ErrLateClockOut},
		{"late clock-out boundary allowed", Policy{PreventLateClockOut: true, LateClockOutMinutes: 20}, ClockOut, shift.EndsAt.Add(20 * time.Minute), nil},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			test.policy.Modes = map[string]json.RawMessage{"ANYWHERE": nil}
			err := ValidatePolicy(test.policy, shift, nil, nil, ActionInput{Type: test.action}, test.now)
			if !errors.Is(err, test.want) {
				t.Fatalf("ValidatePolicy() error=%v want=%v", err, test.want)
			}
		})
	}
}

func TestScheduledBreakGuardBoundaries(t *testing.T) {
	start := time.Date(2026, 8, 11, 1, 0, 0, 0, time.UTC)
	breakStart, breakEnd := uint16(180), uint16(240)
	shift := &Shift{StartsAt: start, EndsAt: start.Add(8 * time.Hour)}
	policy := Policy{
		Modes:                            map[string]json.RawMessage{"ANYWHERE": nil},
		PreventUnscheduledBreak:          true,
		ScheduledBreakStartOffsetMinutes: &breakStart,
		ScheduledBreakEndOffsetMinutes:   &breakEnd,
	}
	tests := []struct {
		name string
		now  time.Time
		want error
	}{
		{"before window blocked", start.Add(179 * time.Minute), ErrOutsideBreakWindow},
		{"opening boundary allowed", start.Add(180 * time.Minute), nil},
		{"inside window allowed", start.Add(210 * time.Minute), nil},
		{"closing boundary blocked", start.Add(240 * time.Minute), ErrOutsideBreakWindow},
		{"after window blocked", start.Add(241 * time.Minute), ErrOutsideBreakWindow},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := ValidatePolicy(policy, shift, nil, nil, ActionInput{Type: StartBreak}, test.now)
			if !errors.Is(err, test.want) {
				t.Fatalf("ValidatePolicy() error=%v want=%v", err, test.want)
			}
		})
	}
	if err := ValidatePolicy(policy, nil, nil, nil, ActionInput{Type: StartBreak}, start.Add(210*time.Minute)); !errors.Is(err, ErrOutsideBreakWindow) {
		t.Fatalf("unscheduled shift must not bypass break guard: %v", err)
	}
}
