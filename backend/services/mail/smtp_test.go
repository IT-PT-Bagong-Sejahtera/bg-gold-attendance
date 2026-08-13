package mail

import (
	"strings"
	"testing"

	"github.com/bg-gold/attendance-api/config"
)

func TestPasswordResetMessageContainsEncodedDeepLink(t *testing.T) {
	message, err := accountMessage(config.MailConfig{
		FromEmail: "attendance@bggold.id",
		FromName:  "BG GOLD Attendance",
		ResetURL:  "bggold-attendance://reset-password?source=email",
	}, "ayu@example.com", "token-with+/unsafe=value", false)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		"Subject: Atur ulang kata sandi BG GOLD Attendance",
		"source=email",
		"token=token-with%2B%2Funsafe%3Dvalue",
		"berlaku selama 30 menit",
	} {
		if !strings.Contains(message, expected) {
			t.Fatalf("message does not contain %q: %s", expected, message)
		}
	}
}

func TestPasswordResetMessageRejectsHeaderInjection(t *testing.T) {
	_, err := accountMessage(config.MailConfig{FromEmail: "attendance@bggold.id", ResetURL: "bggold-attendance://reset-password"}, "victim@example.com\r\nBcc: attacker@example.com", "token", false)
	if err == nil {
		t.Fatal("header injection recipient was accepted")
	}
}

func TestInvitationMessageUsesFirstPasswordCopy(t *testing.T) {
	message, err := accountMessage(config.MailConfig{FromEmail: "attendance@bggold.id", FromName: "BG GOLD Attendance", ResetURL: "bggold-attendance://reset-password"}, "new.employee@example.com", "invite-token", true)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(message, "Subject: Undangan ke BG GOLD Attendance") || !strings.Contains(message, "membuat kata sandi pertama") {
		t.Fatalf("unexpected invitation message: %s", message)
	}
}
