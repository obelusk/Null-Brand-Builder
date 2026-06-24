// Shared constants used across main, preload, and renderer.
// Kept framework-free so it can be required (main) or imported as data (renderer mirror).

const LEVELS = [
  { id: 'h1', label: 'Main Header', defaultSize: 52, defaultWeight: 700, colorRole: 'primary', placeholder: 'Headline' },
  { id: 'h2', label: 'Sub Header', defaultSize: 32, defaultWeight: 600, colorRole: 'secondary', placeholder: 'Subheading' },
  { id: 'caption', label: 'Caption / Quote', defaultSize: 14, defaultWeight: 500, colorRole: 'accent', placeholder: 'Caption' },
  { id: 'body', label: 'Paragraph', defaultSize: 17, defaultWeight: 400, colorRole: 'text', placeholder: 'Body copy. Paste a real paragraph here to see your typography in context. Good type holds up at length — check rhythm, spacing, and how comfortably the eye moves from line to line.' },
];

const COLOR_ROLES = [
  { id: 'primary', label: 'Primary', default: '#1a1a1a' },
  { id: 'secondary', label: 'Secondary', default: '#404040' },
  { id: 'accent', label: 'Accent', default: '#737373' },
  { id: 'base', label: 'Base / Background', default: '#ffffff' },
  { id: 'text', label: 'Text / Neutral', default: '#262626' },
];

const CATEGORIES = ['Sans-Serif', 'Serif', 'Decorative', 'Script', 'Monospace', 'Uncategorized'];

const WEIGHT_NAMES = {
  100: 'Thin',
  200: 'Extra Light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'Extra Bold',
  900: 'Black',
};

module.exports = { LEVELS, COLOR_ROLES, CATEGORIES, WEIGHT_NAMES };
