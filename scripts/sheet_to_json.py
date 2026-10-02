#!/usr/bin/env python3
"""Download the public Google Sheet as CSV and write data/dictionary.json.

Runs in GitHub Actions (never inside the Worker), so the Worker keeps serving a
pre-built, bundled JSON and its per-request CPU time is unchanged.
"""
from __future__ import annotations

import csv
import io
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from build_index import arabic_pronunciation  # noqa: E402

SHEET_ID = os.environ.get("SHEET_ID", "1kXVA3CNgETqym5Vz3lBUu_2gZ01QNdx7ROtGVnIJp0c")
SHEET_GID = os.environ.get("SHEET_GID", "")
CSV_FILE = os.environ.get("SHEET_CSV_FILE", "")  # local file, for tests only
OUT = Path(os.environ.get("OUT_JSON", ROOT / "data" / "dictionary.json"))
MIN_RECORDS = int(os.environ.get("MIN_RECORDS", "8000"))

# Columns: A coptic, B greek, C pronunciation, D english, E phonetic, F kind,
# G gender, H origin, I..AS Arabic meanings (one per column).
MEANING_FIRST, MEANING_LAST = 8, 44


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

        meanings: list[str] = []
        for index in range(MEANING_FIRST, MEANING_LAST + 1):
            value = cell(index)
            if value and value not in meanings:
                meanings.append(value)
        record = {
            "coptic": cell(0),
            "greek": cell(1),
            "pronunciation": cell(2),
            "english": cell(3),
            "phonetic": cell(4),
            "kind": cell(5),
            "gender": cell(6),
            "origin": cell(7),
            "meaning": "، ".join(meanings),
        }
        if not any(record.values()):
            continue
        record["arabic_pronunciation"] = arabic_pronunciation(record["phonetic"] or record["pronunciation"])
        records.append(record)

    if len(records) < MIN_RECORDS:
        raise SystemExit(f"Only {len(records)} records found (< {MIN_RECORDS}); refusing to overwrite the data.")

    ordered_keys = ["coptic", "greek", "pronunciation", "english", "phonetic",
                    "arabic_pronunciation", "kind", "gender", "origin", "meaning"]
    records = [{key: record[key] for key in ordered_keys} for record in records]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(records, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {len(records):,} records ({OUT.stat().st_size / 1e6:.2f} MB) to {OUT}")


if __name__ == "__main__":
    main()
