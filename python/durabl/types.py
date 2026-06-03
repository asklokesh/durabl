"""Portable journal types (schema v1). Mirrors ``src/step-model.ts``."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

JOURNAL_SCHEMA_VERSION = 1

StepKind = Literal[
    "plan",
    "tool_call",
    "summarize",
    "hitl_pause",
    "hitl_input",
]


@dataclass(frozen=True)
class JournalEntry:
    schema: int
    run_id: str
    seq: int
    step_name: str
    kind: StepKind
    idem_key: str
    output: Any
    side_effect: bool
    seeded_from: str | None
    recorded_at: str


@dataclass(frozen=True)
class RunMeta:
    schema: int
    run_id: str
    parent_run: str | None
    forked_at_seq: int | None
    trajectory: str
    created_at: str


@dataclass(frozen=True)
class EffectRow:
    id: int
    run_id: str
    trajectory: str
    step_name: str
    idem_key: str
    payload: str
    fired_at: str
    pid: int
