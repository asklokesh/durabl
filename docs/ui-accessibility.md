# Replay UI accessibility checklist

Scope: static replay UI under `web/` (`index.html`, `app.css`, `app.js`). Target **WCAG 2.1 Level AA** for operator-facing replay and HITL flows.

## Structure and navigation

- [x] Page `lang="en"` and a single logical heading hierarchy (brand + panel titles).
- [x] **Skip link** to `#main-content` (visible on keyboard focus).
- [x] Landmarks: `banner` (top bar), labeled `aside`, `main`, `section` (detail).
- [x] Fork tree: `role="tree"` on host; `treeitem` + nested `group` from `/api/tree` rendering.

## Forms and HITL

- [x] HITL decision: explicit `<label for="hitlDecision">`, `required` + `aria-required`.
- [x] HITL regions: `role="region"` with `aria-labelledby` on panel and banner.
- [x] Submit feedback: `#hitlFormMsg` with `role="status"` and `aria-live="polite"`.
- [x] Offline note linked via `aria-describedby` on `#hitlForm`.
- [x] Disabled submit/textarea when live submit unavailable: `disabled` + `aria-disabled`.
- [x] Paused-run list: `role="list"` / `listitem`, descriptive `aria-label`, `aria-current` when selected.

## Interactive controls

- [x] Tree runs, timeline steps, fork markers, lineage crumbs: **native `<button>`** (keyboard activatable).
- [x] Time-travel slider: `role="group"`, `aria-valuemin` / `max` / `now` / `valuetext` synced in JS.
- [x] Time-travel readout: `aria-live="polite"`.
- [x] Detail tabs: WAI-ARIA tabs (`tablist`, `tab`, `tabpanel`, `aria-selected`, `aria-controls`, roving `tabindex`).
- [x] Tab keyboard: Left/Right/Home/End; inactive panels use `hidden`.
- [x] Trajectory diff: `<label>` elements associated with `#diffRunA` / `#diffRunB` selects.
- [x] Theme toggle: `aria-label` updated when effective theme changes (existing JS).

## Focus and contrast

- [x] Global `:focus-visible` ring (accent); mouse clicks do not leave persistent focus ring.
- [x] Per-control focus styles on tree, steps, tabs, range, selects, HITL, primary/ghost buttons.
- [x] `--text-faint` lightened in dark theme (`#7b8699`) for ~4.5:1 on elevated surfaces.

## Manual smoke test

1. Tab from load: skip link → theme → source → sidebar tree → main timeline → detail tabs.
2. With a paused run: reach HITL textarea and Submit; confirm status message is announced when shown.
3. Open Trajectory diff tab via keyboard; change A/B selects; confirm labels are announced.
4. Toggle light/dark theme; re-check faint meta text and focus rings on both themes.

## Optional automation

With [axe DevTools](https://www.deque.com/axe/devtools/) or `@axe-core/cli` against a running server:

```bash
npx @axe-core/cli http://127.0.0.1:8787/ --tags wcag2a,wcag2aa
```

Run after `durabl serve` (or your local replay port). Fix any violations before merge.

## Out of scope (this PR)

- Server/API error pages and JSON responses.
- Color contrast of user-generated journal content inside step output blocks.
- Full `role="tree"` keyboard spec (expand/collapse); tree is flat buttons per node today.
