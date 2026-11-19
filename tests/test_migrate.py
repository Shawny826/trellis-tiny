"""Migration from an upstream Trellis installation, end to end.

The fixture follows upstream's templates: hook commands of the form
`<python> <script>`, the TRELLIS:START/END block in AGENTS.md, and a version 2
manifest in .trellis/.template-hashes.json.
"""
import contextlib
import io
import json
import unittest
from unittest import mock

from support import SOURCE_SCRIPT, RepoTestCase
from ttlib.install import InitOptions, init

CONTENT_FILES = {
    ".trellis/workflow.md": "# Workflow\n",
    ".trellis/scripts/task.py": "print('task')\n",
    ".trellis/config.yaml": "session_auto_commit: true\n",
    ".claude/hooks/session-start.py": "print('start')\n",
    ".claude/hooks/inject-workflow-state.py": "print('state')\n",
    ".claude/hooks/statusline.py": "print('status')\n",
    ".claude/agents/trellis-check.md": "---\nname: trellis-check\n---\n",
    ".claude/commands/trellis/start.md": "start\n",
    ".claude/skills/trellis-brainstorm/SKILL.md": "brainstorm\n",
    ".codex/hooks/inject-workflow-state.py": "print('codex state')\n",
    ".codex/agents/trellis-check.toml": 'name = "trellis-check"\n',
    ".agents/skills/trellis-check/SKILL.md": "check\n",
}
USER_HOOK = {"type": "command", "command": "echo see .claude/hooks/session-start.py for details"}
CLAUDE_SETTINGS = {
    "env": {"CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR": "1"},
    "statusLine": {"type": "command", "command": "python3 .claude/hooks/statusline.py"},
    "hooks": {
        "SessionStart": [{"matcher": "startup", "hooks": [
            {"type": "command", "command": "python3 .claude/hooks/session-start.py"}]}],
        "UserPromptSubmit": [{"hooks": [
            {"type": "command", "command": "python3 .claude/hooks/inject-workflow-state.py"},
            USER_HOOK]}],
    },
}
CODEX_HOOKS = {"hooks": {"UserPromptSubmit": [{"hooks": [
    {"type": "command", "command": "python3 -X utf8 .codex/hooks/inject-workflow-state.py"}]}],
    "Stop": [{"hooks": [{"type": "command", "command": "my-own-hook"}]}]}}
CODEX_CONFIG = 'project_doc_fallback_filenames = ["AGENTS.md"]\n\n[agents]\nmax_depth = 1\n'
AGENTS_MD = ("# Team rules\nuse tabs\n\n<!-- TRELLIS:START -->\n# Trellis Instructions\n"
             "upstream text\n<!-- TRELLIS:END -->\n")
USER_DATA = {
    ".trellis/spec/backend/index.md": "# Backend\n",
    ".trellis/tasks/08-06-retry/task.json": json.dumps(
        {"title": "Retry policy", "status": "in_progress", "createdAt": "2026-08-06"}),
    ".trellis/tasks/08-06-retry/prd.md": "# PRD\n",
    ".trellis/tasks/archive/2026-06/04-20-plugins/task.json": json.dumps(
        {"name": "plugins", "status": "completed"}),
    ".trellis/workspace/taosu/journal-1.md": "# Journal\n",
}


class MigrationTestCase(RepoTestCase):
    def setUp(self):
        super().setUp()
        self.build_upstream()
        self.commit("upstream trellis")

    def build_upstream(self, extra_manifest=()):
        for path, text in {**CONTENT_FILES, **USER_DATA}.items():
            self.write(path, text)
        self.write(".claude/settings.json", json.dumps(CLAUDE_SETTINGS, indent=2))
        self.write(".codex/hooks.json", json.dumps(CODEX_HOOKS, indent=2))
        self.write(".codex/config.toml", CODEX_CONFIG)
        self.write("AGENTS.md", AGENTS_MD)
        self.write(".trellis/.version", "0.7.0\n")
        self.write(".trellis/.gitignore", ".agents/\n.runtime/\n*.tmp\n")
        listed = [*CONTENT_FILES, ".claude/settings.json", ".codex/hooks.json",
                  ".codex/config.toml", "AGENTS.md", *extra_manifest]
        manifest = {"__version": 2, "hashes": {path: "0" * 64 for path in listed}}
        self.write(".trellis/.template-hashes.json", json.dumps(manifest))

    def migrate(self, *extra):
        return self.tt("init", "--claude", "--codex", "--migrate", *extra, script=SOURCE_SCRIPT)

    def archive(self):
        folders = list((self.root / ".trellis/archive").glob("upstream-*"))
        self.assertEqual(len(folders), 1)
        return folders[0]


class MigrateTest(MigrationTestCase):
    def test_moves_upstream_files_into_the_archive(self):
        self.assert_ok(self.migrate())
        archive = self.archive()
        for path, text in CONTENT_FILES.items():
            self.assertFalse((self.root / path).exists(), path)
            self.assertEqual((archive / path).read_text(encoding="utf-8"), text)
        for path in (".trellis/.template-hashes.json", ".trellis/.version"):
            self.assertTrue((archive / path).is_file(), path)

    def test_leaves_user_data_alone(self):
        self.assert_ok(self.migrate())
        for path, text in USER_DATA.items():
            self.assertEqual(self.read(path), text, path)
        self.assertEqual(self.read(".codex/config.toml"), CODEX_CONFIG)

    def test_removes_only_upstream_hooks(self):
        self.assert_ok(self.migrate())
        settings = json.loads(self.read(".claude/settings.json"))
        self.assertEqual(settings["env"], CLAUDE_SETTINGS["env"])
        self.assertNotIn("statusLine", settings)
        self.assertEqual(settings["hooks"], {"UserPromptSubmit": [{"hooks": [USER_HOOK]}]})
        codex = json.loads(self.read(".codex/hooks.json"))["hooks"]
        self.assertNotIn("UserPromptSubmit", codex)
        self.assertEqual(codex["Stop"][0]["hooks"][0]["command"], "my-own-hook")

    def test_replaces_the_agents_block(self):
        self.assert_ok(self.migrate())
        agents = self.read("AGENTS.md")
        self.assertTrue(agents.startswith("# Team rules\nuse tabs\n\n<!-- tiny-trellis:begin"))
        self.assertNotIn("TRELLIS:START", agents)
        self.assertNotIn("upstream text", agents)

    def test_records_everything_removed(self):
        self.assert_ok(self.migrate())
        report = (self.archive() / "MIGRATION.md").read_text(encoding="utf-8")
        self.assertIn("- .claude/hooks/session-start.py", report)
        self.assertIn("python3 .claude/hooks/session-start.py", report)
        self.assertIn("python3 -X utf8 .codex/hooks/inject-workflow-state.py", report)
        self.assertIn("the Trellis status line from .claude/settings.json", report)
        self.assertIn("upstream text", report)
        self.assertIn(".codex/config.toml was left as is", report)

    def test_indexes_old_tasks_and_specs(self):
        self.assert_ok(self.migrate())
        tasks = self.read(".trellis/spec/upstream-tasks.md")
        self.assertIn("- [Retry policy](../tasks/08-06-retry/prd.md) — in_progress — created "
                      "2026-08-06", tasks)
        self.assertIn("- [plugins](../tasks/archive/2026-06/04-20-plugins) — completed", tasks)
        index = self.read(".trellis/spec/index.md")
        self.assertIn("- [upstream-tasks.md](upstream-tasks.md)", index)
        self.assertIn("- [backend/index.md](backend/index.md)", index)

    def test_unreadable_task_json_is_listed_not_fatal(self):
        broken = '{"title": "Old", "dev_type": docs}'
        self.write(".trellis/tasks/archive/2026-01/01-00-old/task.json", broken)
        self.commit("an early-version task file")
        self.assert_ok(self.migrate())
        tasks = self.read(".trellis/spec/upstream-tasks.md")
        self.assertIn("- [01-00-old](../tasks/archive/2026-01/01-00-old) — task.json could not "
                      "be read (not valid JSON", tasks)
        report = (self.archive() / "MIGRATION.md").read_text(encoding="utf-8")
        self.assertIn("1 upstream task.json file(s) could not be read", report)
        self.assertEqual(self.read(".trellis/tasks/archive/2026-01/01-00-old/task.json"), broken)

    def test_archived_files_are_not_ignored_by_git(self):
        self.assert_ok(self.migrate())
        untracked = self.git("status", "--porcelain", "--untracked-files=all")
        self.assertIn(".agents/skills/trellis-check/SKILL.md", untracked)
        self.assertIn(".trellis/archive/", untracked)

    def test_status_is_clean_right_after_migrating(self):
        self.assert_ok(self.migrate())
        self.assertNotIn("not recorded", self.hook("status").stdout)
        self.commit("migrate")
        self.assertIn("Everything is already up to date.", self.install().stdout)

    def test_unlisted_trellis_files_are_reported_and_left_in_place(self):
        self.write(".claude/skills/trellis-old/SKILL.md", "old skill\n")
        self.write(".claude/skills/my-skill/SKILL.md", "mentions .trellis/scripts/task.py\n")
        self.commit("files from an older upstream version")
        completed = self.migrate()
        self.assert_ok(completed)
        self.assertIn("1 file(s) named trellis* are not in the upstream manifest", completed.stdout)
        self.assertEqual(self.read(".claude/skills/trellis-old/SKILL.md"), "old skill\n")
        report = (self.archive() / "MIGRATION.md").read_text(encoding="utf-8")
        self.assertIn("- .claude/skills/trellis-old/SKILL.md", report)
        self.assertNotIn("my-skill", report)

    def test_other_platforms_are_left_in_place_and_reported(self):
        cursor_hook, cursor_config = ".cursor/hooks/session-start.py", ".cursor/hooks.json"
        self.write(cursor_hook, "print('cursor')\n")
        self.write(cursor_config, '{"hooks": {}}\n')
        self.build_upstream(extra_manifest=[cursor_hook, cursor_config])
        self.commit("cursor too")
        dry_run = self.migrate("--dry-run")
        self.assert_ok(dry_run)
        self.assertIn("2 file(s) in the upstream manifest are not handled", dry_run.stdout)
        self.assertIn(cursor_hook, dry_run.stdout)
        self.assertEqual(self.git("status", "--porcelain"), "")
        self.assert_ok(self.migrate())
        self.assertEqual(self.read(cursor_hook), "print('cursor')\n")
        self.assertEqual(self.read(cursor_config), '{"hooks": {}}\n')
        self.assertFalse((self.root / ".trellis/workflow.md").exists())
        report = (self.archive() / "MIGRATION.md").read_text(encoding="utf-8")
        self.assertIn("## Not handled, left in place", report)
        self.assertIn(f"- {cursor_hook}", report)
        self.assertIn(f"- {cursor_config}", report)
        self.assertNotIn(f"- {cursor_hook}", report.split("## Moved into this folder")[1]
                         .split("## Removed from shared files")[0])

    def test_block_at_the_top_leaves_no_blank_first_line(self):
        self.write("AGENTS.md", "<!-- TRELLIS:START -->\nupstream\n<!-- TRELLIS:END -->\n\n# Ours\n")
        self.commit("block first")
        self.assert_ok(self.migrate())
        self.assertTrue(self.read("AGENTS.md").startswith("# Ours\n"))


class MigrateRefusalTest(MigrationTestCase):
    def assert_untouched(self, completed, message):
        self.assertEqual(completed.returncode, 1)
        self.assertIn(message, completed.stderr)
        self.assertEqual(self.git("status", "--porcelain"), "")

    def test_plain_init_without_a_terminal_changes_nothing(self):
        completed = self.tt("init", "--claude", stdin="", script=SOURCE_SCRIPT)
        self.assert_untouched(completed, "needs a yes from a terminal")
        self.assertIn("init --migrate", completed.stderr)
        self.assertIn("would migrate: archive 14 upstream file(s)", completed.stdout)

    def test_dry_run_without_migrate_previews_the_migration(self):
        completed = self.tt("init", "--dry-run", script=SOURCE_SCRIPT)
        self.assert_ok(completed)
        self.assertIn("would migrate: archive 14 upstream file(s)", completed.stdout)
        self.assertEqual(self.git("status", "--porcelain"), "")

    def test_dry_run_lists_the_plan_and_changes_nothing(self):
        completed = self.migrate("--dry-run")
        self.assert_ok(completed)
        self.assertIn("would migrate: archive 14 upstream file(s)", completed.stdout)
        self.assertIn("would migrate: remove the Trellis block from AGENTS.md", completed.stdout)
        self.assertIn("would update AGENTS.md", completed.stdout)
        self.assertEqual(self.git("status", "--porcelain"), "")

    def test_uncommitted_changes_stop_the_migration(self):
        self.write("README.md", "dirty\n")
        completed = self.migrate()
        self.assertEqual(completed.returncode, 1)
        self.assertIn("uncommitted changes", completed.stderr)
        self.assertTrue((self.root / ".trellis/workflow.md").exists())

    def test_missing_manifest_stops_the_migration(self):
        (self.root / ".trellis/.template-hashes.json").unlink()
        self.commit("no manifest")
        self.assert_untouched(self.migrate(), "is missing")

    def test_unclear_hook_stops_the_migration(self):
        settings = json.loads(json.dumps(CLAUDE_SETTINGS))
        settings["hooks"]["Stop"] = [{"hooks": [
            {"type": "command", "command": "bash .claude/hooks/session-start.py"}]}]
        self.write(".claude/settings.json", json.dumps(settings, indent=2))
        self.commit("a hook of unclear origin")
        completed = self.migrate()
        self.assert_untouched(completed, "bash .claude/hooks/session-start.py")
        self.assertIn("unclear whether", completed.stderr)


class MigrateConfirmTest(MigrationTestCase):
    """Plain init in a terminal asks before migrating. Run in-process, because a subprocess
    here has no terminal to answer from."""

    def init_answering(self, answer):
        terminal = mock.Mock()
        terminal.isatty.return_value = True
        reply = {"side_effect": answer} if answer is EOFError else {"return_value": answer}
        with mock.patch("sys.stdin", terminal), mock.patch("builtins.input", **reply) as asked, \
                contextlib.redirect_stdout(io.StringIO()) as out:
            code = init(self.root, InitOptions(set()))
        asked.assert_called_once()
        return code, out.getvalue()

    def test_yes_migrates_and_installs(self):
        code, out = self.init_answering("y")
        self.assertEqual(code, 0, out)
        self.assertIn("would migrate: archive 14 upstream file(s)", out)
        self.assertFalse((self.root / ".trellis/workflow.md").exists())
        self.assertTrue((self.archive() / ".trellis/workflow.md").is_file())
        self.assertTrue((self.root / ".trellis/tiny/config.json").is_file())

    def test_anything_but_yes_changes_nothing(self):
        for answer in ("", "n", "maybe", EOFError):
            with self.subTest(answer=answer):
                code, out = self.init_answering(answer)
                self.assertEqual(code, 1)
                self.assertIn("Nothing was changed.", out)
                self.assertEqual(answer is EOFError, "init --migrate" in out)
                self.assertEqual(self.git("status", "--porcelain"), "")


if __name__ == "__main__":
    unittest.main()
