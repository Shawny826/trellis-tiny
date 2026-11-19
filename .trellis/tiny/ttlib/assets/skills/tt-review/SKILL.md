---
name: tt-review
description: Get an independent review of a high-risk change (public interface, data migration, security, bulk deletion), or whenever the user asks for one. Dispatches the tiny_trellis_reviewer subagent and acts on its findings.
---

# Independent review

A reviewer that has not seen how the change was made catches what the author's reasoning hides. Give it the result, not the reasoning.

1. Make sure the change is complete and its verify command passes.
2. Spawn the `tiny_trellis_reviewer` subagent with exactly three things:
   - Goal: one or two sentences.
   - Acceptance criteria: the list from the task file, or the one you stated to the user.
   - Change range: a commit range such as `abc123..HEAD`, or a file list. Say whether uncommitted changes are included.
   Leave out your plan, your reasoning, and your opinion of the change.
3. Read the reply: a verdict, each criterion with evidence, findings marked `confirmed` or `judgment`, and what it did not check.
   - Fix confirmed findings. Check judgment findings yourself, then fix them or tell the user why you did not.
   - "cannot review" means the input was incomplete. Supply what it names and dispatch again.
4. If the review made you change code, rerun the verify command. Dispatch the reviewer again only after fixing a high finding.
5. Run `finish ... --review independent`, and tell the user which findings you left unfixed and why.

Where no subagent can be spawned, review the diff yourself against the same three inputs, tell the user it was a self-check, and use `--review self`.
