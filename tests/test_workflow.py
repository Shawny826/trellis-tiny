"""End-to-end tests for status, task, and finish."""
import json
import shutil
import sys
import unittest

from support import RepoTestCase, make_temp_dir, remove_temp_tree


class WorkflowTestCase(RepoTestCase):
    def setUp(self):
        super().setUp()
        self.install()
        self.commit("install tiny-trellis")
        scripts = make_temp_dir()
        self.addCleanup(remove_temp_tree, scripts)
        self.pass_script = scripts / "verify_pass.py"
        self.pass_script.write_text("print('3 passed')\n", encoding="utf-8")
        self.fail_script = scripts / "verify_fail.py"
        self.fail_script.write_text("import sys\nprint('1 failed')\nsys.exit(1)\n",
                                    encoding="utf-8")

    def verify_command(self, script):
        return f"{sys.executable} {script}".replace("\\", "/")

    def journal(self) -> str:
        return self.read(".trellis/workspace/Test-User/tiny-journal.md")


class StatusTest(WorkflowTestCase):
    def test_clean_project(self):
        completed = self.hook("status")
        self.assert_ok(completed)
        self.assertIn("run commands as `", completed.stdout)
        self.assertIn("No active task.", completed.stdout)
        self.assertNotIn("not recorded", completed.stdout)

    def test_reports_unrecorded_changes(self):
        self.write("README.md", "changed\n")
        self.write("new.txt", "new\n")
        self.assertIn("2 changed file(s) since the last finish are not recorded",
                      self.hook("status").stdout)

    def test_manual_status_matches_hook(self):
        self.assertEqual(self.tt("status").stdout, self.hook("status").stdout)

    def test_hook_input_without_cwd_is_an_error(self):
        completed = self.tt("status", "--hook", stdin="{}")
        self.assertEqual(completed.returncode, 1)
        self.assertIn("cwd", completed.stderr)


class TaskTest(WorkflowTestCase):
    def test_new_task_is_active_until_closed(self):
        created = self.tt("task", "new", "Retry policy")
        self.assert_ok(created)
        tasks = list((self.root / ".trellis/tasks").glob("*-retry-policy.md"))
        self.assertEqual(len(tasks), 1)
        self.assertIn("# Retry policy\n- Status: active\n", tasks[0].read_text(encoding="utf-8"))
        self.assertIn(f"Active task: .trellis/tasks/{tasks[0].name}.", self.hook("status").stdout)
        self.assert_ok(self.tt("task", "close", tasks[0].stem))
        self.assertIn("- Status: closed", tasks[0].read_text(encoding="utf-8"))
        self.assertIn("No active task.", self.hook("status").stdout)

    def test_same_title_gets_a_new_file(self):
        self.assert_ok(self.tt("task", "new", "Same"))
        self.assert_ok(self.tt("task", "new", "Same"))
        self.assertEqual(len(list((self.root / ".trellis/tasks").glob("*-same*.md"))), 2)

    def test_closing_an_unknown_task_fails(self):
        completed = self.tt("task", "close", "missing")
        self.assertEqual(completed.returncode, 1)
        self.assertIn("no task file", completed.stderr)


class FinishTest(WorkflowTestCase):
    def finish(self, *extra):
        return self.tt("finish", "--reason", "Fix the greeting", "--review", "self", *extra)

    def test_records_an_entry_and_clears_the_warning(self):
        self.write("README.md", "hello, world\n")
        completed = self.finish("--verify", self.verify_command(self.pass_script))
        self.assert_ok(completed)
        journal = self.journal()
        self.assertIn("- Reason: Fix the greeting", journal)
        self.assertIn("- Changed: README.md", journal)
        self.assertIn("exit 0 — 3 passed", journal)
        self.assertIn("- Checks: no project checks registered", journal)
        self.assertIn("- Review: self", journal)
        self.assertIn("(with uncommitted changes)", journal)
        self.assertNotIn("not recorded", self.hook("status").stdout)

    def test_committing_recorded_work_keeps_status_clean(self):
        self.write("README.md", "hello, world\n")
        self.assert_ok(self.finish("--no-verify", "docs only"))
        self.commit("greeting")
        self.assertNotIn("not recorded", self.hook("status").stdout)

    def test_failed_verification_records_nothing(self):
        self.write("README.md", "broken\n")
        completed = self.finish("--verify", self.verify_command(self.fail_script))
        self.assertEqual(completed.returncode, 1)
        self.assertIn("1 failed", completed.stderr)
        self.assertFalse((self.root / ".trellis/workspace").exists())

    def test_no_verify_is_recorded_with_its_reason(self):
        self.write("README.md", "docs\n")
        self.assert_ok(self.finish("--no-verify", "docs-only change"))
        self.assertIn("- Verify: none — docs-only change", self.journal())

    def test_nothing_to_record(self):
        completed = self.finish("--no-verify", "nothing")
        self.assertEqual(completed.returncode, 1)
        self.assertIn("nothing has changed", completed.stderr)

    def test_reason_must_be_one_line(self):
        self.write("README.md", "x\n")
        completed = self.tt("finish", "--reason", "two\nlines", "--review", "self",
                            "--no-verify", "x")
        self.assertEqual(completed.returncode, 1)
        self.assertIn("single line", completed.stderr)

    def test_active_task_is_linked(self):
        self.assert_ok(self.tt("task", "new", "Linked"))
        self.write("README.md", "x\n")
        self.assert_ok(self.finish("--no-verify", "docs"))
        self.assertRegex(self.journal(), r"- Task: \.trellis/tasks/[\d-]+-linked\.md")

    def test_failing_check_blocks_finish(self):
        self.write(".trellis/tiny/checks/always_fail.py", "import sys\nprint('bad')\nsys.exit(1)\n")
        self.write("README.md", "x\n")
        completed = self.finish("--no-verify", "docs")
        self.assertEqual(completed.returncode, 1)
        self.assertIn("always_fail.py failed: bad", completed.stderr)
        self.assertFalse((self.root / ".trellis/workspace").exists())

    def test_verify_runs_in_the_detected_bash(self):
        local = json.loads(self.read(".trellis/tiny/.runtime/local.json"))
        if local["shell"]["kind"] not in ("git-bash", "bash"):
            self.skipTest("this machine verifies with PowerShell 7")
        self.write("README.md", "x\n")
        self.assert_ok(self.finish("--verify", "test -f README.md && echo 'found it'"))
        self.assertIn("exit 0 — found it", self.journal())

    @unittest.skipUnless(shutil.which("pwsh"), "PowerShell 7 is not installed")
    def test_verify_runs_in_pwsh_when_that_is_the_shell(self):
        local_path = self.root / ".trellis/tiny/.runtime/local.json"
        local = json.loads(local_path.read_text(encoding="utf-8"))
        argv = [shutil.which("pwsh"), "-NoProfile", "-NonInteractive", "-Command"]
        local_path.write_text(json.dumps({**local, "shell": {"kind": "pwsh", "argv": argv}}),
                              encoding="utf-8")
        self.write("README.md", "x\n")
        self.assert_ok(self.finish("--verify", "Write-Output $PSVersionTable.PSVersion.Major"))
        self.assertRegex(self.journal(), r"exit 0 — ([7-9]|\d{2,})\n")


if __name__ == "__main__":
    unittest.main()
