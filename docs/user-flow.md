# User Flow

## Roles

- **Owner**: organization-wide configuration, billing-independent system ownership, and complete reports.
- **Admin**: people, locations, schedules, policies, and corrections.
- **HR**: employee records, attendance, leave, claims, and reports.
- **Supervisor**: assigned locations, schedules, requests, and daily attendance.
- **Employee**: own schedule, attendance actions, requests, history, and profile.

## Navigation

The mobile navigation uses five stable destinations: Home, Schedule, Attendance, Requests, and Profile. Administrative operations live in the web app so employee navigation remains focused.

## Authentication and session restoration

1. Launch shows the BG GOLD mark and a short session check.
2. A valid access token opens Home.
3. An expired access token is refreshed once using the rotating refresh token.
4. Refresh failure clears local credentials and returns to Login with a neutral explanation.
5. Multi-organization users select an organization after login; the last valid selection is restored on later launches.

States:

- Loading: branded, quiet session skeleton.
- Empty: no active organization membership; contact HR action.
- Error: retry network action or return to login.

## Home

Home prioritizes the current work state rather than generic metrics:

1. Greeting, date and time in the selected organization's timezone, and selected organization.
2. Today's shift with location and role.
3. Current attendance state: Not started, Working, On break, Completed, or Pending approval.

New employees receive an email invitation and remain in `INVITED` state until they create their first password. Administrators can edit profile fields and organization roles; role changes revoke active organization sessions so stale permissions cannot continue.
4. One prominent contextual action.
5. Requests needing attention and important announcements.

When there is no shift, the policy determines whether the employee may submit an unscheduled clock request.

## Clock-in

1. Employee selects **Clock in**.
2. Mobile loads the resolved policy: employee override, then location policy, then organization default.
3. Required permissions are requested in context.
4. The app registers its encrypted stable installation ID, then collects required evidence: device UUID, location, QR, Wi-Fi, selfie/face result, and device integrity.
5. A concise preview displays time, location, shift, and collected evidence.
6. Submission includes an idempotency key; device time is informational only.
7. Backend evaluates membership, shift, server time, current state, policy, and evidence in a transaction.
8. Result is Approved, Pending approval, or Rejected with a stable reason code and human message.
9. Home and Attendance refresh from the server result.

Recovery behavior:

- Permission denied: explain why it is needed and offer Settings only when mandatory.
- Location unavailable: retry with accuracy feedback; ANYWHERE may continue if policy permits. Device registration does not depend on location or notification permission.
- Network loss: queue an encrypted retry containing the original idempotency key.
- Duplicate tap/retry: return the original response.
- Selfie upload failure: retry upload before attendance submission.

## Clock-out

The flow mirrors clock-in. Clocking out before the scheduled end requires confirmation and may require a reason or manager approval. Completed attendance remains immutable; later changes are correction requests.

## Breaks and work-more

- A working employee can start a scheduled break inside its allowed range.
- Unscheduled breaks follow the organization policy.
- Timesheets preserve the actual break duration and show a separate policy-rounded value used to calculate net work time.
- Break end restores the Working state.
- Work-more is available after clock-out, captures a reason, and may create a pending request.

## Schedule

- Employee: switches between three real published-shift projections. **Hari** shows one selected date, **Minggu** groups the Monday–Sunday period, and **Kalender** shows the complete month with per-date shift counts and an agenda for the selected date.
- Previous/next controls move exactly one day, week, or month and request the matching API range; `Kembali ke hari ini` restores the current period.
- Calendar grouping and API boundaries use the selected organization's timezone, never the phone or browser timezone. The same rule applies to attendance history, approvals, audit records, shift creation, and correction forms.
- Each view has a period-specific empty state. Open shifts remain available beneath the selected period and retain their pending-request state.
- Supervisor: create or copy draft shifts, detect conflicts, assign employees, and publish.
- Empty state: explain that no published shifts exist for the selected range.
- Conflict state: identify the employee, conflicting period, and available resolution.

## Requests

Requests are grouped by Clocking, Shift, Leave, Claim, and Correction. Each request has a visible state machine and audit timeline. Approval screens show the evidence needed for a decision, not unrelated profile information.

For leave, an employee sees the available, pending, and used balance, selects a leave type and date range, supplies a reason, and can withdraw while the request is pending. Weekends are excluded from the requested total. Managers receive a dedicated queue showing the employee, leave type, date range, total workdays, and reason; rejection requires a written explanation. Admins maintain leave types and yearly entitlements from the same operational workspace.

For claims, an employee selects a category, enters a title, amount, transaction date, and short context, then photographs the receipt when required. The UI explicitly says when OCR is unavailable and asks the employee to confirm the amount manually. A pending claim can be withdrawn. Reviewers see the employee, amount, date, category, notes, and a short-lived private receipt link; rejection requires a written reason. Admins maintain claim categories and whether a receipt is compulsory.

For announcements, the author chooses priority, audience, and whether acknowledgment is compulsory before publishing. Eligible employees receive an inbox item and push attempt. A compulsory announcement opens as a blocking, accessible card on Home and remains until the employee confirms it. Read and acknowledgment are separate server states; notification badge count falls only after the inbox item is marked read.

## Attendance history

Employees see server-confirmed events grouped by day. Managers can filter by location, employee, status, and date. A correction creates a new linked record; it never overwrites the original event.
