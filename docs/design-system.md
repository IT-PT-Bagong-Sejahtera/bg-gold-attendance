# BG GOLD Design System

## Brand source and assumptions

The existing BG GOLD oval mark in the workspace is the brand source. It combines serif lettering, deep brown, and metallic gold. The product UI translates that identity into restrained digital tokens; it does not reproduce textured metallic effects across controls.

## Color tokens

- `ivory-50 #FBF8F1`: application background.
- `ivory-100 #F3EDE1`: secondary surfaces.
- `espresso-950 #24120E`: primary text and dark navigation.
- `espresso-800 #4A2118`: brand-rich surface.
- `gold-500 #C99A2E`: primary accent and focus ring.
- `gold-300 #E4C56F`: subtle highlights.
- `emerald-700 #176B52`: approved/success.
- `ruby-700 #9A3E46`: rejected/destructive.
- `ink-500 #746B64`: secondary text.
- `line-200 #DED5C7`: borders and dividers.

Gold is limited to primary actions, selected states, and small emphasis. Body text remains dark for contrast.

## Typography

- Display and selected headings: a refined serif compatible with the existing mark.
- UI headings and body: a neutral sans-serif with excellent small-size rendering.
- Numeric attendance time: tabular numerals.

Use no more than three text weights on a screen. Labels are sentence case; avoid all caps except compact metadata.

## Shape and motion

- Control radius: 10px; compact fields: 8px; large status panel: 16px.
- Touch target: at least 44x44.
- Borders replace shadows for most grouping. Elevated overlays use a single soft shadow.
- Motion lasts 160–240ms, communicates state, and respects reduced-motion settings.

## Anti-template rules

- One primary action per task region.
- Do not wrap every section in a card.
- Avoid decorative gradients, glass effects, oversized dashboard numbers, generic motivational copy, and emoji icons.
- Empty states explain what is absent and the next legitimate action.
- Error copy names the problem and recovery without blaming the user.
