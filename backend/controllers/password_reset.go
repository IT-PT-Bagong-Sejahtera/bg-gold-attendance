package controllers

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/bg-gold/attendance-api/common"
	"github.com/bg-gold/attendance-api/services/auth"
)

func (s *Server) forgotPassword(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Email string `json:"email"`
	}
	if !httpx.DecodeJSON(w, r, &input) {
		return
	}
	if !strings.Contains(strings.TrimSpace(input.Email), "@") {
		writeValidation(w, r, "Masukkan alamat email yang valid.")
		return
	}
	token, err := s.authService.RequestPasswordReset(r.Context(), input.Email)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if token != "" && s.resetSender != nil {
		if sendErr := s.resetSender.SendPasswordReset(r.Context(), strings.ToLower(strings.TrimSpace(input.Email)), token); sendErr != nil {
			slog.Error("password reset email delivery failed", "request_id", httpx.RequestID(r.Context()), "error", sendErr)
		}
	}
	data := map[string]any{"message": "Jika akun ditemukan, petunjuk reset akan dikirim."}
	if token != "" && (s.environment == "development" || s.environment == "test") {
		data["developmentResetToken"] = token
	}
	httpx.JSON(w, http.StatusAccepted, map[string]any{"data": data, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) resetPassword(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Token       string `json:"token"`
		NewPassword string `json:"newPassword"`
	}
	if !httpx.DecodeJSON(w, r, &input) {
		return
	}
	if len(input.NewPassword) < 8 {
		writeValidation(w, r, "Kata sandi baru minimal 8 karakter.")
		return
	}
	if err := s.authService.ResetPassword(r.Context(), input.Token, input.NewPassword); err != nil {
		if errors.Is(err, auth.ErrInvalidPasswordReset) {
			httpx.WriteError(w, r, &httpx.Error{Status: http.StatusUnprocessableEntity, Code: "RESET_TOKEN_INVALID", Message: "Tautan reset tidak berlaku atau sudah kedaluwarsa."})
			return
		}
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": map[string]string{"message": "Kata sandi berhasil diperbarui. Silakan masuk kembali."}, "requestId": httpx.RequestID(r.Context())})
}
