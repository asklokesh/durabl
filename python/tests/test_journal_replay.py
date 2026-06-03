"""Offline JSONL import + reconstruct (M3 fixture parity smoke test)."""

from pathlib import Path

from durabl import import_journal_source, reconstruct, state_at

FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "test"
    / "fixtures"
    / "m3-portable-bundle.jsonl"
)
ROOT_RUN = "m3-root-1780353444814"


def test_parse_and_reconstruct_m3_fixture() -> None:
    jsonl = FIXTURE.read_text(encoding="utf-8")
    source = import_journal_source(jsonl, origin="test-fixture")
    replayed = reconstruct(source, ROOT_RUN)

    assert replayed.run_id == ROOT_RUN
    assert replayed.trajectory == "main"
    assert len(replayed.steps) == 3
    assert replayed.steps[0].step_name == "step1-plan"
    assert replayed.steps[1].side_effect is True
    assert replayed.outcome is not None
    assert len(replayed.divergence_points) == 2
    assert replayed.reconstructed_from == "test-fixture"


def test_state_at_prefix() -> None:
    jsonl = FIXTURE.read_text(encoding="utf-8")
    source = import_journal_source(jsonl)
    at2 = state_at(source, ROOT_RUN, 2)

    assert at2.n == 2
    assert len(at2.steps) == 2
    assert at2.current_output == at2.steps[-1].output


def test_all_run_ids_from_bundle() -> None:
    jsonl = FIXTURE.read_text(encoding="utf-8")
    source = import_journal_source(jsonl)
    ids = source.all_run_ids()
    assert ROOT_RUN in ids
    assert "m3-forkA-1780353444814" in ids
    assert len(ids) == 4
