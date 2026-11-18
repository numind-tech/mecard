import { mix, rgb } from './backgrounds.js';

const luminance = color => rgb(color).map(channel => {
  const value = channel / 255;
  return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);

export const contrast = (a, b) => {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
};

function readable(color, surface, target, minimum = 4.5) {
  for (let step = 0; step <= 20; step++) {
    const candidate = mix(color, target, step / 20);
    if (contrast(candidate, surface) >= minimum) return candidate;
  }
  return target;
}

export function appearanceTheme(theme, paper = false) {
  const light = {
    page: luminance(theme.page) > .5 ? theme.page : '#f4f3f7',
    surface: '#ffffff', text: readable(theme.text, '#ffffff', '#252930', 7),
    muted: '#595362', dim: '#655f70', border: '#ddd9e7', control: '#f6f5f9', hover: '#eeecf3',
    ink: readable(theme.dark, '#ffffff', '#252930', paper ? 4.5 : 7),
    button: readable(theme.dark, '#ffffff', '#252930'), 'button-text': '#ffffff',
  };
  const dark = {
    page: '#121218', surface: '#1d1d27', text: '#f3f2f7', muted: '#c6c2d3', dim: '#b0aabd',
    border: '#464251', control: '#282631', hover: '#34303f',
    ink: readable(theme.accent, '#1d1d27', '#ffffff', 7),
    button: readable(theme.dark, '#1d1d27', '#ffffff'), 'button-text': '#121218',
  };
  const variables = palette => Object.entries({ ...palette, 'text-rgb': rgb(palette.text).join(', ') })
    .map(([key, value]) => `  --mode-${key}: ${value};`).join('\n');
  return {
    light, dark,
    css: `:root {\n  color-scheme: light;\n${variables(light)}\n}\n` +
      `:root[data-theme="dark"] {\n  color-scheme: dark;\n${variables(dark)}\n}\n` +
      `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n    color-scheme: dark;\n${variables(dark)}\n  }\n}`,
  };
}
