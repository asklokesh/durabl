"""Read-only replay over a :class:`JournalSource` — mirrors ``src/replay.ts`` (subset)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from durabl.journal_source import JournalSource
from durabl.types import EffectRow, JournalEntry, RunMeta


@dataclass(frozen=True)
class ReplayEffect:
    id: int
    step_name: str
    idem_key: str
    fired_at: str
    payload: Any


@dataclass(frozen=True)
class ReplayStep:
    seq: int
    step_name: str
    kind: str
    output: Any
    side_effect: bool
    seeded: bool
    seeded_from: str | None
    idem_key: str
    recorded_at: str
    elapsed_ms_from_prev: int | None
    effects: tuple[ReplayEffect, ...]


@dataclass(frozen=True)
class DivergencePoint:
    seq: int
    fork_run_id: str
    fork_trajectory: str


@dataclass(frozen=True)
class ReplayedRun:
    run_id: str
    trajectory: str
    meta: RunMeta | None
    steps: tuple[ReplayStep, ...]
    total_elapsed_ms: int
    outcome: Any
    effects: tuple[ReplayEffect, ...]
    divergence_points: tuple[DivergencePoint, ...]
    reconstructed_from: str


@dataclass(frozen=True)
class StateAsOf:
    run_id: str
    n: int
    max_seq: int
    steps: tuple[ReplayStep, ...]
    current_output: Any
    effects: tuple[ReplayEffect, ...]
    diverged_so_far: tuple[DivergencePoint, ...]
    reconstructed_from: str


def _elapsed_ms(prev: str, cur: str) -> int | None:
    try:
        a = datetime.fromisoformat(prev.replace("Z", "+00:00"))
        b = datetime.fromisoformat(cur.replace("Z", "+00:00"))
    except ValueError:
        return None
    return int((b - a).total_seconds() * 1000)


def _safe_parse(raw: str) -> Any:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


def _map_effects(rows: list[EffectRow]) -> list[ReplayEffect]:
    return [
        ReplayEffect(
            id=r.id,
            step_name=r.step_name,
            idem_key=r.idem_key,
            fired_at=r.fired_at,
            payload=_safe_parse(r.payload),
        )
        for r in rows
    ]


def _effects_at_step(effects: list[ReplayEffect], step_name: str) -> tuple[ReplayEffect, ...]:
    return tuple(e for e in effects if e.step_name == step_name)


def divergence_points(source: JournalSource, run_id: str) -> list[DivergencePoint]:
    out: list[DivergencePoint] = []
    for child in source.child_runs(run_id):
        if child.forked_at_seq is not None:
            out.append(
                DivergencePoint(
                    seq=child.forked_at_seq,
                    fork_run_id=child.run_id,
                    fork_trajectory=child.trajectory,
                )
            )
    out.sort(key=lambda d: (d.seq, d.fork_run_id))
    return out


def reconstruct(source: JournalSource, run_id: str) -> ReplayedRun:
    entries = source.trajectory(run_id)
    meta = source.run_meta(run_id)
    effects = _map_effects(source.effects_for(run_id))

    steps: list[ReplayStep] = []
    for i, e in enumerate(entries):
        prev: JournalEntry | None = entries[i - 1] if i > 0 else None
        elapsed = (
            _elapsed_ms(prev.recorded_at, e.recorded_at) if prev is not None else None
        )
        steps.append(
            ReplayStep(
                seq=e.seq,
                step_name=e.step_name,
                kind=e.kind,
                output=e.output,
                side_effect=e.side_effect,
                seeded=e.seeded_from is not None,
                seeded_from=e.seeded_from,
                idem_key=e.idem_key,
                recorded_at=e.recorded_at,
                elapsed_ms_from_prev=elapsed,
                effects=_effects_at_step(effects, e.step_name),
            )
        )

    total = 0
    if len(entries) >= 2:
        elapsed = _elapsed_ms(entries[0].recorded_at, entries[-1].recorded_at)
        total = elapsed if elapsed is not None else 0

    return ReplayedRun(
        run_id=run_id,
        trajectory=meta.trajectory if meta else "main",
        meta=meta,
        steps=tuple(steps),
        total_elapsed_ms=total,
        outcome=entries[-1].output if entries else None,
        effects=tuple(effects),
        divergence_points=tuple(divergence_points(source, run_id)),
        reconstructed_from=source.origin,
    )


def state_at(source: JournalSource, run_id: str, n: int) -> StateAsOf:
    full = reconstruct(source, run_id)
    max_seq = full.steps[-1].seq if full.steps else 0
    if not isinstance(n, int) or n < 1 or n > max_seq:
        raise ValueError(
            f"time-travel target step {n} out of range (run {run_id} has steps 1..{max_seq})"
        )
    steps = tuple(s for s in full.steps if s.seq <= n)
    effects = tuple(
        e for e in full.effects if any(s.step_name == e.step_name for s in steps)
    )
    current = next((s for s in steps if s.seq == n), None)
    return StateAsOf(
        run_id=run_id,
        n=n,
        max_seq=max_seq,
        steps=steps,
        current_output=current.output if current else None,
        effects=effects,
        diverged_so_far=tuple(d for d in full.divergence_points if d.seq <= n),
        reconstructed_from=source.origin,
    )
