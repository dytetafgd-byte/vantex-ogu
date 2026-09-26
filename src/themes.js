// themes.js — server-owned theme list. Applied identically on signup, login,
// profile, directory, leaderboard, tickets and admin so nothing drifts.
export const THEMES = [
  { id: 'black-grey',    name: 'Black / Grey',    bg: '#111214', panel: '#1a1c1f', text: '#e8e9ea', accent: '#9aa0a6', hue: 210 },
  { id: 'black-orange',  name: 'Black / Orange',  bg: '#12100d', panel: '#1d1913', text: '#f3ece1', accent: '#ff8a2b', hue: 28 },
  { id: 'purple-orange', name: 'Purple / Orange', bg: '#14101b', panel: '#1f1829', text: '#efe9f7', accent: '#c084fc', accent2: '#ff8a2b', hue: 280 },
  { id: 'ocean',         name: 'Ocean',           bg: '#0b1417', panel: '#122125', text: '#e4f2f4', accent: '#5fd3e6', hue: 190 },
  { id: 'autumn',        name: 'Autumn',          bg: '#161108', panel: '#241a0d', text: '#f6ecd9', accent: '#e0a03a', hue: 40 },
  { id: 'midnight',      name: 'Midnight',        bg: '#0a0d18', panel: '#131a2b', text: '#e6eaf6', accent: '#7aa2ff', hue: 225 },
  { id: 'bone',          name: 'Bone',            bg: '#141311', panel: '#1f1d1a', text: '#f2efe9', accent: '#cfc6b4', hue: 45 },
];

export const THEME_IDS = new Set(THEMES.map(t => t.id));
export const DEFAULT_THEME = 'black-grey';

export function isValidTheme(id) {
  return THEME_IDS.has(id);
}

// One place that turns a theme into CSS variables. The client only ever
// receives this string, so a page can't half-apply a theme.
export function themeCss(themeId, gradients = true) {
  const t = THEMES.find(x => x.id === themeId) || THEMES[0];
  const accent2 = t.accent2 || t.accent;
  const grad = gradients
    ? `linear-gradient(135deg, ${t.accent}, ${accent2})`
    : t.accent;
  return [
    `--bg:${t.bg}`,
    `--panel:${t.panel}`,
    `--text:${t.text}`,
    `--accent:${t.accent}`,
    `--accent2:${accent2}`,
    `--accent-grad:${grad}`,
    '',
  ].join(';');
}