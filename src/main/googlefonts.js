// Phase 4 — Google Fonts discovery (optional / online).
// Fetches the webfonts catalog (cached 24h) and downloads .ttf files into the local fonts folder.

const fs = require('fs');
const path = require('path');
const { appFontsDir } = require('./fonts');

const CATALOG_URL = 'https://www.googleapis.com/webfonts/v1/webfonts';
const CACHE_MS = 24 * 60 * 60 * 1000;

// Map Google's categories onto the app's category set.
const CAT_MAP = {
  'sans-serif': 'Sans-Serif',
  serif: 'Serif',
  display: 'Decorative',
  handwriting: 'Script',
  monospace: 'Monospace',
};

async function fetchCatalog(key) {
  const url = `${CATALOG_URL}?sort=popularity&key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) {
    let msg = `Google Fonts API returned ${res.status}`;
    try { const j = await res.json(); if (j.error && j.error.message) msg = j.error.message; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const json = await res.json();
  return (json.items || []).map((it) => ({
    family: it.family,
    category: CAT_MAP[it.category] || 'Uncategorized',
    variants: it.variants || [],
    files: it.files || {},
    previewUrl: it.files ? (it.files.regular || it.files['400'] || Object.values(it.files)[0] || '') : '',
  }));
}

// Download every variant file for a family into ~/NullBrandBuilder/fonts/.
async function downloadFamily(family, files) {
  const destDir = appFontsDir();
  fs.mkdirSync(destDir, { recursive: true });
  const safeFamily = family.replace(/[^a-z0-9]+/gi, '');
  const written = [];
  for (const [variant, url] of Object.entries(files || {})) {
    if (!url) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = url.toLowerCase().endsWith('.otf') ? '.otf' : '.ttf';
      const fp = path.join(destDir, `${safeFamily}-${variant}${ext}`);
      fs.writeFileSync(fp, buf);
      written.push(fp);
    } catch {
      // skip a failed variant; keep going
    }
  }
  return written;
}

module.exports = { fetchCatalog, downloadFamily, CACHE_MS };
