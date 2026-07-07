'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CIRCADIAN_PALETTE_ID, type ThemePalette } from '@/lib/theme-palettes';
import type { CircadianTheme } from '@/hooks/useCircadianTheme';

interface ThemeGalleryProps {
  open: boolean;
  circadian: CircadianTheme;
  onClose: () => void;
}

const CIRCADIAN_PRESET: ThemePalette = {
  id: CIRCADIAN_PALETTE_ID,
  name: 'Circadian Auto',
  description: 'Time-aware day, evening, night, and system theme modes.',
  colorTemp: 0,
  isDark: true,
  variables: {
    '--background': '#0a0e14',
    '--foreground': '#e0e0e0',
    '--accent': '#40E0D0',
    '--surface': '#0d1117',
    '--surface-raised': '#111722',
    '--border': '#1a1e24',
    '--terminal-bg': '#0a0e14',
    '--terminal-fg': '#e0e0e0',
  },
};

const MODE_LABELS = {
  auto: 'Auto',
  day: 'Day',
  evening: 'Evening',
  night: 'Night',
  system: 'System',
} as const;

const MODE_ORDER = ['auto', 'day', 'evening', 'night', 'system'] as const;

function swatch(palette: ThemePalette, key: keyof ThemePalette['variables'], fallback: string) {
  return palette.variables[key] || fallback;
}

function downloadPalette(palette: ThemePalette) {
  const payload = {
    id: palette.id,
    name: palette.name,
    description: palette.description,
    colorTemp: palette.colorTemp,
    isDark: palette.isDark,
    variables: palette.variables,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${palette.id}.web-console-theme.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function ThemeGallery({ open, circadian, onClose }: ThemeGalleryProps) {
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const palettes = useMemo(() => [CIRCADIAN_PRESET, ...circadian.palettes], [circadian.palettes]);
  const effectiveId = circadian.previewPaletteId || circadian.paletteId;
  const activeExportPalette = circadian.activePalette || palettes.find((palette) => palette.id === circadian.paletteId) || null;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        circadian.clearPreview();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [circadian, onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/35 px-2 pt-10 sm:pt-16" onMouseDown={() => { circadian.clearPreview(); onClose(); }}>
      <div
        className="w-full max-w-5xl overflow-hidden border shadow-2xl"
        style={{ background: 'var(--surface-raised)', borderColor: 'var(--border)', borderRadius: 8 }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2" style={{ borderColor: 'var(--border)' }}>
          <div className="min-w-0">
            <div className="font-mono text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Theme Gallery</div>
            <div className="font-mono text-[10px]" style={{ color: 'var(--muted)' }}>
              {circadian.activePalette?.name || 'Circadian'} / {circadian.colorTemp || 'auto'}K / {circadian.isDark ? 'dark' : 'light'}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-8 overflow-hidden border" style={{ borderColor: 'var(--border)', borderRadius: 6 }}>
              {MODE_ORDER.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className="px-2 font-mono text-[10px]"
                  style={{
                    background: circadian.mode === mode ? 'var(--accent)' : 'transparent',
                    color: circadian.mode === mode ? 'var(--background)' : 'var(--muted-strong)',
                  }}
                  onClick={() => circadian.setMode(mode)}
                >
                  {MODE_LABELS[mode]}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="h-8 border px-2 font-mono text-[10px]"
              style={{ borderColor: 'var(--border)', color: 'var(--foreground)', borderRadius: 6 }}
              onClick={() => {
                if (activeExportPalette && activeExportPalette.id !== CIRCADIAN_PALETTE_ID) downloadPalette(activeExportPalette);
              }}
              disabled={!activeExportPalette || activeExportPalette.id === CIRCADIAN_PALETTE_ID}
              title={activeExportPalette?.id === CIRCADIAN_PALETTE_ID ? 'Select a fixed palette to export' : 'Export selected theme JSON'}
            >
              export
            </button>
            <button
              type="button"
              className="h-8 border px-2 font-mono text-[10px]"
              style={{ borderColor: 'var(--border)', color: 'var(--foreground)', borderRadius: 6 }}
              onClick={() => fileInputRef.current?.click()}
            >
              import
            </button>
            <button
              type="button"
              className="h-8 border px-2 font-mono text-[10px]"
              style={{ borderColor: 'var(--border)', color: 'var(--muted-strong)', borderRadius: 6 }}
              onClick={() => { circadian.clearPreview(); onClose(); }}
            >
              close
            </button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file) return;
            try {
              const imported = circadian.importPalette(JSON.parse(await file.text()));
              setMessage(imported ? `Imported ${imported.name}` : 'Theme JSON is missing required color variables');
            } catch {
              setMessage('Theme JSON could not be parsed');
            }
          }}
        />

        <div
          className="max-h-[min(72vh,680px)] overflow-y-auto p-3"
          onMouseLeave={circadian.clearPreview}
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {palettes.map((palette) => {
              const selected = circadian.paletteId === palette.id;
              const previewed = effectiveId === palette.id && !selected;
              return (
                <button
                  key={palette.id}
                  type="button"
                  data-theme-palette-option={palette.id}
                  className="min-h-[132px] border p-3 text-left transition-colors"
                  style={{
                    borderColor: selected || previewed ? 'var(--accent)' : 'var(--border)',
                    background: selected ? 'color-mix(in srgb, var(--accent) 10%, var(--surface))' : 'var(--surface)',
                    borderRadius: 8,
                  }}
                  onFocus={() => circadian.previewPalette(palette.id)}
                  onMouseEnter={() => circadian.previewPalette(palette.id)}
                  onClick={() => {
                    circadian.setPalette(palette.id);
                    setMessage(`${palette.name} applied`);
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                        {palette.name}
                      </div>
                      <div className="mt-1 line-clamp-2 min-h-[28px] font-mono text-[10px]" style={{ color: 'var(--muted)' }}>
                        {palette.description}
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-[10px]" style={{ color: selected ? 'var(--accent)' : 'var(--muted)' }}>
                      {selected ? 'applied' : palette.custom ? 'custom' : palette.id === CIRCADIAN_PALETTE_ID ? 'auto' : `${palette.colorTemp}K`}
                    </span>
                  </div>
                  <div className="mt-3 grid h-8 grid-cols-6 overflow-hidden border" style={{ borderColor: 'var(--border)', borderRadius: 6 }}>
                    {[
                      swatch(palette, '--background', '#0a0e14'),
                      swatch(palette, '--surface', '#0d1117'),
                      swatch(palette, '--foreground', '#e0e0e0'),
                      swatch(palette, '--accent', '#40E0D0'),
                      swatch(palette, '--ansi-red', '#ff6b6b'),
                      swatch(palette, '--ansi-green', '#69db7c'),
                    ].map((color, index) => (
                      <span key={`${palette.id}-${index}`} style={{ background: color }} />
                    ))}
                  </div>
                  <div className="mt-3 h-7 overflow-hidden border px-2 font-mono text-[10px] leading-7" style={{
                    background: swatch(palette, '--terminal-bg', '#0a0e14'),
                    borderColor: swatch(palette, '--border', '#1a1e24'),
                    color: swatch(palette, '--terminal-fg', '#e0e0e0'),
                    borderRadius: 6,
                  }}>
                    $ pnpm test:browser-regression
                  </div>
                </button>
              );
            })}
          </div>
          {message && (
            <div className="mt-3 border px-3 py-2 font-mono text-xs" style={{ borderColor: 'var(--border)', color: 'var(--muted-strong)', borderRadius: 6 }}>
              {message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
