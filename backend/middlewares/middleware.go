package middlewares

import (
	"log/slog"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"github.com/bg-gold/attendance-api/common"
	"github.com/bg-gold/attendance-api/helpers"
	"github.com/bg-gold/attendance-api/services/auth"
)

func RequestContext(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := strings.TrimSpace(r.Header.Get("X-Request-ID"))
		if requestID == "" || len(requestID) > 64 {
			requestID, _ = identity.NewUUID()
		}
		w.Header().Set("X-Request-ID", requestID)
		next.ServeHTTP(w, r.WithContext(httpx.WithRequestID(r.Context(), requestID)))
	})
}

func Recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				slog.Error("panic recovered", "request_id", httpx.RequestID(r.Context()), "panic", recovered, "stack", string(debug.Stack()))
				httpx.WriteError(w, r, &httpx.Error{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Message: "Terjadi kesalahan pada server."})
			}
		}()
		next.ServeHTTP(w, r)
	})
}

type responseCapture struct {
	http.ResponseWriter
	status int
}

func (w *responseCapture) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func AccessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		capture := &responseCapture{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(capture, r)
		principal, _ := auth.PrincipalFrom(r.Context())
		slog.Info("http request",
			"request_id", httpx.RequestID(r.Context()),
			"method", r.Method,
			"path", r.URL.Path,
			"status", capture.status,
			"latency_ms", time.Since(started).Milliseconds(),
			"user_id", principal.UserID,
			"organization_id", principal.OrganizationID,
		)
	})
}

func CORS(allowed []string) func(http.Handler) http.Handler {
	set := make(map[string]bool, len(allowed))
	for _, origin := range allowed {
		set[origin] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if set[origin] {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key, X-Request-ID")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
