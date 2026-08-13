# Accessibility audit

Scope: BG GOLD employee mobile application and admin web application. Target: WCAG 2.2 AA, with a project-wide minimum 44×44 px/dp interactive target.

## Evidence completed

- Admin login and authenticated dashboard pass `axe-core` with no critical or serious semantic violations. The jsdom-incompatible pixel contrast rule is disabled in that test and contrast is checked from the design tokens below.
- Mobile tests resolve the primary attendance action by accessible role/name, verify disabled/busy state, and verify the selected state of request categories.
- Admin keyboard focus uses a persistent 3 px `#795D25` outline. Browser motion is disabled under `prefers-reduced-motion`.
- Mobile modal motion follows the operating-system Reduce Motion preference.
- Mobile asynchronous success and failure messages use polite or assertive live regions.
- Android API 36 emulator verification now covers a real login and GPS-backed clock-in/out flow, TalkBack binding, keyboard focus traversal/activation, and 200% font scaling. Screenshots and accessibility trees are indexed in `docs/android-emulator-verification.md`.
- Authenticated admin rendering now covers desktop focus visibility, 320 px reflow, effective 44×44 px targets, and a 640 px layout-equivalent 200% zoom pass. Measurements and screenshots are indexed in `docs/admin-browser-verification.md`.
- Mobile schedule verification at 200% covers named/selected Hari, Minggu, and Kalender tabs; 44 dp period controls; a reflowing weekly agenda; and calendar cells named with full dates and shift counts.

## Contrast evidence

| Foreground | Background | Ratio | Usage | Result |
| --- | --- | ---: | --- | --- |
| `#24120E` | `#FBF8F1` | 17.0:1 | Primary text | Pass |
| `#746B64` | `#FBF8F1` | 4.91:1 | Secondary text | Pass |
| `#8A6C2D` | `#FBF8F1` | 4.64:1 | Eyebrow text | Pass |
| `#795D25` | `#FFFDF8` | 6.07:1 | Focus indicator | Pass |
| `#9A3E46` | `#FBEFEF` | 5.93:1 | Error text/icon | Pass |
| `#176B52` | `#EAF4EE` | 5.72:1 | Success text/icon | Pass |

`#C99A2E` on ivory is 2.43:1 and therefore remains decorative only. Meaningful text and focus indicators use the darker gold-brown token.

## Findings and remediation

### A11Y-01 — Mobile controls lacked programmatic names

- Severity: Major
- Principle: Robust
- WCAG: 4.1.2 Name, Role, Value
- Affected: attendance selfie, QR scan, submit/cancel, scanner close, and the main clock action
- Reproduction: navigate with TalkBack/VoiceOver and focus each control; the earlier implementation exposed several generic touch targets.
- Impact: a screen-reader user could not reliably identify the action before activating it.
- Remediation: explicit button roles, localized labels, disabled/busy state, and selected state were added.
- Status: Resolved and automated.

### A11Y-02 — Inconsistent keyboard focus visibility

- Severity: Major
- Principle: Operable
- WCAG: 2.4.7 Focus Visible and 2.4.11 Focus Not Obscured (Minimum)
- Affected: admin navigation, table actions, buttons, links, and form controls
- Reproduction: use Tab from the login screen through the authenticated dashboard.
- Impact: keyboard users could lose their current position.
- Remediation: a high-contrast, offset `:focus-visible` outline now covers every interactive control.
- Status: Resolved in the Chromium renderer; final human Chrome/Firefox traversal remains in the release checklist.

### A11Y-03 — Small interactive targets

- Severity: Minor
- Principle: Operable
- WCAG: 2.5.8 Target Size (Minimum)
- Affected: mobile schedule/request choices and admin week navigation/compact actions
- Reproduction: inspect the rendered target box at the smallest supported viewport.
- Impact: users with reduced dexterity had a higher chance of activating the wrong action.
- Remediation: interactive controls now use at least 44 px/dp height; fixed heights were changed to minimum heights so font scaling can expand them.
- Status: Resolved and verified in the Android AVD and rendered admin dashboard. The admin 320 px audit found and fixed narrow text buttons and compact checkbox-label targets.

### A11Y-04 — Motion preference was ignored by mobile modals

- Severity: Minor
- Principle: Operable
- WCAG: 2.3.3 Animation from Interactions
- Affected: required-announcement, attendance confirmation, and QR scanner modals
- Reproduction: enable Reduce Motion at OS level and open any affected modal.
- Impact: avoidable sliding/fading motion remained visible to motion-sensitive users.
- Remediation: the mobile client subscribes to `AccessibilityInfo.reduceMotionChanged` and replaces modal transitions with `none`.
- Status: Resolved and automated at the preference hook.

### A11Y-05 — Asynchronous feedback was not announced consistently

- Severity: Major
- Principle: Robust
- WCAG: 4.1.3 Status Messages
- Affected: mobile home, attendance, schedule, and request errors/notices
- Reproduction: submit an invalid or successful action while screen-reader focus remains on the initiating control.
- Impact: the state could change without a non-visual indication.
- Remediation: errors use assertive live regions; non-blocking success messages use polite live regions.
- Status: Resolved; final device announcement timing remains in the release checklist.

### A11Y-06 — Header/profile reflow and avatar contrast

- Severity: Major
- Principle: Perceivable and Operable
- WCAG: 1.4.3 Contrast (Minimum) and 1.4.10 Reflow
- Affected: mobile Home header and Profile identity row with a long employee name
- Reproduction: render the seeded `Administrator` account on the API 36 phone AVD.
- Impact: the avatar was partially outside the viewport, and its dark initial had insufficient contrast on the espresso background.
- Remediation: constrain the Home header width, allow both copy columns to shrink, keep both avatars fixed, use champagne-gold avatar text, and remove the decorative initial from assistive-technology focus.
- Status: Resolved and verified on the Android emulator at 100% and 200% font scale.

### A11Y-07 — Bottom navigation overflow and decorative glyph announcements

- Severity: Major
- Principle: Perceivable and Robust
- WCAG: 1.4.10 Reflow and 4.1.2 Name, Role, Value
- Affected: mobile bottom navigation
- Reproduction: enable Android font scale 2.0 and traverse the tabs with TalkBack/keyboard.
- Impact: `Kehadiran` and `Permintaan` were visually truncated, while three other tabs announced a private-use icon glyph before their label.
- Remediation: compact visible labels (`Hadir`, `Ajuan`) preserve space at 200%, while explicit full accessibility labels remove decorative glyphs from all five tab announcements.
- Status: Resolved and verified in the API 36 AVD. Focus order is `Home`, `Jadwal`, `Kehadiran`, `Permintaan`, `Profil`, then the primary screen action.

### A11Y-08 — Admin document overflow and undersized compact actions

- Severity: Major
- Principle: Perceivable and Operable
- WCAG: 1.4.10 Reflow and 2.5.8 Target Size (Minimum); project target is 44×44 px
- Affected: admin dashboard at 320 px, compact record/week/shift actions, and checkbox labels
- Reproduction: render the authenticated dashboard at 320×900 CSS pixels and compare `documentElement.scrollWidth` with `clientWidth`; inspect effective control rectangles.
- Impact: a 15 px document-level horizontal scrollbar required two-dimensional scrolling, and several short actions offered only 29–38 px of horizontal target area.
- Remediation: remove the fixed body minimum width, give links/buttons a 44 px minimum width, and reserve 44 px on direct checkbox/radio labels.
- Status: Resolved and browser-verified. At 320 px and the 640 px layout-equivalent zoom viewport there is no document overflow, no out-of-bounds control, and no effective target below 44×44 px.

## Manual release checklist

These checks require real platform accessibility services and are deliberately not reported as completed by jsdom/Jest:

1. Physical Android TalkBack: required announcement, dynamic QR, leave, and claim flows, plus human confirmation of spoken order and pronunciation. Emulator login and GPS-backed clock in/out are complete.
2. iOS VoiceOver: the same flows, including modal focus entry/return and rotor headings.
3. Admin Chrome and Firefox: human keyboard-only traversal at 320 px and desktop widths, including activation and modal focus return. Chromium-rendered order and focus visibility are complete.
4. Browser zoom at 200%, checking browser-specific reflow and absence of clipped controls. The admin 640 px CSS-layout equivalent and all five Android mobile tabs have passed; actual Chrome/Firefox UI zoom remains.
5. Light/dark/high-contrast OS modes where supported; BG GOLD currently ships a controlled light palette.

Until the remaining physical/human, iOS, and browser checklist is signed off, the parity matrix remains **Implemented**, not **Verified**.
