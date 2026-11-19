"""`tt install` / `tt uninstall`, and the launchers at the top of the checkout."""
import shutil
import subprocess
import sys
import unittest

from support import SOURCE_ROOT, SOURCE_SCRIPT, make_temp_dir, remove_temp_tree

from ttlib import __version__
from ttlib.launcher import MARKER

WINDOWS = sys.platform == "win32"
BASH = shutil.which("bash")


def run(*args, cwd=None):
    return subprocess.run(list(args), cwd=cwd, capture_output=True, text=True, encoding="utf-8",
                          errors="replace")


class LauncherTest(unittest.TestCase):
    def setUp(self):
        self.bin = make_temp_dir()
        self.addCleanup(remove_temp_tree, self.bin)

    def tt(self, *args):
        return run(sys.executable, str(SOURCE_SCRIPT), *args, "--bin-dir", str(self.bin))

    def assert_ok(self, completed):
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)

    def test_install_writes_launchers_that_run_this_checkout(self):
        self.assert_ok(self.tt("install"))
        names = {"tt", "tt.cmd"} if WINDOWS else {"tt"}
        self.assertEqual({path.name for path in self.bin.iterdir()}, names)
        for name in names:
            text = (self.bin / name).read_text(encoding="utf-8")
            self.assertIn(MARKER, text)
            self.assertIn(SOURCE_SCRIPT.as_posix() if name == "tt" else str(SOURCE_SCRIPT), text)

    @unittest.skipUnless(WINDOWS, "tt.cmd is written on Windows only")
    def test_installed_cmd_launcher_runs(self):
        self.assert_ok(self.tt("install"))
        completed = run("cmd", "/c", str(self.bin / "tt.cmd"), "--version")
        self.assert_ok(completed)
        self.assertEqual(completed.stdout.strip(), f"tiny-trellis {__version__}")

    @unittest.skipUnless(BASH, "bash is not installed")
    def test_installed_shell_launcher_runs(self):
        self.assert_ok(self.tt("install"))
        completed = run(BASH, (self.bin / "tt").as_posix(), "--version")
        self.assert_ok(completed)
        self.assertEqual(completed.stdout.strip(), f"tiny-trellis {__version__}")

    def test_reinstall_replaces_its_own_launchers(self):
        self.assert_ok(self.tt("install"))
        self.assert_ok(self.tt("install"))

    def test_someone_elses_tt_is_left_alone(self):
        (self.bin / "tt").write_text("#!/bin/sh\necho another tool\n", encoding="utf-8")
        completed = self.tt("install")
        self.assertEqual(completed.returncode, 1)
        self.assertIn("was not written by `tt install`", completed.stderr)
        self.assertEqual((self.bin / "tt").read_text(encoding="utf-8"),
                         "#!/bin/sh\necho another tool\n")
        self.assert_ok(self.tt("uninstall"))
        self.assertTrue((self.bin / "tt").exists())

    def test_uninstall_removes_only_its_launchers(self):
        self.assert_ok(self.tt("install"))
        (self.bin / "other.txt").write_text("keep\n", encoding="utf-8")
        self.assert_ok(self.tt("uninstall"))
        self.assertEqual([path.name for path in self.bin.iterdir()], ["other.txt"])

    def test_python_option_rejects_a_non_interpreter(self):
        completed = self.tt("install", "--python", sys.executable + "-missing")
        self.assertNotEqual(completed.returncode, 0)
        self.assertEqual(list(self.bin.iterdir()), [])


class CheckoutLauncherTest(unittest.TestCase):
    """The launchers at the top of a fresh checkout, used before `tt install`."""

    @unittest.skipUnless(WINDOWS, "tt.cmd is for Windows")
    def test_cmd_launcher_finds_python(self):
        completed = run("cmd", "/c", ".\\tt.cmd", "--version", cwd=SOURCE_ROOT)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stdout.strip(), f"tiny-trellis {__version__}")

    @unittest.skipUnless(BASH, "bash is not installed")
    def test_shell_launcher_finds_python(self):
        completed = run(BASH, "./tt", "--version", cwd=SOURCE_ROOT)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stdout.strip(), f"tiny-trellis {__version__}")

    def test_cmd_launcher_uses_crlf(self):
        self.assertNotIn(b"\n", (SOURCE_ROOT / "tt.cmd").read_bytes().replace(b"\r\n", b""))


if __name__ == "__main__":
    unittest.main()
