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
};

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

// ── Source banner ──────────────────────────────────────────
async function loadSource() {
  const h = await api("/api/health");
  $("#sourceLabel").textContent = h.label;
  const offline = h.origin && h.origin.startsWith("imported");
  $("#sourcePill").classList.toggle("offline", offline);
  state.live = Boolean(h.live);
  state.hitlSubmitEnabled = Boolean(h.hitlSubmitEnabled);
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
  const panel = $("#hitlPanel");
  const list = $("#hitlPausedList");
  list.innerHTML = "";
  if (!state.pausedRuns.length) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
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
    tree.appendChild(el("div", "empty", "No runs in this journal yet."));
    return;
  }
  for (const root of state.roots) {
    const data = await api(`/api/tree?runId=${encodeURIComponent(root)}`);
    renderTreeNode(tree, data.tree, 0);
  }
  applyTreeFilter();
}

function renderTreeNode(container, node, depth) {
  const row = el("div", "tree-node");
  row.dataset.runId = node.runId;
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
  scrollActiveStepIntoView();
}

function scrollActiveStepIntoView(){document.querySelector(".step.active")?.scrollIntoView({block:"nearest",behavior:"smooth"})}
function visibleStepSeqs(){const r=state.replay;if(!r?.steps.length)return[];const cutoff=state.ttN;return r.steps.filter(s=>cutoff===null||s.seq<=cutoff).map(s=>s.seq)}
function navigateStep(delta){const seqs=visibleStepSeqs();if(!seqs.length)return;let idx=state.selectedStepSeq!=null?seqs.indexOf(state.selectedStepSeq):-1;if(idx<0)idx=seqs.length-1;const next=Math.max(0,Math.min(seqs.length-1,idx+delta));if(next===idx)return;selectStep(seqs[next])}
function applyTreeFilter(){const q=($("#runSearch")?.value||"").trim().toLowerCase();document.querySelectorAll(".tree-node").forEach(row=>{const id=(row.dataset.runId||"").toLowerCase();row.hidden=Boolean(q)&&!id.includes(q)})}
function focusRunSearch(){const search=$("#runSearch");if(!search)return;search.focus();search.select()}
function isTypingTarget(target){if(!target||!(target instanceof Element))return false;const tag=target.tagName;if(tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT")return true;return target.isContentEditable}
function kbdHelpOpen(){const dlg=$("#kbdHelp");return Boolean(dlg&&!dlg.hidden)}
function openKbdHelp(){const dlg=$("#kbdHelp");if(dlg)dlg.hidden=false}
function closeKbdHelp(){const dlg=$("#kbdHelp");if(dlg)dlg.hidden=true}
function toggleKbdHelp(){if(kbdHelpOpen())closeKbdHelp();else openKbdHelp()}
function setupKeyboardShortcuts(){$("#runSearch")?.addEventListener("input",applyTreeFilter);$("#kbdHelpClose")?.addEventListener("click",closeKbdHelp);$("#kbdHelp")?.addEventListener("click",ev=>{if(ev.target===$("#kbdHelp"))closeKbdHelp()});document.addEventListener("keydown",ev=>{if(ev.key==="Escape"){if(kbdHelpOpen()){ev.preventDefault();closeKbdHelp()}return}if(ev.key==="?"&&!ev.metaKey&&!ev.ctrlKey&&!ev.altKey){if(!isTypingTarget(ev.target)){ev.preventDefault();toggleKbdHelp()}return}if(isTypingTarget(ev.target))return;if(ev.key==="/"){ev.preventDefault();focusRunSearch();return}if(ev.key==="j"&&!ev.metaKey&&!ev.ctrlKey&&!ev.altKey){ev.preventDefault();navigateStep(1);return}if(ev.key==="k"&&!ev.metaKey&&!ev.ctrlKey&&!ev.altKey){ev.preventDefault();navigateStep(-1)}})}


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
  const result = el("div");
  const run = async () => {
    result.innerHTML = "";
    if (selA.value === selB.value) { result.appendChild(el("div", "empty", "Pick two different runs.")); return; }
    const d = await api(`/api/diff?a=${encodeURIComponent(selA.value)}&b=${encodeURIComponent(selB.value)}`);
    result.appendChild(el("div", "first-div", d.firstDivergenceSeq === null ? "identical trajectories" : `first divergence at seq ${d.firstDivergenceSeq}`));
    for (const st of d.steps) {
      const row = el("div", "diff-row " + st.status);
      const sym = { same: "=", changed: "≠", only_a: "A", only_b: "B" }[st.status];
      row.appendChild(el("div", "diff-badge", sym));
      const body = el("div");
      body.appendChild(el("div", "diff-step", `#${st.seq} ${st.stepName}${st.seeded ? " (seeded)" : ""}`));
      if (st.status === "changed") {
        const out = el("div", "diff-out");
        const a = el("span", "a", "A: " + fmtOut(st.aOutput)); out.appendChild(a);
        out.appendChild(document.createElement("br"));
        const b = el("span", "b", "B: " + fmtOut(st.bOutput)); out.appendChild(b);
        body.appendChild(out);
      } else if (st.status === "same") {
        body.appendChild(el("div", "diff-out", fmtOut(st.aOutput)));
      } else {
        body.appendChild(el("div", "diff-out", fmtOut(st.aOutput ?? st.bOutput)));
      }
      row.appendChild(body);
      result.appendChild(row);
    }
  };
  selA.onchange = run; selB.onchange = run;
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
setupKeyboardShortcuts();

// ── Boot ───────────────────────────────────────────────────
(async function boot() {
  try {
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
