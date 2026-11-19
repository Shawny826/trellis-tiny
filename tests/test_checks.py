"""End-to-end tests for the end-of-turn check hook and the manual check command."""
import json
import unittest

from support import RepoTestCase, make_temp_dir, remove_temp_tree

NEEDLE_CHECK = """\
import json, sys
from pathlib import Path
needle = "SEC" + "RET"
data = json.load(sys.stdin)
for name in data["changed_files"]:
    path = Path(data["root"]) / name
    if path.is_file() and needle in path.read_text(encoding="utf-8"):
        print(f"{name} contains {needle}")
        sys.exit(1)
"""

COUNTING_CHECK = """\
import os
with open(os.environ["TT_TEST_COUNTER"], "a", encoding="utf-8") as handle:
    handle.write("run\\n")
"""


class CheckHookTest(RepoTestCase):
    def setUp(self):
        super().setUp()
        self.install()
        self.commit("install tiny-trellis")

    def add_check(self, name, source):
        self.write(f".trellis/tiny/checks/{name}", source)
        self.commit(f"add {name}")

    def test_no_checks_lets_the_stop_through_silently(self):
        self.write("README.md", "changed\n")
        completed = self.hook("check")
        self.assert_ok(completed)
        self.assertEqual(completed.stdout + completed.stderr, "")

    def test_failure_blocks_then_repeat_without_change_is_let_through(self):
        self.add_check("needle.py", NEEDLE_CHECK)
        self.write("config.py", "KEY = 'SECRET'\n")
        first = self.hook("check")
        self.assertEqual(first.returncode, 2)
        self.assertIn("needle.py failed: config.py contains SECRET", first.stderr)
        second = self.hook("check")
        self.assert_ok(second)
        message = json.loads(second.stdout)["systemMessage"]
        self.assertIn("same check failure came back", message)

    def test_fixing_the_problem_passes(self):
        self.add_check("needle.py", NEEDLE_CHECK)
        self.write("config.py", "KEY = 'SECRET'\n")
        self.assertEqual(self.hook("check").returncode, 2)
        self.write("config.py", "KEY = read_from_env()\n")
        completed = self.hook("check")
        self.assert_ok(completed)
        self.assertEqual(completed.stdout + completed.stderr, "")

    def test_a_broken_check_blocks(self):
        self.add_check("broken.py", "import sys\nsys.exit(3)\n")
        self.write("README.md", "changed\n")
        completed = self.hook("check")
        self.assertEqual(completed.returncode, 2)
        self.assertIn("broken.py could not run: exited with code 3", completed.stderr)

    def test_unchanged_tree_skips_checks_after_a_pass(self):
        counter_dir = make_temp_dir()
        self.addCleanup(remove_temp_tree, counter_dir)
        counter = counter_dir / "runs.txt"
        self.add_check("counting.py", COUNTING_CHECK)
        self.write("README.md", "changed\n")
        env = {"TT_TEST_COUNTER": str(counter)}
        self.assert_ok(self.hook("check", env=env))
        self.assert_ok(self.hook("check", env=env))
        self.assertEqual(counter.read_text(encoding="utf-8").count("run"), 1)

    def test_hook_failure_blocks_once_then_warns(self):
        self.add_check("needle.py", NEEDLE_CHECK)
        state = self.root / ".trellis/tiny/.runtime/state.json"
        state.write_text("{not json", encoding="utf-8")
        first = self.hook("check")
        self.assertEqual(first.returncode, 2)
        self.assertIn("could not run", first.stderr)
        second = self.hook("check", extra={"stop_hook_active": True})
        self.assert_ok(second)
        self.assertIn("failed twice in a row", json.loads(second.stdout)["systemMessage"])

    def test_manual_check_reports_and_fails(self):
        self.add_check("needle.py", NEEDLE_CHECK)
        self.write("config.py", "KEY = 'SECRET'\n")
        completed = self.tt("check")
        self.assertEqual(completed.returncode, 1)
        self.assertIn("needle.py: fail", completed.stdout)


if __name__ == "__main__":
    unittest.main()
