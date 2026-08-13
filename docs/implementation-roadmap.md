# Implementation Roadmap

## Milestone 0 — discovery and foundations

- Complete APK behavioral inventory and parity matrix.
- Establish clean-room boundaries and BG GOLD design direction.
- Define architecture, MySQL model, REST contract, and test gates.

Exit evidence: all required documents exist and every requested capability is represented in the parity matrix.

## Milestone 1 — operational attendance core

- Monorepo, Docker Compose, MySQL, MinIO, API, mobile, and admin scaffolds.
- Login/logout, rotating refresh, reset-password foundation, and session restoration.
- Organization, employee, role, section, and attendance-policy administration.
- Basic shifts and employee schedule.
- ANYWHERE clock-in/out using server time, idempotency, registered installation evidence, GPS/IP evidence, and optional selfie.
- Home, attendance history, basic admin attendance view, and audit trail.
- Unit, API integration, and critical mobile UI tests.

Exit evidence: login -> schedule -> clock-in -> clock-out -> history works against real Go/MySQL services; repeated submissions return the original response.

Current evidence (2026-08-11): milestone-one behavior is **verified against the directly run local services**. MySQL 8 migration/seed, real Go/MySQL login → schedule → GPS clock-in/out → history on an API 36 AVD, private MinIO evidence, live Mailpit SMTP/STARTTLS delivery, admin production build, Android Hermes export, management UI automation, and clocking integration suites pass. The Compose v5 model also validates with required-secret interpolation; starting the same model remains a deployment-host smoke because this workstation has no Docker daemon.

## Milestone 2 — attendance depth

- Scheduled/unscheduled breaks, early/late rules, pending approval, corrections, auto clock-out, and work-more.
- Geofence, Wi-Fi evidence, and push notifications. Dynamic QR and the persisted attendance outbox with automatic reconnect retry are complete.

Exit evidence: policy matrix and state-machine test suites pass, including time boundaries and reconnect behavior.

Current incremental evidence: policy boundaries, pending approval, append-only corrections, manager roster projection, server auto clock-out, every advanced evidence mode, combined-mode resolution, and organization-isolated offline retry are implemented and automated. Push registration/outbox/provider injection pass; only live Firebase delivery remains external before the notification parity row can become Verified.

## Milestone 3 — workforce workflows

- Manager schedule planner, publish/unpublish, conflict checks, open shifts, and shift requests are complete.
- Timesheet roster, filters, CSV exports, and rounding.
- Leave and claims with attachments and approvals.
- Announcements and acknowledgments.

Exit evidence: employee and manager end-to-end suites pass for each workflow.

Current evidence: schedule publication/conflicts/open-shift requests, roster/timesheets/CSV, leave, private-receipt claims/OCR fallback, and scoped announcements/acknowledgments are all Verified in the parity matrix with live MySQL/MinIO and mobile/admin UI automation.

## Milestone 4 — high-assurance verification

- Face enrollment/liveness adapter and Play Integrity adapter.
- Risk policy, retention automation, operational dashboards, backup/restore rehearsal, and security review.

Exit evidence: provider sandbox tests, risk decisions, retention jobs, restore test, and threat-model review pass.

Current evidence: face-provider injection, deterministic device-integrity risk decisions, private-object retention cleanup, audit-boundary checks, and the security review pass locally. Play Integrity release decode, production backup/restore rehearsal, secret rotation, and external penetration review remain release-environment work.

## Delivery discipline

No milestone is complete while critical behavior is mocked. Each merge updates the parity matrix, API contract, migrations, and tests. Production deployment requires separate environment hardening and human approval.
