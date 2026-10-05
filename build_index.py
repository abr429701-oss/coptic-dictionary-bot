from __future__ import annotations

import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def load_shared_strings(z: zipfile.ZipFile):
    root = ET.fromstring(z.read('xl/sharedStrings.xml'))
    return [''.join(t.text or '' for t in si.iterfind('.//m:t', NS)) for si in root.findall('m:si', NS)]


def col_index(cell_ref: str) -> int:
    letters = ''.join(c for c in cell_ref if c.isalpha())
    result = 0
    for c in letters:
        result = result * 26 + ord(c.upper()) - 64
    return result - 1


def arabic_pronunciation(value: str) -> str:
    """Readable Arabic approximation of the workbook's modern pronunciation.

    The source workbook contains IPA-like symbols and English phonetic spelling;
    this is intentionally a reading aid, not a replacement for the source IPA.
    """
    s = (value or '').split('/')[0].strip().lower().replace('ɑ', 'a')
    s = re.sub(r'[ːˈˌ]', '', s)
    replacements = [
        ('tʰ', 'ت'), ('pʰ', 'ب'), ('kʰ', 'ك'), ('ph', 'ف'), ('th', 'ت'),
        ('üai', 'واي'), ('ai', 'اي'), ('au', 'او'), ('sh', 'ش'), ('ch', 'تش'),
        ('kh', 'خ'), ('ou', 'و'), ('oo', 'و'),
        ('ps', 'بس'), ('ng', 'نغ'), ('j', 'ي'), ('w', 'و'), ('y', 'ي'),
        ('ʃ', 'ش'), ('ʒ', 'ج'), ('ŋ', 'ن'), ('ɣ', 'غ'), ('x', 'خ'),
        ('p', 'ب'), ('v', 'ڤ'), ('f', 'ف'), ('b', 'ب'), ('c', 'ك'),
        ('g', 'ج'), ('q', 'ق'), ('k', 'ك'), ('t', 'ت'), ('d', 'د'),
        ('s', 'س'), ('z', 'ز'), ('m', 'م'), ('n', 'ن'), ('r', 'ر'),
        ('l', 'ل'), ('h', 'ه'), ('a', 'َ'), ('e', 'ِ'), ('i', 'ِ'),
        ('o', 'ُ'), ('u', 'ُ'), ('ə', 'ِ'),
    ]
    out = s
    for old, new in replacements:
        out = out.replace(old, new)
    # Add a carrier alif for an initial short-vowel mark.
    if out.startswith(('َ', 'ِ', 'ُ')):
        out = 'ا' + out
    return out or '—'


def main(src: str, dst: str):
    records = []
    with zipfile.ZipFile(src) as z:
        shared = load_shared_strings(z)
        root = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
        rows = root.findall('.//m:sheetData/m:row', NS)
        # The workbook has useful labels in A:H and the canonical Arabic meaning in BM.
        for row in rows[1:]:
            values = {}
            for cell in row.findall('m:c', NS):
                ref = cell.get('r', '')
                idx = col_index(ref)
                v = cell.find('m:v', NS)
                value = v.text if v is not None else ''
                if cell.get('t') == 's' and value:
                    value = shared[int(value)]
                if value:
                    values[idx] = value.strip()
            if not values:
                continue
            record = {
                'coptic': values.get(0, ''),
                'greek': values.get(1, ''),
                'pronunciation': values.get(2, ''),
                'english': values.get(3, ''),
                'phonetic': values.get(4, ''),
                'arabic_pronunciation': arabic_pronunciation(values.get(4, '') or values.get(2, '')),
                'kind': values.get(5, ''),
                'gender': values.get(6, ''),
                'meaning': values.get(64, ''),
            }
            if any(record.values()):
                records.append(record)
    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    Path(dst).write_text(json.dumps(records, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'Wrote {len(records):,} records to {dst}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: python build_index.py input.xlsx output.json')
    main(sys.argv[1], sys.argv[2])
