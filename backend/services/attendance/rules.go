package attendance

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"
)

func ValidateTransition(state State, action Action) error {
	valid := false
	switch state {
	case NotStarted:
		valid = action == ClockIn
	case Completed:
		valid = action == ClockIn || action == WorkMore
	case Working:
		valid = action == ClockOut || action == StartBreak
	case OnBreak:
		valid = action == EndBreak
	case Pending:
		valid = false
	}
	if !valid {
		return ErrInvalidTransition
	}
	return nil
}

func NextState(current State, action Action, decision Decision) State {
	if decision == PendingApproval {
		return Pending
	}
	if decision != Approved {
		return current
	}
	switch action {
	case ClockIn, WorkMore, EndBreak:
		return Working
	case ClockOut:
		return Completed
	case StartBreak:
		return OnBreak
	default:
		return current
	}
}

func ValidatePolicy(policy Policy, shift *Shift, sectionLatitude, sectionLongitude *float64, input ActionInput, now time.Time) error {
	if input.Type == ClockIn && shift != nil && policy.PreventEarlyClockIn {
		earliest := shift.StartsAt.Add(-time.Duration(policy.EarlyClockInMinutes) * time.Minute)
		if now.Before(earliest) {
			return ErrTooEarly
		}
	}
	if input.Type == ClockIn && shift != nil && policy.PreventLateClockIn {
		latest := shift.StartsAt.Add(time.Duration(policy.LateClockInMinutes) * time.Minute)
		if now.After(latest) {
			return ErrTooLate
		}
	}
	if input.Type == ClockOut && shift != nil && policy.PreventEarlyClockOut {
		earliest := shift.EndsAt.Add(-time.Duration(policy.EarlyClockOutMinutes) * time.Minute)
		if now.Before(earliest) {
			return ErrEarlyClockOut
		}
	}
	if input.Type == ClockOut && shift != nil && policy.PreventLateClockOut {
		latest := shift.EndsAt.Add(time.Duration(policy.LateClockOutMinutes) * time.Minute)
		if now.After(latest) {
			return ErrLateClockOut
		}
	}
	if input.Type == StartBreak && policy.PreventUnscheduledBreak && (shift == nil || !withinScheduledBreak(policy, shift, now)) {
		return ErrOutsideBreakWindow
	}

	locationRequired := hasMode(policy, "LOCATION_ONLY") || hasMode(policy, "GEOFENCE")
	if locationRequired && input.Evidence.Location == nil {
		return ErrLocationRequired
	}
	if input.Evidence.Location != nil && policy.MinimumLocationAccuracyMeters != nil && input.Evidence.Location.AccuracyMeters > *policy.MinimumLocationAccuracyMeters {
		return ErrAccuracyTooLow
	}
	if hasMode(policy, "SELFIE") || policy.SelfieRequired {
		if input.Evidence.AttachmentID == "" {
			return ErrSelfieRequired
		}
	}
	if hasMode(policy, "DYNAMIC_QR") && dynamicQRAction(input.Type) && input.Evidence.DynamicQRToken == "" {
		return ErrQRRequired
	}
	if hasMode(policy, "GEOFENCE") {
		if input.Evidence.Location == nil || sectionLatitude == nil || sectionLongitude == nil {
			return ErrLocationRequired
		}
		radius := 100.0
		var settings struct {
			RadiusMeters float64 `json:"radiusMeters"`
		}
		if raw := policy.Modes["GEOFENCE"]; len(raw) > 0 && json.Unmarshal(raw, &settings) == nil && settings.RadiusMeters > 0 {
			radius = settings.RadiusMeters
		}
		distance := HaversineMeters(input.Evidence.Location.Latitude, input.Evidence.Location.Longitude, *sectionLatitude, *sectionLongitude)
		if distance > radius {
			return ErrOutsideGeofence
		}
	}
	if hasMode(policy, "WIFI") {
		if input.Evidence.WiFi == nil {
			return ErrWiFiRequired
		}
		var settings struct {
			Networks []struct {
				SSID      string `json:"ssid"`
				BSSIDHash string `json:"bssidHash"`
			} `json:"networks"`
		}
		if json.Unmarshal(policy.Modes["WIFI"], &settings) != nil || len(settings.Networks) == 0 {
			return ErrWiFiMismatch
		}
		ssid := strings.TrimSpace(input.Evidence.WiFi.SSID)
		bssid := normalizeBSSID(input.Evidence.WiFi.BSSID)
		hash := fmt.Sprintf("%x", sha256.Sum256([]byte(bssid)))
		matched := false
		for _, network := range settings.Networks {
			if network.SSID == ssid && strings.EqualFold(network.BSSIDHash, hash) {
				matched = true
				break
			}
		}
		if !matched {
			return ErrWiFiMismatch
		}
	}
	if hasMode(policy, "FACE_VERIFICATION") {
		settings := struct {
			FailClosed bool `json:"failClosed"`
		}{FailClosed: true}
		_ = json.Unmarshal(policy.Modes["FACE_VERIFICATION"], &settings)
		if settings.FailClosed && strings.TrimSpace(input.Evidence.FaceVerificationID) == "" {
			return ErrFaceRequired
		}
	}
	if hasMode(policy, "DEVICE_INTEGRITY") {
		settings := integritySettings(policy)
		if settings.FailClosed && strings.TrimSpace(input.Evidence.IntegrityToken) == "" {
			return ErrIntegrityRequired
		}
	}
	return nil
}

type deviceIntegritySettings struct {
	FailClosed   bool `json:"failClosed"`
	MaxRiskScore int  `json:"maxRiskScore"`
}

func integritySettings(policy Policy) deviceIntegritySettings {
	settings := deviceIntegritySettings{FailClosed: true, MaxRiskScore: 30}
	if raw := policy.Modes["DEVICE_INTEGRITY"]; len(raw) > 0 {
		_ = json.Unmarshal(raw, &settings)
	}
	if settings.MaxRiskScore < 0 || settings.MaxRiskScore > 100 {
		settings.MaxRiskScore = 30
	}
	return settings
}

func IntegrityRiskScore(verdict IntegrityVerdict) int {
	score := 0
	if !verdict.AppRecognized {
		score += 60
	}
	if !verdict.Licensed {
		score += 20
	}
	hasDeviceIntegrity := false
	hasBasicIntegrity := false
	for _, label := range verdict.DeviceLabels {
		hasDeviceIntegrity = hasDeviceIntegrity || label == "MEETS_DEVICE_INTEGRITY" || label == "MEETS_STRONG_INTEGRITY"
		hasBasicIntegrity = hasBasicIntegrity || label == "MEETS_BASIC_INTEGRITY"
	}
	if !hasDeviceIntegrity {
		if hasBasicIntegrity {
			score += 25
		} else {
			score += 60
		}
	}
	if verdict.HighRecentActivity {
		score += 20
	}
	if score > 100 {
		return 100
	}
	return score
}

func normalizeBSSID(value string) string {
	return strings.ToLower(strings.NewReplacer(":", "", "-", "").Replace(strings.TrimSpace(value)))
}

func dynamicQRAction(action Action) bool {
	return action == ClockIn || action == ClockOut || action == WorkMore
}

func hasMode(policy Policy, mode string) bool {
	_, ok := policy.Modes[mode]
	return ok
}

func withinScheduledBreak(policy Policy, shift *Shift, now time.Time) bool {
	if shift == nil || policy.ScheduledBreakStartOffsetMinutes == nil || policy.ScheduledBreakEndOffsetMinutes == nil {
		return false
	}
	start := shift.StartsAt.Add(time.Duration(*policy.ScheduledBreakStartOffsetMinutes) * time.Minute)
	end := shift.StartsAt.Add(time.Duration(*policy.ScheduledBreakEndOffsetMinutes) * time.Minute)
	return !now.Before(start) && now.Before(end)
}

func HaversineMeters(latitude1, longitude1, latitude2, longitude2 float64) float64 {
	const earthRadiusMeters = 6371000.0
	toRadians := func(value float64) float64 { return value * math.Pi / 180 }
	lat1 := toRadians(latitude1)
	lat2 := toRadians(latitude2)
	deltaLat := toRadians(latitude2 - latitude1)
	deltaLon := toRadians(longitude2 - longitude1)
	a := math.Sin(deltaLat/2)*math.Sin(deltaLat/2) + math.Cos(lat1)*math.Cos(lat2)*math.Sin(deltaLon/2)*math.Sin(deltaLon/2)
	return earthRadiusMeters * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}
