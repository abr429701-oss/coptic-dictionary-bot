import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("sheet_to_json", Path(__file__).resolve().parent.parent / "scripts" / "sheet_to_json.py")
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


def rows(*words):
    return [{"coptic": word} for word in words]


def ids_of(records):
    return {record["coptic"]: record.get("id") for record in records}


class WordIdTests(unittest.TestCase):
    def test_ids_survive_reorder_delete_and_insert(self):
        registry = {"next": 1, "ids": {}}
        first = rows("ⲁⲛⲁⲩ", "ⲃⲁⲓ", "ⲅⲁⲗ")
        module.assign_ids(first, registry)
        before = ids_of(first)

        second = rows("ⲇⲉⲛ", "ⲅⲁⲗ", "ⲁⲛⲁⲩ")  # inserted, reordered, "ⲃⲁⲓ" deleted
        module.assign_ids(second, registry)
        after = ids_of(second)

        self.assertEqual(after["ⲁⲛⲁⲩ"], before["ⲁⲛⲁⲩ"])
        self.assertEqual(after["ⲅⲁⲗ"], before["ⲅⲁⲗ"])
        self.assertNotIn(after["ⲇⲉⲛ"], before.values())

    def test_deleted_ids_are_never_reused(self):
        registry = {"next": 1, "ids": {}}
        module.assign_ids(rows("ⲁ", "ⲃ"), registry)
        deleted_id = registry["ids"]["ⲃ"]
        later = rows("ⲁ", "ⲅ")
        module.assign_ids(later, registry)
        self.assertNotEqual(ids_of(later)["ⲅ"], deleted_id)
        again = rows("ⲃ")
        module.assign_ids(again, registry)
        self.assertEqual(ids_of(again)["ⲃ"], deleted_id)

    def test_same_spelling_shares_one_id_and_case_is_ignored(self):
        registry = {"next": 1, "ids": {}}
        records = rows("ⲁⲛⲁⲩ", "Ⲁⲛⲁⲩ", "ⲁⲛⲁⲩ")
        module.assign_ids(records, registry)
        self.assertEqual({record["id"] for record in records}, {1})

    def test_rows_without_a_word_get_no_id(self):
        registry = {"next": 1, "ids": {}}
        records = rows("", "ⲁ")
        module.assign_ids(records, registry)
        self.assertNotIn("id", records[0])
        self.assertEqual(records[1]["id"], 1)

    def test_jinkim_is_a_combining_mark(self):
        self.assertEqual(module.clean_coptic("ⲁⲧ`ⲥϧⲁⲓ"), "ⲁⲧⲥ\u0300ϧⲁⲓ")
        self.assertEqual(module.clean_coptic("`ⲡ`ⲉϩⲟⲟⲩ  `ⲙ`ⲡ`ⲥⲛⲁⲩ"), "ⲡ\u0300ⲉ\u0300ϩⲟⲟⲩ ⲙ\u0300ⲡ\u0300ⲥ\u0300ⲛⲁⲩ")


if __name__ == "__main__":
    unittest.main()
