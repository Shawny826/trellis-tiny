"""End-to-end tests for init."""
import json
import unittest

from support import SOURCE_ROOT, SOURCE_SCRIPT, RepoTestCase


class InitTest(RepoTestCase):
    def test_installs_everything_for_both_platforms(self):
        self.install()
        agents = self.read("AGENTS.md")
        self.assertIn("<!-- tiny-trellis:begin", agents)
        self.assertIn("<!-- tiny-trellis:end -->", agents)
        self.assertEqual(self.read("CLAUDE.md"), "@AGENTS.md\n")
        self.assertTrue((self.root / ".trellis/tiny/tt.py").is_file())
        self.assertTrue((self.root / ".trellis/spec/index.md").is_file())
        self.assertEqual(self.read(".claude/agents/tiny_trellis_reviewer.md"),
                         (SOURCE_ROOT / "ttlib/assets/reviewer.md").read_text(encoding="utf-8"))
        self.assertTrue((self.root / ".codex/agents/tiny_trellis_reviewer.toml").is_file())
        local = json.loads(self.read(".trellis/tiny/.runtime/local.json"))
        self.assertTrue(local["interpreter"])
        self.assertIn(local["shell"]["kind"], ("git-bash", "pwsh", "bash"))

    def test_hooks_without_checks_have_no_stop_hook(self):
        self.install()
        claude = json.loads(self.read(".claude/settings.local.json"))["hooks"]
        codex = json.loads(self.read(".codex/hooks.json"))["hooks"]
        self.assertEqual(set(claude), {"SessionStart"})
        self.assertEqual(set(codex), {"SessionStart"})
        handler = claude["SessionStart"][0]["hooks"][0]
        self.assertEqual(handler["args"][-3:],
                         ["${CLAUDE_PROJECT_DIR}/.trellis/tiny/tt.py", "status", "--hook"])
        self.assertIn(self.root.as_posix(), codex["SessionStart"][0]["hooks"][0]["command"])

    def test_registered_checks_add_the_stop_hook(self):
        self.write(".trellis/tiny/checks/always_pass.py", "")
        self.install()
        claude = json.loads(self.read(".claude/settings.local.json"))["hooks"]
        self.assertIn("Stop", claude)

    def test_second_run_changes_nothing(self):
        self.install()
        before = {path: path.read_bytes() for path in self.root.rglob("*")
                  if path.is_file() and ".git" not in path.parts}
        second = self.install()
        self.assertIn("Everything is already up to date.", second.stdout)
        after = {path: path.read_bytes() for path in before}
        self.assertEqual(before, after)

    def test_keeps_existing_agents_md_text(self):
        self.write("AGENTS.md", "# Team rules\nuse tabs\n")
        self.install()
        self.assertTrue(self.read("AGENTS.md").startswith("# Team rules\nuse tabs\n\n"))

    def test_machine_specific_files_are_excluded_from_git(self):
        self.install()
        exclude = self.read(".git/info/exclude")
        self.assertIn("/.claude/settings.local.json", exclude)
        self.assertIn("/.codex/hooks.json", exclude)
        self.assertNotIn(".codex/hooks.json", self.git("status", "--porcelain"))

    def test_dry_run_writes_nothing(self):
        completed = self.tt("init", "--claude", "--dry-run", script=SOURCE_SCRIPT)
        self.assert_ok(completed)
        self.assertIn("would create AGENTS.md", completed.stdout)
        self.assertFalse((self.root / ".trellis").exists())
        self.assertFalse((self.root / "AGENTS.md").exists())

    def test_invalid_settings_stop_init_before_any_write(self):
        self.write(".claude/settings.local.json", "{broken")
        completed = self.tt("init", "--claude", script=SOURCE_SCRIPT)
        self.assertEqual(completed.returncode, 1)
        self.assertIn("not valid JSON", completed.stderr)
        self.assertFalse((self.root / "AGENTS.md").exists())

    def test_upstream_trellis_without_a_manifest_stops_init(self):
        self.write(".trellis/workflow.md", "upstream\n")
        completed = self.tt("init", "--claude", stdin="", script=SOURCE_SCRIPT)
        self.assertEqual(completed.returncode, 1)
        self.assertIn(".trellis/.template-hashes.json is missing", completed.stderr)
        self.assertFalse((self.root / "AGENTS.md").exists())

    def test_migrate_without_upstream_is_an_error(self):
        completed = self.tt("init", "--claude", "--migrate", script=SOURCE_SCRIPT)
        self.assertEqual(completed.returncode, 1)
        self.assertIn("no upstream Trellis installation", completed.stderr)

    def test_without_flags_sets_up_both_platforms(self):
        self.assert_ok(self.tt("init", script=SOURCE_SCRIPT))
        self.assertTrue((self.root / ".claude/skills/tt-task/SKILL.md").is_file())
        self.assertTrue((self.root / ".agents/skills/tt-task/SKILL.md").is_file())


if __name__ == "__main__":
    unittest.main()
