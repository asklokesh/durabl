# Design System — durabl

## Product Context

- **What this is:** A neutral, self-hostable agent execution journal with replay, time-travel, logical step-level fork, and HITL pause/resume. Restate is the durable substrate; the product never relies on process snapshots.
- **Who it's for:** Engineers operating agent runs locally or on their own infra—debugging crashes, comparing trajectories, exporting JSONL for offline proof, and resuming HITL after restarts.
- **Space/industry:** Durable execution / workflow observability (peers: Temporal Web UI, Restate UI, Langfuse traces). durabl differentiates as **vendor-neutral journal + offline replay**, not another hosted fleet dashboard.
- **Project type:** Data-dense developer web app (three-column replay console), zero frontend framework deps.

### Memorable thing

**Your agent run is a tangible recording you can scrub, fork, and carry offline—not a black box in someone else's cloud.**

Every visual choice should reinforce local ownership, forensic clarity, and time as a first-class axis.

## Aesthetic Direction

- **Direction:** Industrial Forensic — operations console for journal archaeology, not marketing SaaS.
- **Decoration level:** Intentional — subtle radial depth on canvas, hairline borders, no blobs or hero gradients.
- **Mood:** Calm, precise, trustworthy under stress. Feels like late-night incident debugging: high signal, low chrome, no performative "AI product" gloss.
- **Reference sites:** Temporal Web UI (timeline density), Restate UI (invocation journal mental model). Deliberately **not** copying their default indigo/purple accent convergence.

## Typography

- **Display/Hero:** IBM Plex Sans 600 — technical credibility without startup-display clichés.
- **Body:** IBM Plex Sans 400 — readable at 14px in dense panels.
- **UI/Labels:** IBM Plex Sans 500 — same family, weight contrast only.
- **Data/Tables/Timeline:** IBM Plex Mono 400 — step IDs, timestamps, JSON; `font-variant-numeric: tabular-nums`.
- **Code:** IBM Plex Mono 400 — step detail JSON, export paths, API labels.
- **Loading:** Bunny Fonts CDN — `https://fonts.bunny.net/css?family=ibm-plex-sans:400,500,600|ibm-plex-mono:400`
- **Scale:**
  - xs: 11px / 0.6875rem — badges, meta
  - sm: 12px / 0.75rem — table secondary
  - base: 14px / 0.875rem — body (default)
  - md: 16px / 1rem — panel titles
  - lg: 20px / 1.25rem — brand wordmark
  - xl: 24px / 1.5rem — empty states

## Color

- **Approach:** Restrained — one primary accent (timeflow teal), semantic colors only where journal state demands it.

| Token | Light | Dark | Usage |
|-------|-------|------|--------|
| `--accent` | `#0d9488` | `#2dd4bf` | Primary actions, focus rings, scrubber fill |
| `--accent-soft` | `#0d948822` | `#2dd4bf22` | Selected row wash |
| `--bg` | `#f0f2f7` | `#0a0c10` | Page canvas |
| `--bg-elev` | `#ffffff` | `#12151c` | Panels, cards |
| `--bg-elev2` | `#e8ecf4` | `#181c25` | Nested wells, code blocks |
| `--border` | `#d0d7e4` | `#252b3a` | Panel edges |
| `--text` | `#141a26` | `#e8ecf4` | Primary copy |
| `--text-dim` | `#5a6578` | `#9aa3b2` | Secondary |
| `--text-faint` | `#8892a4` | `#626b7d` | Tertiary |
| `--green` | `#059669` | `#34d399` | Live journal pill |
| `--amber` | `#d97706` | `#fbbf24` | Offline / imported pill, banners |
| `--red` | `#dc2626` | `#f87171` | Errors, failed steps |
| `--cyan` | `#0891b2` | `#22d3ee` | Fork branch highlights |

- **Dark mode:** First-class. Default follows `prefers-color-scheme`; user override via `data-theme` + `durabl.theme` in localStorage. Reduce accent saturation ~10% in dark for glare control.
- **Migration note:** `web/app.css` uses the teal tokens above (migrated 2026-06-03 from legacy indigo `#6366f1`).

## Spacing

- **Base unit:** 4px
- **Density:** Compact-comfortable — dense enough for 40+ step runs, breathable panel gutters.
- **Scale:** 2xs(2) xs(4) sm(8) md(12) lg(16) xl(24) 2xl(32) 3xl(48)
- **Panel padding:** 12px (sm/md), 16px (lg panels)
- **Column gap:** 1px hairline (current pattern) or 8px on mobile stack

## Layout

- **Approach:** Grid-disciplined — fixed three-column ops layout (runs | timeline | diff/HITL); stacks at ≤720px.
- **Grid:** Desktop 240px | 1fr | 320px min; tablet single column with panel order preserved.
- **Max content width:** Full viewport (tool UI, not marketing).
- **Border radius:** sm 4px (inputs, chips), md 8px (panels, buttons), lg 12px (modals), full 9999px (pills only).

## Motion

- **Approach:** Minimal-functional — motion explains state change, never decorates.
- **Easing:** enter `cubic-bezier(0, 0, 0.2, 1)`, exit `cubic-bezier(0.4, 0, 1, 1)`, move `cubic-bezier(0.4, 0, 0.2, 1)`
- **Duration:** micro 80ms (hover), short 150ms (panel reveal), medium 250ms (scrubber thumb), long 400ms (help overlay only)
- **Reduced motion:** Honor `prefers-reduced-motion: reduce` — disable transitions except focus outlines.

## Component notes (replay UI)

| Element | Guidance |
|---------|----------|
| Source pill | Green dot + label = live; amber = offline import. Never blue "connected" generic. |
| Timeline scrubber | Accent track; thumb uses `--range-thumb-bg` with visible border in dark mode. |
| Fork tree | Cyan accent on active branch; SVG twigs 1px `--border`, not filled blobs. |
| Diff panel | Side-by-side default; inline toggle in settings. Divergence line uses `--red` at 60% opacity. |
| HITL form | Primary button `--accent`; disabled state `--text-faint` + no gradient. |
| Offline banner | Amber wash `#f59e0b22` + bottom border — already correct pattern. |

## SAFE vs RISK (design posture)

**SAFE (category baseline):**

- Dark-first ops theme with light mode toggle.
- Monospace for machine-readable step payloads.
- Timeline / scrubber for time-travel.
- Status pills for live vs offline source.

**RISKS (durabl's face):**

1. **Teal timeflow accent** instead of category indigo/purple — signals "replay transport" not "another SaaS AI dashboard." Cost: breaks visual continuity with current shipped `#6366f1` until migrated.
2. **Forensic flat panels** over glassmorphism — radial page gradient only; panels stay opaque for JSON readability. Cost: less "premium" than trendy devtools.
3. **IBM Plex stack** over system/Inter defaults — distinctive, license-clean, slightly heavier font load. Cost: one CDN request (acceptable for local UI).

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-03 | Initial design system | `/design-consultation` — product context from README + `docs/UI.md`; research via Temporal/Restate UI patterns; preview at `~/.gstack/projects/durabl/designs/design-system-20250603/design-preview.html` |

## Artifacts

- **Preview HTML:** `~/.gstack/projects/durabl/designs/design-system-20250603/design-preview.html`
- **Approved direction:** Variant A (Forensic Teal) — `approved.json` alongside preview
