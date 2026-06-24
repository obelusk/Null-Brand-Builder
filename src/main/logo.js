// Phase 3.5 — logo color extraction.
// PNG: dominant palette via node-vibrant. SVG: unique fill/stroke values via svgson.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

// node-vibrant v4 exposes the Node backend at the /node subpath (CommonJS).
let _vibrant = null;
function getVibrant() { if (!_vibrant) _vibrant = require('node-vibrant/node'); return _vibrant.Vibrant; }
let _svgson = null;
function getSvgson() { if (!_svgson) _svgson = require('svgson'); return _svgson; }

const NAMED = {
  black: '#000000', white: '#ffffff', red: '#ff0000', lime: '#00ff00', green: '#008000',
  blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff',
  fuchsia: '#ff00ff', gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000',
  navy: '#000080', olive: '#808000', purple: '#800080', teal: '#008080', orange: '#ffa500',
};
const HEXRE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

// Normalize a CSS color token to a 6-digit hex, or null to skip it.
function normColor(v) {
  if (!v) return null;
  v = String(v).trim().toLowerCase();
  if (['none', 'transparent', 'inherit', 'currentcolor'].includes(v) || v.startsWith('url(')) return null;
  if (NAMED[v]) return NAMED[v];
  if (v.startsWith('rgb')) {
    const m = v.match(/\d+\.?\d*/g);
    if (m && m.length >= 3) v = '#' + m.slice(0, 3).map((n) => Math.round(+n).toString(16).padStart(2, '0')).join('');
  }
  if (HEXRE.test(v)) {
    if (v.length === 4) v = '#' + v.slice(1).split('').map((c) => c + c).join('');
    return v;
  }
  return null;
}

async function extractSvg(filePath) {
  const { parse } = getSvgson();
  const tree = await parse(fs.readFileSync(filePath, 'utf8'));
  const colors = new Set();
  (function walk(n) {
    if (!n) return;
    const a = n.attributes || {};
    [a.fill, a.stroke, a['stop-color']].forEach((raw) => { const c = normColor(raw); if (c) colors.add(c); });
    if (a.style) {
      a.style.split(';').forEach((decl) => {
        const i = decl.indexOf(':');
        if (i < 0) return;
        const key = decl.slice(0, i).trim();
        if (/^(fill|stroke|stop-color)$/i.test(key)) { const c = normColor(decl.slice(i + 1)); if (c) colors.add(c); }
      });
    }
    (n.children || []).forEach(walk);
  })(tree);
  return [...colors].sort();
}

async function extractPng(filePath) {
  const Vibrant = getVibrant();
  const p = await Vibrant.from(filePath).getPalette();
  const order = ['Vibrant', 'LightVibrant', 'DarkVibrant', 'Muted', 'LightMuted', 'DarkMuted'];
  return order.map((k) => (p[k] && p[k].hex ? p[k].hex.toLowerCase() : null)).filter(Boolean);
}

async function extractLogoColors(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'Logo file not found.' };
  const ext = path.extname(filePath).toLowerCase();
  try {
    let type, colors;
    if (ext === '.svg') { type = 'svg'; colors = await extractSvg(filePath); }
    else if (ext === '.png') { type = 'png'; colors = await extractPng(filePath); }
    else return { ok: false, error: 'Only PNG and SVG logos are supported.' };
    return { ok: true, type, colors, fileUrl: pathToFileURL(filePath).href, name: path.basename(filePath), path: filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { extractLogoColors };
