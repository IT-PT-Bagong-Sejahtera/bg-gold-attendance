package mail

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/bg-gold/attendance-api/config"
)

func TestLiveSMTPPasswordResetAndInvitationDelivery(t *testing.T) {
	host := os.Getenv("TEST_SMTP_HOST")
	apiURL := strings.TrimRight(os.Getenv("TEST_MAILPIT_API_URL"), "/")
	if host == "" || apiURL == "" {
		t.Skip("TEST_SMTP_HOST and TEST_MAILPIT_API_URL are required")
	}
	port, err := strconv.Atoi(os.Getenv("TEST_SMTP_PORT"))
	if err != nil || port <= 0 {
		t.Fatal("TEST_SMTP_PORT must be a valid port")
	}
	sender := NewSMTP(config.MailConfig{
		Host: host, Port: port, FromEmail: "attendance@bggold.local",
		FromName: "BG GOLD Attendance", ResetURL: "bggold-attendance://reset-password",
	})
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	resetRecipient := "reset." + suffix + "@bggold.local"
	inviteRecipient := "invite." + suffix + "@bggold.local"
	resetToken, inviteToken := "reset-token-"+suffix, "invite-token-"+suffix
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err = sender.SendPasswordReset(ctx, resetRecipient, resetToken); err != nil {
		t.Fatal(err)
	}
	if err = sender.SendInvitation(ctx, inviteRecipient, inviteToken); err != nil {
		t.Fatal(err)
	}

	type messageSummary struct {
		ID      string `json:"ID"`
		Subject string `json:"Subject"`
	}
	var list struct {
		Messages []messageSummary `json:"messages"`
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		response, requestErr := http.Get(apiURL + "/api/v1/messages")
		if requestErr == nil {
			requestErr = json.NewDecoder(response.Body).Decode(&list)
			_ = response.Body.Close()
		}
		if requestErr == nil && len(list.Messages) >= 2 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("Mailpit did not expose delivered messages: %v", requestErr)
		}
		time.Sleep(100 * time.Millisecond)
	}
	joinedDetails := ""
	for _, item := range list.Messages {
		response, requestErr := http.Get(apiURL + "/api/v1/message/" + item.ID)
		if requestErr != nil {
			t.Fatal(requestErr)
		}
		var detail any
		if requestErr = json.NewDecoder(response.Body).Decode(&detail); requestErr != nil {
			_ = response.Body.Close()
			t.Fatal(requestErr)
		}
		_ = response.Body.Close()
		encoded, _ := json.Marshal(detail)
		joinedDetails += item.Subject + " " + string(encoded)
	}
	for _, expected := range []string{
		"Atur ulang kata sandi BG GOLD Attendance", "Undangan ke BG GOLD Attendance",
		resetRecipient, inviteRecipient, resetToken, inviteToken,
	} {
		if !strings.Contains(joinedDetails, expected) {
			t.Fatalf("live SMTP delivery does not contain %q", expected)
		}
	}
}
