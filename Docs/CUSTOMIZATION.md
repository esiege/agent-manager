# Customization: every way the app can look

How much of the app's look a user can change. It covers the site-wide color
settings: color themes, light / dark, header tone, and the hidden custom-color
palette.

> **Status: not built yet.** This was copied from another project on Nov 13,
> 2026 and cut down to the parts that apply to Agent Manager Deluxe. It is the
> target design. The file paths, the `gma:` storage keys and the Tailwind
> class names are the source project's and will change when this is built here
> (this app uses Mantine, and its web code is under `web/`).

---

## 1. The short version

| Axis | Choices | Where it's picked | Kept |
|---|---|---|---|
| Color theme | 6 (Gold, Emerald, Sapphire, Ruby, Amethyst, Slate) | The dot on the header's light / dark switch | Per browser |
| Custom colors per theme | 64 primary × 64 secondary for each of the 6 slots | Press and hold a swatch on the color wheel | Per browser |
| Light / dark | 2 (first visit follows the OS setting) | The header's sun / moon switch | Per browser |
| Header tone | 2 (dark header or light header), apart from the page's mode | The small window in the middle of the color wheel | Per browser |

Counting only the built-in site settings, that's 6 themes × 2 modes × 2 header
tones = **24 site looks** before any custom colors.

---

## 2. How color works under the hood

Everything colored in the app comes from a handful of numbers on `<html>`.
Source: [src/config/siteThemes.ts](../src/config/siteThemes.ts),
[src/hooks/useSiteTheme.ts](../src/hooks/useSiteTheme.ts),
[src/index.css](../src/index.css).

A color theme is eight numbers, written to `<html>` as CSS custom properties:

| Variable | What it drives |
|---|---|
| `--hs` / `--ss` | Surface hue / saturation: the page background, cards, borders, muted text (the shadcn tokens `--background`, `--card`, `--muted`, `--border`…) |
| `--ha` / `--sa` | Accent hue / saturation: `--primary`, `--ring` |
| `--brand-h` / `--brand-s` | The **brand** ramp (the "gold" in the default theme) |
| `--brand2-h` / `--brand2-s` | The **brand2** ramp (deep bronze in the default theme) |

From those, `index.css` builds two 11-step ramps (`--brand-50` … `--brand-950`,
`--brand2-50` … `--brand2-950`) with fixed lightness steps, used through
Tailwind as `text-brand-400`, `bg-brand2-600/20` and so on, and directly as
`hsl(var(--brand-400))` in SVG fills.

**The house rule for art:** every drawing, ornament and screen style uses only
the brand and brand2 ramps plus black and white. A style may desaturate or
darken a ramp with `calc()`, but it never hardcodes a hex color. That is why
one theme pick re-tints every screen at once, including all the SVG art.
Components that need a hex string (a canvas, a library that appends an alpha to
a hex) use `useThemeRampHex` ([src/hooks/useThemeRampHex.ts](../src/hooks/useThemeRampHex.ts))
so they follow the theme too.

**No flash on load.** An inline script in [index.html](../index.html) reads the
saved theme, mode and custom colors and applies them before the first paint.
It keeps its own copy of the six themes' numbers, so a change to
`SITE_THEMES` must be made in both places.

**Tabs stay in sync.** All of this is an external store; changing the theme in
one tab updates every other open tab through the `storage` event.

---

## 3. The six color themes

Each theme is a primary and secondary color, shown as a split swatch (primary
top-left, secondary bottom-right).

| Theme | Primary (brand) | Secondary (brand2) | Surface |
|---|---|---|---|
| **Gold** (default) | Gold | Deep bronze | Warm parchment |
| **Emerald** | Green | Old gold | Green-tinted |
| **Sapphire** | Blue | Teal | Blue-tinted |
| **Ruby** | Red | Orange | Red-tinted |
| **Amethyst** | Violet | Magenta | Violet-tinted |
| **Slate** | Gray-blue | Gray-teal | Nearly neutral gray |

Unknown or missing saved values fall back to Gold.

---

## 4. Light and dark mode

- The first visit follows the operating system (`prefers-color-scheme`); after
  that the pick is saved (`theme-preference`).
- Dark mode is the `.dark` class on `<html>`. Every surface token is written as
  `hue calc(sat * k%) L%`, so light and dark are both tinted from the same four
  theme numbers: dark mode in Ruby is a red-black, in Emerald a green-black.
- Light / dark and the color theme are independent: any theme in either mode.

### The switch

In the header, top right on desktop; on phones it sits in the menu sheet under
the logo, on a "Light / dark" row. Source: [src/components/ThemeToggle.tsx](../src/components/ThemeToggle.tsx).

```
 ☀  [ ●──── ]  ☾
```

- **Sun** sets light, **moon** sets dark.
- **Clicking the gray track** flips between them.
- **The dot** slides to the side for the current mode, and it is painted in the
  current theme's split swatch. It isn't just the switch's knob: clicking it
  opens the color wheel (§5). That's the only hint the wheel exists.

---

## 5. The hidden palette: the color wheel and custom colors

The color theme picker has no label or menu entry. It lives inside the knob of
the light / dark switch, and its custom-color editor is behind a press and
hold. Both are one control.

### 5.1 Opening the wheel

Click the dot on the light / dark switch (not the track around it). A round
disc drops down under the header, with a little pointer at its top aimed at the
dot. On it:

- **Six swatches in a ring**, one per theme, each split diagonally into its
  primary and secondary colors. They pop in one after another (30 ms apart),
  starting at the top and going clockwise. The active theme has a ring around
  it. Hovering a swatch grows it.
- **A tiny window in the middle**: a miniature app window whose top bar is the
  header, with two dots in the theme's colors and a sun or moon. This is the
  header tone switch (§5.4).

Clicking anywhere outside the wheel closes it.

### 5.2 Click or hold

Each swatch does two things depending on how long it's pressed:

| Gesture | What happens |
|---|---|
| **Click** (a short press) | Switches the site to that theme and closes the wheel |
| **Press and hold for 450 ms** | Opens the color editor for that swatch's slot; the wheel shrinks away and the editor takes its place |

Details that make the hold work on every device:

- The hold timer starts on pointer down (mouse, pen or finger) and is cancelled
  if the pointer lifts, leaves the swatch, or the browser cancels the touch.
  Dragging off the swatch is a way to back out of a hold.
- Once the hold fires, the click that follows on release is swallowed, so a
  hold never also switches themes.
- The swatch has `touch-action: none` and blocks the context menu, so a long
  press on a phone opens the editor instead of the browser's own long-press
  menu or a scroll.
- Each swatch's tooltip says "click to use, hold to customise", the only
  place the hold is mentioned.

### 5.3 The color editor

The editor is a small panel (268 px wide) where the wheel was, titled
"Customise <Theme>". Top to bottom:

1. **Primary / Secondary tabs.** A two-way switch, each half showing a dot of
   that slot's current color. Primary is selected when the editor opens.
2. **A 64-color grid**, 8 × 8. Columns are eight hues (red 4°, orange 30°,
   yellow 48°, lime 92°, green 150°, cyan 190°, blue 220°, magenta 300°); rows
   are eight saturations from gray-ish (16%) at the top to vivid (98%) at the
   bottom, all at the same middle lightness. The cell matching the current
   color is ringed. **One click on a cell sets the color**: there's no
   separate picker and no Apply step, the grid is both the palette and the
   picker.
3. **A footer**: a split-swatch preview of the slot as it now stands, a
   **Reset** button (circular arrow, back to the built-in colors, grayed out
   when the slot has no custom colors), and **Use theme**, which switches the
   site to this slot and closes everything.
4. **An X** in the corner goes back to the wheel without closing it.

What a cell click changes:

| Tab | Sets | Also derives |
|---|---|---|
| **Primary** | The brand ramp's hue and saturation | The surface and accent channels: same hue, accent at 0.7× the saturation, surface at 0.5× (each clamped), so the page background, cards, borders and focus rings all move to the new color, not just the gold accents |
| **Secondary** | The brand2 ramp's hue and saturation | Nothing else |

So Primary re-tints the whole app (surfaces and the main accent), and
Secondary only changes the second accent.

**Live preview.** If the slot being edited is the active theme, every click
re-colors the whole app behind the editor at once. If it isn't, only the
editor's preview and the wheel swatch change until Use theme is pressed.

**Slots, not new themes.** Custom colors replace a slot's colors; they don't
add a seventh theme. All six slots can be customized, so a user can keep six
color pairs of their own. The wheel swatch, the knob on the switch and the
header window's dots all show the custom colors. Overrides are saved per
browser (`gma:themeOverrides`, one `{hue, sat}` set per slot), merged over the
built-in theme, and applied before paint like the rest.

That's 64 × 64 = 4,096 primary / secondary pairs per slot, in either mode,
with either header tone.

### 5.4 Header tone

The miniature window in the middle of the wheel flips the header between a
**dark header** (the default, whatever the page's mode) and a **light header**.
Its own top bar shows the current tone. It's independent of light / dark, so
there are four combinations: dark page / dark header, dark page / light header,
light page / dark header, light page / light header.

How it works: a light header gets the `.header-light` class on the header, the
nav band and the phone menu sheet. Tailwind's `dark:` variant skips anything
inside `.header-light`, and a custom `hl:` variant styles it instead, so
header code writes `text-brand-200 hl:text-brand-800`. Saved as
`gma:headerTone`.

---

## 6. Where things are saved

| Setting | Saved in | Key |
|---|---|---|
| Color theme | Browser | `gma:colorTheme` |
| Custom colors | Browser | `gma:themeOverrides` |
| Light / dark | Browser | `theme-preference` |
| Header tone | Browser | `gma:headerTone` |

None of the site-wide settings follow the account yet: a user who switches
browser or device starts back on Gold, following their OS's light / dark.
