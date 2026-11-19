# DESIGN.md: FireReach Medan Visual & Interaction Direction

> Reading this as: public-service Web GIS application for urban fire incident mapping and service coverage analysis in Kota Medan, designed for municipal researchers, GIS analysts, and project reviewers, in a warm archival cartographic aesthetic, dial ENERGY 1 / RHYTHM 2 / MOTION 1.

Dial: ENERGY 1 / RHYTHM 2 / MOTION 1

---

## 1. Design Identity & Liveliness Levers

FireReach Medan is an academic and civic Web GIS tool for Kota Medan (`Fire Incident Mapping & Emergency Service Coverage Analysis`). Its interface takes cues from municipal atlases and technical cartographic notebooks: warm archival paper canvas (`#F4F2EC`), crisp white map/data sheets (`#FFFFFF`), dark slate ink (`#202A2D`), and ember rust (`#B84A35`) reserved strictly for fire incident markers and primary map actions.

- **One focal point per screen**: On the Dashboard and Fire Incident Explorer, the interactive Kota Medan Leaflet map (or data registry view when spatial points are absent) occupies the primary visual weight; KPIs, tables, and the schematic 3D preview sit as structured companions.
- **Hierarchical contrast**: Page titles (`Plus Jakarta Sans`), section heads, tabular numerals, and coordinate readouts (`IBM Plex Mono` with `tabular-nums`) establish a clear typographic hierarchy without oversized hero marketing banners.
- **Whitespace as structure**: Generous margins (`24px` to `32px` on desktop, `16px` on mobile) separate navigation, map canvas, filter controls, and metadata notes so dense spatial tables stay readable.
- **One deliberate accent**: Ember `#B84A35` marks active fire incidents and the single primary action per view; secondary data layers use River `#356067` / `#477A82` and Amber `#D58A43` / `#8A5218`.
- **Identity motif**: Explicit cartographic provenance footer bars on every map and chart panel displaying CRS (`EPSG:4326` web / `EPSG:32647` metric), period, granularity, and source attribution.

---

## 2. Color System & Verified WCAG AA Contrast

Theme mode: **Light-first (fixed)**. Geographic base maps, choropleth legends, and dense Indonesian municipal tables lose legibility under dark-mode defaults without specialized dark cartographic tiles (R-21).

| Token | Hex | Role | Contrast Verification |
|---|---|---|---|
| `--color-paper` | `#F4F2EC` | Main warm archival workspace background | Base canvas |
| `--color-surface` | `#FFFFFF` | Map container, table panel, sidebar surface | Elevated sheet |
| `--color-surface-subtle` | `#ECEAE2` | Table headers, secondary summary strips | Subtle band |
| `--color-ink` | `#202A2D` | Primary headings, body text, nav labels | 14.68:1 on `#FFFFFF`, 13.11:1 on `#F4F2EC` (Pass AA/AAA) |
| `--color-ink-muted` | `#556164` | Secondary labels, captions, metadata | 6.40:1 on `#FFFFFF`, 5.72:1 on `#F4F2EC` (Pass AA; darkened from `#687477` which scored 4.31:1 on `#F4F2EC`) |
| `--color-ember` | `#B84A35` | Primary action fill, fire marker accent | 5.16:1 on `#FFFFFF`, 4.61:1 on `#F4F2EC`, 5.16:1 white text on fill (Pass AA) |
| `--color-ember-hover` | `#9A3B29` | Primary button hover/active state | 6.93:1 white text on fill (Pass AA) |
| `--color-river` | `#477A82` | Secondary layer fill, station/water markers | 4.80:1 white text on fill (Pass AA) |
| `--color-river-text` | `#356067` | Secondary links and text badges | 6.95:1 on `#FFFFFF`, 6.21:1 on `#F4F2EC` (Pass AA; darkened from `#477A82` which scored 4.29:1 on `#F4F2EC`) |
| `--color-amber-swatch` | `#D58A43` | Medium-tier choropleth/chart fill ONLY | Never used for text on light; paired with `#202A2D` border/label |
| `--color-amber-text` | `#8A5218` | Warning/in-development text label | 6.36:1 on `#FFFFFF`, 5.68:1 on `#F4F2EC` (Pass AA) |
| `--color-border` | `#D9DEDA` | Structural hairline dividers | Hairline separator |
| `--color-border-strong` | `#6E7A7D` | Input borders, checkboxes, focus outlines | >= 4.3:1 on `#FFFFFF` and >= 3.8:1 on `#F4F2EC` (Pass non-text 3:1) |

Palette rule (R-29): Core colors stay strictly bounded to Ink, Paper/Surface neutrals, Ember (primary accent), River (secondary GIS layer), and Amber (mid-scale legend tier).

---

## 3. Typography (R-06)

- **UI & Headings**: `Plus Jakarta Sans` (`@fontsource/plus-jakarta-sans`, weights 400, 500, 600, 700), bundled locally by Vite. Chosen for clean Indonesian legibility, open counters in dense kecamatan tables, and zero third-party font render-blocking.
- **Technical Metadata & Coordinates**: `IBM Plex Mono` (`@fontsource/ibm-plex-mono`, weights 400, 500), bundled locally by Vite. Used strictly for CRS codes (`EPSG:32647`, `EPSG:4326`), coordinates, file hashes, dates, and tabular counts (`font-variant-numeric: tabular-nums`), never as oversized decorative display headlines.
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
- **Motion (`MOTION 1`)**: Hover/focus/active transitions (`150ms ease`) and drawer slide transitions only. Zero continuous pulse animations, zero bounce/floating loops. All transitions disable under `@media (prefers-reduced-motion: reduce)`. The bounded Three.js mini preview starts paused under reduced motion and always provides an explicit Play/Pause rotation button.
- **Icons**: Minimal inline geometric SVGs (`aria-hidden="true"`) strictly where navigation, map legend geometry, or status differentiation (non-color marker) requires visual clarity. Zero decorative emojis or sparkle/AI glyphs.

---

## 6. Accessibility & Data Honesty Guardrails

- Every enabled interactive control sets `cursor: pointer`; disabled controls set `cursor: not-allowed`.
- Visible `:focus-visible` ring (`2px solid #202A2D` with `2px` white offset) on all links, buttons, selects, inputs, and table rows.
- Interactive touch targets maintain minimum `44px` height/hit area on mobile and navigation rows.
- Every data view implements explicit Loading, Empty (naming cause + next action), Error, and `DATA DEMO` states.
- Status badges always pair hue with text and distinct geometric markers (never color alone).
- Zero fabricated numbers, zero fake coordinates, zero unverified claims (`live`, `real-time`, `AI prediction`), and zero em dashes (U+2014).

---

## 7. Design Decision Log (R-31 One-Line Reasons)

- **Palette**: Warm paper `#F4F2EC` and ember `#B84A35` evoke civic cartographic maps and emergency fire mapping without generic dark/neon AI gradients.
- **Typography**: `Plus Jakarta Sans` handles Indonesian municipal prose cleanly while `IBM Plex Mono` aligns tabular numbers and CRS coordinates.
- **Layout**: Navigation rail separates shell overview from the 4 ownership modules while prioritizing map and table visibility over uniform stat cards.
- **Spacing**: Progressive `16px` / `24px` / `32px` gaps isolate dense filter controls from cartographic layers and tables.
- **Border Radius**: `4px` controls vs `8px` panels visually separate interactive inputs from structural containers without pill uniformity.
- **Motion**: `150ms` state feedback and explicit 3D pause toggle honor `MOTION 1` and vestibular accessibility.
- **Three.js Mini Preview**: Bounded schematic massing clarifies selected fire object categories while keeping Leaflet 2D as the sole spatial analysis map.
