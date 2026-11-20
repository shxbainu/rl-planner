# Tests for the homework merge in pull_crosswalk.py. Run: python3 -m unittest tools/test_pull_crosswalk.py
import json, os, sys, tempfile, unittest

sys.path.insert(0, os.path.dirname(__file__))
from pull_crosswalk import keep_titles, pair_up


def hw(cls, title, due, type="homework"):
    return {"class": cls, "title": title, "due": due, "type": type}


class PairUp(unittest.TestCase):
    def test_exact_match(self):
        a = hw("Latin", "Read p.110", "2026-11-19")
        b = hw("Latin", "Read p.110", "2026-11-19")
        self.assertEqual(pair_up([a], [b]), [(a, b)])

    def test_reworded_title_matches(self):
        new = hw("English", "Reading Quiz 4 (Odyssey XXII)", "2026-11-19", "quiz")
        old = hw("English", "Odyssey XXII reading quiz 4", "2026-11-19", "quiz")
        self.assertEqual(pair_up([new], [old]), [(new, old)])

    def test_two_items_same_class_same_day_stay_apart(self):
        new = [hw("MSI", "Handout on Functions", "2026-11-20"), hw("MSI", "Lab report draft", "2026-11-20")]
        old = [hw("MSI", "Lab report draft", "2026-11-20"), hw("MSI", "Handout on Functions", "2026-11-20")]
        pairs = pair_up(new, old)
        self.assertEqual(len(pairs), 2)
        for a, b in pairs:
            self.assertEqual(a["title"], b["title"])


class KeepTitles(unittest.TestCase):
    def test_postponed_item_keeps_old_title_but_takes_new_due_date(self):
        old = hw("Latin", "Latin Test ch. 9", "2026-11-19", "test")
        new = hw("Latin", "Latin Test ch 9 (vocab)", "2026-11-20", "test")
        with tempfile.TemporaryDirectory() as d:
            cwd = os.getcwd()
            os.chdir(d)
            try:
                with open("homework.json", "w") as f:
                    json.dump({"assignments": [old]}, f)
                out = keep_titles({"assignments": [new]})
            finally:
                os.chdir(cwd)
        self.assertEqual(len(out["assignments"]), 1)
        self.assertEqual(out["assignments"][0]["title"], "Latin Test ch. 9")
        self.assertEqual(out["assignments"][0]["due"], "2026-11-20")


if __name__ == "__main__":
    unittest.main()
