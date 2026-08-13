package controllers

import (
	"errors"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/bg-gold/attendance-api/common"
	"github.com/bg-gold/attendance-api/services/attendance"
	"github.com/bg-gold/attendance-api/services/auth"
	"github.com/go-chi/chi/v5"
)

func (s *Server) submitAttendance(w http.ResponseWriter, r *http.Request) {
	principal, _ := auth.PrincipalFrom(r.Context())
	var input attendance.ActionInput
	if !httpx.DecodeJSON(w, r, &input) {
		return
	}
	result, cached, err := s.attendance.Submit(r.Context(), principal, r.Header.Get("Idempotency-Key"), input, httpx.RequestID(r.Context()), remoteIP(r.RemoteAddr))
	if err != nil {
		writeAttendanceError(w, r, err)
		return
	}
	status := http.StatusCreated
	if cached {
		status = http.StatusOK
	}
	httpx.JSON(w, status, map[string]any{"data": result, "requestId": httpx.RequestID(r.Context()), "idempotentReplay": cached})
}

func (s *Server) issueDynamicQR(w http.ResponseWriter, r *http.Request) {
	principal, _ := auth.PrincipalFrom(r.Context())
	result, err := s.attendance.IssueDynamicQR(r.Context(), principal, chi.URLParam(r, "sectionID"), httpx.RequestID(r.Context()))
	if err != nil {
		writeAttendanceError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"data": result, "requestId": httpx.RequestID(r.Context())})
}

func remoteIP(address string) string {
	host, _, err := net.SplitHostPort(address)
	if err == nil {
		return host
	}
	return address
}

func (s *Server) attendanceToday(w http.ResponseWriter, r *http.Request) {
	principal, _ := auth.PrincipalFrom(r.Context())
	result, err := s.attendance.Today(r.Context(), principal)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": result, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) attendanceHistory(w http.ResponseWriter, r *http.Request) {
	principal, _ := auth.PrincipalFrom(r.Context())
	now := time.Now().UTC()
	from, err := parseTimeQuery(r, "from", now.AddDate(0, 0, -31))
	if err != nil {
		httpx.WriteError(w, r, &httpx.Error{Status: http.StatusBadRequest, Code: "INVALID_DATE_RANGE", Message: "Tanggal mulai tidak valid.", Err: err})
		return
	}
	to, err := parseTimeQuery(r, "to", now.AddDate(0, 0, 1))
	if err != nil || !to.After(from) {
		httpx.WriteError(w, r, &httpx.Error{Status: http.StatusBadRequest, Code: "INVALID_DATE_RANGE", Message: "Rentang tanggal tidak valid.", Err: err})
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, nextCursor, err := s.attendance.HistoryPage(r.Context(), principal, from, to, limit, r.URL.Query().Get("cursor"))
	if err != nil {
		if errors.Is(err, attendance.ErrInvalidCursor) {
			httpx.WriteError(w, r, &httpx.Error{Status: http.StatusBadRequest, Code: "INVALID_CURSOR", Message: "Cursor riwayat absensi tidak valid.", Err: err})
			return
		}
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": items, "nextCursor": nextCursor, "requestId": httpx.RequestID(r.Context())})
}

func writeAttendanceError(w http.ResponseWriter, r *http.Request, err error) {
	status, code, message := http.StatusUnprocessableEntity, "ATTENDANCE_REJECTED", "Absensi tidak dapat diproses."
	switch {
	case errors.Is(err, attendance.ErrAlreadyClockedInToday):
		status, code, message = http.StatusConflict, "ALREADY_CLOCKED_IN_TODAY", "Absensi masuk hari ini sudah tercatat. Setiap karyawan hanya dapat clock-in satu kali per hari."
	case errors.Is(err, attendance.ErrInvalidTransition):
		code, message = "INVALID_ATTENDANCE_STATE", "Tindakan ini tidak sesuai dengan status absensi saat ini."
	case errors.Is(err, attendance.ErrPolicyMissing):
		status, code, message = http.StatusConflict, "ATTENDANCE_POLICY_MISSING", "Kebijakan absensi belum dikonfigurasi."
	case errors.Is(err, attendance.ErrLocationRequired):
		code, message = "LOCATION_REQUIRED", "Lokasi diperlukan untuk absensi ini."
	case errors.Is(err, attendance.ErrAccuracyTooLow):
		code, message = "LOCATION_ACCURACY_TOO_LOW", "Akurasi lokasi belum cukup baik. Coba kembali di area terbuka."
	case errors.Is(err, attendance.ErrOutsideGeofence):
		code, message = "OUTSIDE_GEOFENCE", "Anda berada di luar area absensi."
	case errors.Is(err, attendance.ErrWiFiRequired):
		code, message = "WIFI_REQUIRED", "Informasi Wi-Fi diperlukan untuk absensi ini."
	case errors.Is(err, attendance.ErrWiFiMismatch):
		code, message = "WIFI_MISMATCH", "Sambungkan perangkat ke Wi-Fi lokasi yang diizinkan."
	case errors.Is(err, attendance.ErrFaceRequired):
		code, message = "FACE_VERIFICATION_REQUIRED", "Verifikasi wajah dan liveness diperlukan untuk absensi ini."
	case errors.Is(err, attendance.ErrFaceInvalid):
		code, message = "FACE_VERIFICATION_INVALID", "Verifikasi wajah tidak valid atau sudah kedaluwarsa."
	case errors.Is(err, attendance.ErrIntegrityRequired):
		code, message = "DEVICE_INTEGRITY_REQUIRED", "Pemeriksaan keamanan perangkat diperlukan untuk absensi ini."
	case errors.Is(err, attendance.ErrIntegrityFailed):
		code, message = "DEVICE_INTEGRITY_FAILED", "Keamanan perangkat tidak memenuhi kebijakan absensi."
	case errors.Is(err, attendance.ErrIntegrityUnavailable):
		status, code, message = http.StatusServiceUnavailable, "DEVICE_INTEGRITY_UNAVAILABLE", "Pemeriksaan keamanan perangkat sedang tidak tersedia."
	case errors.Is(err, attendance.ErrDeviceInvalid):
		code, message = "DEVICE_INVALID", "Perangkat ini belum terdaftar untuk akun aktif. Muat ulang lalu coba kembali."
	case errors.Is(err, attendance.ErrSelfieRequired):
		code, message = "SELFIE_REQUIRED", "Foto selfie diperlukan untuk absensi ini."
	case errors.Is(err, attendance.ErrQRRequired):
		code, message = "QR_REQUIRED", "Pindai QR dinamis di lokasi sebelum mengirim absensi."
	case errors.Is(err, attendance.ErrQRInvalid):
		code, message = "QR_INVALID", "QR tidak valid untuk lokasi ini."
	case errors.Is(err, attendance.ErrQRExpired):
		code, message = "QR_EXPIRED", "QR sudah kedaluwarsa. Pindai kode terbaru."
	case errors.Is(err, attendance.ErrQRAlreadyUsed):
		code, message = "QR_ALREADY_USED", "QR ini sudah pernah digunakan. Pindai kode terbaru."
	case errors.Is(err, attendance.ErrTooEarly):
		code, message = "OUTSIDE_TIME_WINDOW", "Belum waktunya melakukan clock-in."
	case errors.Is(err, attendance.ErrTooLate):
		code, message = "OUTSIDE_TIME_WINDOW", "Batas waktu clock-in sudah lewat. Hubungi supervisor bila perlu koreksi."
	case errors.Is(err, attendance.ErrEarlyClockOut):
		code, message = "OUTSIDE_TIME_WINDOW", "Belum waktunya melakukan clock-out."
	case errors.Is(err, attendance.ErrLateClockOut):
		code, message = "OUTSIDE_TIME_WINDOW", "Batas waktu clock-out sudah lewat. Hubungi supervisor bila perlu koreksi."
	case errors.Is(err, attendance.ErrOutsideBreakWindow):
		code, message = "OUTSIDE_BREAK_WINDOW", "Istirahat hanya dapat dimulai pada jadwal yang telah ditentukan."
	case errors.Is(err, attendance.ErrIdempotencyReuse):
		status, code, message = http.StatusConflict, "IDEMPOTENCY_KEY_REUSED", "Permintaan menggunakan kunci pengiriman yang sudah dipakai untuk data berbeda."
	case err != nil && err.Error() == "invalid idempotency key":
		status, code, message = http.StatusBadRequest, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key wajib diisi."
	default:
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteError(w, r, &httpx.Error{Status: status, Code: code, Message: message, Err: err})
}

func parseTimeQuery(r *http.Request, name string, fallback time.Time) (time.Time, error) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return fallback, nil
	}
	return time.Parse(time.RFC3339, raw)
}
