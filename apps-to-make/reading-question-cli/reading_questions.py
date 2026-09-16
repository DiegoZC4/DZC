#!/usr/bin/env python3
"""Ask questions drawn from an Obsidian vault and optionally log answers."""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_VAULT = Path.home() / "Documents" / "Brain Tree"
DEFAULT_HISTORY = Path.home() / ".local" / "share" / "reading-question-cli" / "history.jsonl"
REFLECTION_PROMPTS = (
    "What is the strongest claim in this note, stated in your own words?",
    "What evidence would most change your mind about the central claim?",
    "What does this connect to that the note does not mention explicitly?",
    "What is the most important unresolved question here?",
    "What concrete prediction or implication follows from this material?",
    "Which part would be hardest to explain accurately without looking back?",
)
QUESTION_RE = re.compile(r"(?:^|\s)([^.!?\n][^?\n]{8,240}\?)")
MARKDOWN_PREFIX_RE = re.compile(r"^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)+")
MARKDOWN_NOISE_RE = re.compile(r"[`*_>#]|!?(?:\[([^]]*)\]\([^)]*\))")


@dataclass(frozen=True)
class Note:
    path: Path
    relative_path: str
    title: str
    text: str


@dataclass(frozen=True)
class Card:
    card_id: str
    note: Note
    question: str
    context: str
    kind: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Practice questions extracted from an Obsidian vault.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--vault", type=Path, default=DEFAULT_VAULT)
    parser.add_argument("--history", type=Path, default=DEFAULT_HISTORY)
    parser.add_argument("--count", type=int, default=10, help="Maximum cards in a session")
    parser.add_argument("--query", default="", help="Filter note paths and contents")
    parser.add_argument(
        "--mode",
        choices=("mixed", "explicit", "reflection"),
        default="mixed",
        help="Use extracted questions, reflection prompts, or both",
    )
    parser.add_argument("--seed", type=int, help="Repeatable card ordering")
    parser.add_argument("--recent", type=int, default=100, help="Cards to avoid repeating")
    parser.add_argument("--list", action="store_true", help="Report corpus statistics and exit")
    parser.add_argument("--no-save", action="store_true", help="Do not write answer history")
    return parser.parse_args()


def clean_markdown(text: str) -> str:
    text = re.sub(r"^---\s*$.*?^---\s*$", "", text, count=1, flags=re.MULTILINE | re.DOTALL)
    text = re.sub(r"```.*?```", " ", text, flags=re.DOTALL)
    text = MARKDOWN_NOISE_RE.sub(lambda match: match.group(1) or "", text)
    text = re.sub(r"\[\[([^]|]+)(?:\|([^]]+))?\]\]", lambda match: match.group(2) or match.group(1), text)
    return re.sub(r"\s+", " ", text).strip()


def note_title(path: Path, text: str) -> str:
    heading = re.search(r"^#\s+(.+?)\s*$", text, flags=re.MULTILINE)
    return heading.group(1).strip() if heading else path.stem


def load_notes(vault: Path, query: str) -> list[Note]:
    if not vault.is_dir():
        raise SystemExit(f"Vault not found: {vault}")

    needle = query.casefold().strip()
    notes: list[Note] = []
    for path in vault.rglob("*.md"):
        relative = path.relative_to(vault)
        if any(part.startswith(".") for part in relative.parts):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        if needle and needle not in f"{relative}\n{text}".casefold():
            continue
        if len(text.strip()) < 40:
            continue
        notes.append(Note(path, str(relative), note_title(path, text), text))
    return notes


def normalize_question(raw: str) -> str:
    question = MARKDOWN_PREFIX_RE.sub("", raw).strip()
    question = clean_markdown(question)
    return question[:1].upper() + question[1:] if question else ""


def context_around(plain: str, phrase: str, radius: int = 220) -> str:
    index = plain.find(phrase)
    if index < 0 and phrase:
        index = plain.find(phrase[:1].lower() + phrase[1:])
    if index < 0:
        return plain[: radius * 2].strip()
    start = max(0, index - radius)
    end = min(len(plain), index + len(phrase) + radius)
    excerpt = plain[start:end].strip()
    if start:
        excerpt = "..." + excerpt
    if end < len(plain):
        excerpt += "..."
    return excerpt


def card_id(note: Note, question: str) -> str:
    payload = f"{note.relative_path}\0{question}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()[:16]


def explicit_cards(note: Note) -> list[Card]:
    seen: set[str] = set()
    cards: list[Card] = []
    plain_text = clean_markdown(note.text)
    for line in note.text.splitlines():
        if len(cards) >= 50:
            break
        for match in QUESTION_RE.finditer(line):
            question = normalize_question(match.group(1))
            key = question.casefold()
            if len(question) < 10 or key in seen:
                continue
            seen.add(key)
            cards.append(
                Card(card_id(note, question), note, question, context_around(plain_text, question), "explicit")
            )
            if len(cards) >= 50:
                break
    return cards


def reflection_card(note: Note, prompt: str) -> Card:
    words = clean_markdown(note.text).split()
    excerpt = " ".join(words[:90])
    if len(words) > 90:
        excerpt += "..."
    return Card(card_id(note, prompt), note, prompt, excerpt, "reflection")


def build_cards(
    notes: list[Note],
    mode: str,
    rng: random.Random,
    max_cards: int | None = None,
) -> list[Card]:
    cards: list[Card] = []
    for note in notes:
        found = explicit_cards(note) if mode != "reflection" else []
        if mode == "explicit":
            cards.extend(found)
        elif mode == "reflection":
            cards.append(reflection_card(note, rng.choice(REFLECTION_PROMPTS)))
        elif found:
            cards.extend(found)
        else:
            cards.append(reflection_card(note, rng.choice(REFLECTION_PROMPTS)))
        if max_cards is not None and len(cards) >= max_cards:
            break
    return cards


def recent_card_ids(history_path: Path, limit: int) -> set[str]:
    if limit <= 0 or not history_path.exists():
        return set()
    try:
        lines = history_path.read_text(encoding="utf-8").splitlines()[-limit:]
    except OSError:
        return set()
    result: set[str] = set()
    for line in lines:
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if value.get("card_id"):
            result.add(value["card_id"])
    return result


def append_history(path: Path, card: Card, answer: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "answered_at": datetime.now(timezone.utc).isoformat(),
        "card_id": card.card_id,
        "kind": card.kind,
        "note": str(card.note.path),
        "question": card.question,
        "answer": answer,
    }
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def print_card(card: Card, number: int, total: int) -> None:
    print(f"\n[{number}/{total}] {card.note.title}")
    print("-" * min(72, max(24, len(card.note.title) + 8)))
    print(card.question)
    print("\nEnter an answer, or use :context, :source, :skip, or :quit.")


def run_session(cards: list[Card], args: argparse.Namespace) -> int:
    selected = cards[: max(0, args.count)]
    answered = 0
    for index, card in enumerate(selected, start=1):
        print_card(card, index, len(selected))
        while True:
            try:
                response = input("> ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                return answered
            if response == ":quit":
                return answered
            if response == ":skip":
                break
            if response == ":source":
                print(card.note.path)
                continue
            if response == ":context":
                print(f"\n{card.context}\n")
                continue
            if not response:
                continue
            if not args.no_save:
                append_history(args.history.expanduser(), card, response)
            answered += 1
            break
    return answered


def main() -> int:
    args = parse_args()
    rng = random.Random(args.seed)
    notes = load_notes(args.vault.expanduser(), args.query)

    if args.list:
        cards = build_cards(notes, args.mode, rng)
        explicit_count = (
            sum(card.kind == "explicit" for card in cards)
            if args.mode != "reflection"
            else sum(len(explicit_cards(note)) for note in notes)
        )
        print(f"Vault: {args.vault.expanduser()}")
        print(f"Notes: {len(notes)}")
        print(f"Explicit questions: {explicit_count}")
        print(f"Available cards ({args.mode}): {len(cards)}")
        return 0

    rng.shuffle(notes)
    target_pool = max(args.count * 8, args.recent + args.count, 32)
    cards = build_cards(notes, args.mode, rng, max_cards=target_pool)

    if not cards:
        print("No matching questions or notes found.", file=sys.stderr)
        return 1

    seen = recent_card_ids(args.history.expanduser(), args.recent)
    fresh = [card for card in cards if card.card_id not in seen]
    pool = fresh or cards
    rng.shuffle(pool)
    answered = run_session(pool, args)
    destination = "without saving" if args.no_save else f"to {args.history.expanduser()}"
    print(f"\nAnswered {answered} question(s) {destination}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
