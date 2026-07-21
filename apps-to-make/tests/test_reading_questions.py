#!/usr/bin/env python3
"""Unit tests for the reading-question CLI draft."""

from __future__ import annotations

import argparse
import importlib.util
import io
import json
import random
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "reading-question-cli" / "reading_questions.py"
SPEC = importlib.util.spec_from_file_location("reading_questions", SOURCE)
assert SPEC and SPEC.loader
reading_questions = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = reading_questions
SPEC.loader.exec_module(reading_questions)


class ReadingQuestionTests(unittest.TestCase):
    def make_note(self, text: str, name: str = "Note.md") -> reading_questions.Note:
        path = Path("/vault") / name
        return reading_questions.Note(path, name, Path(name).stem, text)

    def test_markdown_cleanup_and_title(self) -> None:
        source = """---
tag: test
---
# Useful Heading

Read **this** [source](https://example.com) and [[Target|label]].
```python
ignored = True
```
"""
        cleaned = reading_questions.clean_markdown(source)
        self.assertNotIn("tag: test", cleaned)
        self.assertNotIn("ignored", cleaned)
        self.assertIn("Read this source and label.", cleaned)
        self.assertEqual(reading_questions.note_title(Path("fallback.md"), source), "Useful Heading")

    def test_load_notes_filters_hidden_short_and_query(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            vault = Path(temp)
            (vault / "keep.md").write_text("# Keep\n" + "Relevant question material. " * 4, encoding="utf-8")
            (vault / "other.md").write_text("# Other\n" + "Different subject matter. " * 4, encoding="utf-8")
            (vault / "short.md").write_text("too short", encoding="utf-8")
            hidden = vault / ".obsidian"
            hidden.mkdir()
            (hidden / "secret.md").write_text("Relevant but hidden. " * 5, encoding="utf-8")

            notes = reading_questions.load_notes(vault, "relevant")
            self.assertEqual([note.relative_path for note in notes], ["keep.md"])

    def test_explicit_cards_deduplicate_and_include_context(self) -> None:
        note = self.make_note(
            "# Questions\nWhy does the model prefer this answer?\n"
            "Why does the model prefer this answer?\n"
            "Surrounding evidence makes the question useful for review."
        )
        cards = reading_questions.explicit_cards(note)
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0].kind, "explicit")
        self.assertEqual(cards[0].question, "Why does the model prefer this answer?")
        self.assertIn("Surrounding evidence", cards[0].context)
        self.assertEqual(len(cards[0].card_id), 16)

    def test_build_cards_respects_modes_and_limit(self) -> None:
        notes = [
            self.make_note("Why is this explicit question worth retaining? " + "Context " * 8, "One.md"),
            self.make_note("This note has no question mark but enough material. " * 3, "Two.md"),
        ]
        rng = random.Random(3)
        explicit = reading_questions.build_cards(notes, "explicit", rng)
        reflection = reading_questions.build_cards(notes, "reflection", random.Random(3))
        mixed = reading_questions.build_cards(notes, "mixed", random.Random(3), max_cards=1)
        self.assertEqual(len(explicit), 1)
        self.assertEqual([card.kind for card in reflection], ["reflection", "reflection"])
        self.assertEqual(len(mixed), 1)

    def test_history_round_trip_and_malformed_lines(self) -> None:
        note = self.make_note("Why should this question be tested? " + "Context " * 8)
        card = reading_questions.explicit_cards(note)[0]
        with tempfile.TemporaryDirectory() as temp:
            history = Path(temp) / "history.jsonl"
            reading_questions.append_history(history, card, "Because it catches regressions.")
            with history.open("a", encoding="utf-8") as handle:
                handle.write("not json\n")
            self.assertEqual(reading_questions.recent_card_ids(history, 10), {card.card_id})
            record = json.loads(history.read_text(encoding="utf-8").splitlines()[0])
            self.assertEqual(record["answer"], "Because it catches regressions.")
            self.assertEqual(record["card_id"], card.card_id)

    def test_session_commands_and_answer_persistence(self) -> None:
        note = self.make_note("Why should sessions accept commands? " + "Context " * 8)
        card = reading_questions.explicit_cards(note)[0]
        with tempfile.TemporaryDirectory() as temp:
            history = Path(temp) / "history.jsonl"
            args = argparse.Namespace(count=1, no_save=False, history=history)
            output = io.StringIO()
            with patch("builtins.input", side_effect=[":context", ":source", "Final answer"]), patch("sys.stdout", output):
                answered = reading_questions.run_session([card], args)
            self.assertEqual(answered, 1)
            self.assertIn("Context", output.getvalue())
            self.assertIn(str(note.path), output.getvalue())
            self.assertEqual(json.loads(history.read_text(encoding="utf-8"))["answer"], "Final answer")


if __name__ == "__main__":
    unittest.main(verbosity=2)
