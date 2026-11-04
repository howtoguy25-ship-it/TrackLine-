# TrackLine brand mark -- editable sources

Real, editable vector sources for the app icon/logo -- open either file in any SVG editor
(Figma, Illustrator, Inkscape, or just a text editor since the paths are hand-written and
short) to tweak colors, the pin shape, or the route-and-dot mark.

- **icon.svg** -- the full App Store icon: the blue gradient background + white pin + route
  mark, full-bleed 1024x1024, no transparency. This is the source for `assets/icon.png`.
  App Store/the OS applies its own corner rounding, so this stays a plain square.
- **icon-foreground.svg** -- just the pin + route mark, white/blue, on a transparent
  background, scaled down and centered to sit inside Android's adaptive-icon safe zone
  (launchers crop this into a circle/squircle/rounded square, and anything near the edges of
  a full 1024x1024 canvas gets clipped). This is the source for both
  `assets/adaptive-icon.png` (rendered by Android over `app.config.js`'s
  `android.adaptiveIcon.backgroundColor`, `#0B1220`) and `assets/logo-transparent.png` (the
  splash screen image, same backgroundColor).

## Colors used

- Background gradient: `#3B82F6` -> `#1240B0` (close to the app's own accent blue,
  `colors.accent` in `src/theme/tokens.ts`, `#1D4ED8`)
- Pin fill: white (`#FFFFFF`, with a very faint gradient to `#EAF1FF` for depth)
- Route mark: `#1240B0` (icon.svg) / `#1D4ED8` (icon-foreground.svg) -- same family as the
  background so it reads as a genuine cutout rather than a sticker

## Re-exporting after an edit

After editing either SVG, re-export it to PNG at exactly 1024x1024 and overwrite the matching
file in `assets/` (`icon.png` for icon.svg; `adaptive-icon.png` AND `logo-transparent.png`,
both from icon-foreground.svg -- they're the same artwork, just referenced by two different
config fields). `icon.png` must stay fully opaque (no alpha channel) -- App Store rejects an
icon with transparency.
