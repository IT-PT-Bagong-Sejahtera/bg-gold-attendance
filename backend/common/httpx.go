package httpx

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
)

type Error struct {
	Status  int
	Code    string
	Message string
	Err     error
}

func (e *Error) Error() string {
	if e.Err != nil {
		return e.Err.Error()
	}
	return e.Message
}

func (e *Error) Unwrap() error { return e.Err }

type errorBody struct {
	Error errorDetail `json:"error"`
}

type errorDetail struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"requestId,omitempty"`
}

func JSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if value != nil {
		_ = json.NewEncoder(w).Encode(value)
	}
}

func DecodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		WriteError(w, r, &Error{Status: http.StatusBadRequest, Code: "INVALID_JSON", Message: "Payload JSON tidak valid.", Err: err})
		return false
	}
	return true
}

func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	var appErr *Error
	if !errors.As(err, &appErr) {
		appErr = &Error{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Message: "Terjadi kesalahan pada server.", Err: err}
	}
	requestID := RequestID(r.Context())
	if appErr.Status >= 500 {
		slog.Error("request failed", "request_id", requestID, "code", appErr.Code, "error", appErr.Err)
	}
	JSON(w, appErr.Status, errorBody{Error: errorDetail{Code: appErr.Code, Message: appErr.Message, RequestID: requestID}})
}
