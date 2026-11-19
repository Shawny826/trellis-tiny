"""Unit tests for the edits init makes to AGENTS.md, CLAUDE.md, and hook settings."""
import json
import unittest

import support  # noqa: F401  (puts the source tree on sys.path)

from ttlib.errors import TinyError
from ttlib.hookconfig import claude_groups, merge_hooks
from ttlib.managed import apply_block, with_import

BLOCK = "<!-- tiny-trellis:begin -->\nrules\n<!-- tiny-trellis:end -->\n"
NEW_BLOCK = "<!-- tiny-trellis:begin -->\nnew rules\n<!-- tiny-trellis:end -->\n"


class ApplyBlockTest(unittest.TestCase):
    def test_creates_block_for_missing_file(self):
        self.assertEqual(apply_block(None, BLOCK), BLOCK)

    def test_appends_after_existing_text_without_touching_it(self):
        result = apply_block("# Project\nuser text\n", BLOCK)
        self.assertEqual(result, "# Project\nuser text\n\n" + BLOCK)

    def test_replaces_only_between_markers(self):
        existing = "before\n" + BLOCK + "after\n"
        self.assertEqual(apply_block(existing, NEW_BLOCK), "before\n" + NEW_BLOCK + "after\n")

    def test_keeps_crlf_line_endings(self):
        result = apply_block("user text\r\n", BLOCK)
        self.assertNotIn("\r\r", result)
        self.assertEqual(result.count("\n"), result.count("\r\n"))

    def test_rejects_unpaired_markers(self):
        with self.assertRaises(TinyError):
            apply_block("<!-- tiny-trellis:begin -->\nno end\n", BLOCK)

    def test_rejects_repeated_blocks(self):
        with self.assertRaises(TinyError):
            apply_block(BLOCK + BLOCK, NEW_BLOCK)


class WithImportTest(unittest.TestCase):
    def test_creates_import_for_missing_file(self):
        self.assertEqual(with_import(None), "@AGENTS.md\n")

    def test_prepends_import(self):
        self.assertEqual(with_import("# Notes\n"), "@AGENTS.md\n\n# Notes\n")

    def test_leaves_existing_import_alone(self):
        text = "# Notes\n@AGENTS.md\n"
        self.assertEqual(with_import(text), text)


class MergeHooksTest(unittest.TestCase):
    def setUp(self):
        self.ours = claude_groups(["python3"], with_stop=True)

    def test_keeps_other_settings_and_user_hooks(self):
        existing = json.dumps({
            "env": {"A": "1"},
            "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "user-hook"}]}]},
        })
        merged = json.loads(merge_hooks(existing, self.ours, "settings"))
        self.assertEqual(merged["env"], {"A": "1"})
        commands = [h["command"] for g in merged["hooks"]["Stop"] for h in g["hooks"]]
        self.assertEqual(commands, ["user-hook", "python3"])

    def test_is_idempotent(self):
        once = merge_hooks(None, self.ours, "settings")
        self.assertEqual(merge_hooks(once, self.ours, "settings"), once)

    def test_drops_our_stop_hook_when_no_longer_wanted(self):
        with_stop = merge_hooks(None, self.ours, "settings")
        without = json.loads(merge_hooks(with_stop, claude_groups(["python3"], False), "s"))
        self.assertNotIn("Stop", without["hooks"])
        self.assertIn("SessionStart", without["hooks"])

    def test_rejects_invalid_json(self):
        with self.assertRaises(TinyError):
            merge_hooks("{not json", self.ours, "settings")


if __name__ == "__main__":
    unittest.main()
