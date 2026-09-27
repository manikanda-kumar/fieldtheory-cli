import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("collectors", Path(__file__).resolve().parents[1] / "scripts/sync-mac-collectors.py")
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "collector"
        self.remote = Path(self.temp.name) / "remote.git"
        self.root.mkdir()
        self.cmd("git", "init", "--bare", str(self.remote))
        self.cmd("git", "init", "-b", "main", str(self.root))
        self.g("config", "user.email", "test@example.invalid")
        self.g("config", "user.name", "Test")
        self.g("config", "core.excludesFile", "/dev/null")
        self.g("commit", "--allow-empty", "-m", "baseline")
        self.g("remote", "add", "origin", str(self.remote))
        self.g("push", "origin", "main")
        self.main = self.g("rev-parse", "HEAD")
        self.g("checkout", "-b", "mac-collectors")
        self.g("push", "-u", "origin", "mac-collectors")

    def cmd(self, *args):
        return subprocess.check_output(args, stderr=subprocess.DEVNULL, text=True).strip()

    def g(self, *args):
        return self.cmd("git", "-C", str(self.root), *args)

    def write(self, name, text="snapshot\n"):
        p = self.root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)

    def test_publish_only_collector_branch(self):
        self.write("bookmarks/projects/projects.jsonl", '{"repo":"example"}\n')
        self.write("library/projects/example.md", "# Example\n")
        collector.publish(self.root)
        self.assertEqual(self.cmd("git", "--git-dir", str(self.remote), "rev-parse", "main"), self.main)
        self.assertNotEqual(self.g("rev-parse", "HEAD"), self.main)
        self.assertEqual(self.g("status", "--porcelain"), "")

    def test_reject_database_or_digest_output_without_staging(self):
        for name in ["bookmarks/bookmarks.db", "library/daily/2026-09-28.md", ".env"]:
            with self.subTest(name=name):
                self.write(name)
                with self.assertRaisesRegex(RuntimeError, "Non-project"):
                    collector.publish(self.root)
                self.assertEqual(self.g("diff", "--cached", "--name-only"), "")
                (self.root / name).unlink()

    def test_reject_main_and_existing_staged_edits(self):
        self.g("checkout", "main")
        with self.assertRaisesRegex(RuntimeError, "another branch"):
            collector.publish(self.root)
        self.g("checkout", "mac-collectors")
        self.write("library/projects/example.md")
        self.g("add", ".")
        with self.assertRaisesRegex(RuntimeError, "staged"):
            collector.publish(self.root)

    def test_remote_race_preserves_local_snapshot(self):
        other = self.g("commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "other writer")
        self.g("push", "origin", f"{other}:mac-collectors")
        self.write("library/projects/example.md", "# Retain this snapshot\n")
        with self.assertRaises(subprocess.CalledProcessError):
            collector.publish(self.root)
        self.assertEqual(self.g("ls-remote", "origin", "refs/heads/mac-collectors").split()[0], other)
        self.assertEqual((self.root / "library/projects/example.md").read_text(), "# Retain this snapshot\n")
        self.assertNotEqual(self.g("rev-parse", "HEAD"), self.main)

    def test_checkout_guards(self):
        collector.validate_checkout(self.root, Path(self.temp.name) / "canonical")
        with self.assertRaisesRegex(RuntimeError, "must not be canonical"):
            collector.validate_checkout(self.root, self.root)
        self.write("bookmarks/bookmarks.db")
        with self.assertRaisesRegex(RuntimeError, "no canonical database"):
            collector.validate_checkout(self.root, Path(self.temp.name) / "canonical")

    def test_path_allowlist(self):
        for p in ["bookmarks/projects/meta.json", "library/projects-active.md", "library/projects/a.md"]:
            self.assertTrue(collector.allowed_path(p), p)
        for p in ["library/projects/nested/a.md", "bookmarks/projects/cookies.json", "library/projects/../daily/a.md"]:
            self.assertFalse(collector.allowed_path(p), p)


if __name__ == "__main__":
    unittest.main()
