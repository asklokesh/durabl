"""Substrate-independent journal reads — mirrors ``src/journal-source.ts``."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Protocol

from durabl.types import (
    JOURNAL_SCHEMA_VERSION,
    EffectRow,
    JournalEntry,
    RunMeta,
    StepKind,
)


@dataclass(frozen=True)
class ImportedJournal:
    steps: tuple[JournalEntry, ...]
    metas: tuple[RunMeta, ...]
    effects: tuple[EffectRow, ...]


class JournalSource(Protocol):
    @property
    def origin(self) -> str: ...

    def trajectory(self, run_id: str) -> list[JournalEntry]: ...
    def run_meta(self, run_id: str) -> RunMeta | None: ...
    def child_runs(self, parent_run_id: str) -> list[RunMeta]: ...
    def effects_for(self, run_id: str) -> list[EffectRow]: ...
    def all_run_ids(self) -> list[str]: ...


def _hydrate_step(obj: dict[str, Any]) -> JournalEntry:
    return JournalEntry(
        schema=JOURNAL_SCHEMA_VERSION,
        run_id=str(obj["runId"]),
        seq=int(obj["seq"]),
        step_name=str(obj["stepName"]),
        kind=obj["kind"],  # type: ignore[arg-type]
        idem_key=str(obj["idemKey"]),
        output=obj.get("output"),
        side_effect=bool(obj.get("sideEffect")),
        seeded_from=obj.get("seededFrom") if obj.get("seededFrom") is not None else None,
        recorded_at=str(obj["recordedAt"]),
    )


def _hydrate_meta(obj: dict[str, Any]) -> RunMeta:
    forked = obj.get("forkedAtSeq")
    return RunMeta(
        schema=JOURNAL_SCHEMA_VERSION,
        run_id=str(obj["runId"]),
        parent_run=obj.get("parentRun") if obj.get("parentRun") is not None else None,
        forked_at_seq=None if forked is None else int(forked),
        trajectory=str(obj.get("trajectory", "main")),
        created_at=str(obj.get("createdAt", "")),
    )


def _hydrate_effect(obj: dict[str, Any]) -> EffectRow:
    payload = obj.get("payload")
    if isinstance(payload, str):
        payload_str = payload
    else:
        payload_str = json.dumps(payload if payload is not None else None)
    return EffectRow(
        id=int(obj.get("id", 0)),
        run_id=str(obj.get("runId", obj.get("run_id", ""))),
        trajectory=str(obj.get("trajectory", "main")),
        step_name=str(obj.get("stepName", obj.get("step_name", ""))),
        idem_key=str(obj.get("idemKey", obj.get("idem_key", ""))),
        payload=payload_str,
        fired_at=str(obj.get("firedAt", obj.get("fired_at", ""))),
        pid=int(obj.get("pid", 0)),
    )


def parse_export(jsonl: str) -> ImportedJournal:
    """Parse portable JSONL (bare M1 lines or tagged M2/M3 export)."""
    steps: list[JournalEntry] = []
    metas: list[RunMeta] = []
    effects: list[EffectRow] = []

    for i, raw in enumerate(jsonl.split("\n"), start=1):
        line = raw.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as e:
            raise ValueError(f"invalid JSONL at line {i}: {e}") from e
        if not isinstance(obj, dict):
            raise ValueError(f"invalid JSONL at line {i}: expected object")

        tag = obj.get("record")
        if tag == "run_meta":
            metas.append(_hydrate_meta(obj))
        elif tag == "step":
            steps.append(_hydrate_step(obj))
        elif tag == "effect":
            effects.append(_hydrate_effect(obj))
        elif tag is None:
            steps.append(_hydrate_step(obj))
        # unknown tagged records skipped (forward-compat)

    return ImportedJournal(
        steps=tuple(steps),
        metas=tuple(metas),
        effects=tuple(effects),
    )


class _ImportedJournalSource:
    def __init__(self, origin: str, imported: ImportedJournal) -> None:
        self._origin = origin
        steps_by_run: dict[str, list[JournalEntry]] = {}
        for s in imported.steps:
            steps_by_run.setdefault(s.run_id, []).append(s)
        for arr in steps_by_run.values():
            arr.sort(key=lambda e: e.seq)

        meta_by_run: dict[str, RunMeta] = {m.run_id: m for m in imported.metas}
        for run_id in steps_by_run:
            if run_id not in meta_by_run:
                first = steps_by_run[run_id][0]
                meta_by_run[run_id] = RunMeta(
                    schema=JOURNAL_SCHEMA_VERSION,
                    run_id=run_id,
                    parent_run=None,
                    forked_at_seq=None,
                    trajectory="main",
                    created_at=first.recorded_at,
                )

        effects_by_run: dict[str, list[EffectRow]] = {}
        for e in imported.effects:
            effects_by_run.setdefault(e.run_id, []).append(e)
        for arr in effects_by_run.values():
            arr.sort(key=lambda e: e.id)

        self._steps_by_run = steps_by_run
        self._meta_by_run = meta_by_run
        self._effects_by_run = effects_by_run

    @property
    def origin(self) -> str:
        return self._origin

    def trajectory(self, run_id: str) -> list[JournalEntry]:
        return list(self._steps_by_run.get(run_id, []))

    def run_meta(self, run_id: str) -> RunMeta | None:
        return self._meta_by_run.get(run_id)

    def child_runs(self, parent_run_id: str) -> list[RunMeta]:
        children = [m for m in self._meta_by_run.values() if m.parent_run == parent_run_id]
        return sorted(children, key=lambda m: m.created_at)

    def effects_for(self, run_id: str) -> list[EffectRow]:
        return list(self._effects_by_run.get(run_id, []))

    def all_run_ids(self) -> list[str]:
        metas = sorted(self._meta_by_run.values(), key=lambda m: m.created_at)
        return [m.run_id for m in metas]


def import_journal_source(jsonl: str, origin: str = "imported-jsonl-export") -> JournalSource:
    """Build a read-only journal from an export string (no SQLite / Restate)."""
    imported = parse_export(jsonl)
    return _ImportedJournalSource(origin, imported)


def load_journal_source(path: str, origin: str | None = None) -> JournalSource:
    """Load portable JSONL from a file path."""
    with open(path, encoding="utf-8") as f:
        text = f.read()
    label = origin or f"file:{path}"
    return import_journal_source(text, origin=label)
