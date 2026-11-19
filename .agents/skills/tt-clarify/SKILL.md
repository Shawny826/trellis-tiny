---
name: tt-clarify
description: Settle an ambiguous request before implementing. Use when the request leaves a choice only the user can make (scope, behavior, trade-offs) or its acceptance criteria are unclear.
---

# Clarify the request

The goal is a request precise enough that two people would build the same thing, written down where the next session can find it.

1. Settle what you can yourself first: read the code, `.trellis/spec/index.md`, and the specs that apply. Don't ask the user what the repository already answers.
2. List the questions that remain, and keep only those whose answer changes what you would build.
3. Ask one question at a time, the most consequential first. Offer two or three concrete options with your recommendation and its reason, so the user can answer in a word.
4. Ask a new question when an answer opens one. Once the remaining questions would not change the result, stop asking and state your assumptions instead.
5. Write the result down:
   - For cross-session work, put the goal and acceptance criteria in the task file (see `tt-task`) and the answers under Decisions.
   - Otherwise restate the goal and acceptance criteria to the user in two or three lines before you start.
6. If an answer is a rule that later work must follow, also record it with `tt-record`.

Each acceptance criterion must be checkable by a command, a test, or an observable behavior. "Works well" is not one.
