// The site's color theme: six built-in themes, custom colors per theme slot, and the header's
// tone. See Docs/CUSTOMIZATION.md. Light / dark is Mantine's and isn't kept here.
//
// A theme is eight numbers written to <html> as CSS custom properties; styles.css builds every
// themed color from them. The store is shared by every tab through the `storage` event.

import { useSyncExternalStore } from 'react';

export type ThemeId = 'gold' | 'emerald' | 'sapphire' | 'ruby' | 'amethyst' | 'slate';
export type HeaderTone = 'dark' | 'light';
export type Slot = 'primary' | 'secondary';

export interface HueSat {
  hue: number;
  sat: number;
}

export interface SiteTheme {
  id: ThemeId;
  label: string;
  surface: HueSat;
  accent: HueSat;
  brand: HueSat;
  brand2: HueSat;
}

export type SlotOverride = Partial<Record<Slot, HueSat>>;
export type Overrides = Partial<Record<ThemeId, SlotOverride>>;

export interface SiteThemeState {
  themeId: ThemeId;
  overrides: Overrides;
  headerTone: HeaderTone;
}

const hs = (hue: number, sat: number): HueSat => ({ hue, sat });

/** Gold's numbers are also the defaults in styles.css, for a browser with nothing saved. */
export const SITE_THEMES: readonly SiteTheme[] = [
  { id: 'gold', label: 'Gold', surface: hs(40, 32), accent: hs(38, 60), brand: hs(43, 80), brand2: hs(24, 55) },
  { id: 'emerald', label: 'Emerald', surface: hs(150, 18), accent: hs(152, 50), brand: hs(152, 62), brand2: hs(44, 70) },
  { id: 'sapphire', label: 'Sapphire', surface: hs(218, 22), accent: hs(218, 60), brand: hs(218, 78), brand2: hs(184, 62) },
  { id: 'ruby', label: 'Ruby', surface: hs(356, 20), accent: hs(354, 58), brand: hs(354, 72), brand2: hs(24, 82) },
  { id: 'amethyst', label: 'Amethyst', surface: hs(268, 20), accent: hs(268, 52), brand: hs(268, 62), brand2: hs(312, 60) },
  { id: 'slate', label: 'Slate', surface: hs(215, 8), accent: hs(212, 20), brand: hs(212, 22), brand2: hs(185, 18) },
];

const DEFAULT_THEME: ThemeId = 'gold';

/** The editor's grid: eight hues across, eight saturations down. */
export const GRID_HUES = [
  { hue: 4, name: 'Red' },
  { hue: 30, name: 'Orange' },
  { hue: 48, name: 'Yellow' },
  { hue: 92, name: 'Lime' },
  { hue: 150, name: 'Green' },
  { hue: 190, name: 'Cyan' },
  { hue: 220, name: 'Blue' },
  { hue: 300, name: 'Magenta' },
] as const;
export const GRID_SATS = [16, 28, 39, 51, 63, 75, 86, 98] as const;

const KEY_THEME = 'am:colorTheme';
const KEY_OVERRIDES = 'am:themeOverrides';
const KEY_TONE = 'am:headerTone';
/** The resolved eight numbers, for index.html's script to apply before the first paint. */
const KEY_VARS = 'am:themeVars';

const VAR_NAMES = ['--hs', '--ss', '--ha', '--sa', '--brand-h', '--brand-s', '--brand2-h', '--brand2-s'] as const;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function isThemeId(value: unknown): value is ThemeId {
  return SITE_THEMES.some((t) => t.id === value);
}

function toHueSat(value: unknown): HueSat | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { hue, sat } = value as Record<string, unknown>;
  if (typeof hue !== 'number' || typeof sat !== 'number' || !Number.isFinite(hue) || !Number.isFinite(sat)) return undefined;
  return { hue: clamp(hue, 0, 360), sat: clamp(sat, 0, 100) };
}

/** A slot's theme with its custom colors, if any, laid over the built-in ones. */
export function resolveTheme(id: ThemeId, overrides: Overrides): SiteTheme {
  const base = SITE_THEMES.find((t) => t.id === id) ?? SITE_THEMES[0]!;
  const custom = overrides[id];
  if (!custom) return base;
  const theme = { ...base };
  if (custom.primary) {
    // Primary re-tints the whole app: surfaces and the accent follow its hue at a lower saturation.
    const { hue, sat } = custom.primary;
    theme.brand = custom.primary;
    theme.accent = { hue, sat: clamp(Math.round(sat * 0.7), 8, 70) };
    theme.surface = { hue, sat: clamp(Math.round(sat * 0.5), 4, 36) };
  }
  if (custom.secondary) theme.brand2 = custom.secondary;
  return theme;
}

/** The two colors of a theme's split swatch. */
export function swatchColors(theme: SiteTheme): { primary: string; secondary: string } {
  return {
    primary: `hsl(${theme.brand.hue} ${theme.brand.sat}% 50%)`,
    secondary: `hsl(${theme.brand2.hue} ${theme.brand2.sat}% 42%)`,
  };
}

/** Primary top-left, secondary bottom-right. */
export function splitSwatch(theme: SiteTheme): string {
  const { primary, secondary } = swatchColors(theme);
  return `linear-gradient(135deg, ${primary} 50%, ${secondary} 50%)`;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private mode or a full disk: the pick lasts for this page only.
  }
}

function load(): SiteThemeState {
  const savedTheme = read(KEY_THEME);
  const overrides: Overrides = {};
  try {
    const raw: unknown = JSON.parse(read(KEY_OVERRIDES) ?? 'null');
    if (raw && typeof raw === 'object') {
      for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!isThemeId(id) || !value || typeof value !== 'object') continue;
        const primary = toHueSat((value as Record<string, unknown>).primary);
        const secondary = toHueSat((value as Record<string, unknown>).secondary);
        if (primary || secondary) overrides[id] = { ...(primary && { primary }), ...(secondary && { secondary }) };
      }
    }
  } catch {
    // Unreadable overrides count as none.
  }
  return {
    themeId: isThemeId(savedTheme) ? savedTheme : DEFAULT_THEME,
    overrides,
    headerTone: read(KEY_TONE) === 'light' ? 'light' : 'dark',
  };
}

function themeVars(theme: SiteTheme): number[] {
  return [
    theme.surface.hue,
    theme.surface.sat,
    theme.accent.hue,
    theme.accent.sat,
    theme.brand.hue,
    theme.brand.sat,
    theme.brand2.hue,
    theme.brand2.sat,
  ];
}

function apply(current: SiteThemeState): number[] {
  const vars = themeVars(resolveTheme(current.themeId, current.overrides));
  const { style } = document.documentElement;
  VAR_NAMES.forEach((name, i) => style.setProperty(name, String(vars[i])));
  return vars;
}

let state = load();
const listeners = new Set<() => void>();

function commit(next: SiteThemeState): void {
  state = next;
  write(KEY_THEME, next.themeId);
  write(KEY_OVERRIDES, Object.keys(next.overrides).length > 0 ? JSON.stringify(next.overrides) : null);
  write(KEY_TONE, next.headerTone);
  write(KEY_VARS, JSON.stringify(apply(next)));
  listeners.forEach((listener) => listener());
}

if (typeof window !== 'undefined') {
  apply(state);
  // Another tab changed something.
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== KEY_THEME && event.key !== KEY_OVERRIDES && event.key !== KEY_TONE) return;
    state = load();
    apply(state);
    listeners.forEach((listener) => listener());
  });
}

export function setTheme(themeId: ThemeId): void {
  commit({ ...state, themeId });
}

export function setSlotColor(themeId: ThemeId, slot: Slot, color: HueSat): void {
  commit({ ...state, overrides: { ...state.overrides, [themeId]: { ...state.overrides[themeId], [slot]: color } } });
}

/** Back to the slot's built-in colors. */
export function resetSlot(themeId: ThemeId): void {
  const overrides = { ...state.overrides };
  delete overrides[themeId];
  commit({ ...state, overrides });
}

export function setHeaderTone(headerTone: HeaderTone): void {
  commit({ ...state, headerTone });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSiteTheme(): SiteThemeState {
  return useSyncExternalStore(subscribe, () => state);
}
