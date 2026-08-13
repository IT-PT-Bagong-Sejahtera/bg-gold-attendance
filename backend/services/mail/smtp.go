package mail

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/mail"
	"net/smtp"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/bg-gold/attendance-api/config"
)

type AccountSender interface {
	SendPasswordReset(ctx context.Context, recipient, rawToken string) error
	SendInvitation(ctx context.Context, recipient, rawToken string) error
}

type SMTP struct {
	config config.MailConfig
}

func NewSMTP(cfg config.MailConfig) *SMTP { return &SMTP{config: cfg} }

func (s *SMTP) SendPasswordReset(ctx context.Context, recipient, rawToken string) error {
	message, err := accountMessage(s.config, recipient, rawToken, false)
	if err != nil {
		return err
	}
	return s.send(ctx, recipient, message)
}

func (s *SMTP) SendInvitation(ctx context.Context, recipient, rawToken string) error {
	message, err := accountMessage(s.config, recipient, rawToken, true)
	if err != nil {
		return err
	}
	return s.send(ctx, recipient, message)
}

func (s *SMTP) send(ctx context.Context, recipient, message string) error {
	address := net.JoinHostPort(s.config.Host, strconv.Itoa(s.config.Port))
	dialer := net.Dialer{Timeout: 10 * time.Second}
	connection, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return fmt.Errorf("connect SMTP: %w", err)
	}
	defer connection.Close()
	deadline := time.Now().Add(15 * time.Second)
	if value, ok := ctx.Deadline(); ok {
		deadline = value
	}
	_ = connection.SetDeadline(deadline)
	client, err := smtp.NewClient(connection, s.config.Host)
	if err != nil {
		return fmt.Errorf("initialize SMTP: %w", err)
	}
	defer client.Close()
	if ok, _ := client.Extension("STARTTLS"); ok {
		if err = client.StartTLS(&tls.Config{MinVersion: tls.VersionTLS12, ServerName: s.config.Host}); err != nil {
			return fmt.Errorf("start SMTP TLS: %w", err)
		}
	} else if s.config.RequireTLS {
		return fmt.Errorf("SMTP server does not offer STARTTLS")
	}
	if s.config.Username != "" {
		if err = client.Auth(smtp.PlainAuth("", s.config.Username, s.config.Password, s.config.Host)); err != nil {
			return fmt.Errorf("authenticate SMTP: %w", err)
		}
	}
	if err = client.Mail(s.config.FromEmail); err != nil {
		return fmt.Errorf("set SMTP sender: %w", err)
	}
	if err = client.Rcpt(recipient); err != nil {
		return fmt.Errorf("set SMTP recipient: %w", err)
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("start SMTP message: %w", err)
	}
	if _, err = io.Copy(w, strings.NewReader(message)); err != nil {
		return fmt.Errorf("write SMTP message: %w", err)
	}
	if err = w.Close(); err != nil {
		return fmt.Errorf("finish SMTP message: %w", err)
	}
	if err = client.Quit(); err != nil {
		return fmt.Errorf("quit SMTP: %w", err)
	}
	return nil
}

func accountMessage(cfg config.MailConfig, recipient, rawToken string, invitation bool) (string, error) {
	if _, err := mail.ParseAddress(recipient); err != nil {
		return "", fmt.Errorf("invalid email recipient: %w", err)
	}
	base, err := url.Parse(cfg.ResetURL)
	if err != nil {
		return "", fmt.Errorf("parse password reset URL: %w", err)
	}
	query := base.Query()
	query.Set("token", rawToken)
	base.RawQuery = query.Encode()
	from := (&mail.Address{Name: cfg.FromName, Address: cfg.FromEmail}).String()
	subject := "Atur ulang kata sandi BG GOLD Attendance"
	body := "Gunakan tautan berikut untuk mengatur ulang kata sandi BG GOLD Attendance. Tautan berlaku selama 30 menit.\r\n\r\n" + base.String() + "\r\n\r\nJika Anda tidak meminta perubahan ini, abaikan email ini."
	if invitation {
		subject = "Undangan ke BG GOLD Attendance"
		body = "Akun BG GOLD Attendance Anda telah dibuat. Gunakan tautan berikut untuk membuat kata sandi pertama. Tautan berlaku selama 30 menit.\r\n\r\n" + base.String() + "\r\n\r\nJika undangan ini tidak Anda kenali, hubungi administrator BG GOLD."
	}
	return "From: " + from + "\r\n" +
		"To: " + recipient + "\r\n" +
		"Subject: " + subject + "\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: text/plain; charset=UTF-8\r\n" +
		"Content-Transfer-Encoding: 8bit\r\n\r\n" + body + "\r\n", nil
}
