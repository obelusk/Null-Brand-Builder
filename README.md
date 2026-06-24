# Null Brand Builder

Offline-first cross-platform desktop tool for building a complete brand kit — pair your
installed system fonts across a four-level typographic hierarchy with a five-role color
palette, then export to CSS variables or JSON design tokens.

Built with Electron + vanilla HTML/CSS/JS. Fully offline; no account or internet required.

## Run it

```bash
npm install      # already done if node_modules/ exists
npm start
```

## What's implemented (working core)

| Phase | Feature |
| --- | --- |
| 0 | Electron scaffold, electron-builder config (Win/Mac/Linux targets), `~/NullBrandBuilder/fonts/` bootstrap |
| 1 | **Local font engine** — scans OS font dirs + the app folder with `fontkit`, extracts metadata, categorizes (Sans/Serif/Decorative/Script/Mono), dedupes, caches to disk |
| 2 | **Typography canvas** — four live levels (Main Header, Sub Header, Caption, Paragraph); per-level font / category / weight / size; editable preview text; arrow-key cycling (← → fonts, ↑ ↓ category); font search; randomize; **font favorites** (★ toggle + a "★ Favorites" filter, persisted globally) |
| 3 | **Color palette** — five roles with native picker + hex sync, live HEX/RGB/HSL, plain-language readability badges, light/dark/base background toggle, color-blindness simulation (deuter/protan/tritan) |
| 4 | **Google Fonts discovery** — ⌕ Discover modal: enter your free API key (stored locally), browse the popularity-sorted catalog (cached 24h) with live previews rendered in each typeface, search + category filter, and **Download & use** to fetch all weights into the local fonts folder and merge them into the normal font list. Offline-aware. |
| 3.5 | **Logo upload + color extraction** — drag-drop / browse PNG or SVG; PNG palette via node-vibrant, SVG fill/stroke colors via svgson; clickable swatches assignable to any palette role; in-canvas logo preview with transparent/white/black/gray backdrop; re-extract / remove; logo path saved with the kit |
| 5 | **Save / load brand kits** (electron-store), session autosave, **export CSS variables**, **JSON design tokens** (Figma/Tailwind-friendly), a one-page **PDF brand sheet** (Electron `printToPDF` — no Puppeteer), and a **side-by-side A/B compare** view (Current vs. any saved kit); plus **Reset to Default** (neutral monochrome blank slate) |

### Keyboard
Click a level in the canvas to select it (the wrapper, not the text), then:
`←` `→` cycle fonts · `↑` `↓` switch category · `Enter` edit text · `Esc` stop editing.

## Architecture

```
src/
  main/        main.js (window + IPC), fonts.js (font engine), store.js, exporters.js
  preload/     preload.js — contextBridge IPC whitelist
  renderer/    index.html, styles.css, renderer.js (all UI state)
  shared/      constants.js, color.js (used by main; mirrored in renderer)
```

## Packaging

`npm run dist:win` produces a Windows NSIS installer in `release/` (uses `assets/icon.png`,
auto-converted to `.ico`). Verified: the packaged build boots and the font engine scans
correctly from inside `app.asar`. `dist:mac` / `dist:linux` build the other targets.

## Not yet built (from the action plan)

- **Phase 6 (remaining)** — code signing (Windows cert / Apple Developer ID; unsigned builds
  trigger a SmartScreen "more info → run anyway" prompt), GitHub Actions CI for Mac/Linux
  artifacts, and cross-OS smoke testing.

## Packaging

`assets/icon.png` (512×512) must be added before `npm run dist` — electron-builder
converts the one source image to `.ico` / `.icns` / `.png` per OS.
