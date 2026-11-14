// The header's light / dark switch. Its knob wears the color theme and opens the color wheel;
// holding a swatch on the wheel opens that slot's color editor. See Docs/CUSTOMIZATION.md.

import {
  ActionIcon,
  Button,
  Portal,
  SegmentedControl,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { IconMoon, IconRotate, IconSun, IconX } from '@tabler/icons-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import {
  GRID_HUES,
  GRID_SATS,
  resetSlot,
  resolveTheme,
  setHeaderTone,
  setSlotColor,
  setTheme,
  SITE_THEMES,
  splitSwatch,
  swatchColors,
  useSiteTheme,
  type SiteTheme,
  type Slot,
  type ThemeId,
} from '../lib/siteTheme';

const HOLD_MS = 450;
const DISC = 212;
const RING = 68;
const EDITOR_WIDTH = 268;
/** From the knob's bottom edge to the top of the wheel. */
const DROP = 16;
const EDGE = 8;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Eats the click that follows a hold's release, whatever is under the pointer by then. */
function swallowNextClick(): void {
  const swallow = (event: Event) => {
    event.stopPropagation();
    event.preventDefault();
  };
  const release = () => {
    document.removeEventListener('pointerup', release, true);
    document.removeEventListener('pointercancel', release, true);
    // The click comes right after the pointerup.
    setTimeout(() => document.removeEventListener('click', swallow, true), 0);
  };
  document.addEventListener('click', swallow, true);
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', release, true);
}

function Swatch({
  theme,
  index,
  active,
  onUse,
  onEdit,
}: {
  theme: SiteTheme;
  index: number;
  active: boolean;
  onUse: () => void;
  onEdit: () => void;
}) {
  const timer = useRef<number | undefined>(undefined);
  const cancel = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  useEffect(() => cancel, [cancel]);

  // Clockwise from the top.
  const angle = (index / SITE_THEMES.length) * 2 * Math.PI;
  const style: CSSProperties = {
    left: DISC / 2 + RING * Math.sin(angle),
    top: DISC / 2 - RING * Math.cos(angle),
    background: splitSwatch(theme),
    animationDelay: `${index * 30}ms`,
  };

  return (
    <Tooltip label={`${theme.label}: click to use, hold to customise`}>
      <button
        type="button"
        className="am-wheel-swatch"
        style={style}
        data-active={active || undefined}
        aria-label={`${theme.label} theme`}
        aria-pressed={active}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          cancel();
          timer.current = window.setTimeout(() => {
            timer.current = undefined;
            swallowNextClick();
            onEdit();
          }, HOLD_MS);
        }}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onContextMenu={(event) => event.preventDefault()}
        // Shift is the keyboard's way to the editor.
        onClick={(event) => (event.shiftKey ? onEdit() : onUse())}
      />
    </Tooltip>
  );
}

function Editor({ id, style, onBack, onUse }: { id: ThemeId; style: CSSProperties; onBack: () => void; onUse: () => void }) {
  const site = useSiteTheme();
  const [slot, setSlot] = useState<Slot>('primary');
  const theme = resolveTheme(id, site.overrides);
  const colors = swatchColors(theme);
  const current = slot === 'primary' ? theme.brand : theme.brand2;
  const custom = site.overrides[id] !== undefined;

  const tab = (label: string, color: string) => (
    <span className="am-editor-tab">
      <span className="am-editor-dot" style={{ background: color }} />
      {label}
    </span>
  );

  return (
    <div className="am-editor" style={style} role="dialog" aria-label={`Customise ${theme.label}`}>
      <div className="am-editor-head">
        <span>Customise {theme.label}</span>
        <ActionIcon variant="subtle" color="gray" size="sm" onClick={onBack} aria-label="Back to the color wheel">
          <IconX size={14} />
        </ActionIcon>
      </div>
      <SegmentedControl
        fullWidth
        size="xs"
        value={slot}
        onChange={(value) => setSlot(value as Slot)}
        data={[
          { value: 'primary', label: tab('Primary', colors.primary) },
          { value: 'secondary', label: tab('Secondary', colors.secondary) },
        ]}
      />
      <div className="am-editor-grid">
        {GRID_SATS.map((sat) =>
          GRID_HUES.map(({ hue, name }) => (
            <button
              key={`${hue}-${sat}`}
              type="button"
              className="am-editor-cell"
              style={{ background: `hsl(${hue} ${sat}% 50%)` }}
              data-active={(current.hue === hue && current.sat === sat) || undefined}
              aria-label={`${name}, ${sat}% saturation`}
              aria-pressed={current.hue === hue && current.sat === sat}
              onClick={() => setSlotColor(id, slot, { hue, sat })}
            />
          )),
        )}
      </div>
      <div className="am-editor-foot">
        <span className="am-editor-preview" style={{ background: splitSwatch(theme) }} aria-hidden />
        <Tooltip label="Reset to the built-in colors">
          <ActionIcon variant="default" size="md" disabled={!custom} onClick={() => resetSlot(id)} aria-label="Reset to the built-in colors">
            <IconRotate size={15} />
          </ActionIcon>
        </Tooltip>
        <Button size="compact-sm" ml="auto" onClick={onUse}>
          Use theme
        </Button>
      </div>
    </div>
  );
}

export function ThemeSwitch() {
  const { setColorScheme } = useMantineColorScheme();
  const mode = useComputedColorScheme('light', { getInitialValueInEffect: false });
  const site = useSiteTheme();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ThemeId | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number } | null>(null);
  const knob = useRef<HTMLButtonElement>(null);
  const layer = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setEditing(null);
  }, []);

  // Where the knob is, so the wheel can drop under it and point back at it.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const rect = knob.current?.getBoundingClientRect();
      if (rect) setAnchor({ x: rect.left + rect.width / 2, y: rect.bottom, width: window.innerWidth });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, mode]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (layer.current?.contains(target) || knob.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  const active = resolveTheme(site.themeId, site.overrides);
  const activeColors = swatchColors(active);
  const tone = site.headerTone;
  const otherTone = tone === 'dark' ? 'light' : 'dark';

  let wheelStyle: CSSProperties = {};
  let pointerStyle: CSSProperties = {};
  let editorStyle: CSSProperties = {};
  if (anchor) {
    const half = DISC / 2;
    const centerX = clamp(anchor.x, half + EDGE, Math.max(half + EDGE, anchor.width - half - EDGE));
    const top = anchor.y + DROP;
    // Near the screen's edge the wheel can't sit right under the knob, so the pointer leans to it.
    const lean = Math.atan2(anchor.x - centerX, half + DROP);
    wheelStyle = { left: centerX - half, top };
    pointerStyle = { transform: `rotate(${lean}rad) translateY(${-half}px) rotate(45deg)` };
    editorStyle = {
      left: clamp(anchor.x - EDITOR_WIDTH / 2, EDGE, Math.max(EDGE, anchor.width - EDITOR_WIDTH - EDGE)),
      top,
    };
  }

  return (
    <div className="am-switch" data-mode={mode}>
      <button
        type="button"
        className="am-switch-end"
        onClick={() => setColorScheme('light')}
        aria-label="Light mode"
        aria-pressed={mode === 'light'}
      >
        <IconSun size={16} />
      </button>
      <span className="am-switch-rail">
        <button
          type="button"
          className="am-switch-track"
          onClick={() => setColorScheme(mode === 'dark' ? 'light' : 'dark')}
          aria-label={`Switch to ${mode === 'dark' ? 'light' : 'dark'} mode`}
        />
        <button
          ref={knob}
          type="button"
          className="am-switch-knob"
          style={{ background: splitSwatch(active) }}
          onClick={() => (open ? close() : setOpen(true))}
          aria-label="Color theme"
          aria-haspopup="dialog"
          aria-expanded={open}
        />
      </span>
      <button
        type="button"
        className="am-switch-end"
        onClick={() => setColorScheme('dark')}
        aria-label="Dark mode"
        aria-pressed={mode === 'dark'}
      >
        <IconMoon size={16} />
      </button>

      {open && anchor && (
        <Portal>
          <div ref={layer}>
            <div
              className="am-wheel"
              style={wheelStyle}
              role="dialog"
              aria-label="Color theme"
              data-out={editing !== null || undefined}
              inert={editing !== null}
            >
              <span className="am-wheel-pointer" style={pointerStyle} aria-hidden />
              {SITE_THEMES.map((base, index) => (
                <Swatch
                  key={base.id}
                  theme={resolveTheme(base.id, site.overrides)}
                  index={index}
                  active={base.id === site.themeId}
                  onUse={() => {
                    setTheme(base.id);
                    close();
                  }}
                  onEdit={() => setEditing(base.id)}
                />
              ))}
              <Tooltip label={`${tone === 'dark' ? 'Dark' : 'Light'} header: click for a ${otherTone} one`}>
                <button
                  type="button"
                  className="am-wheel-window"
                  data-tone={tone}
                  onClick={() => setHeaderTone(otherTone)}
                  aria-label={`Switch to a ${otherTone} header`}
                >
                  <span className="am-wheel-window-bar">
                    <i style={{ background: activeColors.primary }} />
                    <i style={{ background: activeColors.secondary }} />
                  </span>
                  <span className="am-wheel-window-body">{tone === 'dark' ? <IconMoon size={14} /> : <IconSun size={14} />}</span>
                </button>
              </Tooltip>
            </div>
            {editing && (
              <Editor
                id={editing}
                style={editorStyle}
                onBack={() => setEditing(null)}
                onUse={() => {
                  setTheme(editing);
                  close();
                }}
              />
            )}
          </div>
        </Portal>
      )}
    </div>
  );
}
