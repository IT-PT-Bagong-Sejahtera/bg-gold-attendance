package attendance

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

type Action string

const (
	ClockIn    Action = "CLOCK_IN"
	ClockOut   Action = "CLOCK_OUT"
	StartBreak Action = "START_BREAK"
	EndBreak   Action = "END_BREAK"
	WorkMore   Action = "WORK_MORE"
)

type State string

const (
	NotStarted State = "NOT_STARTED"
	Working    State = "WORKING"
	OnBreak    State = "ON_BREAK"
	Completed  State = "COMPLETED"
	Pending    State = "PENDING"
)

type Decision string

const (
	Approved        Decision = "APPROVED"
	PendingApproval Decision = "PENDING"
	Rejected        Decision = "REJECTED"
)

var (
	ErrInvalidTransition     = errors.New("invalid attendance state transition")
	ErrAlreadyClockedInToday = errors.New("employee already clocked in today")
	ErrPolicyMissing         = errors.New("attendance policy is not configured")
	ErrLocationRequired      = errors.New("location evidence is required")
	ErrSelfieRequired        = errors.New("selfie evidence is required")
	ErrQRRequired            = errors.New("dynamic QR evidence is required")
	ErrQRInvalid             = errors.New("dynamic QR token is invalid")
	ErrQRExpired             = errors.New("dynamic QR token has expired")
	ErrQRAlreadyUsed         = errors.New("dynamic QR token was already used")
	ErrAccuracyTooLow        = errors.New("location accuracy is below policy requirement")
	ErrOutsideGeofence       = errors.New("location is outside geofence")
	ErrWiFiRequired          = errors.New("wifi evidence is required")
	ErrWiFiMismatch          = errors.New("wifi network does not match policy")
	ErrFaceRequired          = errors.New("face verification is required")
	ErrFaceInvalid           = errors.New("face verification is invalid")
	ErrIntegrityRequired     = errors.New("device integrity token is required")
	ErrIntegrityFailed       = errors.New("device integrity verdict rejected")
	ErrIntegrityUnavailable  = errors.New("device integrity provider is unavailable")
	ErrDeviceInvalid         = errors.New("attendance device is not registered for the active account")
	ErrTooEarly              = errors.New("clock in is too early")
	ErrTooLate               = errors.New("clock in is too late")
	ErrEarlyClockOut         = errors.New("clock out is too early")
	ErrLateClockOut          = errors.New("clock out is too late")
	ErrOutsideBreakWindow    = errors.New("break is outside the scheduled window")
	ErrIdempotencyReuse      = errors.New("idempotency key was reused with another request")
	ErrInvalidCursor         = errors.New("attendance history cursor is invalid")
)

type LocationEvidence struct {
	Latitude       float64   `json:"latitude"`
	Longitude      float64   `json:"longitude"`
	AccuracyMeters float64   `json:"accuracyMeters"`
	CapturedAt     time.Time `json:"capturedAt"`
}

type Evidence struct {
	Location           *LocationEvidence `json:"location"`
	AttachmentID       string            `json:"attachmentId"`
	DynamicQRToken     string            `json:"dynamicQrToken"`
	DeviceID           string            `json:"deviceId"`
	IntegrityToken     string            `json:"integrityToken"`
	WiFi               *WiFiEvidence     `json:"wifi"`
	FaceVerificationID string            `json:"faceVerificationId"`
	IntegrityVerdict   json.RawMessage   `json:"-"`
}

type WiFiEvidence struct {
	SSID  string `json:"ssid"`
	BSSID string `json:"bssid"`
}

type IntegrityVerdict struct {
	AppRecognized      bool     `json:"appRecognized"`
	Licensed           bool     `json:"licensed"`
	DeviceLabels       []string `json:"deviceLabels"`
	HighRecentActivity bool     `json:"highRecentActivity"`
	ProviderReference  string   `json:"providerReference"`
}

type IntegrityVerifier interface {
	Verify(context.Context, string, string) (IntegrityVerdict, error)
}

type ActionInput struct {
	Type      Action   `json:"type"`
	ShiftID   string   `json:"shiftId"`
	SectionID string   `json:"sectionId"`
	Reason    string   `json:"reason"`
	Evidence  Evidence `json:"evidence"`
}

type Result struct {
	ActionID        string    `json:"actionId"`
	Decision        Decision  `json:"decision"`
	AttendanceState State     `json:"attendanceState"`
	RecordedAt      time.Time `json:"recordedAt"`
	Message         string    `json:"message"`
}

type Policy struct {
	ID                               string
	Name                             string
	Version                          uint32
	EarlyClockInMinutes              uint16
	LateClockInMinutes               uint16
	EarlyClockOutMinutes             uint16
	LateClockOutMinutes              uint16
	PreventEarlyClockIn              bool
	PreventLateClockIn               bool
	PreventEarlyClockOut             bool
	PreventLateClockOut              bool
	AutoClockOut                     bool
	UnscheduledRequiresApproval      bool
	WorkMoreRequiresApproval         bool
	UnscheduledBreakRequiresApproval bool
	PreventUnscheduledBreak          bool
	ScheduledBreakStartOffsetMinutes *uint16
	ScheduledBreakEndOffsetMinutes   *uint16
	BreakRoundingMinutes             *uint16
	SelfieRequired                   bool
	MinimumLocationAccuracyMeters    *float64
	Modes                            map[string]json.RawMessage
}

type Shift struct {
	ID        string
	SectionID string
	StartsAt  time.Time
	EndsAt    time.Time
}

type StateSnapshot struct {
	State         State
	ActiveShiftID string
}

type DynamicQR struct {
	Token     string    `json:"token"`
	SectionID string    `json:"sectionId"`
	ExpiresAt time.Time `json:"expiresAt"`
}
