# durabl replay UI — UX notes

**Branch:** `feat/ux-onboarding`  
**Surface:** `web/` (vanilla HTML/CSS/JS, zero deps)

---

## First-visit onboarding

On the first load in a browser (no prior dismiss), a compact **welcome banner** appears under the top bar. It summarizes the three core affordances:

1. **Replay** — step timeline and time-travel scrubber  
2. **Fork** — run tree and divergence markers  
3. **HITL** — paused runs and resume (live mode)

Actions:

| Control | Behavior |
|---------|----------|
| **3-step tour** | Opens a guided overlay that spotlights each area in order (replay → fork → HITL). |
| **Dismiss** | Hides onboarding and does not show again in this browser. |
| **Skip** (in tour) | Same as dismiss. |
| **Done** (last step) | Completes tour and persists dismiss. |

### Persistence

Dismissal is stored in `localStorage`:

```
key:   durabl.onboarding.dismissed
value: "1"
```

If storage is unavailable (private mode, blocked), the banner may reappear on refresh; the tour still works for the session.

### Reset (manual QA)

```js
localStorage.removeItem('durabl.onboarding.dismissed');
location.reload();
```

---

## Layout map (onboarding targets)

| Step | DOM target | Fallback |
|------|------------|----------|
| Replay | `#timeline` | — |
| Fork | `#tree` | — |
| HITL | `#hitlPanel` | `#hitlBanner` when no paused runs in sidebar |

The HITL step uses the sidebar panel when visible; otherwise it highlights the in-run HITL banner so the copy still lands when a run is paused.

---

## Related docs

- [hitl-web-ui.md](./hitl-web-ui.md) — pause/resume API and live vs offline  
- [QUICKSTART.md](./QUICKSTART.md) — run the UI (`npm run ui`)
