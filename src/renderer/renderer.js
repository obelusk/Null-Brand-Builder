/* Null Brand Builder — renderer. Plain browser script (no modules). */

// ---- Mirrored constants (kept in sync with src/shared/constants.js) ----
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
const FAVORITES_CAT = '★ Favorites'; // pseudo-category that filters to favorited families

// ---- Color math ----
function hexToRgb(hex) {
  let h = String(hex).replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2; const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}
function rgbToCmyk({ r, g, b }) {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const k = 1 - Math.max(rr, gg, bb);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
  const c = (1 - rr - k) / (1 - k);
  const m = (1 - gg - k) / (1 - k);
  const y = (1 - bb - k) / (1 - k);
  return { c: Math.round(c * 100), m: Math.round(m * 100), y: Math.round(y * 100), k: Math.round(k * 100) };
}
function relLum({ r, g, b }) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const la = relLum(hexToRgb(a)), lb = relLum(hexToRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function isValidHex(v) { return /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(String(v).trim()); }
function normHex(v) {
  let h = String(v).trim();
  if (h[0] !== '#') h = '#' + h;
  h = h.toLowerCase();
  if (h.length === 4) h = '#' + h.slice(1).split('').map((c) => c + c).join(''); // #abc -> #aabbcc
  return h;
}

// ---- App state ----
let fontData = { families: [] };
let familyByName = new Map();
let favorites = new Set(); // global favorited family names (persisted in main)
const activeCategoryList = ['All', FAVORITES_CAT, ...CATEGORIES]; // present-only set rebuilt after scan

const state = {
  name: '',
  levels: {}, // id -> { family, category, weight, style, size }
  texts: {},  // id -> string
  colors: {},
  bg: 'base',
  logo: null, // { path, type, name, fileUrl, colors:[], backing }
};
LEVELS.forEach((l) => {
  state.levels[l.id] = { family: '', category: 'All', weight: l.defaultWeight, style: 'normal', size: l.defaultSize };
});
COLOR_ROLES.forEach((r) => { state.colors[r.id] = r.default; });

let activeLevelId = LEVELS[0].id;
let activeColorRole = COLOR_ROLES[0].id;
const loadedFonts = new Set();

// ---- DOM refs ----
const $ = (sel) => document.querySelector(sel);
const canvasEl = $('#canvas');
const typeControlsEl = $('#typeControls');
const colorControlsEl = $('#colorControls');
const fontFaceStyle = document.createElement('style');
document.head.appendChild(fontFaceStyle);
const gfPreviewStyle = document.createElement('style'); // remote Google Fonts previews
document.head.appendChild(gfPreviewStyle);
let gfItems = []; // cached Google Fonts catalog

// ---- Toast ----
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---- Font face injection ----
function variantFor(level) {
  const fam = familyByName.get(level.family);
  if (!fam) return null;
  return fam.variants.find((v) => v.weight === level.weight && v.style === level.style)
    || fam.variants.find((v) => v.weight === level.weight)
    || fam.variants[0] || null;
}
// The default variant for a family is always Regular (400 normal) when present,
// then any normal-style variant, then whatever comes first in priority order.
function regularVariant(fam) {
  if (!fam) return null;
  return fam.variants.find((v) => v.weight === 400 && v.style === 'normal')
    || fam.variants.find((v) => v.style === 'normal')
    || fam.variants[0] || null;
}
// Conventional style label: 400 → Regular/Italic, 700 → Bold/Bold Italic, else weight name + Italic.
function variantLabel(v) {
  if (v.weight === 400) return v.style === 'italic' ? 'Italic' : 'Regular';
  return v.weightName + (v.style === 'italic' ? ' Italic' : '');
}
// Namespace preview fonts so they can never override the app's own UI fonts
// (e.g. Segoe UI / Roboto), which would re-shape the toolbar and make it jump.
function fontAlias(family) { return 'nbbf-' + family; }
function injectFont(family, variant) {
  if (!variant || !family) return;
  const key = `${family}|${variant.weight}|${variant.style}`;
  if (loadedFonts.has(key)) return;
  loadedFonts.add(key);
  fontFaceStyle.appendChild(document.createTextNode(
    `@font-face{font-family:"${fontAlias(family)}";src:url("${variant.fileUrl}");font-weight:${variant.weight};font-style:${variant.style};font-display:swap;}`
  ));
}

// ---- Build canvas ----
function buildCanvas() {
  canvasEl.innerHTML = '';

  // Logo sits at the top of the preview card (Phase 3.5).
  const logoBox = document.createElement('div');
  logoBox.className = 'canvas-logo';
  logoBox.id = 'canvasLogo';
  logoBox.style.display = 'none';
  canvasEl.appendChild(logoBox);

  LEVELS.forEach((lvl) => {
    const wrap = document.createElement('div');
    wrap.className = 'level';
    wrap.dataset.id = lvl.id;
    wrap.tabIndex = 0;

    const tag = document.createElement('span');
    tag.className = 'level-tag';
    tag.textContent = lvl.label;

    const text = document.createElement('div');
    text.className = 'level-text';
    text.contentEditable = 'true';
    text.spellcheck = false;
    text.dataset.placeholder = lvl.placeholder;
    text.dataset.id = lvl.id;
    text.textContent = state.texts[lvl.id] || lvl.placeholder;

    text.addEventListener('input', () => {
      state.texts[lvl.id] = text.textContent;
      scheduleAutosave();
    });
    text.addEventListener('focusin', () => setActiveLevel(lvl.id));
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); wrap.focus(); }
    });

    wrap.addEventListener('focusin', () => setActiveLevel(lvl.id));
    wrap.addEventListener('mousedown', (e) => {
      if (e.target === wrap || e.target === tag) { e.preventDefault(); wrap.focus(); }
    });

    wrap.append(tag, text);
    canvasEl.appendChild(wrap);
  });
  renderCanvasLogo();
}

function setActiveLevel(id) {
  activeLevelId = id;
  document.querySelectorAll('.level').forEach((el) => el.classList.toggle('active', el.dataset.id === id));
  document.querySelectorAll('.type-row').forEach((el) => el.classList.toggle('active', el.dataset.id === id));
}

// Cycle the currently active level's font (←/→) or category (↑/↓).
function cycleActiveLevel(key) {
  const id = activeLevelId;
  if (!id) return;
  const lvl = state.levels[id];
  const fams = filteredFamilies(id);

  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    if (!fams.length) return;
    let idx = fams.findIndex((f) => f.family === lvl.family);
    if (idx < 0) idx = 0;
    idx = (idx + (key === 'ArrowRight' ? 1 : -1) + fams.length) % fams.length;
    setFamily(id, fams[idx].family);
  } else if (key === 'ArrowUp' || key === 'ArrowDown') {
    let ci = activeCategoryList.indexOf(lvl.category);
    if (ci < 0) ci = 0;
    ci = (ci + (key === 'ArrowDown' ? 1 : -1) + activeCategoryList.length) % activeCategoryList.length;
    lvl.category = activeCategoryList[ci];
    const opts = filteredFamilies(id);
    if (opts.length && !opts.some((f) => f.family === lvl.family)) setFamily(id, opts[0].family, true);
    renderTypeControls();
  }
}

async function toggleFavoriteForLevel(id) {
  const fam = state.levels[id] && state.levels[id].family;
  if (!fam) { toast('Pick a font first'); return; }
  favorites = new Set(await window.api.toggleFavorite(fam));
  renderTypeControls();
  toast(favorites.has(fam) ? `★ ${fam} added to favorites` : `${fam} removed from favorites`);
}

// ---- Typography controls panel ----
function familiesInCategory(cat) {
  if (cat === 'All') return fontData.families;
  if (cat === FAVORITES_CAT) return fontData.families.filter((f) => favorites.has(f.family));
  return fontData.families.filter((f) => f.category === cat);
}

function filteredFamilies(id) {
  const lvl = state.levels[id];
  const search = (lvl._search || '').toLowerCase();
  return familiesInCategory(lvl.category).filter((f) => !search || f.family.toLowerCase().includes(search));
}

// Build <option>s, prefixing favorites with ★ and guaranteeing the selected family stays visible
// even when the active filter would otherwise exclude it.
function familyOptionsHtml(fams, selFamily) {
  let list = fams;
  if (selFamily && !fams.some((f) => f.family === selFamily) && familyByName.has(selFamily)) {
    list = [familyByName.get(selFamily), ...fams];
  }
  return list.map((f) => {
    const star = favorites.has(f.family) ? '★ ' : '';
    return `<option value="${escAttr(f.family)}"${f.family === selFamily ? ' selected' : ''}>${star}${escHtml(f.family)}</option>`;
  }).join('');
}

function renderTypeControls() {
  typeControlsEl.innerHTML = '';
  LEVELS.forEach((lvl) => {
    const st = state.levels[lvl.id];
    const row = document.createElement('div');
    row.className = 'type-row' + (lvl.id === activeLevelId ? ' active' : '');
    row.dataset.id = lvl.id;

    const fams = filteredFamilies(lvl.id);
    const fam = familyByName.get(st.family);
    const variants = fam ? fam.variants : [];

    row.innerHTML = `
      <div class="type-row-head">
        <span class="caret">▸</span>
        <span class="type-row-label">${lvl.label}</span>
        <span class="type-row-meta">${fam ? escHtml(fam.family) : '—'} · ${st.size}px</span>
      </div>
      <div class="type-row-body">
        <div class="ctl">
          <select class="cat-select" data-id="${lvl.id}">
            ${activeCategoryList.map((c) => `<option value="${c}"${c === st.category ? ' selected' : ''}>${c}</option>`).join('')}
          </select>
          <select class="family-select" data-id="${lvl.id}">
            ${familyOptionsHtml(fams, st.family)}
          </select>
          <button class="fav-btn${favorites.has(st.family) ? ' on' : ''}" data-id="${lvl.id}"
                  title="${favorites.has(st.family) ? 'Remove from favorites' : 'Add to favorites'}"
                  aria-label="Toggle favorite">${favorites.has(st.family) ? '★' : '☆'}</button>
        </div>
        <div class="ctl">
          <input class="font-search" data-id="${lvl.id}" type="text" placeholder="Search fonts…" value="${escAttr(st._search || '')}" />
        </div>
        <div class="ctl">
          <select class="weight-select" data-id="${lvl.id}">
            ${variants.map((v) => {
              const val = `${v.weight}:${v.style}`;
              const sel = (v.weight === st.weight && v.style === st.style) ? ' selected' : '';
              return `<option value="${val}"${sel}>${variantLabel(v)}</option>`;
            }).join('') || '<option>Regular</option>'}
          </select>
          <input class="size-input" data-id="${lvl.id}" type="number" min="8" max="200" value="${st.size}" />
        </div>
      </div>`;
    typeControlsEl.appendChild(row);
  });

  // wire events (delegated per render)
  typeControlsEl.querySelectorAll('.cat-select').forEach((el) => el.addEventListener('change', (e) => {
    const id = e.target.dataset.id, st = state.levels[id];
    st.category = e.target.value;
    const opts = filteredFamilies(id);
    if (opts.length && !opts.some((f) => f.family === st.family)) setFamily(id, opts[0].family, true);
    renderTypeControls();
  }));
  typeControlsEl.querySelectorAll('.family-select').forEach((el) => el.addEventListener('change', (e) =>
    setFamily(e.target.dataset.id, e.target.value)));
  typeControlsEl.querySelectorAll('.weight-select').forEach((el) => el.addEventListener('change', (e) => {
    const id = e.target.dataset.id, [w, s] = e.target.value.split(':');
    state.levels[id].weight = Number(w); state.levels[id].style = s;
    applyLevel(id); scheduleAutosave();
  }));
  typeControlsEl.querySelectorAll('.size-input').forEach((el) => el.addEventListener('input', (e) => {
    const id = e.target.dataset.id;
    state.levels[id].size = Number(e.target.value) || 16;
    applyLevel(id);
    const meta = typeControlsEl.querySelector(`.type-row[data-id="${id}"] .type-row-meta`);
    if (meta) { const fam = familyByName.get(state.levels[id].family); meta.textContent = `${fam ? fam.family : '—'} · ${state.levels[id].size}px`; }
    scheduleAutosave();
  }));
  typeControlsEl.querySelectorAll('.font-search').forEach((el) => el.addEventListener('input', (e) => {
    const id = e.target.dataset.id;
    state.levels[id]._search = e.target.value;
    refreshFamilySelect(id);
  }));
  typeControlsEl.querySelectorAll('.fav-btn').forEach((el) => el.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFavoriteForLevel(e.currentTarget.dataset.id);
  }));
  typeControlsEl.querySelectorAll('.type-row').forEach((el) => el.addEventListener('mousedown', () => setActiveLevel(el.dataset.id)));
}

// Update only one family <select> without losing search-field focus.
function refreshFamilySelect(id) {
  const sel = typeControlsEl.querySelector(`.family-select[data-id="${id}"]`);
  if (!sel) return;
  const st = state.levels[id];
  sel.innerHTML = familyOptionsHtml(filteredFamilies(id), st.family);
}

function setFamily(id, family, skipRerender) {
  const st = state.levels[id];
  st.family = family;
  // Selecting a font always defaults to its Regular style.
  const v = regularVariant(familyByName.get(family));
  if (v) { st.weight = v.weight; st.style = v.style; }
  applyLevel(id);
  if (!skipRerender) renderTypeControls();
  scheduleAutosave();
}

function applyLevel(id) {
  const lvl = LEVELS.find((l) => l.id === id);
  const st = state.levels[id];
  const wrap = canvasEl.querySelector(`.level[data-id="${id}"] .level-text`);
  if (!wrap) return;
  const variant = variantFor(st);
  injectFont(st.family, variant);
  wrap.style.fontFamily = st.family ? `"${fontAlias(st.family)}", system-ui, sans-serif` : 'system-ui, sans-serif';
  wrap.style.fontSize = st.size + 'px';
  wrap.style.fontWeight = st.weight;
  wrap.style.fontStyle = st.style;
  wrap.style.color = state.colors[lvl.colorRole];
  wrap.style.lineHeight = id === 'body' ? '1.6' : '1.15';
}

// ---- Color controls ----
function renderColorControls() {
  colorControlsEl.innerHTML = '<div class="color-chips" id="colorChips"></div><div class="color-detail" id="colorDetail"></div>';
  renderColorChips();
  renderColorDetail();
}

function renderColorChips() {
  const chips = document.getElementById('colorChips');
  if (!chips) return;
  chips.innerHTML = COLOR_ROLES.map((r) => {
    const short = r.label.split(' / ')[0];
    return `<button class="color-chip${r.id === activeColorRole ? ' active' : ''}" data-role="${r.id}" title="${escAttr(r.label)}">
      <span class="chip-sw" style="background:${state.colors[r.id]}"></span>
      <span class="chip-label">${short}</span>
    </button>`;
  }).join('');
  chips.querySelectorAll('.color-chip').forEach((b) => b.addEventListener('click', () => {
    activeColorRole = b.dataset.role;
    renderColorChips();
    renderColorDetail();
  }));
}

// Readability/role descriptor for the badge shown in the detail panel.
function colorBadgeInfo(roleId, hex) {
  if (roleId === 'base') {
    return { cls: 'neutral', txt: 'Background', title: 'This is the page background. The other colors are checked for readability against it.' };
  }
  const ratio = contrast(hex, state.colors.base);
  let cls, txt;
  if (ratio >= 7) { cls = 'pass'; txt = '✓ Easy to read'; }
  else if (ratio >= 4.5) { cls = 'pass'; txt = '✓ Readable'; }
  else if (ratio >= 3) { cls = 'aa'; txt = '△ Large text only'; }
  else { cls = 'fail'; txt = '✕ Hard to read'; }
  return { cls, txt, title: `On the background this scores ${ratio.toFixed(1)}:1. Higher is easier to read — 4.5:1+ for normal text, 3:1 for large headings.` };
}

function renderColorDetail() {
  const detail = document.getElementById('colorDetail');
  if (!detail) return;
  const role = COLOR_ROLES.find((r) => r.id === activeColorRole) || COLOR_ROLES[0];
  const hex = state.colors[role.id];
  const badge = colorBadgeInfo(role.id, hex);
  detail.innerHTML = `
    <div class="detail-head">
      <span class="detail-role">${role.label}</span>
      <span class="contrast-badge ${badge.cls}" title="${escAttr(badge.title)}">${badge.txt}</span>
    </div>
    <div class="detail-pick">
      <input class="swatch-input" type="color" value="${hex}" data-role="${role.id}" aria-label="${escAttr(role.label)} color" />
      <input class="color-hex" type="text" value="${hex}" data-role="${role.id}" spellcheck="false" maxlength="7" />
    </div>
    <ul class="fmt-list" id="fmtList"></ul>`;
  detail.querySelector('.swatch-input').addEventListener('input', (e) => setColor(role.id, e.target.value));
  detail.querySelector('.color-hex').addEventListener('input', (e) => {
    if (isValidHex(e.target.value)) setColor(role.id, normHex(e.target.value));
  });
  updateColorReadouts();
}

function setColor(role, hex) {
  state.colors[role] = normHex(hex);
  document.documentElement.style.setProperty(`--color-${role}`, state.colors[role]);
  LEVELS.forEach((l) => { if (l.colorRole === role) applyLevel(l.id); });
  applyBackground();
  if (role === activeColorRole) {
    const sw = document.querySelector(`#colorDetail .swatch-input[data-role="${role}"]`);
    const tx = document.querySelector(`#colorDetail .color-hex[data-role="${role}"]`);
    if (sw) sw.value = state.colors[role];
    if (tx && document.activeElement !== tx) tx.value = state.colors[role];
  }
  updateColorReadouts();
  scheduleAutosave();
}

// In-place refresh: chip colors (all) + format lines and badge (active role only).
function updateColorReadouts() {
  // Each chip reflects its color and flags a readability warning with an outline.
  COLOR_ROLES.forEach((r) => {
    const chip = colorControlsEl.querySelector(`.color-chip[data-role="${r.id}"]`);
    const sw = chip && chip.querySelector('.chip-sw');
    if (!sw) return;
    sw.style.background = state.colors[r.id];
    const info = colorBadgeInfo(r.id, state.colors[r.id]);
    sw.classList.toggle('warn-aa', info.cls === 'aa');
    sw.classList.toggle('warn-fail', info.cls === 'fail');
    chip.title = r.id === 'base' ? r.label : `${r.label} — ${info.txt}`;
  });
  const role = COLOR_ROLES.find((r) => r.id === activeColorRole) || COLOR_ROLES[0];
  const hex = state.colors[role.id];
  const list = document.getElementById('fmtList');
  if (list) {
    const { r, g, b } = hexToRgb(hex);
    const { h, s, l } = rgbToHsl({ r, g, b });
    const { c, m, y, k } = rgbToCmyk({ r, g, b });
    const rows = [
      ['RGB', `rgb(${r}, ${g}, ${b})`],
      ['HSL', `hsl(${h}, ${s}%, ${l}%)`],
      ['CMYK', `cmyk(${c}%, ${m}%, ${y}%, ${k}%)`],
    ];
    list.innerHTML = rows.map(([key, val]) =>
      `<li><span class="fmt-key">${key}</span><span class="fmt-val" data-copy="${val}" title="Click to copy">${val}</span></li>`).join('');
    list.querySelectorAll('.fmt-val').forEach((el) => el.addEventListener('click', () => {
      navigator.clipboard.writeText(el.dataset.copy).then(() => toast('Copied ' + el.dataset.copy)).catch(() => {});
    }));
  }
  const badgeEl = document.querySelector('#colorDetail .contrast-badge');
  if (badgeEl) {
    const info = colorBadgeInfo(role.id, hex);
    badgeEl.className = 'contrast-badge ' + info.cls;
    badgeEl.textContent = info.txt;
    badgeEl.title = info.title;
  }
}

function applyBackground() {
  canvasEl.classList.remove('bg-light', 'bg-dark');
  if (state.bg === 'base') canvasEl.style.background = state.colors.base;
  else { canvasEl.style.background = ''; canvasEl.classList.add('bg-' + state.bg); }
}

// ---- Apply full state to UI ----
function applyAll() {
  COLOR_ROLES.forEach((r) => document.documentElement.style.setProperty(`--color-${r.id}`, state.colors[r.id]));
  LEVELS.forEach((l) => applyLevel(l.id));
  applyBackground();
}

// ---- Logo (Phase 3.5) ----
function renderCanvasLogo() {
  const box = document.getElementById('canvasLogo');
  if (!box) return;
  if (state.logo && state.logo.fileUrl) {
    box.style.display = 'inline-flex';
    box.innerHTML = `<img src="${state.logo.fileUrl}" alt="logo" />`;
  } else {
    box.style.display = 'none';
    box.innerHTML = '';
  }
}

function renderLogoPanel() {
  const drop = $('#logoDrop');
  const empty = drop.querySelector('.logo-drop-empty');
  const loaded = drop.querySelector('.logo-loaded');
  const tools = $('#logoTools');
  if (state.logo) {
    empty.classList.add('hidden');
    loaded.classList.remove('hidden');
    $('#logoName').textContent = state.logo.name || 'logo';
    $('#logoBadge').textContent = (state.logo.type || '').toUpperCase();
    tools.classList.remove('hidden');
    renderSwatches();
  } else {
    empty.classList.remove('hidden');
    loaded.classList.add('hidden');
    tools.classList.add('hidden');
  }
}

function renderSwatches() {
  const wrap = $('#logoSwatches');
  wrap.innerHTML = '';
  const colors = (state.logo && state.logo.colors) || [];
  if (!colors.length) { wrap.innerHTML = '<span class="swatch-empty">No colors found in this file.</span>'; return; }
  colors.forEach((hex) => {
    const el = document.createElement('div');
    el.className = 'logo-swatch';
    el.style.background = hex;
    el.title = `Click to assign ${hex}`;
    el.innerHTML = `<span class="sw-hex">${hex}</span>`;
    el.addEventListener('click', (e) => openAssignPopover(e.currentTarget, hex));
    wrap.appendChild(el);
  });
}

function closeAssignPopover() {
  const pop = document.getElementById('assignPop');
  if (pop) pop.remove();
  document.removeEventListener('mousedown', outsideAssign, true);
}
function outsideAssign(e) {
  const pop = document.getElementById('assignPop');
  if (pop && !pop.contains(e.target)) closeAssignPopover();
}
function openAssignPopover(anchor, hex) {
  closeAssignPopover();
  const pop = document.createElement('div');
  pop.className = 'assign-pop';
  pop.id = 'assignPop';
  pop.innerHTML = `<div class="assign-title">Assign ${hex} to:</div>` +
    COLOR_ROLES.map((r) => `<button data-role="${r.id}"><span class="dot" style="background:${hex}"></span>${r.label}</button>`).join('');
  document.body.appendChild(pop);
  const rect = anchor.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - pop.offsetWidth - 10)) + 'px';
  pop.style.top = Math.min(rect.bottom + 6, window.innerHeight - pop.offsetHeight - 10) + 'px';
  pop.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    activeColorRole = b.dataset.role;
    setColor(b.dataset.role, hex);
    renderColorChips();
    renderColorDetail();
    closeAssignPopover();
    toast(`${hex} → ${COLOR_ROLES.find((r) => r.id === b.dataset.role).label}`);
  }));
  setTimeout(() => document.addEventListener('mousedown', outsideAssign, true), 0);
}

function handleLogoResult(res) {
  if (!res || res.canceled) return;
  if (!res.ok) { toast(res.error || 'Could not read logo'); return; }
  state.logo = {
    path: res.path, type: res.type, name: res.name, fileUrl: res.fileUrl,
    colors: res.colors,
  };
  renderLogoPanel();
  renderCanvasLogo();
  scheduleAutosave();
  toast(`Logo loaded — ${res.colors.length} color${res.colors.length === 1 ? '' : 's'}`);
}

async function loadLogoFromFile(file) {
  if (!file) return;
  const path = window.api.getPathForFile(file);
  handleLogoResult(await window.api.extractLogo(path));
}

function wireLogo() {
  const drop = $('#logoDrop');
  const input = $('#logoFileInput');

  drop.addEventListener('click', () => input.click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { loadLogoFromFile(input.files[0]); input.value = ''; });

  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) loadLogoFromFile(e.dataTransfer.files[0]);
  });

  $('#btnReextract').addEventListener('click', async () => {
    if (!state.logo) return;
    const res = await window.api.extractLogo(state.logo.path);
    if (!res.ok) { toast(res.error || 'Logo file not found — re-upload'); return; }
    state.logo.colors = res.colors;
    state.logo.fileUrl = res.fileUrl;
    renderSwatches();
    renderCanvasLogo();
    scheduleAutosave();
    toast('Re-extracted colors');
  });

  $('#btnRemoveLogo').addEventListener('click', () => {
    state.logo = null; // does not touch palette colors already assigned
    renderLogoPanel();
    renderCanvasLogo();
    scheduleAutosave();
    toast('Logo removed');
  });
}

// Restore a saved logo by re-reading its file; show a friendly prompt if it has moved.
function restoreLogo(saved) {
  if (!saved || !saved.path) { state.logo = null; renderLogoPanel(); renderCanvasLogo(); return; }
  state.logo = { ...saved };
  window.api.extractLogo(saved.path).then((res) => {
    if (res.ok) {
      state.logo.fileUrl = res.fileUrl; state.logo.colors = res.colors;
      state.logo.name = res.name; state.logo.type = res.type;
    } else {
      state.logo = null;
      toast('Saved logo file not found — re-upload it.');
    }
    renderLogoPanel();
    renderCanvasLogo();
  });
}

// ---- Kits ----
function currentState() {
  return {
    name: $('#kitName').value.trim(),
    levels: JSON.parse(JSON.stringify(state.levels)),
    texts: { ...state.texts },
    colors: { ...state.colors },
    bg: state.bg,
    logo: state.logo ? {
      path: state.logo.path, type: state.logo.type, name: state.logo.name,
      colors: state.logo.colors,
    } : null,
  };
}
function applyState(s) {
  if (!s) return;
  $('#kitName').value = s.name || '';
  state.name = s.name || '';
  if (s.colors) Object.assign(state.colors, s.colors);
  COLOR_ROLES.forEach((r) => { if (state.colors[r.id]) state.colors[r.id] = normHex(state.colors[r.id]); });
  if (s.bg) state.bg = s.bg;
  LEVELS.forEach((l) => {
    if (s.levels && s.levels[l.id]) Object.assign(state.levels[l.id], s.levels[l.id]);
    if (s.texts && typeof s.texts[l.id] === 'string') state.texts[l.id] = s.texts[l.id];
  });
  buildCanvas();
  renderTypeControls();
  renderColorControls();
  applyAll();
  restoreLogo(s.logo);
}

// Build a self-contained one-page brand-sheet HTML (fonts embedded as file:// @font-face).
function buildBrandSheetHtml() {
  const c = state.colors;
  let faces = '';
  const specimens = LEVELS.map((lvl) => {
    const st = state.levels[lvl.id];
    const v = variantFor(st);
    let famCss = 'system-ui, sans-serif';
    if (st.family && v) {
      const alias = 'pf-' + lvl.id;
      faces += `@font-face{font-family:"${alias}";src:url("${v.fileUrl}");font-weight:${v.weight};font-style:${v.style};}`;
      // Single quotes here: this string goes inside a double-quoted style="" attribute,
      // so double quotes would terminate the attribute and break font-family.
      famCss = `'${alias}', system-ui, sans-serif`;
    }
    const text = state.texts[lvl.id] || lvl.placeholder;
    const wname = v ? v.weightName + (v.style === 'italic' ? ' Italic' : '') : '';
    return `<div class="spec">
      <div class="spec-meta">${escHtml(lvl.label)} · ${escHtml(st.family || '—')}${wname ? ' ' + wname : ''} · ${st.size}px</div>
      <div class="spec-text" style="font-family:${famCss};font-size:${st.size}px;font-weight:${st.weight};font-style:${st.style};color:${c[lvl.colorRole]};line-height:${lvl.id === 'body' ? 1.6 : 1.15}">${escHtml(text)}</div>
    </div>`;
  }).join('');

  const swatches = COLOR_ROLES.map((r) => {
    const hex = c[r.id]; const { r: rr, g, b } = hexToRgb(hex);
    const { c: cy, m, y, k } = rgbToCmyk({ r: rr, g, b });
    return `<div class="sw"><div class="sw-chip" style="background:${hex}"></div>
      <div><div class="sw-role">${escHtml(r.label)}</div>
        <div class="sw-val">${hex.toUpperCase()}</div>
        <div class="sw-val">rgb(${rr}, ${g}, ${b})</div>
        <div class="sw-val">cmyk(${cy}%, ${m}%, ${y}%, ${k}%)</div>
      </div></div>`;
  }).join('');

  const logoSection = state.logo && state.logo.fileUrl
    ? `<div class="section-h">Logo</div><div class="logo"><img src="${state.logo.fileUrl}" /></div>`
    : '';
  const title = state.name || 'Untitled Brand Kit';

  // The document itself is pure white with neutral chrome; only the type specimens
  // carry the brand's fonts, colors, and sizes.
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page { margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #ffffff; color: #1a1a1a; }
    ${faces}
    .sheet { padding: 48px 56px; }
    .eyebrow { font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: #999; margin: 0 0 4px; }
    .kit-name { font-size: 26px; font-weight: 700; margin: 0 0 26px; color: #1a1a1a; }
    .logo { margin-bottom: 30px; } .logo img { max-height: 88px; max-width: 360px; }
    .section-h { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #999; border-bottom: 1px solid #ddd; padding-bottom: 6px; margin: 0 0 18px; }
    .palette { display: flex; flex-wrap: wrap; gap: 24px; margin-bottom: 36px; }
    .sw { display: flex; gap: 11px; align-items: flex-start; }
    .sw-chip { width: 48px; height: 48px; border-radius: 8px; border: 1px solid #ddd; flex: 0 0 auto; }
    .sw-role { font-size: 12px; font-weight: 600; color: #1a1a1a; margin-bottom: 2px; }
    .sw-val { font-family: ui-monospace, monospace; font-size: 10.5px; color: #555; }
    .spec { margin-bottom: 22px; }
    .spec-meta { font-size: 10px; letter-spacing: .5px; color: #999; margin-bottom: 4px; }
    .spec-text { word-break: break-word; }
    .foot { margin-top: 32px; font-size: 10px; color: #aaa; }
  </style></head><body><div class="sheet">
    <div class="eyebrow">Brand Kit</div>
    <div class="kit-name">${escHtml(title)}</div>
    ${logoSection}
    <div class="section-h">Color Palette</div>
    <div class="palette">${swatches}</div>
    <div class="section-h">Typography</div>
    ${specimens}
    <div class="foot">Generated with Null Brand Builder</div>
  </div></body></html>`;
}

async function refreshKitList() {
  const kits = await window.api.listKits();
  const ul = $('#kitList');
  ul.innerHTML = '';
  if (!kits.length) { ul.innerHTML = '<li class="kit-list-empty">No saved kits yet.</li>'; return; }
  kits.forEach((k) => {
    const li = document.createElement('li');
    const date = k.savedAt ? new Date(k.savedAt).toLocaleDateString() : '';
    li.innerHTML = `
      <div class="kit-info"><div class="kit-title">${escHtml(k.name)}</div><div class="kit-date">${date}</div></div>
      <button class="icon-btn" data-load="${escAttr(k.name)}" title="Load">↥</button>
      <button class="icon-btn danger" data-del="${escAttr(k.name)}" title="Delete">✕</button>`;
    ul.appendChild(li);
  });
  ul.querySelectorAll('[data-load]').forEach((b) => b.addEventListener('click', async () => {
    const s = await window.api.loadKit(b.dataset.load);
    applyState(s); toast(`Loaded “${b.dataset.load}”`);
  }));
  ul.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    await window.api.deleteKit(b.dataset.del); refreshKitList(); toast(`Deleted “${b.dataset.del}”`);
  }));
}

// ---- Autosave (debounced) ----
let autosaveTimer = null;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => window.api.saveSession(currentState()), 600);
}

// ---- Randomize ----
function randomize() {
  LEVELS.forEach((lvl) => {
    const st = state.levels[lvl.id];
    const pool = familiesInCategory(st.category);
    if (!pool.length) return;
    const fam = pool[Math.floor(Math.random() * pool.length)];
    st.family = fam.family;
    const v = fam.variants[Math.floor(Math.random() * fam.variants.length)];
    if (v) { st.weight = v.weight; st.style = v.style; }
  });
  renderTypeControls();
  applyAll();
  scheduleAutosave();
  toast('Randomized fonts');
}

// ---- Helpers ----
function escHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function escAttr(s) { return String(s).replace(/"/g, '&quot;'); }

// ---- Bootstrap ----
async function init() {
  buildCanvas();
  renderColorControls();
  wireTopbar();
  wireLogo();
  wireDiscover();
  wireCompare();
  wireGlobalKeys();

  // Load fonts (cached or scan)
  const overlay = $('#scanOverlay');
  let progressOff = null;
  const cached = await window.api.getFonts({ force: false });
  if (cached && cached.families && cached.families.length) {
    setFontData(cached);
  } else {
    overlay.classList.remove('hidden');
    progressOff = window.api.onScanProgress(({ done, total }) => {
      $('#scanText').textContent = `Scanning fonts… ${done}/${total}`;
      $('#scanBarFill').style.width = total ? `${(done / total) * 100}%` : '0%';
    });
    const data = await window.api.getFonts({ force: true });
    setFontData(data);
    overlay.classList.add('hidden');
    if (progressOff) progressOff();
  }

  // Load the global favorites list before any font UI renders.
  favorites = new Set(await window.api.getFavorites());

  // Restore last session, else seed sensible defaults
  const session = await window.api.getSession();
  if (session) applyState(session);
  else seedDefaults();

  renderTypeControls();
  applyAll();
  renderLogoPanel();
  setActiveLevel(activeLevelId);
  refreshKitList();
}
window.addEventListener('error', (e) => console.error('[error] ' + e.message + ' @' + e.filename + ':' + e.lineno));

function setFontData(data) {
  fontData = data;
  familyByName = new Map(data.families.map((f) => [f.family, f]));
  // rebuild category list to only those present
  const present = CATEGORIES.filter((c) => data.families.some((f) => f.category === c));
  activeCategoryList.length = 0;
  activeCategoryList.push('All', FAVORITES_CAT, ...present);
}

// Prefer a plain, widely-available sans-serif so the starting point is a neutral blank slate.
const GENERIC_FONT_PREFS = ['Arial', 'Helvetica', 'Helvetica Neue', 'Segoe UI', 'Roboto',
  'Liberation Sans', 'DejaVu Sans', 'Verdana', 'Tahoma'];

function pickGenericFamily() {
  for (const name of GENERIC_FONT_PREFS) if (familyByName.has(name)) return familyByName.get(name);
  return fontData.families.find((f) => f.category === 'Sans-Serif') || fontData.families[0] || null;
}

// Restore the neutral defaults: one generic sans across all levels + the monochrome palette.
// resetText=true also clears any edited preview copy back to the placeholders.
function applyDefaults(resetText) {
  const fam = pickGenericFamily();
  LEVELS.forEach((l) => {
    const st = state.levels[l.id];
    st.category = 'All';
    st._search = '';
    st.size = l.defaultSize;
    st.weight = 400;
    st.style = 'normal';
    if (fam) {
      st.family = fam.family;
      const v = regularVariant(fam); // always start at Regular
      if (v) { st.weight = v.weight; st.style = v.style; }
    }
    if (resetText) state.texts[l.id] = l.placeholder;
  });
  COLOR_ROLES.forEach((r) => { state.colors[r.id] = r.default; });
  state.bg = 'base';
}

function seedDefaults() { applyDefaults(true); }

function wireTopbar() {
  $('#btnRefreshFonts').addEventListener('click', async () => {
    const overlay = $('#scanOverlay'); overlay.classList.remove('hidden');
    const off = window.api.onScanProgress(({ done, total }) => {
      $('#scanText').textContent = `Scanning fonts… ${done}/${total}`;
      $('#scanBarFill').style.width = total ? `${(done / total) * 100}%` : '0%';
    });
    const data = await window.api.getFonts({ force: true });
    setFontData(data);
    overlay.classList.add('hidden'); off();
    renderTypeControls();
    toast(`Found ${data.count} font families`);
  });

  $('#btnRandomize').addEventListener('click', randomize);

  $('#btnReset').addEventListener('click', () => {
    applyDefaults(false); // keep edited text + kit name; reset fonts, sizes, and colors
    $('#cvdSelect').value = '';
    canvasEl.style.filter = '';
    document.querySelectorAll('.seg-btn[data-bg]').forEach((x) => x.classList.toggle('active', x.dataset.bg === 'base'));
    renderTypeControls();
    renderColorControls();
    applyAll();
    scheduleAutosave();
    toast('Reset to defaults');
  });

  $('#btnExportCss').addEventListener('click', async () => {
    const res = await window.api.exportCss(currentState());
    if (res.ok) toast('CSS exported');
    else if (!res.canceled) toast('Export failed');
  });
  $('#btnExportJson').addEventListener('click', async () => {
    const res = await window.api.exportJson(currentState());
    if (res.ok) toast('JSON tokens exported');
    else if (!res.canceled) toast('Export failed');
  });
  $('#btnExportPdf').addEventListener('click', async () => {
    toast('Building PDF…');
    const res = await window.api.exportPdf(buildBrandSheetHtml(), state.name);
    if (res.ok) toast('PDF exported');
    else if (!res.canceled) toast(res.error || 'PDF export failed');
  });

  $('#btnSaveKit').addEventListener('click', async () => {
    const name = $('#kitName').value.trim() || `Kit ${new Date().toLocaleString()}`;
    $('#kitName').value = name;
    const res = await window.api.saveKit(name, currentState());
    if (res.ok) { toast(`Saved “${name}”`); refreshKitList(); }
    else toast(res.error || 'Save failed');
  });

  $('#kitName').addEventListener('input', () => { state.name = $('#kitName').value; scheduleAutosave(); });

  // Background segmented control
  document.querySelectorAll('.seg-btn[data-bg]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.seg-btn[data-bg]').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    state.bg = b.dataset.bg;
    applyBackground();
    scheduleAutosave();
  }));

  // CVD simulation
  $('#cvdSelect').addEventListener('change', (e) => {
    canvasEl.style.filter = e.target.value ? `url(#${e.target.value})` : '';
  });
}

// ---- Google Fonts Discovery (Phase 4) ----
const GF_KEY_DOCS = 'https://developers.google.com/fonts/docs/developer_api';
const gfLoadedPreviews = new Set();

function gfShow(view) {
  ['gfOffline', 'gfKeySetup', 'gfBrowser'].forEach((id) => $('#' + id).classList.toggle('hidden', id !== view));
}

async function openDiscover() {
  $('#gfModal').classList.remove('hidden');
  await gfRefreshView();
}
function closeDiscover() { $('#gfModal').classList.add('hidden'); }

async function gfRefreshView() {
  if (!navigator.onLine) { gfShow('gfOffline'); return; }
  const key = await window.api.gfGetKey();
  if (!key) { $('#gfKeyInput').value = ''; gfShow('gfKeySetup'); return; }
  gfShow('gfBrowser');
  await loadCatalog(false);
}

async function loadCatalog(force) {
  const status = $('#gfStatus');
  status.textContent = 'Loading font catalog…';
  $('#gfList').innerHTML = '';
  const res = await window.api.gfCatalog({ force });
  if (!res.ok) {
    if (res.error === 'no-key') { gfShow('gfKeySetup'); return; }
    status.textContent = `Couldn't load fonts: ${res.error}`;
    return;
  }
  gfItems = res.items || [];
  const cats = ['All', ...[...new Set(gfItems.map((i) => i.category))].sort()];
  $('#gfCategory').innerHTML = cats.map((c) => `<option value="${c}">${c}</option>`).join('');
  status.textContent = `${gfItems.length} families${res.stale ? ' (showing cached list — refresh failed)' : ''}`;
  renderGfList();
}

function renderGfList() {
  const term = $('#gfSearch').value.trim().toLowerCase();
  const cat = $('#gfCategory').value || 'All';
  const matches = gfItems.filter((i) =>
    (cat === 'All' || i.category === cat) && (!term || i.family.toLowerCase().includes(term)));
  const shown = matches.slice(0, 60);

  $('#gfStatus').textContent = `${matches.length} match${matches.length === 1 ? '' : 'es'}` +
    (matches.length > shown.length ? ` — showing first ${shown.length}, refine your search` : '');

  const list = $('#gfList');
  list.innerHTML = shown.map((it) => {
    const alias = 'gfp-' + it.family;
    const owned = familyByName.has(it.family);
    return `<div class="gf-item">
      <div class="gf-item-main">
        <div class="gf-item-name">${escHtml(it.family)}<span class="gf-cat">${it.category}</span></div>
        <div class="gf-preview" style="font-family:'${alias}', system-ui, sans-serif">${escHtml(it.family)}</div>
      </div>
      ${owned
        ? '<span class="gf-downloaded">✓ Installed</span>'
        : `<button class="btn tiny gf-dl" data-family="${escAttr(it.family)}">Download &amp; use</button>`}
    </div>`;
  }).join('');

  // Inject remote @font-face previews for the visible items.
  shown.forEach((it) => {
    if (!it.previewUrl || gfLoadedPreviews.has(it.family)) return;
    gfLoadedPreviews.add(it.family);
    gfPreviewStyle.appendChild(document.createTextNode(
      `@font-face{font-family:"gfp-${it.family}";src:url("${it.previewUrl}");font-display:swap;}`));
  });

  list.querySelectorAll('.gf-dl').forEach((b) => b.addEventListener('click', () => downloadGfont(b.dataset.family, b)));
}

async function downloadGfont(family, btn) {
  const item = gfItems.find((i) => i.family === family);
  if (!item) return;
  btn.disabled = true;
  btn.textContent = 'Downloading…';
  const res = await window.api.gfDownload(family, item.files);
  if (!res.ok) { btn.disabled = false; btn.textContent = 'Download & use'; toast(res.error || 'Download failed'); return; }
  setFontData(res.fonts);
  // Load it straight into the active level for instant gratification.
  const lvl = state.levels[activeLevelId];
  if (lvl && familyByName.has(family)) { lvl.category = 'All'; setFamily(activeLevelId, family); }
  renderTypeControls();
  renderGfList();
  toast(`${family} installed (${res.written} file${res.written === 1 ? '' : 's'})`);
}

function wireDiscover() {
  $('#btnDiscover').addEventListener('click', openDiscover);
  $('#gfClose').addEventListener('click', closeDiscover);
  $('#gfModal').addEventListener('mousedown', (e) => { if (e.target === $('#gfModal')) closeDiscover(); });
  $('#gfSearch').addEventListener('input', renderGfList);
  $('#gfCategory').addEventListener('change', renderGfList);
  $('#gfKeyLink').addEventListener('click', (e) => { e.preventDefault(); window.api.openExternal(GF_KEY_DOCS); });
  $('#gfChangeKey').addEventListener('click', async () => { $('#gfKeyInput').value = await window.api.gfGetKey(); gfShow('gfKeySetup'); });
  $('#gfKeySave').addEventListener('click', async () => {
    const key = $('#gfKeyInput').value.trim();
    if (!key) { toast('Enter an API key'); return; }
    await window.api.gfSetKey(key);
    await loadCatalog(true);
    gfShow('gfBrowser');
  });
}

// ---- Side-by-side compare (Phase 5) ----
const CURRENT_SENTINEL = '__current__';

function pathToFileUrlRenderer(p) {
  return 'file:///' + encodeURI(String(p).replace(/\\/g, '/')).replace(/#/g, '%23');
}

// Render a read-only preview of a kit state into a container.
function renderComparePreview(container, s) {
  if (!s) { container.innerHTML = '<div class="cmp-empty">Nothing selected.</div>'; container.style.background = ''; return; }
  const colors = s.colors || {};
  container.style.background = colors.base || '#ffffff';

  const lines = LEVELS.map((lvl) => {
    const st = (s.levels && s.levels[lvl.id]) || {};
    let famCss = 'system-ui, sans-serif';
    const v = st.family ? variantFor(st) : null;
    if (st.family && v) { injectFont(st.family, v); famCss = `'${fontAlias(st.family)}', system-ui, sans-serif`; }
    const text = (s.texts && s.texts[lvl.id]) || lvl.placeholder;
    const color = colors[lvl.colorRole] || '#000';
    const size = Math.round((st.size || lvl.defaultSize) * 0.62); // scaled to fit the column
    return `<div class="cmp-line" style="font-family:${famCss};font-weight:${st.weight || lvl.defaultWeight};font-style:${st.style || 'normal'};color:${color};font-size:${size}px;line-height:${lvl.id === 'body' ? 1.6 : 1.15}">${escHtml(text)}</div>`;
  }).join('');

  const swatches = COLOR_ROLES.map((r) =>
    `<span class="cmp-sw" style="background:${colors[r.id] || '#000'}" title="${escAttr(r.label)} ${colors[r.id] || ''}"></span>`).join('');

  const logoUrl = s.logo ? (s.logo.fileUrl || (s.logo.path ? pathToFileUrlRenderer(s.logo.path) : '')) : '';
  const logoHtml = logoUrl ? `<div class="cmp-logo"><img src="${logoUrl}" alt="logo" /></div>` : '';

  container.innerHTML = `${logoHtml}<div class="cmp-lines">${lines}</div><div class="cmp-pal">${swatches}</div>`;
}

async function stateForSelection(val) {
  if (val === CURRENT_SENTINEL) return currentState();
  return window.api.loadKit(val);
}

async function refreshComparePane(side) {
  const sel = $('#cmpSelect' + side);
  const container = $('#cmpPreview' + side);
  renderComparePreview(container, await stateForSelection(sel.value));
}

async function openCompare() {
  const kits = await window.api.listKits();
  const opts = `<option value="${CURRENT_SENTINEL}">Current (unsaved)</option>` +
    kits.map((k) => `<option value="${escAttr(k.name)}">${escHtml(k.name)}</option>`).join('');
  $('#cmpSelectA').innerHTML = opts;
  $('#cmpSelectB').innerHTML = opts;
  $('#cmpSelectA').value = CURRENT_SENTINEL;
  $('#cmpSelectB').value = kits.length ? kits[0].name : CURRENT_SENTINEL;
  $('#cmpModal').classList.remove('hidden');
  await refreshComparePane('A');
  await refreshComparePane('B');
}
function closeCompare() { $('#cmpModal').classList.add('hidden'); }

function wireCompare() {
  $('#btnCompare').addEventListener('click', openCompare);
  $('#cmpClose').addEventListener('click', closeCompare);
  $('#cmpModal').addEventListener('mousedown', (e) => { if (e.target === $('#cmpModal')) closeCompare(); });
  $('#cmpSelectA').addEventListener('change', () => refreshComparePane('A'));
  $('#cmpSelectB').addEventListener('change', () => refreshComparePane('B'));
}

// Global shortcuts: cycle/favorite the active level from anywhere, unless the user is typing.
function isTypingTarget(el) {
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}
function wireGlobalKeys() {
  document.addEventListener('keydown', (e) => {
    if (!$('#gfModal').classList.contains('hidden')) { if (e.key === 'Escape') closeDiscover(); return; }
    if (!$('#cmpModal').classList.contains('hidden')) { if (e.key === 'Escape') closeCompare(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTypingTarget(e.target)) return; // let arrows move the cursor / change the field
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      cycleActiveLevel(e.key);
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      toggleFavoriteForLevel(activeLevelId);
    }
  });
}

window.addEventListener('DOMContentLoaded', init);
