---
name: tt-bootstrap
description: Write the first project specs and the knowledge index from the repository itself. Started by the user, usually once after installing tiny-trellis.
---

# Bootstrap specs

The goal is a short set of specs describing conventions the code already follows, so later sessions don't have to rediscover them.

1. Survey the repository: the README and docs, the build and test commands, the directory layout, and a few representative files per area. Existing docs stay where they are; link to them rather than copying them.
2. Before writing, propose a list of spec files to the user: one per area with real conventions (for example error handling, testing, data access), each with two or three rules you observed. Wait for the user to confirm or trim the list.
3. Write each confirmed file with `tt-record`. Every rule must point to where the code follows it. A rule you could not find in the code is a proposal, so ask the user instead of writing it as fact.
4. Make `.trellis/spec/index.md` list every file, with one line on what it covers.
5. Run `finish --no-verify "specs only" --review self`, and tell the user what each file covers.

Keep each file to 15 rules or fewer, and move the details behind a rule into a research note in `.trellis/spec/research/`. A spec nobody reads costs context and protects nothing.
