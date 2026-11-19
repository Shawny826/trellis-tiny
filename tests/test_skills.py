"""The skills: their sources, and how init installs them for each platform."""
import re
import unittest

from support import SOURCE_ROOT, RepoTestCase

from ttlib.skills import USER_ONLY, skill_names

ASSETS = SOURCE_ROOT / "ttlib" / "assets"
FRONTMATTER = re.compile(r"\A---\n(.*?)\n---\n", re.S)
SKILL_MENTION = re.compile(r"`(tt-[a-z]+)`")
CLAUDE_DESCRIPTION_LIMIT = 1536


def frontmatter(text):
    match = FRONTMATTER.match(text)
    if match is None:
        raise AssertionError("no frontmatter on the first line")
    return dict(line.split(": ", 1) for line in match.group(1).splitlines())


class SkillSourceTest(unittest.TestCase):
    def test_every_source_names_itself_and_has_a_description(self):
        self.assertEqual(skill_names(), ["tt-bootstrap", "tt-clarify", "tt-digest", "tt-record",
                                         "tt-review", "tt-task"])
        for name in skill_names():
            fields = frontmatter((ASSETS / "skills" / name / "SKILL.md").read_text("utf-8"))
            self.assertEqual(set(fields), {"name", "description"}, name)
            self.assertEqual(fields["name"], name)
            self.assertLess(len(fields["description"]), CLAUDE_DESCRIPTION_LIMIT, name)

    def test_every_mentioned_skill_exists(self):
        texts = [(ASSETS / "agents-block.md").read_text("utf-8")]
        texts += [(ASSETS / "skills" / n / "SKILL.md").read_text("utf-8") for n in skill_names()]
        mentioned = {name for text in texts for name in SKILL_MENTION.findall(text)}
        self.assertTrue(mentioned)
        self.assertLessEqual(mentioned, set(skill_names()))

    def test_the_block_mentions_every_skill(self):
        block = (ASSETS / "agents-block.md").read_text("utf-8")
        self.assertEqual(set(SKILL_MENTION.findall(block)), set(skill_names()))


class SkillInstallTest(RepoTestCase):
    def test_claude_marks_user_only_skills(self):
        self.install("--claude")
        for name in skill_names():
            fields = frontmatter(self.read(f".claude/skills/{name}/SKILL.md"))
            if name in USER_ONLY:
                self.assertEqual(fields.get("disable-model-invocation"), "true", name)
            else:
                self.assertNotIn("disable-model-invocation", fields, name)
        self.assertFalse((self.root / ".agents").exists())

    def test_codex_marks_user_only_skills_with_a_policy_file(self):
        self.install("--codex")
        for name in skill_names():
            source = (ASSETS / "skills" / name / "SKILL.md").read_text("utf-8")
            self.assertEqual(self.read(f".agents/skills/{name}/SKILL.md"), source)
            policy = self.root / ".agents/skills" / name / "agents/openai.yaml"
            self.assertEqual(policy.is_file(), name in USER_ONLY, name)
        policy_text = self.read(".agents/skills/tt-digest/agents/openai.yaml")
        self.assertIn("allow_implicit_invocation: false", policy_text)
        self.assertFalse((self.root / ".claude").exists())


if __name__ == "__main__":
    unittest.main()
