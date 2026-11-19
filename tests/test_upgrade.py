"""init on a project that already has tiny-trellis: upgrades and their safeguards."""
import json
import unittest

from support import SOURCE_ROOT, SOURCE_SCRIPT, RepoTestCase

from ttlib import __version__
from ttlib.ownership import digest

SKILL = ".claude/skills/tt-task/SKILL.md"


class UpgradeTestCase(RepoTestCase):
    def init(self, *flags):
        return self.tt("init", *flags, script=SOURCE_SCRIPT)

    def config(self):
        return json.loads(self.read(".trellis/tiny/config.json"))

    def manifest(self):
        return json.loads(self.read(".trellis/tiny/manifest.json"))

    def set_record(self, version=None, manifest_updates=None):
        if version is not None:
            self.write(".trellis/tiny/config.json",
                       json.dumps({**self.config(), "version": version}))
        if manifest_updates:
            self.write(".trellis/tiny/manifest.json",
                       json.dumps({**self.manifest(), **manifest_updates}))

    def backups(self):
        return sorted((self.root / ".trellis/tiny").glob(".backup-*"))


class FreshInstallTest(UpgradeTestCase):
    def test_plain_init_sets_up_both_platforms_and_records_them(self):
        completed = self.init()
        self.assert_ok(completed)
        self.assertIn(f"install tiny-trellis {__version__} for Claude Code and Codex",
                      completed.stdout)
        self.assertEqual(self.config(), {"version": __version__, "platforms": ["claude", "codex"]})
        manifest = self.manifest()
        for path in (".trellis/tiny/tt.py", ".trellis/tiny/ttlib/cli.py", SKILL,
                     ".agents/skills/tt-task/SKILL.md", ".codex/agents/tiny_trellis_reviewer.toml"):
            self.assertEqual(manifest[path], digest(self.read(path)), path)
        self.assertNotIn("AGENTS.md", manifest)

    def test_project_entry_script_matches_the_source_one(self):
        self.assert_ok(self.init())
        self.assertEqual(self.read(".trellis/tiny/tt.py"),
                         (SOURCE_ROOT / "tt.py").read_text(encoding="utf-8"))

    def test_a_platform_can_be_added_later(self):
        self.assert_ok(self.init("--claude"))
        self.assertEqual(self.config()["platforms"], ["claude"])
        self.assertFalse((self.root / ".agents").exists())
        self.assert_ok(self.init("--codex"))
        self.assertEqual(self.config()["platforms"], ["claude", "codex"])
        self.assertTrue((self.root / ".agents/skills/tt-task/SKILL.md").is_file())
        self.assertTrue((self.root / ".claude/skills/tt-task/SKILL.md").is_file())


class UpgradeTest(UpgradeTestCase):
    def setUp(self):
        super().setUp()
        self.assert_ok(self.init())
        self.commit("install tiny-trellis")

    def test_older_install_is_upgraded_and_replaced_files_are_backed_up(self):
        old_skill = "older skill text\n"
        self.write(SKILL, old_skill)
        self.set_record("0.0.1", {SKILL: digest(old_skill)})
        completed = self.init()
        self.assert_ok(completed)
        self.assertIn(f"upgrade tiny-trellis from 0.0.1 to {__version__}", completed.stdout)
        self.assertEqual(self.config()["version"], __version__)
        self.assertNotEqual(self.read(SKILL), old_skill)
        [backup] = self.backups()
        self.assertEqual((backup / SKILL).read_text(encoding="utf-8"), old_skill)

    def test_hand_edited_file_stops_init_without_changes(self):
        self.write(SKILL, "my own edits\n")
        self.set_record("0.0.1")
        before = self.read(".trellis/tiny/config.json")
        completed = self.init()
        self.assertEqual(completed.returncode, 1)
        self.assertIn(SKILL, completed.stderr)
        self.assertIn("--force", completed.stderr)
        self.assertEqual(self.read(SKILL), "my own edits\n")
        self.assertEqual(self.read(".trellis/tiny/config.json"), before)

    def test_keep_leaves_the_hand_edited_file(self):
        self.write(SKILL, "my own edits\n")
        completed = self.init("--keep")
        self.assert_ok(completed)
        self.assertIn(f"note: {SKILL} kept as you changed it", completed.stdout)
        self.assertEqual(self.read(SKILL), "my own edits\n")

    def test_force_backs_up_the_hand_edited_file_then_overwrites_it(self):
        self.write(SKILL, "my own edits\n")
        self.assert_ok(self.init("--force"))
        self.assertNotEqual(self.read(SKILL), "my own edits\n")
        [backup] = self.backups()
        self.assertEqual((backup / SKILL).read_text(encoding="utf-8"), "my own edits\n")

    def test_deleted_skill_stays_deleted_but_deleted_code_comes_back(self):
        (self.root / SKILL).unlink()
        (self.root / ".trellis/tiny/ttlib/cli.py").unlink()
        completed = self.init()
        self.assert_ok(completed)
        self.assertIn(f"note: {SKILL} not recreated because you deleted it", completed.stdout)
        self.assertFalse((self.root / SKILL).exists())
        self.assertTrue((self.root / ".trellis/tiny/ttlib/cli.py").is_file())

    def test_files_this_version_no_longer_installs_are_retired(self):
        unchanged, edited = ".claude/skills/tt-old/SKILL.md", ".claude/skills/tt-gone/SKILL.md"
        self.write(unchanged, "old\n")
        self.write(edited, "edited by hand\n")
        self.set_record(manifest_updates={unchanged: digest("old\n"), edited: digest("as written")})
        completed = self.init()
        self.assert_ok(completed)
        self.assertIn(f"retire {unchanged}", completed.stdout)
        self.assertFalse((self.root / unchanged).exists())
        [backup] = self.backups()
        self.assertEqual((backup / unchanged).read_text(encoding="utf-8"), "old\n")
        self.assertIn(f"note: {edited} no longer used, but left because you changed it",
                      completed.stdout)
        self.assertEqual(self.read(edited), "edited by hand\n")

    def test_newer_install_needs_allow_downgrade(self):
        self.set_record("99.0.0")
        completed = self.init()
        self.assertEqual(completed.returncode, 1)
        self.assertIn("newer than this tt", completed.stderr)
        self.assert_ok(self.init("--allow-downgrade"))
        self.assertEqual(self.config()["version"], __version__)

    def test_upgrade_on_a_clean_tree_leaves_status_clean(self):
        old_skill = "older skill text\n"
        self.write(SKILL, old_skill)
        self.set_record("0.0.1", {SKILL: digest(old_skill)})
        self.commit("pretend an older version wrote this")
        self.assert_ok(self.hook("status"))
        self.tt("finish", "--reason", "record the older install", "--review", "self",
                "--no-verify", "setup only")
        self.assert_ok(self.init())
        self.assertNotIn("not recorded", self.hook("status").stdout)

    def test_upgrade_does_not_hide_unrecorded_work(self):
        self.write("README.md", "work in progress\n")
        self.set_record("0.0.1")
        self.assert_ok(self.init())
        self.assertIn("not recorded", self.hook("status").stdout)


if __name__ == "__main__":
    unittest.main()
