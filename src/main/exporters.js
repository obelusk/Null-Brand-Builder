// Phase 5 — export generators. Turn a brand-kit state object into CSS / JSON token text.
// State shape:
//   { name, levels: { h1: {family,size,weight,style}, ... }, colors: { primary, ... } }

const { LEVELS, COLOR_ROLES } = require('../shared/constants');
const { rgbString, hslString, hexToRgb, rgbToHsl } = require('../shared/color');

function cssVarSafe(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function buildCss(state) {
  const lines = [];
  lines.push('/* Null Brand Builder export */');
  if (state.name) lines.push(`/* Brand kit: ${state.name} */`);
  lines.push(':root {');

  lines.push('  /* Colors */');
  for (const role of COLOR_ROLES) {
    const hex = (state.colors && state.colors[role.id]) || role.default;
    lines.push(`  --color-${role.id}: ${hex};`);
    lines.push(`  --color-${role.id}-rgb: ${rgbString(hex).replace(/^rgb\(|\)$/g, '')};`);
  }

  lines.push('');
  lines.push('  /* Typography */');
  for (const lvl of LEVELS) {
    const l = (state.levels && state.levels[lvl.id]) || {};
    const family = l.family ? `"${l.family}"` : 'sans-serif';
    lines.push(`  --font-${lvl.id}-family: ${family};`);
    lines.push(`  --font-${lvl.id}-size: ${l.size ?? lvl.defaultSize}px;`);
    lines.push(`  --font-${lvl.id}-weight: ${l.weight ?? lvl.defaultWeight};`);
    lines.push(`  --font-${lvl.id}-style: ${l.style || 'normal'};`);
  }
  lines.push('}');

  lines.push('');
  lines.push('/* Suggested usage */');
  const map = { h1: 'h1', h2: 'h2', caption: '.caption', body: 'body, p' };
  for (const lvl of LEVELS) {
    const sel = map[lvl.id] || `.${lvl.id}`;
    lines.push(`${sel} {`);
    lines.push(`  font-family: var(--font-${lvl.id}-family);`);
    lines.push(`  font-size: var(--font-${lvl.id}-size);`);
    lines.push(`  font-weight: var(--font-${lvl.id}-weight);`);
    lines.push(`  font-style: var(--font-${lvl.id}-style);`);
    lines.push(`  color: var(--color-${lvl.colorRole});`);
    lines.push('}');
  }
  return lines.join('\n') + '\n';
}

// Figma Tokens / Tailwind-friendly design tokens.
function buildJsonTokens(state) {
  const colors = {};
  for (const role of COLOR_ROLES) {
    const hex = (state.colors && state.colors[role.id]) || role.default;
    colors[role.id] = {
      value: hex,
      type: 'color',
      rgb: rgbString(hex),
      hsl: hslString(hex),
    };
  }
  const typography = {};
  for (const lvl of LEVELS) {
    const l = (state.levels && state.levels[lvl.id]) || {};
    typography[lvl.id] = {
      type: 'typography',
      value: {
        fontFamily: l.family || 'sans-serif',
        fontSize: `${l.size ?? lvl.defaultSize}px`,
        fontWeight: l.weight ?? lvl.defaultWeight,
        fontStyle: l.style || 'normal',
      },
      label: lvl.label,
    };
  }
  const tokens = {
    $schema: 'https://schemas.nullbrandbuilder.dev/tokens.json',
    name: state.name || 'Untitled Brand Kit',
    color: colors,
    typography,
  };
  return JSON.stringify(tokens, null, 2) + '\n';
}

module.exports = { buildCss, buildJsonTokens };
