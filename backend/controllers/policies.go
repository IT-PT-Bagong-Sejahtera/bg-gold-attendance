package controllers

import (
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/bg-gold/attendance-api/common"
	"github.com/bg-gold/attendance-api/services/auth"
	"github.com/go-chi/chi/v5"
)

type updatePolicyInput struct {
	Name                          *string  `json:"name"`
	Modes                         []string `json:"modes"`
	SelfieRequired                *bool    `json:"selfieRequired"`
	MinimumLocationAccuracyMeters *float64 `json:"minimumLocationAccuracyMeters"`
	GeofenceRadiusMeters          *float64 `json:"geofenceRadiusMeters"`
	WiFiNetworks                  []struct {
		SSID  string `json:"ssid"`
		BSSID string `json:"bssid"`
	} `json:"wifiNetworks"`
	FaceFailClosed                   *bool   `json:"faceFailClosed"`
	IntegrityFailClosed              *bool   `json:"integrityFailClosed"`
	MaxRiskScore                     *int    `json:"maxRiskScore"`
	EarlyClockInMinutes              *uint16 `json:"earlyClockInMinutes"`
	LateClockInMinutes               *uint16 `json:"lateClockInMinutes"`
	EarlyClockOutMinutes             *uint16 `json:"earlyClockOutMinutes"`
	LateClockOutMinutes              *uint16 `json:"lateClockOutMinutes"`
	PreventEarlyClockIn              *bool   `json:"preventEarlyClockIn"`
	PreventLateClockIn               *bool   `json:"preventLateClockIn"`
	PreventEarlyClockOut             *bool   `json:"preventEarlyClockOut"`
	PreventLateClockOut              *bool   `json:"preventLateClockOut"`
	UnscheduledRequiresApproval      *bool   `json:"unscheduledRequiresApproval"`
	WorkMoreRequiresApproval         *bool   `json:"workMoreRequiresApproval"`
	UnscheduledBreakRequiresApproval *bool   `json:"unscheduledBreakRequiresApproval"`
	PreventUnscheduledBreak          *bool   `json:"preventUnscheduledBreak"`
	ScheduledBreakStartOffsetMinutes *uint16 `json:"scheduledBreakStartOffsetMinutes"`
	ScheduledBreakEndOffsetMinutes   *uint16 `json:"scheduledBreakEndOffsetMinutes"`
	BreakRoundingMinutes             *uint16 `json:"breakRoundingMinutes"`
}

func (s *Server) updatePolicy(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	policyID := strings.TrimSpace(chi.URLParam(r, "policyID"))
	var in updatePolicyInput
	if !httpx.DecodeJSON(w, r, &in) {
		return
	}
	if in.Name != nil && strings.TrimSpace(*in.Name) == "" {
		writeValidation(w, r, "Nama kebijakan wajib diisi.")
		return
	}
	for _, value := range []*uint16{in.EarlyClockInMinutes, in.LateClockInMinutes, in.EarlyClockOutMinutes, in.LateClockOutMinutes} {
		if value != nil && *value > 1440 {
			writeValidation(w, r, "Toleransi waktu absensi maksimal 1.440 menit.")
			return
		}
	}
	if in.MaxRiskScore != nil && (*in.MaxRiskScore < 0 || *in.MaxRiskScore > 100) {
		writeValidation(w, r, "Skor risiko maksimum wajib antara 0 dan 100.")
		return
	}
	if in.MinimumLocationAccuracyMeters != nil && *in.MinimumLocationAccuracyMeters < 0 {
		writeValidation(w, r, "Akurasi lokasi minimum tidak boleh negatif.")
		return
	}
	if in.BreakRoundingMinutes != nil && (*in.BreakRoundingMinutes < 1 || *in.BreakRoundingMinutes > 60) {
		writeValidation(w, r, "Pembulatan istirahat wajib antara 1 dan 60 menit.")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer tx.Rollback()
	var currentName, status string
	var version int
	var currentBreakStart, currentBreakEnd sql.NullInt64
	var currentPreventBreak, currentBreakApproval bool
	if err = tx.QueryRowContext(r.Context(), `SELECT name,version,status,scheduled_break_start_offset_minutes,scheduled_break_end_offset_minutes,prevent_unscheduled_break,unscheduled_break_requires_approval FROM attendance_policies WHERE id=UUID_TO_BIN(?) AND organization_id=UUID_TO_BIN(?) FOR UPDATE`, policyID, p.OrganizationID).Scan(&currentName, &version, &status, &currentBreakStart, &currentBreakEnd, &currentPreventBreak, &currentBreakApproval); errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, r, &httpx.Error{Status: http.StatusNotFound, Code: "POLICY_NOT_FOUND", Message: "Kebijakan tidak ditemukan."})
		return
	} else if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if status != "ACTIVE" {
		httpx.WriteError(w, r, &httpx.Error{Status: http.StatusConflict, Code: "POLICY_ARCHIVED", Message: "Kebijakan yang telah diarsipkan tidak dapat diubah."})
		return
	}
	breakStart, breakEnd := currentBreakStart, currentBreakEnd
	if in.ScheduledBreakStartOffsetMinutes != nil {
		breakStart = sql.NullInt64{Int64: int64(*in.ScheduledBreakStartOffsetMinutes), Valid: true}
	}
	if in.ScheduledBreakEndOffsetMinutes != nil {
		breakEnd = sql.NullInt64{Int64: int64(*in.ScheduledBreakEndOffsetMinutes), Valid: true}
	}
	preventBreak, breakApproval := currentPreventBreak, currentBreakApproval
	if in.PreventUnscheduledBreak != nil {
		preventBreak = *in.PreventUnscheduledBreak
	}
	if in.UnscheduledBreakRequiresApproval != nil {
		breakApproval = *in.UnscheduledBreakRequiresApproval
	}
	if breakStart.Valid != breakEnd.Valid || (breakStart.Valid && breakEnd.Int64 <= breakStart.Int64) {
		writeValidation(w, r, "Rentang scheduled break tidak valid.")
		return
	}
	if preventBreak && !breakStart.Valid {
		writeValidation(w, r, "Jadwal istirahat wajib diisi sebelum absensi di luar jadwal dapat ditolak.")
		return
	}
	if preventBreak && breakApproval {
		writeValidation(w, r, "Pilih salah satu: tolak atau minta persetujuan untuk istirahat di luar jadwal.")
		return
	}
	name := currentName
	if in.Name != nil {
		name = strings.TrimSpace(*in.Name)
	}
	_, err = tx.ExecContext(r.Context(), `UPDATE attendance_policies SET name=?,version=version+1,
		early_clock_in_minutes=COALESCE(?,early_clock_in_minutes),late_clock_in_minutes=COALESCE(?,late_clock_in_minutes),early_clock_out_minutes=COALESCE(?,early_clock_out_minutes),late_clock_out_minutes=COALESCE(?,late_clock_out_minutes),
		prevent_early_clock_in=COALESCE(?,prevent_early_clock_in),prevent_late_clock_in=COALESCE(?,prevent_late_clock_in),prevent_early_clock_out=COALESCE(?,prevent_early_clock_out),prevent_late_clock_out=COALESCE(?,prevent_late_clock_out),
		selfie_required=COALESCE(?,selfie_required),minimum_location_accuracy_meters=COALESCE(?,minimum_location_accuracy_meters),unscheduled_requires_approval=COALESCE(?,unscheduled_requires_approval),work_more_requires_approval=COALESCE(?,work_more_requires_approval),
		unscheduled_break_requires_approval=COALESCE(?,unscheduled_break_requires_approval),prevent_unscheduled_break=COALESCE(?,prevent_unscheduled_break),scheduled_break_start_offset_minutes=COALESCE(?,scheduled_break_start_offset_minutes),scheduled_break_end_offset_minutes=COALESCE(?,scheduled_break_end_offset_minutes),break_rounding_minutes=COALESCE(?,break_rounding_minutes),updated_at=UTC_TIMESTAMP(6)
		WHERE id=UUID_TO_BIN(?)`, name, in.EarlyClockInMinutes, in.LateClockInMinutes, in.EarlyClockOutMinutes, in.LateClockOutMinutes, in.PreventEarlyClockIn, in.PreventLateClockIn, in.PreventEarlyClockOut, in.PreventLateClockOut, in.SelfieRequired, in.MinimumLocationAccuracyMeters, in.UnscheduledRequiresApproval, in.WorkMoreRequiresApproval, in.UnscheduledBreakRequiresApproval, in.PreventUnscheduledBreak, in.ScheduledBreakStartOffsetMinutes, in.ScheduledBreakEndOffsetMinutes, in.BreakRoundingMinutes, policyID)
	if err != nil {
		writeConflict(w, r, "POLICY_EXISTS", "Nama dan versi kebijakan sudah digunakan.", err)
		return
	}
	if len(in.Modes) > 0 {
		if err = replacePolicyModes(r, tx, policyID, in); err != nil {
			writeValidation(w, r, err.Error())
			return
		}
	}
	if err = insertAudit(r.Context(), tx, p, "policy.update", "attendance_policy", policyID, map[string]any{"previousName": currentName, "name": name, "previousVersion": version, "version": version + 1, "modes": in.Modes}); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": map[string]any{"id": policyID, "name": name, "version": version + 1}, "requestId": httpx.RequestID(r.Context())})
}

func replacePolicyModes(r *http.Request, tx *sql.Tx, policyID string, in updatePolicyInput) error {
	allowed := map[string]bool{"ANYWHERE": true, "LOCATION_ONLY": true, "GEOFENCE": true, "DYNAMIC_QR": true, "WIFI": true, "SELFIE": true, "FACE_VERIFICATION": true, "DEVICE_INTEGRITY": true}
	current := map[string]any{}
	rows, err := tx.QueryContext(r.Context(), `SELECT mode,CAST(settings AS CHAR) FROM attendance_policy_modes WHERE policy_id=UUID_TO_BIN(?)`, policyID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var mode string
		var settings sql.NullString
		if err = rows.Scan(&mode, &settings); err != nil {
			rows.Close()
			return err
		}
		if settings.Valid {
			current[mode] = settings.String
		}
	}
	rows.Close()
	if _, err = tx.ExecContext(r.Context(), `DELETE FROM attendance_policy_modes WHERE policy_id=UUID_TO_BIN(?)`, policyID); err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, raw := range in.Modes {
		mode := strings.ToUpper(strings.TrimSpace(raw))
		if !allowed[mode] || seen[mode] {
			return fmt.Errorf("mode absensi tidak dikenal atau berulang: %s", raw)
		}
		seen[mode] = true
		settings := current[mode]
		switch mode {
		case "GEOFENCE":
			if in.GeofenceRadiusMeters != nil {
				if *in.GeofenceRadiusMeters < 10 || *in.GeofenceRadiusMeters > 5000 {
					return errors.New("radius geofence wajib antara 10 dan 5.000 meter")
				}
				encoded, _ := json.Marshal(map[string]any{"radiusMeters": *in.GeofenceRadiusMeters})
				settings = string(encoded)
			} else if settings == nil {
				return errors.New("radius geofence wajib diisi untuk mode baru")
			}
		case "WIFI":
			if len(in.WiFiNetworks) > 0 {
				networks := make([]map[string]string, 0, len(in.WiFiNetworks))
				for _, network := range in.WiFiNetworks {
					if strings.TrimSpace(network.SSID) == "" || normalizeWiFiBSSID(network.BSSID) == "" {
						return errors.New("SSID dan BSSID Wi-Fi wajib valid")
					}
					hash := sha256.Sum256([]byte(normalizeWiFiBSSID(network.BSSID)))
					networks = append(networks, map[string]string{"ssid": strings.TrimSpace(network.SSID), "bssidHash": fmt.Sprintf("%x", hash)})
				}
				encoded, _ := json.Marshal(map[string]any{"networks": networks})
				settings = string(encoded)
			} else if settings == nil {
				return errors.New("SSID dan BSSID wajib diisi untuk mode Wi-Fi baru")
			}
		case "FACE_VERIFICATION":
			if in.FaceFailClosed != nil || settings == nil {
				failClosed := true
				if in.FaceFailClosed != nil {
					failClosed = *in.FaceFailClosed
				}
				encoded, _ := json.Marshal(map[string]any{"failClosed": failClosed, "minimumScore": 0.8})
				settings = string(encoded)
			}
		case "DEVICE_INTEGRITY":
			if in.IntegrityFailClosed != nil || in.MaxRiskScore != nil || settings == nil {
				failClosed, maxRisk := true, 30
				if in.IntegrityFailClosed != nil {
					failClosed = *in.IntegrityFailClosed
				}
				if in.MaxRiskScore != nil {
					maxRisk = *in.MaxRiskScore
				}
				encoded, _ := json.Marshal(map[string]any{"failClosed": failClosed, "maxRiskScore": maxRisk})
				settings = string(encoded)
			}
		}
		if _, err = tx.ExecContext(r.Context(), `INSERT INTO attendance_policy_modes(policy_id,mode,settings) VALUES(UUID_TO_BIN(?),?,?)`, policyID, mode, settings); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) archivePolicy(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	policyID := strings.TrimSpace(chi.URLParam(r, "policyID"))
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer tx.Rollback()
	var name, status string
	if err = tx.QueryRowContext(r.Context(), `SELECT name,status FROM attendance_policies WHERE id=UUID_TO_BIN(?) AND organization_id=UUID_TO_BIN(?) FOR UPDATE`, policyID, p.OrganizationID).Scan(&name, &status); errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, r, &httpx.Error{Status: http.StatusNotFound, Code: "POLICY_NOT_FOUND", Message: "Kebijakan tidak ditemukan."})
		return
	} else if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if status != "ARCHIVED" {
		now := time.Now().UTC()
		if _, err = tx.ExecContext(r.Context(), `UPDATE attendance_policies SET status='ARCHIVED',updated_at=? WHERE id=UUID_TO_BIN(?)`, now, policyID); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if _, err = tx.ExecContext(r.Context(), `UPDATE policy_assignments SET valid_until=? WHERE policy_id=UUID_TO_BIN(?) AND (valid_until IS NULL OR valid_until>?)`, now, policyID, now); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if err = insertAudit(r.Context(), tx, p, "policy.archive", "attendance_policy", policyID, map[string]any{"name": name}); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
	}
	if err = tx.Commit(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": map[string]any{"id": policyID, "status": "ARCHIVED"}, "requestId": httpx.RequestID(r.Context())})
}
