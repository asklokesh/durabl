// durabl replay UI — vanilla JS, zero deps. Talks to the read-only replay APIs.
"use strict";

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, txt) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
};

const state = {
  runs: [],
  roots: [],
  selected: null,
  replay: null, // current full ReplayedRun
  ttN: null, // time-travel step (null = full run)
  selectedStepSeq: null,
  live: false,
  hitlSubmitEnabled: false,
  hitlState: "none",
  pausedRuns: [],
  origin: "",
  hitlSubmitDisabledReason: "",
  /** Trajectory diff panel: "side" | "inline" */
  diffViewMode: localStorage.getItem("durabl.diffViewMode") === "inline" ? "inline" : "side",
  exportPath: null,
  uiUrl: null,
};

const THEME_STORAGE_KEY = "durabl.theme";

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `HTTP ${res.status}`);
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

// ── Source banner ──────────────────────────────────────────
async function loadSource() {
  const h = await api("/api/health");
  $("#sourceLabel").textContent = h.label;
  state.origin = h.origin || "";
  state.hitlSubmitDisabledReason = h.hitlSubmitDisabledReason || "";
  const offline = isOfflineHealth(h);
  $("#sourcePill").classList.toggle("offline", offline);
  state.live = Boolean(h.live);
  state.hitlSubmitEnabled = Boolean(h.hitlSubmitEnabled);
  state.exportPath = h.exportPath ?? null;
  state.uiUrl = h.uiUrl ?? null;
  renderSettings(h);
  updateOfflineBanner(h);
  updateExportButton();
}

async function submitHitlInput(ev) {
  ev.preventDefault();
  const decision = $("#hitlDecision").value.trim();
  const msg = $("#hitlFormMsg");
  const btn = $("#hitlSubmitBtn");
  if (!state.selected || !decision) return;
  btn.disabled = true;
  msg.hidden = false;
  msg.className = "hitl-form-msg";
  msg.textContent = "Submitting…";
  try {
    const res = await apiPost("/api/hitl/input", { runId: state.selected, decision });
    if (res.accepted === false && res.state !== "resumed") {
      msg.classList.add("err");
      msg.textContent = "Input not accepted (duplicate or already resumed).";
    } else {
      msg.classList.add("ok");
      msg.textContent = res.accepted
        ? "Accepted — run resuming…"
        : "Already resumed (idempotent no-op).";
      $("#hitlDecision").value = "";
      await sleep(800);
      await loadRuns();
      if (state.selected) await selectRun(state.selected);
    }
  } catch (e) {
    msg.classList.add("err");
    msg.textContent = e.message;
  } finally {
    btn.disabled = !state.hitlSubmitEnabled;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Runs + fork tree ───────────────────────────────────────
async function loadRuns() {
  const data = await api("/api/runs");
  state.runs = data.runs;
  state.roots = data.roots;
  await loadHitlPaused();
  await renderTree();
  if (!state.selected && state.runs.length) {
    // prefer a root run for the first view
    const first = state.roots[0] || state.runs[0].runId;
    selectRun(first);
  } else if (state.selected) {
    await refreshHitlForRun(state.selected);
  }
}

async function loadHitlPaused() {
  try {
    const data = await api("/api/hitl/paused");
    state.pausedRuns = data.paused || [];
    renderHitlPausedList();
  } catch {
    state.pausedRuns = [];
    renderHitlPausedList();
  }
}

function renderHitlPausedList() {
  const list = $("#hitlPausedList");
  list.innerHTML = "";
  if (!state.pausedRuns.length) {
    renderEmptyState(
      list,
      "◎",
      "No paused runs",
      state.live
        ? "Runs waiting for human input appear here."
        : "Offline replay — no live HITL queue.",
    );
    return;
  }
  for (const p of state.pausedRuns) {
    const row = el("button", "hitl-paused-item");
    row.type = "button";
    if (p.runId === state.selected) row.classList.add("active");
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
  const submitBtn = $("#hitlSubmitBtn");
  const msg = $("#hitlFormMsg");
  msg.hidden = true;

  if (state.hitlState !== "paused") {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  $("#hitlBannerSub").textContent = state.selected || "";
  const canSubmit = state.hitlSubmitEnabled && state.live;
  form.hidden = !canSubmit;
  offlineNote.hidden = canSubmit;
  submitBtn.disabled = !canSubmit;
  if (!canSubmit) {
    $("#hitlDecision").value = "";
  }
}

async function renderTree() {
  const tree = $("#tree");
  tree.innerHTML = "";
  if (!state.roots.length) {
    renderEmptyState(
      tree,
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
    renderTreeNode(tree, data.tree, 0);
  }
}

function renderTreeNode(container, node, depth) {
  const row = el("div", "tree-node");
  row.classList.add(node.forkedAtSeq === null ? "root" : "fork");
  if (state.selected === node.runId) row.classList.add("active");
  if (depth > 0) {
    row.appendChild(el("span", "twig", "  ".repeat(depth - 1) + "└─"));
  }
  row.appendChild(el("span", "tname", node.runId));
  const badge = el("span", "traj-badge", node.forkedAtSeq === null ? node.trajectory : `@${node.forkedAtSeq} ${node.trajectory}`);
  row.appendChild(badge);
  row.onclick = () => selectRun(node.runId);
  container.appendChild(row);
  for (const c of node.children) renderTreeNode(container, c, depth + 1);
}

// ── Select + render a run ──────────────────────────────────
async function selectRun(runId) {
  state.selected = runId;
  state.ttN = null;
  state.selectedStepSeq = null;
  document.querySelectorAll(".tree-node").forEach((n) => {
    n.classList.toggle("active", n.querySelector(".tname")?.textContent === runId);
  });
  const replay = await api(`/api/replay?runId=${encodeURIComponent(runId)}`);
  state.replay = replay;
  renderRunHeader(replay);
  setupTimeTravel(replay);
  renderTimeline();
  if (replay.steps.length) selectStep(replay.steps[replay.steps.length - 1].seq);
  populateDiffPickers();
  await refreshHitlForRun(runId);
  updateExportButton();
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
  row.appendChild(chip("elapsed", r.totalElapsedMs + "ms"));
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
    state.ttN = n === max ? null : n;
    $("#ttNow").textContent = n;
    range.style.setProperty("--pct", (n / max) * 100 + "%");
    renderTimeline();
    selectStep(n);
  };
  $("#ttLive").onclick = () => {
    range.value = max;
    state.ttN = null;
    $("#ttNow").textContent = max;
    range.style.setProperty("--pct", "100%");
    renderTimeline();
    selectStep(max);
  };
}

// ── Timeline ───────────────────────────────────────────────
function renderTimeline() {
  const tl = $("#timeline");
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
    head.appendChild(el("span", "step-name", s.stepName));
    head.appendChild(el("span", "step-kind kind-" + s.kind, s.kind));
    const tags = el("div", "step-tags");
    if (s.sideEffect) tags.appendChild(el("span", "tag effect", "side-effect"));
    if (s.effects.length) tags.appendChild(el("span", "tag effect", `⚡ ${s.effects.length}`));
    if (s.seeded) tags.appendChild(el("span", "tag seeded", "seeded"));
    if (s.elapsedMsFromPrev !== null) tags.appendChild(el("span", "tag timing", `+${s.elapsedMsFromPrev}ms`));
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

function selectStep(seq) {
  state.selectedStepSeq = seq;
  document.querySelectorAll(".step").forEach((n) => {
    const sseq = Number(n.querySelector(".step-seq")?.textContent.replace("#", ""));
    n.classList.toggle("active", sseq === seq);
  });
  renderStepDetail(seq);
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

  panel.appendChild(kv("step", `#${s.seq} · ${s.stepName}`));
  panel.appendChild(kv("kind", s.kind));
  panel.appendChild(kv("idempotency key", s.idemKey));
  panel.appendChild(kv("recorded at", s.recordedAt));
  panel.appendChild(kv("timing", s.elapsedMsFromPrev === null ? "first step" : `+${s.elapsedMsFromPrev}ms from previous`));
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
      void loadHitlPaused().then(() => {
        if (state.selected) void refreshHitlForRun(state.selected);
      });
    }, 3000);
  } catch (e) {
    document.body.innerHTML = `<div style="padding:40px;font-family:monospace;color:#f87171">Failed to load: ${e.message}</div>`;
  }
})();
