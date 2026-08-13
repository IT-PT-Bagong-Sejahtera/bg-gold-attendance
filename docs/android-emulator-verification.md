# Android emulator verification

Date: 2026-08-11  
Application: `com.bggold.attendance`  
AVD: `Medium_Phone_API_36.0`, Android API 36, `google_apis_playstore/x86_64`

## Environment

- A clean AVD data image was started without snapshots.
- The native debug APK was built with Gradle and installed through ADB. The build included the Kotlin `bg-gold-integrity` module and completed successfully.
- Metro served the React Native bundle through an ADB reverse tunnel.
- The app used a local Go API, isolated MySQL 8 data on port 3307, and local MinIO. The seeded account and organization were BG GOLD-only demo data.
- Emulator GPS was fixed to Jakarta coordinates before the attendance flow.

## Functional result

The following real client/API flow passed without mocks in the path and without React Native or Android runtime errors:

1. Launch and session restoration.
2. Email/password login against the Go API.
3. Foreground precise-location permission request.
4. Evidence preview reporting a location accuracy of approximately 5 m.
5. Clock-in submission and transition to `Sedang bekerja`.
6. Clock-out submission and transition to `Selesai`.
7. Attendance timeline rendering both immutable events.
8. Natural access-token expiry after 15 minutes, one rotating-refresh request for concurrent 401 responses, transparent retry with the new token, and continued authenticated Home rendering.
9. Schedule, attendance history, requests, and profile tabs continued loading from the real API after that refresh while Android font scale remained at 200%.
10. The completed Hari, Minggu, and Kalender schedule projections loaded their own API periods. The weekly agenda and full monthly grid remained readable at 200%, and calendar cells exposed full localized dates plus shift counts.
11. After refreshing against the updated `/me`, Home rendered `15.27` in `Asia/Jakarta` while the emulator status bar remained near `03.28`; this proves visible application time follows the organization rather than the device timezone at 200% font scale.

## Database-free demo path

The login screen exposes **Demo karyawan**, **Demo supervisor**, and **Demo 2 · Satu HP** roles for periods when MySQL/API infrastructure is unavailable. These are intentionally separate client-side sandboxes: their long-lived sessions use SecureStore, mutable workforce samples use AsyncStorage, demo uploads remain on-device, and the API client short-circuits before `fetch`. Demo 2 binds its simulated employee to the installation identifier after the first attendance. Normal account login and server-authoritative production behavior remain unchanged.

The standalone release APK was installed on the API 36 AVD while Metro, the Go API, and MySQL were stopped. In the employee role, Clock-in changed the local attendance state to `Sedang bekerja`; after force-stopping and reopening the app, both the demo session and working state were restored. In the supervisor role, the **Setujui** tab loaded four seeded requests (attendance, leave, claim, and shift), accepted approve/reject decisions, and preserved the reduced queue after restart.

The final regression used Android font scale `2.0` together with three-button navigation. The supervisor queue header, employee/status rows, and actions reflowed without overlap. The employee Requests and Profile screens kept the leave action, employee number, organization, role, and all five tabs within the viewport. Scrollable announcement and attendance modals remained operable above the protected system-navigation region.

The supervisor **Hasil absensi** view was then verified on the standalone release build. It loaded six demo employees, summarized present/late/absent counts, and rendered each employee's outlet, shift, clock-in, clock-out, duration, and status. **Export Excel** produced `Rekap-Absensi-BG-GOLD-2026-08-12.xlsx` and opened Android's native share sheet. The generated OOXML package is regression-tested for its workbook, styles, summary, all-employee detail sheet, and autofilter entries.

### Demo 2 · Satu HP

The final release APK was installed on the API 36 AVD with three-button navigation. Pressing **Clock in** opened Android's camera permission and then launched the camera immediately without an extra photo-button press. `dumpsys media.camera` reported the open camera as device `1` with `Facing: Front`. After capture and crop, the form showed the organization timestamp in `Asia/Jakarta`, required a name and photo, and allowed Flagship, Warehouse, or event location selection.

Submitting at Warehouse moved the organization-day state directly to `Selesai`, removed the Clock-in action, and showed that the next Clock-in is available tomorrow. The name, installation binding, and completed state survived force-stop/relaunch. The Go API also rejects a second accepted or pending Clock-in for the same user and organization-local day. Font scale `2.0` kept the content scrollable and the five compact navigation labels separated above the Android system-navigation area.

Demo evidence:

- [Final local-demo login](evidence/android-emulator-demo-login-final.png)
- [Final login accessibility tree](evidence/android-emulator-demo-login-final.xml)
- [Final local-demo Home](evidence/android-emulator-demo-home-final.png)
- [Final Home accessibility tree](evidence/android-emulator-demo-home-final.xml)
- [Persisted demo session after app restart](evidence/android-emulator-demo-restored.png)
- [Persisted attendance accessibility tree](evidence/android-emulator-demo-restored.xml)
- [Employee/supervisor demo choices at 200%](evidence/android-supervisor-login-options-200.png)
- [Supervisor approval queue at 200%](evidence/android-supervisor-final-fresh-200.png)
- [Supervisor approval accessibility tree](evidence/android-supervisor-final-fresh-200.xml)
- [Employee Requests after responsive fix at 200%](evidence/android-employee-requests-final-200.png)
- [Employee Requests accessibility tree](evidence/android-employee-requests-final-200.xml)
- [Employee Profile after responsive fix at 200%](evidence/android-employee-profile-final-200.png)
- [Employee Profile accessibility tree](evidence/android-employee-profile-final-200.xml)
- [Supervisor all-employee attendance report](evidence/android-supervisor-attendance-report.png)
- [Supervisor attendance report accessibility tree](evidence/android-supervisor-attendance-report.xml)
- [Native Android Excel share dialog](evidence/android-supervisor-excel-share-final.png)
- [Excel share dialog accessibility tree](evidence/android-supervisor-excel-share-final.xml)
- [Demo 2 rounded login cards](evidence/android-demo2-auto-login-scrolled.png)
- [Automatic front camera](evidence/android-demo2-auto-front-camera.png)
- [Photo, organization time, and location picker](evidence/android-demo2-auto-form-ready.png)
- [Completed once-per-day state](evidence/android-demo2-final-completed.png)
- [Demo 2 at 200% font scale](evidence/android-demo2-final-large-text.png)
- [Automatic camera accessibility tree](evidence/android-demo2-auto-front-camera.xml)
- [Completed state accessibility tree](evidence/android-demo2-final-completed.xml)

Evidence:

- [Login screen](evidence/android-emulator-login.png)
- [Login accessibility tree](evidence/android-emulator-login-accessibility.xml)
- [Home after responsive-header fix](evidence/android-emulator-home-fixed2.png)
- [Home accessibility tree](evidence/android-emulator-home-fixed2-accessibility.xml)
- [Attendance evidence preview](evidence/android-emulator-clock-preview.png)
- [Attendance preview accessibility tree](evidence/android-emulator-clock-preview-accessibility.xml)
- [Clock-in result](evidence/android-emulator-clock-in-result.png)
- [Clock-out result](evidence/android-emulator-clock-out-result.png)
- [Clock-out result accessibility tree](evidence/android-emulator-clock-out-result-accessibility.xml)
- [UI after expired-session refresh](evidence/android-emulator-expired-session-refresh.xml)
- [Schedule after expired-session refresh](evidence/android-emulator-schedule-after-refresh.xml)
- [Weekly schedule at 200%](evidence/android-emulator-schedule-week-font-200.png)
- [Weekly schedule accessibility tree](evidence/android-emulator-schedule-week-font-200-accessibility.xml)
- [Calendar schedule at 200%](evidence/android-emulator-schedule-calendar-font-200.png)
- [Calendar schedule accessibility tree](evidence/android-emulator-schedule-calendar-font-200-accessibility.xml)
- [Daily schedule at 200%](evidence/android-emulator-schedule-day-font-200.png)
- [Daily schedule accessibility tree](evidence/android-emulator-schedule-day-font-200-accessibility.xml)
- [Organization-timezone rendering at 200%](evidence/android-emulator-organization-timezone-font-200.png)
- [Organization-timezone accessibility tree](evidence/android-emulator-organization-timezone-font-200-accessibility.xml)
- [Final post-build/install regression tree](evidence/android-emulator-final-regression.xml)
- [Final post-build/install screenshot](evidence/android-emulator-final-regression.png)

## Accessibility result

- Android font scale was set to `2.0`. Home, Schedule, Attendance, Requests, and Profile remained readable and scrollable, with their primary controls available.
- TalkBack was enabled and reported as a bound service with spoken, haptic, and audible feedback types.
- Keyboard/TalkBack focus traversed in a predictable order: `Home` → `Jadwal` → `Kehadiran` → `Permintaan` → `Profil` → `Clock in`.
- Pressing Enter on the focused attendance action opened the evidence preview. The preview exposed named selfie, submit, and cancel controls and could be cancelled by keyboard.
- The avatar initial is decorative and is removed from the accessibility tree. Every tab now has an explicit label so icon glyphs are not announced.
- At 200% font scale, visible tab names use the compact labels `Hadir` and `Ajuan`; their accessible names remain `Kehadiran` and `Permintaan`.

Evidence:

- [200% font scale after fixes](evidence/android-emulator-font-200-fixed.png)
- [200% accessibility tree](evidence/android-emulator-font-200-fixed-accessibility.xml)
- [TalkBack focus tree](evidence/android-emulator-talkback-app-focus.xml)
- [TalkBack keyboard activation](evidence/android-emulator-talkback-keyboard-activation.xml)
- [Profile at 200% after responsive-avatar fix](evidence/android-emulator-profile-font-200-fixed.png)
- [Profile accessibility tree at 200%](evidence/android-emulator-profile-font-200-fixed-accessibility.xml)

## Issues found and fixed

- The long administrator greeting allowed the header row to grow beyond the viewport and clipped the avatar. The header now has an explicit responsive width, shrinkable copy, and a fixed avatar.
- The Home and Profile avatar initials used dark text on an espresso background. They now use champagne-gold text, keep a fixed footprint during reflow, and are hidden from assistive-technology focus as decorative content.
- Bottom-tab labels overflowed at 200% font scale. Compact visible labels were introduced while full semantic labels were preserved.
- Three bottom tabs exposed decorative icon glyphs to TalkBack. All five tabs now have explicit accessible names.
- The mobile client refreshed only during application startup, so an access token that expired while the app remained open produced a false session error. Authenticated requests now coordinate one rotating refresh, persist the replacement pair, and retry once; multipart evidence uploads use the same path. The emulator reproduced the original expiry and then passed with one refresh for concurrent requests.
- The fixed-height bottom tab bar could overlap Android system navigation on edge-to-edge devices. Its height and bottom padding now include the runtime safe-area inset, and the Android theme requests dark system-navigation icons on the light BG GOLD background. It was verified with both gesture navigation and three-button navigation; in three-button mode the application tabs end at pixel `2248`, exactly where the protected system-navigation area begins.
- Fixed-height modal content and horizontal request/profile rows could clip actions or values at large text sizes. The affected content now scrolls or reflows vertically, uses minimum rather than fixed control heights, and allows long values and action groups to wrap. The supervisor approval cards use the same responsive rules.

Safe-area evidence:

- [Gesture-navigation result](evidence/android-emulator-safe-area-gesture.png)
- [Three-button navigation result](evidence/android-emulator-safe-area-three-button-final.png)
- [Three-button accessibility tree](evidence/android-emulator-safe-area-three-button-final.xml)

## Remaining external sign-off

- FCM delivery still requires the BG GOLD Firebase configuration and service-account credentials. This AVD includes Google Play services and can be used once those files are supplied; see [Firebase's Android FCM setup](https://firebase.google.com/docs/cloud-messaging/android/get-started).
- Play Integrity still requires the package and signing certificate to be recognized by Google Play, a linked cloud project, and server decode credentials. The sideloaded local debug build is not release-verdict evidence; see [Google's Play Integrity setup and verdict requirements](https://developer.android.com/google/play/integrity/setup).
- iOS VoiceOver and human review of spoken order/pronunciation require an iOS device or macOS simulator environment.
- Chrome/Firefox keyboard-only traversal and 200% browser zoom remain separate admin-web release checks.
