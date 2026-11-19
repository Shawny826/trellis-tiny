---
name: tt-record
description: Record project knowledge in .trellis/spec/. Use when the user confirms a decision that later work must follow, when a fix teaches a lesson worth keeping (a root cause, a trap to avoid), or when an earlier rule is replaced.
---

# Record knowledge

Specs say what is true now. The reasoning and the history stay findable, but out of the way.

1. Find where it belongs: read `.trellis/spec/index.md`, and prefer the file that already covers the topic over a new one.
2. Write the rule so it can be checked against code: the condition, what must happen, and the reason in one sentence. Add a short example when the rule is easy to misread.
3. Update in place. When a new rule replaces an old one, change the old text instead of appending a second, conflicting rule. When a whole file is replaced, make the old file's first line `> Superseded by [new file](new file) on YYYY-MM-DD.` and leave the rest as it was, so a search can tell current files from replaced ones.
4. Keep the evidence when it matters. Rejected options and their reasons, or the investigation behind a lesson, go in a research note in `.trellis/spec/research/`, and the rule links to it. Research notes are evidence, not rules: they are not listed in `index.md`.
5. For a new rule file, add one line to `index.md`: `- [file](file) — what it covers and when it applies`.
6. Name the files you changed in the `finish` reason.

For a lesson from a fix, record the root cause and the check that would have caught it, not the story of the debugging. If a script could check it, suggest a project check to the user, and add one only if they agree.

Don't record typo fixes, what the code already makes obvious, or ideas the user has not confirmed.
