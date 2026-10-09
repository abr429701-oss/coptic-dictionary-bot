#!/usr/bin/env python3
"""Download the public Google Sheet as CSV and write data/dictionary.json.

Runs in GitHub Actions (never inside the Worker), so the Worker keeps serving a
pre-built, bundled JSON and its per-request CPU time is unchanged.

New sheet layout (columns):
    A = coptic
    B = ipa (pronunciation)
    C = arabic meaning
    D = english
    E = french
    F = german
    G = greek (new)
    J = origin (new position)
    K = kind (new position)
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import sys
import time
import unicodedata
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SHEET_ID = os.environ.get("SHEET_ID", "14pUNXtrHoMSU9lBWhKQZyspe-DDTMDudSiuL2sJQRUI")
SHEET_GID = os.environ.get("SHEET_GID", "")
CSV_FILE = os.environ.get("SHEET_CSV_FILE", "")  # local file, for tests only
OUT = Path(os.environ.get("OUT_JSON", ROOT / "data" / "dictionary.json"))
IDS_FILE = Path(os.environ.get("WORD_IDS_JSON", ROOT / "data" / "word_ids.json"))
MIN_RECORDS = int(os.environ.get("MIN_RECORDS", "8000"))

# Column indices (A=0, B=1, ...).
COPTIC_COLUMN = 0          # A
IPA_COLUMN = 1             # B
ARABIC_COLUMN = 2          # C
ENGLISH_COLUMN = 3         # D
FRENCH_COLUMN = 4          # E
GERMAN_COLUMN = 5          # F
GREEK_COLUMN = 6           # G
ORIGIN_COLUMN = 9          # J
KIND_COLUMN = 10           # K


JINKIM = "\u0300"  # combining grave: the real jinkim, drawn over the letter it follows
_JINKIM_BEFORE_LETTER = re.compile(r"`([^\W\d_])")


def clean_coptic(value: str) -> str:
    """Write the jinkim as a combining mark instead of a spaced ASCII backtick.

    The sheet types the jinkim as ` *before* the letter it sits on ("ⲁⲧ`ⲥϧⲁⲓ"), which shows as a
    stray gap. Here it becomes a mark on that letter ("ⲁⲧⲥ̀ϧⲁⲓ"), so a single word stays one
    unbroken word. Real spaces between the words of a phrase are kept (only runs are collapsed).
    """
    text = _JINKIM_BEFORE_LETTER.sub(lambda match: match.group(1) + JINKIM, value)
    return re.sub(r"\s+", " ", text).strip()


def word_key(coptic: str) -> str:
    """Identity of a word for its permanent id: the cleaned spelling, ignoring letter case."""
    return unicodedata.normalize("NFC", coptic).casefold().strip()


def load_registry(path: Path = IDS_FILE) -> dict:
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        return {"next": int(data["next"]), "ids": dict(data["ids"])}
    return {"next": 1, "ids": {}}


def assign_ids(records: list[dict], registry: dict) -> int:
    """Give every word a permanent number and return how many new numbers were issued.

    The registry is append-only: a number, once issued, always belongs to that spelling. It is never
    reused and never changes when other rows are added, deleted, moved or edited in the sheet. Rows
    that share a spelling share the number (one pronunciation per spelling).
    """
    issued = 0
    for record in records:
        key = word_key(record["coptic"])
        if not key:
            record.pop("id", None)
            continue
        if key not in registry["ids"]:
            registry["ids"][key] = registry["next"]
            registry["next"] += 1
            issued += 1
        record["id"] = registry["ids"][key]
    return issued


def save_registry(registry: dict, path: Path = IDS_FILE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(registry, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def with_id_first(record: dict) -> dict:
    return ({"id": record["id"]} if "id" in record else {}) | {k: v for k, v in record.items() if k != "id"}


def reindex_existing() -> None:
    """One-off/repair: re-clean and re-number the dictionary.json already in the repository."""
    records = json.loads(OUT.read_text(encoding="utf-8"))
    for record in records:
        record["coptic"] = clean_coptic(record["coptic"])
    registry = load_registry()
    issued = assign_ids(records, registry)
    OUT.write_text(
        json.dumps([with_id_first(r) for r in records], ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    save_registry(registry)
    print(f"Re-indexed {len(records):,} records; issued {issued:,} new ids (next id {registry['next']}).")


def download() -> str:
    if CSV_FILE:
        return Path(CSV_FILE).read_text(encoding="utf-8-sig")
    url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv"
    if SHEET_GID:
        url += f"&gid={SHEET_GID}"
    last_error = None
    for attempt in range(1, 4):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "coptic-dictionary-sync/1.0"})
            with urllib.request.urlopen(request, timeout=90) as response:
                return response.read().decode("utf-8-sig")
        except Exception as error:  # noqa: BLE001
            last_error = error
            print(f"Download attempt {attempt} failed: {error}", file=sys.stderr)
            time.sleep(5 * attempt)
    raise SystemExit(f"Could not download the sheet: {last_error}")


def main() -> None:
    rows = list(csv.reader(io.StringIO(download())))
    if not rows or "coptic" not in (rows[0][0] if rows[0] else "").lower():
        raise SystemExit("Unexpected sheet content (is the sheet shared as 'Anyone with the link'?).")

    records = []
    for row in rows[1:]:
        def cell(index: int) -> str:
            return row[index].strip() if index < len(row) else ""

        record = {
            "coptic": clean_coptic(cell(COPTIC_COLUMN)),
            "pronunciation": cell(IPA_COLUMN),
            "meaning": cell(ARABIC_COLUMN),
            "english": cell(ENGLISH_COLUMN),
            "translation_fr": cell(FRENCH_COLUMN),
            "translation_de": cell(GERMAN_COLUMN),
            "greek": cell(GREEK_COLUMN),
            "origin": cell(ORIGIN_COLUMN),
            "kind": cell(KIND_COLUMN),
        }
        if not any(record.values()):
            continue
        records.append(record)

    if len(records) < MIN_RECORDS:
        raise SystemExit(f"Only {len(records)} records found (< {MIN_RECORDS}); refusing to overwrite the data.")

    registry = load_registry()
    issued = assign_ids(records, registry)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps([with_id_first(r) for r in records], ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    save_registry(registry)
    print(f"Issued {issued:,} new word ids (next id {registry['next']}).")
    print(f"Wrote {len(records):,} records ({OUT.stat().st_size / 1e6:.2f} MB) to {OUT}")


if __name__ == "__main__":
    if "--reindex" in sys.argv:
        reindex_existing()
    else:
        main()
