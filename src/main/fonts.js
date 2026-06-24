// Phase 1 — Local Font Engine.
// Scans OS font directories + the app's own ~/NullBrandBuilder/fonts folder,
// reads metadata with fontkit, categorizes, dedupes, and returns a family-grouped list.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const { WEIGHT_NAMES } = require('../shared/constants');

// fontkit 2.x is ESM-only; load it lazily via dynamic import and cache the module.
let _fontkit = null;
async function getFontkit() {
  if (!_fontkit) _fontkit = await import('fontkit');
  return _fontkit;
}

const SUPPORTED_EXT = new Set(['.ttf', '.otf']);

// Bump when the scan output shape/ordering changes, to invalidate stale caches.
const SCAN_VERSION = 2;

// Priority for ordering a family's variants: Regular > Italic > Bold > Bold Italic > rest.
function styleRank(v) {
  if (v.weight === 400 && v.style === 'normal') return 0;
  if (v.weight === 400 && v.style === 'italic') return 1;
  if (v.weight === 700 && v.style === 'normal') return 2;
  if (v.weight === 700 && v.style === 'italic') return 3;
  return 4;
}

function appFontsDir() {
  return path.join(os.homedir(), 'NullBrandBuilder', 'fonts');
}

// Returns the list of directories to scan for the current OS, plus the app folder.
function systemFontDirs() {
  const home = os.homedir();
  const dirs = [];
  switch (process.platform) {
    case 'win32':
      dirs.push(path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'));
      if (process.env.LOCALAPPDATA) {
        dirs.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'));
      }
      break;
    case 'darwin':
      dirs.push('/System/Library/Fonts', '/Library/Fonts', path.join(home, 'Library', 'Fonts'));
      break;
    default: // linux & others
      dirs.push('/usr/share/fonts', '/usr/local/share/fonts',
        path.join(home, '.fonts'), path.join(home, '.local', 'share', 'fonts'));
      break;
  }
  dirs.push(appFontsDir());
  return dirs;
}

// Recursively collect supported font file paths. Skips unreadable dirs gracefully.
function collectFontFiles(dir, out, depth = 0) {
  if (depth > 8) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable / missing — skip
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        collectFontFiles(full, out, depth + 1);
      } else if (SUPPORTED_EXT.has(path.extname(entry.name).toLowerCase())) {
        out.push(full);
      }
    } catch {
      // broken symlink or permission error — skip
    }
  }
}

function weightToName(weight) {
  if (WEIGHT_NAMES[weight]) return WEIGHT_NAMES[weight];
  // round to nearest defined bucket
  const buckets = Object.keys(WEIGHT_NAMES).map(Number);
  const nearest = buckets.reduce((a, b) => (Math.abs(b - weight) < Math.abs(a - weight) ? b : a), 400);
  return WEIGHT_NAMES[nearest];
}

// Determine category from panose data first, then fall back to name heuristics.
function detectCategory(font, family) {
  const name = (family || '').toLowerCase();

  // Name-based strong signals first (cheap and reliable for well-named fonts).
  if (/\b(mono|consol|courier|code)\b/.test(name)) return 'Monospace';
  if (/(script|hand|brush|cursive|signature|calligra)/.test(name)) return 'Script';
  if (/(display|decora|poster|stencil|ornament|gothic black|impact)/.test(name)) return 'Decorative';

  // Panose classification (OS/2 table).
  const panose = font['OS/2'] && font['OS/2'].panose;
  if (Array.isArray(panose) && panose.length >= 4) {
    const [familyKind, serifStyle, , proportion] = panose;
    if (proportion === 9) return 'Monospace';
    if (familyKind === 3) return 'Script';
    if (familyKind === 4) return 'Decorative';
    if (familyKind === 2) {
      // Latin Text: serifStyle 11–15 == sans-serif family
      if (serifStyle >= 11 && serifStyle <= 15) return 'Sans-Serif';
      if (serifStyle >= 2 && serifStyle <= 10) return 'Serif';
    }
  }

  // post.isFixedPitch catches monospace fonts panose missed.
  if (font.post && font.post.isFixedPitch) return 'Monospace';

  // Name fallbacks.
  if (/sans/.test(name)) return 'Sans-Serif';
  if (/serif|times|georgia|garamond|roman|slab/.test(name)) return 'Serif';

  return 'Uncategorized';
}

function isItalic(font) {
  const sel = font['OS/2'] && font['OS/2'].fsSelection;
  if (typeof sel === 'number') return (sel & 0x01) !== 0; // bit 0 = italic
  const mac = font.head && font.head.macStyle;
  if (typeof mac === 'number') return (mac & 0x02) !== 0;
  return /italic|oblique/i.test(font.subfamilyName || '');
}

function getWeight(font) {
  const w = font['OS/2'] && font['OS/2'].usWeightClass;
  if (typeof w === 'number' && w >= 1 && w <= 1000) return w;
  if (/bold/i.test(font.subfamilyName || '')) return 700;
  return 400;
}

// Main scan. onProgress(done, total) is optional.
async function scanFonts(onProgress) {
  const fontkit = await getFontkit();
  const files = [];
  for (const dir of systemFontDirs()) collectFontFiles(dir, files);

  const familyMap = new Map(); // family -> { family, category, variants: [] }
  const total = files.length;
  let done = 0;

  for (const file of files) {
    done++;
    if (onProgress && done % 25 === 0) onProgress(done, total);
    let font;
    try {
      font = fontkit.openSync(file);
    } catch {
      continue; // unreadable / unsupported metadata — skip, never crash
    }
    // Skip font collections (.ttc surfaced as collection) — plan excludes them.
    if (!font || font.type === 'TTC' || !font.familyName) continue;

    const family = font.familyName.trim();
    const weight = getWeight(font);
    const italic = isItalic(font);
    const style = italic ? 'italic' : 'normal';

    if (!familyMap.has(family)) {
      familyMap.set(family, { family, category: detectCategory(font, family), variants: [] });
    }
    const fam = familyMap.get(family);

    // Dedupe by weight+style; keep the first file found.
    if (fam.variants.some((v) => v.weight === weight && v.style === style)) continue;

    fam.variants.push({
      path: file,
      fileUrl: pathToFileURL(file).href,
      weight,
      weightName: weightToName(weight),
      style,
      postscriptName: font.postscriptName || '',
      subfamily: font.subfamilyName || '',
    });
  }

  if (onProgress) onProgress(total, total);

  const families = [...familyMap.values()];
  // Sort variants by a familiar priority: Regular, Italic, Bold, Bold Italic,
  // then remaining weights ascending (normal before italic within each weight).
  for (const fam of families) {
    fam.variants.sort((a, b) =>
      styleRank(a) - styleRank(b)
      || a.weight - b.weight
      || (a.style === b.style ? 0 : a.style === 'normal' ? -1 : 1));
  }
  // Sort families alphabetically (case-insensitive).
  families.sort((a, b) => a.family.toLowerCase().localeCompare(b.family.toLowerCase()));

  return { families, count: families.length, scannedAt: Date.now(), version: SCAN_VERSION };
}

module.exports = { scanFonts, appFontsDir, systemFontDirs, SCAN_VERSION };
