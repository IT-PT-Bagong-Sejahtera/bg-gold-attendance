# Loading, empty, and error state audit

The review covers every employee-mobile route and every admin dashboard region. States keep the last valid data during background refresh; first-load placeholders reserve vertical space so content does not jump.

## Mobile

| Surface | Loading | Empty | Error and recovery |
| --- | --- | --- | --- |
| Session/login | Button changes to “Memeriksa akun…” and becomes disabled | Not applicable | Inline, announced error; form values remain and submit is immediately available |
| Home | Three stable attendance placeholder rows | Explains that clock events will appear after clock-in/out | Announced inline message, pull-to-refresh, and explicit “Coba lagi” |
| Attendance | Three stable history placeholder rows | Explains that records are grouped here after attendance | Announced inline message, pull-to-refresh, and explicit “Coba lagi” |
| Schedule | Three stable schedule placeholder rows | Explains that an administrator must publish a shift | Announced inline message, pull-to-refresh, and explicit “Coba lagi” |
| Requests/leave/claims | Stable request placeholder rows | Explains which approval-required clocking appears here; leave/claim sections remain usable | Announced inline message, pull-to-refresh, and explicit “Coba lagi” |
| Profile/organization | Two stable identity placeholder rows | Not applicable for an authenticated membership | Announced inline message and explicit “Coba lagi” |

## Admin web

| Surface | Loading | Empty | Error and recovery |
| --- | --- | --- | --- |
| Session restore | Branded launch state with live-region copy | Not applicable | Invalid/expired session returns to login through the auth boundary |
| Daily activity | Contextual “Memuat aktivitas…” state | Explains where clock-in/out appears | Dashboard-wide alert reports the number of failed data regions |
| Employees, shifts, locations, policies | Three fixed-height placeholder rows per resource | Separate truthful message for each resource type | Failed queries remain isolated; “Coba lagi” refetches only failed regions |
| Attendance, timesheets, audit, approval queues | Contextual loading copy without destructive clearing | Domain-specific copy: no activity, no complete session, no audit, or all reviewed | Local action errors remain beside their initiating form; query failure uses dashboard retry |
| CSV reports and mutation forms | Button copy reflects the active operation and controls disable during submission | Not applicable | Inline alert retains entered values and permits retry |

## Interaction rules

- Background refresh never replaces valid content with a blank loading screen.
- A failed request does not masquerade as an empty collection.
- Empty-state copy states what is absent and, when applicable, who or what creates it.
- Blocking dialogs are reserved for evidence confirmation, compulsory announcements, and camera/QR capture.
- Retry actions are at least 44 px/dp and retain the current route and user input.
- Error and status messages are exposed to assistive technology.

## Automated evidence

- Mobile schedule tests hold the API promise open and verify the reserved loading state, then simulate a failed request and successful inline retry.
- Existing mobile tests cover empty attendance, schedule, request, and home projections through mocked empty API collections.
- Admin tests force one resource query to fail, verify the aggregated alert, retry only the failed query, and continue the employee workflow.
- Admin axe checks cover login and the fully populated authenticated dashboard after the state changes.
