// durabl replay UI — vanilla JS, zero deps. Talks to the read-only replay APIs.
"use strict";

const THEME_STORAGE_KEY = "durabl.theme";

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, txt) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
};

const HITL_SUBMIT_OFFLINE_ERROR =
  "HITL submit requires live mode (SQLite journal + Restate ingress). " +
  "Offline export can list paused runs but cannot resolve the durable promise.";

const state = {
  runs: [],
  roots: [],
  selected: null,
  replay: null, // current full ReplayedRun
  ttN: null, // time-travel step (null = full run)
  selectedStepSeq: null,
  live: false,
  hitlSubmitEnabled: false,
  hitlSubmitDisabledReason: HITL_SUBMIT_OFFLINE_ERROR,
  hitlState: "none",
  pausedRuns: [],
  pausedRunsLoading: false,
  pausedRunsError: null,
  hitlSubmitBusy: false,
  origin: "",
  hitlSubmitDisabledReason: "",
  /** Trajectory diff panel: "side" | "inline" */
  diffViewMode: localStorage.getItem("durabl.diffViewMode") === "inline" ? "inline" : "side",
  exportPath: null,
  uiUrl: null,
  /** runIds on root→selected lineage (from GET /api/tree). */
  lineagePath: new Set(),
  /** root runId → ForkTreeNode from GET /api/tree */
  forkTrees: new Map(),
};

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(apiErrorMessage(body, res.status));
  }
  return body;
}

async function apiPost(path, payload) {
  return api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function fmtOut(v) {
  if (typeof v === "string") return v;
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

// ── Theme & settings ───────────────────────────────────────
function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === "light" || mode === "dark") {
    root.dataset.theme = mode;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch (_) {}
  } else {
    delete root.dataset.theme;
    try {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } catch (_) {}
  }
}

function initThemeControls() {
  const select = $("#themeSelect");
  if (!select) return;
  let stored = "system";
  try {
    const t = localStorage.getItem(THEME_STORAGE_KEY);
    if (t === "light" || t === "dark") stored = t;
  } catch (_) {}
  select.value = stored;
  applyTheme(stored === "system" ? "system" : stored);
  select.addEventListener("change", () => {
    applyTheme(select.value === "system" ? "system" : select.value);
  });
  const btn = $("#themeToggle");
  if (btn) {
    btn.addEventListener("click", () => {
      const root = document.documentElement;
      const cur =
        root.dataset.theme ||
        (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      const next = cur === "dark" ? "light" : "dark";
      select.value = next;
      applyTheme(next);
      btn.setAttribute("aria-label", next === "dark" ? "Switch to light mode" : "Switch to dark mode");
      const icon = btn.querySelector(".theme-toggle-icon");
      if (icon) icon.textContent = next === "dark" ? "☀" : "☾";
    });
  }
}

function renderEmptyState(container, icon, title, hint) {
  const wrap = el("div", "empty-state");
  wrap.appendChild(el("div", "empty-icon", icon));
  wrap.appendChild(el("div", "empty-title", title));
  wrap.appendChild(el("div", "empty-hint", hint));
  container.appendChild(wrap);
}

function renderSettings(h) {
  const exportEl = $("#settingsExportPath");
  const urlEl = $("#settingsLiveUrl");
  if (!exportEl || !urlEl) return;
  const path = h.exportPath ?? state.exportPath;
  if (path) {
    exportEl.textContent = path;
    exportEl.title = path;
  } else {
    exportEl.textContent = state.live ? "Live journal (no export file)" : "—";
    exportEl.title = "";
  }
  const url = h.uiUrl ?? state.uiUrl ?? window.location.href;
  state.uiUrl = url;
  urlEl.textContent = url;
  urlEl.href = url;
}

function isOfflineHealth(h) {
  const origin = h?.origin ?? state.origin ?? "";
  return !h?.live || String(origin).startsWith("imported");
}

function updateOfflineBanner(h) {
  const banner = $("#offlineBanner");
  if (!banner) return;
  const offline = isOfflineHealth(h);
  banner.hidden = !offline;
  if (!offline) return;
  banner.textContent =
    h?.hitlSubmitDisabledReason ||
    state.hitlSubmitDisabledReason ||
    "Viewing imported JSONL — replay only. No live substrate; HITL submit is disabled.";
}

function updateExportButton() {
  const btn = $("#btnExport");
  if (!btn) return;
  btn.disabled = !state.selected;
  btn.title = state.selected
    ? "Download JSONL export (fork tree bundle)"
    : "Select a run to export";
}

async function downloadExport() {
  if (!state.selected) return;
  const url = `/api/export?runId=${encodeURIComponent(state.selected)}&bundle=true`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const disp = res.headers.get("content-disposition") || "";
  const m = /filename="([^"]+)"/.exec(disp);
  const filename = m?.[1] || `${state.selected}-bundle.jsonl`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function uploadJsonl(file) {
  const text = await file.text();
  const res = await fetch("/api/import", {
    method: "POST",
    headers: { "content-type": "application/x-ndjson" },
    body: text,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const hint = body.hint ? ` (${body.hint})` : "";
    throw new Error((body.error || `HTTP ${res.status}`) + hint);
  }
  state.selected = null;
  state.replay = null;
  await loadSource();
  await loadRuns();
}

// ── Hash routing (#/run/:id/step/:n) ───────────────────────
let suppressHashSync = false;

/** @returns {{ runId: string, step: number | null } | null} */
function parseRouteHash() {
  const raw = location.hash.replace(/^#/, "");
  if (!raw) return null;
  const m = raw.match(/^\/run\/([^/]+)(?:\/step\/(\d+))?$/);
  if (!m) return null;
  const step = m[2] != null ? Number(m[2]) : null;
  if (step != null && (!Number.isFinite(step) || step < 1)) return null;
  return { runId: decodeURIComponent(m[1]), step };
}

function syncRouteHash() {
  if (suppressHashSync || !state.selected) return;
  let path = `/run/${encodeURIComponent(state.selected)}`;
  if (state.selectedStepSeq != null) path += `/step/${state.selectedStepSeq}`;
  const next = "#" + path;
  if (location.hash === next) return;
  suppressHashSync = true;
  history.replaceState(null, "", next);
  suppressHashSync = false;
}

async function restoreFromRouteHash() {
  const route = parseRouteHash();
  if (!route) return false;
  if (!state.runs.some((r) => r.runId === route.runId)) return false;
  await selectRun(route.runId, { routeStep: route.step, fromHash: true });
  return true;
}

window.addEventListener("hashchange", () => {
  if (suppressHashSync || !state.runs.length) return;
  void restoreFromRouteHash();
});

// ── Source banner ──────────────────────────────────────────
async function loadSource() {
  const h = await api("/api/health");
  $("#sourceLabel").textContent = h.label;
  state.origin = h.origin || "";
  state.hitlSubmitDisabledReason = h.hitlSubmitDisabledReason || "";
  const offline = isOfflineHealth(h);
  $("#sourcePill").classList.toggle("offline", offline);
  updateOfflineBanner(offline);
  state.live = Boolean(h.live);
  state.hitlSubmitEnabled = Boolean(h.hitlSubmitEnabled);
  state.exportPath = h.exportPath ?? null;
  state.uiUrl = h.uiUrl ?? null;
  renderSettings(h);
  updateOfflineBanner(h);
  updateExportButton();
}

function setHitlFormMsg(text, kind) {
  const msg = $("#hitlFormMsg");
  msg.hidden = !text;
  msg.className = "hitl-form-msg" + (kind ? " " + kind : "");
  msg.textContent = text || "";
}

function canSubmitHitlNow() {
  return Boolean(
    state.selected &&
      state.hitlState === "paused" &&
      state.hitlSubmitEnabled &&
      state.live &&
      !state.hitlSubmitBusy,
  );
}

function syncHitlSubmitControls() {
  const btn = $("#hitlSubmitBtn");
  const canSubmit = canSubmitHitlNow();
  btn.disabled = !canSubmit;
  $("#hitlDecision").disabled = state.hitlSubmitBusy || !canSubmit;
}

async function submitHitlInput(ev) {
  if (ev) ev.preventDefault();
  const decision = $("#hitlDecision").value.trim();
  const btn = $("#hitlSubmitBtn");
  if (!state.selected) {
    setHitlFormMsg("Select a paused run first.", "err");
    return;
  }
  if (!decision) {
    setHitlFormMsg("Enter a decision before submitting.", "err");
    $("#hitlDecision").focus();
    return;
  }
  if (!canSubmitHitlNow()) return;

  state.hitlSubmitBusy = true;
  btn.disabled = true;
  setHitlFormMsg("Submitting…", "");
  try {
    const res = await apiPost("/api/hitl/input", { runId: state.selected, decision });
    if (res.accepted === false && res.state !== "resumed") {
      setHitlFormMsg("Input not accepted (duplicate or already resumed).", "err");
    } else {
      setHitlFormMsg(
        res.accepted ? "Accepted — run resuming…" : "Already resumed (idempotent no-op).",
        "ok",
      );
      $("#hitlDecision").value = "";
      await sleep(800);
      await loadRuns();
      if (state.selected) await selectRun(state.selected);
    }
  } catch (e) {
    setHitlFormMsg(e.message || "Submit failed.", "err");
  } finally {
    state.hitlSubmitBusy = false;
    syncHitlSubmitControls();
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Runs + fork tree ───────────────────────────────────────
async function loadRuns() {
  renderTreeSkeleton();
  try {
    const data = await api("/api/runs");
    state.runs = data.runs;
    state.roots = data.roots;
    await loadHitlPaused();
    await renderTree();
    if (!state.selected && state.runs.length) {
      const restored = await restoreFromRouteHash();
      if (!restored) {
        const first = state.roots[0] || state.runs[0].runId;
        await selectRun(first);
      }
    } else if (state.selected) {
      await refreshHitlForRun(state.selected);
    }
  } catch (e) {
    const tree = $("#tree");
    tree.classList.remove("is-loading");
    tree.innerHTML = "";
    tree.appendChild(el("div", "empty err", e.message));
    throw e;
  }
}

async function loadHitlPaused() {
  state.pausedRunsLoading = true;
  state.pausedRunsError = null;
  renderHitlPausedList();
  try {
    const data = await api("/api/hitl/paused");
    state.pausedRuns = data.paused || [];
  } catch (e) {
    state.pausedRuns = [];
    state.pausedRunsError = e.message || "Could not load paused runs.";
  } finally {
    state.pausedRunsLoading = false;
    renderHitlPausedList();
  }
}

function shouldShowHitlPanel() {
  return (
    state.pausedRunsLoading ||
    state.pausedRunsError ||
    state.pausedRuns.length > 0 ||
    state.live
  );
}

function renderHitlPausedList() {
  const panel = $("#hitlPanel");
  const list = $("#hitlPausedList");
  list.innerHTML = "";
  list.setAttribute("aria-busy", state.pausedRunsLoading ? "true" : "false");

  if (!shouldShowHitlPanel()) {
    if (panel) panel.hidden = true;
    return;
  }
  if (panel) panel.hidden = false;

  if (state.pausedRunsLoading) {
    const loading = el("div", "hitl-paused-status loading", "Loading paused runs…");
    loading.setAttribute("role", "status");
    list.appendChild(loading);
    return;
  }
  if (state.pausedRunsError) {
    const err = el("div", "hitl-paused-status err", state.pausedRunsError);
    err.setAttribute("role", "alert");
    list.appendChild(err);
    return;
  }
  if (!state.pausedRuns.length) {
    const empty = el("div", "hitl-paused-status empty", "No runs awaiting human input.");
    empty.setAttribute("role", "status");
    list.appendChild(empty);
    return;
  }

  for (const p of state.pausedRuns) {
    const row = el("button", "hitl-paused-item");
    row.type = "button";
    row.setAttribute("role", "listitem");
    row.setAttribute("aria-label", `Paused run ${p.runId}`);
    if (p.runId === state.selected) {
      row.classList.add("active");
      row.setAttribute("aria-current", "true");
    }
    row.appendChild(el("div", "run-id", p.runId));
    row.appendChild(el("div", "hint", "paused — click to review & submit"));
    row.onclick = () => selectRun(p.runId);
    list.appendChild(row);
  }
}

async function refreshHitlForRun(runId) {
  if (!runId) {
    state.hitlState = "none";
    updateHitlBanner();
    return;
  }
  try {
    const st = await api(`/api/hitl/status?runId=${encodeURIComponent(runId)}`);
    state.hitlState = st.state || "none";
    state.hitlSubmitEnabled = Boolean(st.submitEnabled);
  } catch {
    const run = state.runs.find((r) => r.runId === runId);
    state.hitlState = run?.hitlState || "none";
  }
  updateHitlBanner();
  renderHitlPausedList();
}

function updateHitlBanner() {
  const banner = $("#hitlBanner");
  const form = $("#hitlForm");
  const offlineNote = $("#hitlOfflineNote");
  const hint = $("#hitlDecisionHint");

  if (state.hitlState !== "paused") {
    banner.hidden = true;
    setHitlFormMsg("", "");
    return;
  }
  banner.hidden = false;
  $("#hitlBannerSub").textContent = state.selected || "";
  const canSubmit = hitlCanSubmit();
  form.hidden = false;
  offlineNote.hidden = canSubmit;
  if (hint) hint.hidden = !canSubmit;
  if (!canSubmit) {
    $("#hitlDecision").value = "";
    setHitlFormMsg("", "");
  }
  syncHitlSubmitControls();
}

function forkBadgeLabel(node) {
  return node.forkedAtSeq === null ? node.trajectory : `@${node.forkedAtSeq} ${node.trajectory}`;
}

function forkTwigSvg() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "fork-twig");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("viewBox", "0 0 14 14");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M2 7h6M8 4v6M8 7h4");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.4");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}

async function renderTree() {
  const host = $("#tree");
  host.innerHTML = "";
  state.forkTrees.clear();
  if (!state.roots.length) {
    renderEmptyState(
      host,
      "◇",
      "No runs in this journal",
      state.live
        ? "Start an agent run — it will show up in the fork tree."
        : "This export has no recorded runs yet.",
    );
    return;
  }
  for (const root of state.roots) {
    const data = await api(`/api/tree?runId=${encodeURIComponent(root)}`);
    state.forkTrees.set(root, data.tree);
    const block = el("div", "fork-tree-block");
    if (state.roots.length > 1) {
      block.appendChild(el("div", "fork-tree-root-label", root));
    }
    const ul = el("ul", "fork-lineage-tree");
    ul.setAttribute("role", "group");
    renderTreeNode(ul, data.tree, 0);
    block.appendChild(ul);
    host.appendChild(block);
  }
  syncTreeSelection();
}

function renderTreeNode(ul, node, depth) {
  const li = el("li", "fork-tree-item");
  li.setAttribute("role", "treeitem");
  const row = el("button", "tree-node");
  row.type = "button";
  row.classList.add(node.forkedAtSeq === null ? "root" : "fork");
  row.dataset.runId = node.runId;
  if (depth > 0) row.appendChild(forkTwigSvg());
  row.appendChild(el("span", "tname", node.runId));
  row.appendChild(el("span", "traj-badge", forkBadgeLabel(node)));
  const label = `${node.forkedAtSeq === null ? "Root" : "Fork"} run ${node.runId}, ${forkBadgeLabel(node)}`;
  row.setAttribute("aria-label", label);
  if (node.runId === state.selected) row.setAttribute("aria-current", "location");
  row.onclick = () => selectRun(node.runId);
  li.appendChild(row);
  if (node.children.length) {
    const childUl = el("ul", "fork-tree-children");
    childUl.setAttribute("role", "group");
    for (const c of node.children) renderTreeNode(childUl, c, depth + 1);
    li.appendChild(childUl);
  }
  ul.appendChild(li);
}

function syncTreeSelection() {
  document.querySelectorAll(".tree-node").forEach((row) => {
    const id = row.dataset.runId;
    const on = id === state.selected;
    row.classList.toggle("active", on);
    row.classList.toggle("on-path", state.lineagePath.has(id));
    if (on) row.setAttribute("aria-current", "location");
    else row.removeAttribute("aria-current");
  });
}

function renderLineageBar(chain) {
  const bar = $("#lineagePath");
  bar.innerHTML = "";
  if (!chain || chain.length <= 1) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  chain.forEach((node, i) => {
    if (i > 0) bar.appendChild(el("span", "lineage-sep", "→"));
    const btn = el("button", "lineage-crumb");
    btn.type = "button";
    btn.textContent = node.runId;
    btn.title = forkBadgeLabel(node);
    if (node.runId === state.selected) {
      btn.classList.add("active");
      btn.setAttribute("aria-current", "location");
    }
    btn.setAttribute("aria-label", `Lineage: ${node.runId}`);
    btn.onclick = () => selectRun(node.runId);
    bar.appendChild(btn);
  });
}

async function refreshLineageForRun(runId) {
  if (!runId) {
    state.lineagePath = new Set();
    renderLineageBar([]);
    syncTreeSelection();
    return;
  }
  const data = await api(`/api/tree?runId=${encodeURIComponent(runId)}`);
  const chain = data.lineage || [];
  state.lineagePath = new Set(chain.map((n) => n.runId));
  renderLineageBar(chain);
  syncTreeSelection();
}

// ── Select + render a run ──────────────────────────────────
async function selectRun(runId, opts = {}) {
  state.selected = runId;
  updateExportButton();
  state.ttN = null;
  state.selectedStepSeq = null;
  await refreshLineageForRun(runId);
  const replay = await api(`/api/replay?runId=${encodeURIComponent(runId)}`);
  state.replay = replay;
  renderRunHeader(replay);
  setupTimeTravel(replay);

  let initialSeq = null;
  if (opts.routeStep != null && replay.steps.length) {
    const max = replay.steps.length;
    const n = Math.min(Math.max(1, opts.routeStep), max);
    const step = replay.steps.find((s) => s.seq === n) ?? replay.steps[max - 1];
    initialSeq = step.seq;
    if (max > 1) applyTimeTravelStep(n, max);
  }

  renderTimeline();
  if (replay.steps.length) {
    const seq = initialSeq ?? replay.steps[replay.steps.length - 1].seq;
    selectStep(seq, { skipHash: true });
  }
  populateDiffPickers();
  await refreshHitlForRun(runId);
  updateExportButton();
  if (!opts.fromHash) syncRouteHash();
}

function renderRunHeader(r) {
  const head = $("#runHeader");
  head.innerHTML = "";
  head.appendChild(el("div", "run-title", r.runId));
  const row = el("div", "run-meta-row");
  const chip = (label, val, cls) => {
    const c = el("span", "chip" + (cls ? " " + cls : ""));
    c.appendChild(el("span", null, label + " "));
    c.appendChild(el("b", null, String(val)));
    return c;
  };
  row.appendChild(chip("trajectory", r.trajectory, "accent"));
  row.appendChild(chip("steps", r.steps.length));
  row.appendChild(chip("effects", r.effects.length));
  row.appendChild(chip("elapsed", formatDuration(r.totalElapsedMs) ?? `${r.totalElapsedMs}ms`));
  const runRow = state.runs.find((x) => x.runId === r.runId);
  const hs = runRow?.hitlState || state.hitlState;
  if (hs && hs !== "none") {
    row.appendChild(chip("HITL", hs, hs === "paused" ? "accent" : ""));
  }
  if (r.meta && r.meta.parentRun) {
    row.appendChild(chip("forked from", `${r.meta.parentRun} @${r.meta.forkedAtSeq}`));
  }
  if (r.divergencePoints.length) {
    row.appendChild(chip("forks here", r.divergencePoints.length));
  }
  head.appendChild(row);
}

// ── Time-travel ────────────────────────────────────────────
function applyTimeTravelStep(n, max) {
  const range = $("#ttRange");
  if (!range || max <= 1) return;
  state.ttN = n === max ? null : n;
  range.value = String(n);
  $("#ttNow").textContent = String(n);
  range.style.setProperty("--pct", (n / max) * 100 + "%");
}

function setupTimeTravel(r) {
  const bar = $("#ttBar");
  const range = $("#ttRange");
  const max = r.steps.length;
  if (max <= 1) { bar.hidden = true; return; }
  bar.hidden = false;
  range.min = 1;
  range.max = max;
  range.value = max;
  state.ttN = null;
  $("#ttNow").textContent = max;
  $("#ttMax").textContent = max;
  range.style.setProperty("--pct", "100%");
  range.oninput = () => {
    const n = Number(range.value);
    applyTimeTravelStep(n, max);
    renderTimeline();
    selectStep(n);
  };
  $("#ttLive").onclick = () => {
    applyTimeTravelStep(max, max);
    renderTimeline();
    selectStep(max);
  };
}

// ── Timeline ───────────────────────────────────────────────
function renderTimeline() {
  const tl = $("#timeline");
  tl.classList.remove("is-loading");
  tl.innerHTML = "";
  const r = state.replay;
  if (!r) return;
  const cutoff = state.ttN; // null = show all
  const divBySeq = new Map();
  for (const d of r.divergencePoints) {
    if (!divBySeq.has(d.seq)) divBySeq.set(d.seq, []);
    divBySeq.get(d.seq).push(d);
  }

  for (const s of r.steps) {
    const node = el("div", "step");
    node.classList.add("kind-" + s.kind);
    node.classList.toggle("has-effect", s.effects.length > 0);
    node.classList.toggle("seeded", s.seeded);
    if (cutoff !== null && s.seq > cutoff) node.classList.add("future");
    if (cutoff !== null && s.seq === cutoff) node.classList.add("current");
    if (state.selectedStepSeq === s.seq) node.classList.add("active");

    const dot = el("div", "node", String(s.seq));
    node.appendChild(dot);

    const head = el("div", "step-head");
    head.appendChild(el("span", "step-seq", "#" + s.seq));
    head.appendChild(el("span", "step-label", humanStepLabel(s)));
    const prov = providerFromJournalOutput(s.output);
    if (prov) {
      const pb = el("span", "provider-badge", providerIconText(prov.provider));
      pb.title = `${prov.provider} (${prov.mode})`;
      head.appendChild(pb);
    }
    head.appendChild(el("span", "step-kind kind-" + s.kind, s.kind));
    const tags = el("div", "step-tags");
    if (s.sideEffect) tags.appendChild(el("span", "tag effect", "side-effect"));
    if (s.effects.length) tags.appendChild(el("span", "tag effect", `⚡ ${s.effects.length}`));
    if (s.seeded) tags.appendChild(el("span", "tag seeded", "seeded"));
    if (s.elapsedMsFromPrev !== null) {
      const dur = formatDuration(s.elapsedMsFromPrev);
      if (dur) tags.appendChild(el("span", "tag duration", dur));
    }
    head.appendChild(tags);
    node.appendChild(head);

    node.appendChild(el("div", "step-out", fmtOut(s.output)));
    node.onclick = () => selectStep(s.seq);
    tl.appendChild(node);

    if (divBySeq.has(s.seq)) {
      for (const d of divBySeq.get(s.seq)) {
        const m = el("div", "diverge-marker", `⑂ fork diverged here → ${d.forkRunId} [${d.forkTrajectory}]`);
        m.style.cursor = "pointer";
        m.onclick = () => selectRun(d.forkRunId);
        tl.appendChild(m);
      }
    }
  }
}

function selectStep(seq, opts = {}) {
  state.selectedStepSeq = seq;
  document.querySelectorAll(".step").forEach((n) => {
    const sseq = Number(n.querySelector(".step-seq")?.textContent.replace("#", ""));
    n.classList.toggle("active", sseq === seq);
  });
  renderStepDetail(seq);
  if (!opts.skipHash) syncRouteHash();
}

function renderStepDetail(seq) {
  const panel = $("#tab-step");
  panel.innerHTML = "";
  const r = state.replay;
  const s = r && r.steps.find((x) => x.seq === seq);
  if (!s) { panel.appendChild(el("div", "empty", "Select a step.")); return; }

  const kv = (label, value, pre) => {
    const wrap = el("div", "kv");
    wrap.appendChild(el("div", "kv-label", label));
    if (pre) {
      const p = el("pre", "json", value);
      wrap.appendChild(p);
    } else {
      wrap.appendChild(el("div", "kv-value", value));
    }
    return wrap;
  };

  panel.appendChild(kv("step", `#${s.seq} · ${humanStepLabel(s)}`));
  panel.appendChild(kv("logical name", s.stepName));
  panel.appendChild(kv("kind", s.kind));
  const prov = providerFromJournalOutput(s.output);
  if (prov) panel.appendChild(kv("model provider", `${prov.provider} (${prov.mode})`));
  panel.appendChild(kv("idempotency key", s.idemKey));
  panel.appendChild(kv("recorded at", s.recordedAt));
  const timing =
    s.elapsedMsFromPrev === null
      ? "first step"
      : `${formatDuration(s.elapsedMsFromPrev) ?? s.elapsedMsFromPrev + "ms"} from previous`;
  panel.appendChild(kv("timing", timing));
  panel.appendChild(kv("seeded", s.seeded ? `yes (from ${s.seededFrom})` : "no — natively executed"));
  panel.appendChild(kv("output", fmtOut(s.output), true));

  if (s.effects.length) {
    panel.appendChild(el("div", "kv-label", "side effects fired"));
    for (const e of s.effects) {
      panel.appendChild(el("pre", "json", fmtOut({ id: e.id, idemKey: e.idemKey, firedAt: e.firedAt, payload: e.payload })));
    }
  }
}

// ── Diff ───────────────────────────────────────────────────
const DIFF_STATUS_SYM = { same: "=", changed: "≠", only_a: "A", only_b: "B" };

function shortRunId(runId) {
  if (!runId || runId.length <= 22) return runId;
  return runId.slice(0, 10) + "…" + runId.slice(-8);
}

function diffOutputPre(output) {
  return el("pre", "diff-pre", fmtOut(output));
}

function diffCol(label, output, side) {
  const col = el("div", "diff-col diff-col-" + side);
  col.appendChild(el("div", "diff-col-label", label));
  col.appendChild(diffOutputPre(output));
  return col;
}

/** Render step output(s) for trajectory diff rows (uses /api/diff StepDiff fields). */
function appendDiffStepOutput(parent, st, mode, runA, runB) {
  if (st.status === "changed") {
    const wrap = el("div", "diff-out" + (mode === "side" ? " diff-out-side" : " diff-out-inline"));
    if (mode === "side") {
      wrap.appendChild(diffCol(shortRunId(runA), st.aOutput, "a"));
      wrap.appendChild(diffCol(shortRunId(runB), st.bOutput, "b"));
    } else {
      const a = el("div", "diff-inline-line");
      a.appendChild(el("span", "diff-inline-tag a", "A"));
      a.appendChild(diffOutputPre(st.aOutput));
      wrap.appendChild(a);
      const b = el("div", "diff-inline-line");
      b.appendChild(el("span", "diff-inline-tag b", "B"));
      b.appendChild(diffOutputPre(st.bOutput));
      wrap.appendChild(b);
    }
    parent.appendChild(wrap);
    return;
  }
  const single = el("div", "diff-out");
  if (st.status === "only_a") {
    single.appendChild(el("div", "diff-col-label", shortRunId(runA)));
    single.appendChild(diffOutputPre(st.aOutput));
  } else if (st.status === "only_b") {
    single.appendChild(el("div", "diff-col-label", shortRunId(runB)));
    single.appendChild(diffOutputPre(st.bOutput));
  } else {
    single.appendChild(diffOutputPre(st.aOutput));
  }
  parent.appendChild(single);
}

function setDiffViewMode(mode, rerender) {
  state.diffViewMode = mode === "inline" ? "inline" : "side";
  localStorage.setItem("durabl.diffViewMode", state.diffViewMode);
  document.querySelectorAll(".diff-view-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === state.diffViewMode);
  });
  if (typeof rerender === "function") rerender();
}

function populateDiffPickers() {
  const panel = $("#tab-diff");
  panel.innerHTML = "";
  const controls = el("div", "diff-controls");
  const selA = el("select", "pick");
  const selB = el("select", "pick");
  for (const run of state.runs) {
    const oa = el("option", null, run.runId); oa.value = run.runId;
    const ob = el("option", null, run.runId); ob.value = run.runId;
    selA.appendChild(oa); selB.appendChild(ob.cloneNode(true));
  }
  selA.value = state.selected;
  // default B = first fork of selected, else next run
  const forkTarget = state.replay?.divergencePoints?.[0]?.forkRunId;
  selB.value = forkTarget || (state.runs.find((r) => r.runId !== state.selected)?.runId ?? state.selected);
  controls.appendChild(el("span", "kv-label", "A"));
  controls.appendChild(selA);
  controls.appendChild(el("span", "kv-label", "B"));
  controls.appendChild(selB);

  const viewToggle = el("div", "diff-view-toggle");
  viewToggle.setAttribute("role", "group");
  viewToggle.setAttribute("aria-label", "Diff layout");
  for (const { mode, label } of [
    { mode: "side", label: "Side by side" },
    { mode: "inline", label: "Inline" },
  ]) {
    const btn = el("button", "diff-view-btn btn-ghost" + (state.diffViewMode === mode ? " active" : ""), label);
    btn.type = "button";
    btn.dataset.mode = mode;
    btn.onclick = () => setDiffViewMode(mode, run);
    viewToggle.appendChild(btn);
  }
  controls.appendChild(viewToggle);

  const result = el("div", "diff-result");
  const run = async () => {
    result.innerHTML = "";
    if (selA.value === selB.value) {
      result.appendChild(el("div", "empty", "Pick two different runs."));
      return;
    }
    const runA = selA.value;
    const runB = selB.value;
    const d = await api(`/api/diff?a=${encodeURIComponent(runA)}&b=${encodeURIComponent(runB)}`);
    const summary = el("div", "diff-summary");
    if (d.firstDivergenceSeq === null) {
      summary.appendChild(el("div", "first-div", "identical trajectories"));
    } else {
      summary.appendChild(el("div", "first-div", `first divergence at seq ${d.firstDivergenceSeq}`));
      const jump = el("button", "btn-ghost diff-jump", "Jump to divergence");
      jump.type = "button";
      jump.onclick = () => {
        const target = result.querySelector(".diff-row.divergence");
        if (target) target.scrollIntoView({ block: "nearest", behavior: "smooth" });
      };
      summary.appendChild(jump);
    }
    result.appendChild(summary);

    for (const st of d.steps) {
      const row = el("div", "diff-row " + st.status);
      if (d.firstDivergenceSeq !== null && st.seq === d.firstDivergenceSeq) {
        row.classList.add("divergence");
      }
      row.dataset.seq = String(st.seq);
      row.appendChild(el("div", "diff-badge", DIFF_STATUS_SYM[st.status]));
      const body = el("div", "diff-body");
      body.appendChild(el("div", "diff-step", `#${st.seq} ${st.stepName}${st.seeded ? " (seeded)" : ""}`));
      appendDiffStepOutput(body, st, state.diffViewMode, runA, runB);
      row.appendChild(body);
      result.appendChild(row);
    }
  };
  selA.onchange = run;
  selB.onchange = run;
  panel.appendChild(controls);
  panel.appendChild(result);
  run();
}

// ── Tabs ───────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    $("#tab-" + tab.dataset.tab).classList.add("active");
  };
});

$("#hitlForm").addEventListener("submit", submitHitlInput);
$("#hitlDecision").addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter" || !(ev.metaKey || ev.ctrlKey)) return;
  ev.preventDefault();
  void submitHitlInput();
});

const importFile = $("#importFile");
if (importFile) {
  $("#btnImport").addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", () => {
    const file = importFile.files && importFile.files[0];
    importFile.value = "";
    if (!file) return;
    void uploadJsonl(file).catch((e) => {
      window.alert(e instanceof Error ? e.message : String(e));
    });
  });
}
$("#btnExport").addEventListener("click", () => {
  void downloadExport().catch((e) => {
    window.alert(e instanceof Error ? e.message : String(e));
  });
});

// ── Boot ───────────────────────────────────────────────────
(async function boot() {
  try {
    initThemeControls();
    const btnImport = $("#btnImport");
    const importFile = $("#importFile");
    if (btnImport && importFile) {
      btnImport.addEventListener("click", () => importFile.click());
      importFile.addEventListener("change", async () => {
        const file = importFile.files?.[0];
        importFile.value = "";
        if (!file) return;
        try {
          btnImport.disabled = true;
          await uploadJsonl(file);
        } catch (e) {
          alert(e.message);
        } finally {
          btnImport.disabled = false;
        }
      });
    }
    const btnExport = $("#btnExport");
    if (btnExport) {
      btnExport.addEventListener("click", () => {
        void downloadExport().catch((e) => alert(e.message));
      });
    }
    await loadSource();
    await loadRuns();
    setInterval(() => {
      void loadSource();
      void loadHitlPaused().then(() => {
        if (state.selected) void refreshHitlForRun(state.selected);
      });
    }, 3000);
  } catch (e) {
    document.body.innerHTML = `<div style="padding:40px;font-family:monospace;color:#f87171">Failed to load: ${e.message}</div>`;
  }
})();
