# Admin browser verification

Date: 2026-08-11  
Application: BG GOLD Attendance admin web  
Runtime: Vite development build backed by the real local Go API and MySQL demo data

## Scope

The authenticated dashboard was rendered in the Codex in-app Chromium browser. The pass covered semantic structure, keyboard focus styling, narrow-screen reflow, effective target size, and a CSS-viewport equivalent of 200% desktop zoom.

## Results

- The demo owner session authenticated against the real API and loaded all operational dashboard regions without an alert.
- The DOM exposes a named primary navigation, one page-level heading, named regions, labeled form controls, and native links, buttons, inputs, selects, and textareas.
- The first 40 focusable controls follow document order with no positive `tabindex`. Navigation begins `Ringkasan` → `Karyawan` → `Jadwal` → `Lokasi kerja` → `Kebijakan` → `Keluar`.
- Twelve sampled links/buttons received a visible `3px solid rgb(121, 93, 37)` keyboard outline with a `3px` offset and were scrolled fully into view.
- At a 320×900 CSS-pixel viewport, 43 enabled controls remained within the viewport, every effective target was at least 44×44 px, and document `scrollWidth` matched `clientWidth`.
- At a 640×450 CSS-pixel viewport—layout-equivalent to a 1280×900 display at 200% browser zoom—44 enabled controls remained in bounds, every effective target was at least 44×44 px, and there was no document-level horizontal overflow.
- The production admin bundle, TypeScript build, and the three-test Vitest/axe suite pass after the fixes.

Checkbox/radio size is measured using the associated label because the label is the effective pointer/touch target. Native horizontal scrolling inside the seven-day planner remains intentional and does not create document-level overflow.

## Evidence

- [320 px reflow after the fix](evidence/admin-browser-320-fixed.png)
- [640 px layout-equivalent 200% zoom pass](evidence/admin-browser-640-zoom-equivalent.png)
- Automated semantic checks: `apps/admin/src/App.test.tsx`
- Responsive/focus implementation: `apps/admin/src/styles.css`

## Issues found and fixed

- `body` had `min-width: 320px`. With a vertical scrollbar, the content stayed 320 px wide while the available client width became 305 px, producing a 15 px horizontal scrollbar. The fixed minimum was removed.
- Short text buttons such as `Koreksi`, `Tarik`, and weekly arrow controls could be narrower than the project's 44 px target. Links and buttons now have a 44 px minimum width.
- The visual checkbox was 16 px and its label did not reserve a 44 px effective target. Direct checkbox/radio labels now have a 44 px minimum height while retaining the compact visual control.

## Remaining human/platform sign-off

- A human still needs to perform uninterrupted physical Tab/Shift+Tab/Enter/Escape traversal in release Chrome and Firefox, including modal focus return and download controls.
- Actual browser UI zoom at 200% must be confirmed in release Chrome and Firefox. The 640 px pass proves the same CSS reflow breakpoint and target geometry, but it is not a substitute for browser-specific zoom behavior.
- High-contrast/forced-colors behavior remains a separate platform check.
