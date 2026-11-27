# DESIGN.md: FireReach Medan Visual & Interaction Direction

> Reading this as: public-service Web GIS application for urban fire incident mapping and service coverage analysis in Kota Medan, designed for municipal researchers, GIS analysts, and project reviewers, in a warm archival cartographic aesthetic, dial ENERGY 1 / RHYTHM 2 / MOTION 1.

Dial: ENERGY 1 / RHYTHM 2 / MOTION 1

---

## 1. Design Identity & Liveliness Levers

FireReach Medan is an academic and civic Web GIS tool for Kota Medan (`Fire Incident Mapping & Emergency Service Coverage Analysis`). Its interface pairs a **Warm Editorial + Modern Geospatial Intelligence** aesthetic inspired by archival atlases and civic engineering dossiers: warm ivory canvas (`#FAF6F0`), paper map/data sheets (`#FFFDF9`), warm sand containers (`#F3ECE2`), deep charcoal ink (`#1F2421`), and terracotta crimson (`#B83B28` / `#962E1E`) paired with ochre gold (`#8A5212` / `#D98A36`) and river teal (`#2C555C` / `#3D6E76`).

- **One focal point per screen**: On the Dashboard and Fire Incident Explorer, the interactive Kota Medan Leaflet map (or data registry view when spatial points are absent) occupies the primary visual weight; KPIs, tables, and the spatial response-simulation panel sit as structured companions.
- **Hierarchical contrast**: Editorial display headings (`Playfair Display`), readable body UI (`Plus Jakarta Sans`), and tabular numerals/coordinate readouts (`IBM Plex Mono` with `tabular-nums`) establish a clear typographic hierarchy without oversized marketing banners.
- **Whitespace as structure**: Generous margins (`24px` to `32px` on desktop, `16px` on mobile) separate navigation, map canvas, filter controls, and metadata notes so dense spatial tables stay readable.
- **Deliberate accent discipline**: Terracotta Crimson `#B83B28` marks active fire incidents and the single primary action per view; secondary data layers use River Teal `#2C555C` / `#3D6E76` and Ochre Gold `#D98A36` / `#8A5212`.
- **Identity motif**: Explicit cartographic provenance footer bars on every map and chart panel displaying CRS (`EPSG:4326` web / `EPSG:32647` metric), period, granularity, and source attribution.

---

## 2. Color System & Verified WCAG AA Contrast

Theme mode: **Light-first (fixed)**. Geographic base maps, choropleth legends, and dense Indonesian municipal tables lose legibility under dark-mode defaults without specialized dark cartographic tiles (R-21).

| Token | Hex | Role | Contrast Verification |
|---|---|---|---|
| `--color-paper` | `#FAF6F0` | Warm ivory workspace background | Base canvas |
| `--color-surface` | `#FFFDF9` | Map container, table panel, sidebar surface | Elevated paper sheet |
| `--color-surface-subtle` | `#F3ECE2` | Table headers, secondary summary strips | Warm sand subtle band |
| `--color-ink` | `#1F2421` | Primary headings, body text, nav labels | 15.51:1 on `#FFFDF9`, 14.64:1 on `#FAF6F0`, 13.44:1 on `#F3ECE2` (Pass AA/AAA) |
| `--color-ink-muted` | `#525B56` | Secondary labels, captions, metadata | 6.91:1 on `#FFFDF9`, 6.52:1 on `#FAF6F0` (Pass AA) |
| `--color-ember` | `#B83B28` | Primary action fill, fire marker accent | 5.60:1 `#FFFDF9` text on fill (Pass AA) |
| `--color-ember-hover` | `#962E1E` | Primary button hover, warn-badge text | 7.64:1 `#FFFDF9` text on fill, 6.76:1 on `#FCECE8` (Pass AA) |
| `--color-river` | `#3D6E76` | Secondary layer fill, station/network accents | Paired with light surface and dark ink borders |
| `--color-river-text` | `#2C555C` | Secondary links and active status badges | 8.07:1 on `#FFFDF9`, 7.14:1 on `#E8F1F2` (Pass AA) |
| `--color-amber-swatch` | `#D98A36` | Medium-tier choropleth/chart fill ONLY | Never used for text on light; paired with `#1F2421` border/label |
| `--color-amber-text` | `#8A5212` | Exploratory/provisional text label | 5.75:1 on `#FCF2E3` (Pass AA) |
| `--color-border` | `#DDD5CA` | Structural hairline dividers | Warm stone hairline separator |
| `--color-border-strong` | `#6A635B` | Input borders, checkboxes, focus outlines | High contrast non-text outline (>= 3:1) |

Palette rule (R-29): Core colors stay strictly bounded to Charcoal Ink, Warm Ivory neutrals, Terracotta Crimson (primary accent), River Teal (secondary GIS layer), and Ochre Gold (mid-scale legend tier).

---

## 3. Typography (R-06)

- **Editorial Headings**: `Playfair Display` (`@fontsource/playfair-display`, weights 600, 700), bundled locally by Vite for authoritative atlas-grade `h1`/`h2` hierarchy and brand wordmark.
- **UI & Tables**: `Plus Jakarta Sans` (`@fontsource/plus-jakarta-sans`, weights 400, 500, 600, 700), bundled locally by Vite. Chosen for crisp Indonesian legibility and open counters in dense kecamatan tables.
- **Technical Metadata & Coordinates**: `IBM Plex Mono` (`@fontsource/ibm-plex-mono`, weights 400, 500), bundled locally by Vite for CRS codes (`EPSG:32647`, `EPSG:4326`), coordinates, SHA-256 hashes, dates, and `tabular-nums`.
- **Type Scale**: Fluid H1 (`clamp(1.5rem, 1.25rem + 1vw, 2.05rem)`), H2 (`clamp(1.15rem, 1.05rem + 0.4vw, 1.375rem)`), body `1rem` (`16px`), metadata `0.875rem` (`14px`), micro caption `0.75rem` (`12px` minimum).

---

## 4. Layout, Breakpoints & Responsive Flow (R-03, R-05)

Three explicit responsive bands (avoiding a broken two-state desktop/mobile jump):
1. **Mobile (`< 640px`)**: Compact sticky header with labeled `"Menu"` drawer trigger (`>= 44x44px`), single-column stack, map first (`min-height: 300px`), horizontal scroll wrapped inside `.table-scroll` so the document itself never overflows horizontally (`scrollWidth <= clientWidth`).
2. **Tablet / Small Laptop (`640px` to `1023px`)**: Drawer navigation remains accessible via labeled `"Menu"` button, 2-column summary strips and balanced filter grids, side-by-side map + inspector only when width permits.
3. **Desktop (`>= 1024px`)**: Fixed `248px` left navigation rail grouped into `Ringkasan` (Dashboard, Tentang & Sumber Data) and `Modul Analisis` (all 4 modules with clear status tags) + fluid main canvas up to `1360px` max content width.

Section composition varies intentionally (`RHYTHM 2`): Dashboard pairs an asymmetric context header + overview map beside a concise data provenance panel, followed by a structured module readiness list; Incident Explorer uses a control toolbar, split map/inspector layout, chart breakdown, and separated unlocated records table.

---

## 5. Radius, Elevation, Motion & Icons (R-04, R-11, R-12, R-19, R-31)

- **Border radius variation**: `4px` on form inputs, table pills, and status tags; `8px` on map/content panels; `6px` on buttons. Never pill-shaped (`9999px`) on cards or inputs.
- **Elevation**: Flat paper-on-canvas by default (`1px solid #D9DEDA`). Subtle shadow (`0 4px 14px rgba(32, 42, 45, 0.08)`) reserved exclusively for floating mobile nav drawer and active map tooltips/overlays.
- **Motion (`MOTION 1`)**: Tactile hover/focus/active transitions (`150ms`-`180ms` ease, slight lift and light sheen on interactive buttons) and drawer slide transitions, plus warm editorial skeleton shimmer placeholders during asynchronous module and dataset loads. Zero bounce/floating loops. All transitions and skeleton shimmer animations disable under `@media (prefers-reduced-motion: reduce)`.
- **Icons**: Minimal inline geometric SVGs (`aria-hidden="true"`) strictly where navigation, map legend geometry, or status differentiation (non-color marker) requires visual clarity. Zero decorative emojis or sparkle/AI glyphs.

---

## 6. Accessibility & Data Honesty Guardrails

- Every enabled interactive control sets `cursor: pointer`; disabled controls set `cursor: not-allowed`.
- Visible `:focus-visible` ring (`2px solid #202A2D` with `2px` white offset) on all links, buttons, selects, inputs, and table rows.
- Interactive touch targets maintain minimum `44px` height/hit area on mobile and navigation rows.
- Every data view implements explicit Loading, Empty (naming cause + next action), Error, and provenance states without fake DEMO fallbacks in production.
- Status badges always pair hue with text and inline SVG geometric markers (never color alone).
- Zero fabricated numbers, zero fake coordinates, zero unverified claims (`live`, `real-time`, `AI prediction`), and zero em dashes (U+2014).

---

## 7. Design Decision Log (R-31 One-Line Reasons)

- **Palette**: Warm ivory `#FAF6F0`, terracotta `#B83B28`, ochre gold `#8A5212`, and river teal `#2C555C` evoke archival maps and fire engineering briefs without generic dark/neon AI gradients.
- **Typography**: `Playfair Display` anchors editorial `h1`/`h2` titles, `Plus Jakarta Sans` handles Indonesian prose cleanly, and `IBM Plex Mono` aligns tabular numbers and CRS coordinates.
- **Layout**: Navigation rail separates shell overview from the 4 ownership modules while prioritizing map and table visibility over uniform stat cards.
- **Spacing**: Progressive `16px` / `24px` / `32px` gaps isolate dense filter controls from cartographic layers and tables.
- **Border Radius**: `4px` controls vs `8px` panels visually separate interactive inputs from structural containers without pill uniformity.
- **Motion**: `150ms`-`180ms` state feedback and reduced-motion guards on hover and shimmer animations honor `MOTION 1` and vestibular accessibility.
- **Spatial Map & Response Simulation**: Leaflet 2D serves as the sole spatial analysis map across all four modules, paired with Canvas 2D and SVG 2D fallback road-network dispatch simulation in Incident Explorer.
