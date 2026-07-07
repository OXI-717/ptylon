export const THEME_VARIABLE_NAMES = [
  '--background',
  '--foreground',
  '--accent',
  '--surface',
  '--surface-raised',
  '--border',
  '--muted',
  '--muted-strong',
  '--terminal-bg',
  '--terminal-fg',
  '--terminal-cursor',
  '--terminal-selection',
  '--ansi-black',
  '--ansi-red',
  '--ansi-green',
  '--ansi-yellow',
  '--ansi-blue',
  '--ansi-magenta',
  '--ansi-cyan',
  '--ansi-white',
  '--ansi-bright-black',
  '--ansi-bright-red',
  '--ansi-bright-green',
  '--ansi-bright-yellow',
  '--ansi-bright-blue',
  '--ansi-bright-magenta',
  '--ansi-bright-cyan',
  '--ansi-bright-white',
  '--warm-filter-color',
  '--warm-filter-opacity',
  '--blue-reduction',
] as const;

export type ThemeVariableName = typeof THEME_VARIABLE_NAMES[number];

export interface ThemePalette {
  id: string;
  name: string;
  description: string;
  colorTemp: number;
  isDark: boolean;
  variables: Partial<Record<ThemeVariableName, string>>;
  custom?: boolean;
}

export const CIRCADIAN_PALETTE_ID = 'circadian';

export const BUILT_IN_THEME_PALETTES: ThemePalette[] = [
  {
    id: 'graphite-lab',
    name: 'Graphite Lab',
    description: 'Neutral dark console with cyan signal and high terminal contrast.',
    colorTemp: 5600,
    isDark: true,
    variables: {
      '--background': '#0b0d10',
      '--foreground': '#e8edf2',
      '--accent': '#37d6c3',
      '--surface': '#11161b',
      '--surface-raised': '#171f26',
      '--border': '#29323b',
      '--muted': '#8a98a8',
      '--muted-strong': '#d4dde7',
      '--terminal-bg': '#07090c',
      '--terminal-fg': '#e8edf2',
      '--terminal-cursor': '#37d6c3',
      '--terminal-selection': '#37d6c340',
      '--ansi-black': '#1b2229',
      '--ansi-red': '#ff6b7a',
      '--ansi-green': '#7ddf87',
      '--ansi-yellow': '#f4c95d',
      '--ansi-blue': '#7fb6ff',
      '--ansi-magenta': '#d38cff',
      '--ansi-cyan': '#37d6c3',
      '--ansi-white': '#e8edf2',
      '--ansi-bright-black': '#5b6875',
      '--ansi-bright-red': '#ff8c96',
      '--ansi-bright-green': '#9bf0a2',
      '--ansi-bright-yellow': '#ffe08a',
      '--ansi-bright-blue': '#a8ceff',
      '--ansi-bright-magenta': '#e2adff',
      '--ansi-bright-cyan': '#72eadc',
      '--ansi-bright-white': '#ffffff',
      '--warm-filter-color': '#ffd29a',
      '--warm-filter-opacity': '0',
      '--blue-reduction': '1',
    },
  },
  {
    id: 'paper-trail',
    name: 'Paper Trail',
    description: 'Bright operational theme for daytime review and docs-heavy work.',
    colorTemp: 6500,
    isDark: false,
    variables: {
      '--background': '#fbfcfd',
      '--foreground': '#111820',
      '--accent': '#0b6bcb',
      '--surface': '#eef2f5',
      '--surface-raised': '#ffffff',
      '--border': '#cfd7df',
      '--muted': '#667382',
      '--muted-strong': '#26313d',
      '--terminal-bg': '#ffffff',
      '--terminal-fg': '#111820',
      '--terminal-cursor': '#0b6bcb',
      '--terminal-selection': '#0b6bcb30',
      '--ansi-black': '#27313d',
      '--ansi-red': '#c9364a',
      '--ansi-green': '#1d8f50',
      '--ansi-yellow': '#b77900',
      '--ansi-blue': '#0b6bcb',
      '--ansi-magenta': '#8c4fd9',
      '--ansi-cyan': '#0f8b8d',
      '--ansi-white': '#f2f5f8',
      '--ansi-bright-black': '#667382',
      '--ansi-bright-red': '#e34b5f',
      '--ansi-bright-green': '#25a864',
      '--ansi-bright-yellow': '#d59600',
      '--ansi-bright-blue': '#277edb',
      '--ansi-bright-magenta': '#a76bf0',
      '--ansi-bright-cyan': '#14a4a6',
      '--ansi-bright-white': '#ffffff',
      '--warm-filter-color': '#ffd29a',
      '--warm-filter-opacity': '0',
      '--blue-reduction': '1',
    },
  },
  {
    id: 'ember-ops',
    name: 'Ember Ops',
    description: 'Warm low-blue console for evening sessions without flattening alerts.',
    colorTemp: 3600,
    isDark: true,
    variables: {
      '--background': '#11100e',
      '--foreground': '#f0e3cf',
      '--accent': '#f3a35c',
      '--surface': '#191714',
      '--surface-raised': '#24211d',
      '--border': '#3a3026',
      '--muted': '#a39380',
      '--muted-strong': '#f0ddc1',
      '--terminal-bg': '#0b0a09',
      '--terminal-fg': '#f0e3cf',
      '--terminal-cursor': '#f3a35c',
      '--terminal-selection': '#f3a35c40',
      '--ansi-black': '#211d18',
      '--ansi-red': '#ff746d',
      '--ansi-green': '#91cf7b',
      '--ansi-yellow': '#f2c35b',
      '--ansi-blue': '#7fb0e8',
      '--ansi-magenta': '#d892dc',
      '--ansi-cyan': '#69c7bb',
      '--ansi-white': '#f0e3cf',
      '--ansi-bright-black': '#6d6257',
      '--ansi-bright-red': '#ff978f',
      '--ansi-bright-green': '#afe69a',
      '--ansi-bright-yellow': '#ffdc82',
      '--ansi-bright-blue': '#a8caf4',
      '--ansi-bright-magenta': '#ebb3ef',
      '--ansi-bright-cyan': '#91dfd3',
      '--ansi-bright-white': '#fff7eb',
      '--warm-filter-color': '#ffd29a',
      '--warm-filter-opacity': '0.1',
      '--blue-reduction': '0.86',
    },
  },
  {
    id: 'signal-deck',
    name: 'Signal Deck',
    description: 'Dark monitoring palette with green status, blue navigation, red alerts.',
    colorTemp: 5200,
    isDark: true,
    variables: {
      '--background': '#090d0b',
      '--foreground': '#e3eee8',
      '--accent': '#55d17a',
      '--surface': '#101713',
      '--surface-raised': '#17211b',
      '--border': '#26362d',
      '--muted': '#8aa395',
      '--muted-strong': '#d7e8dd',
      '--terminal-bg': '#060907',
      '--terminal-fg': '#e3eee8',
      '--terminal-cursor': '#55d17a',
      '--terminal-selection': '#55d17a38',
      '--ansi-black': '#162019',
      '--ansi-red': '#ff6c76',
      '--ansi-green': '#55d17a',
      '--ansi-yellow': '#e6c65c',
      '--ansi-blue': '#72a7ff',
      '--ansi-magenta': '#cf8cff',
      '--ansi-cyan': '#55d6c2',
      '--ansi-white': '#e3eee8',
      '--ansi-bright-black': '#617168',
      '--ansi-bright-red': '#ff929a',
      '--ansi-bright-green': '#84e79d',
      '--ansi-bright-yellow': '#f5db84',
      '--ansi-bright-blue': '#9fc5ff',
      '--ansi-bright-magenta': '#dfafff',
      '--ansi-bright-cyan': '#82ecdd',
      '--ansi-bright-white': '#ffffff',
      '--warm-filter-color': '#ffd29a',
      '--warm-filter-opacity': '0',
      '--blue-reduction': '0.98',
    },
  },
];

export function sanitizeThemeId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'custom-theme';
}

export function normalizeThemePalette(value: unknown): ThemePalette | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ThemePalette>;
  if (typeof candidate.name !== 'string' || !candidate.name.trim()) return null;
  if (!candidate.variables || typeof candidate.variables !== 'object') return null;
  const variables: Partial<Record<ThemeVariableName, string>> = {};
  for (const key of THEME_VARIABLE_NAMES) {
    const variable = candidate.variables[key];
    if (typeof variable === 'string' && variable.trim()) {
      variables[key] = variable.trim();
    }
  }
  if (!variables['--background'] || !variables['--foreground'] || !variables['--accent']) return null;
  const id = sanitizeThemeId(typeof candidate.id === 'string' ? candidate.id : candidate.name);
  return {
    id,
    name: candidate.name.trim().slice(0, 80),
    description: typeof candidate.description === 'string' ? candidate.description.trim().slice(0, 180) : 'Imported theme',
    colorTemp: typeof candidate.colorTemp === 'number' ? candidate.colorTemp : 5600,
    isDark: Boolean(candidate.isDark),
    variables,
    custom: true,
  };
}
