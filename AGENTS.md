# trellis-tiny

This repository is trellis-tiny: a lightweight project workflow for Claude Code and Codex, written in Python with only the standard library. It replaced an earlier TypeScript implementation, the `tiny/` npm package, which has been removed.

## Start here

- `docs/design.md` is the design record. Section 8 lists confirmed decisions and section 9 the open questions. Read the relevant sections before changing behavior, and update the document when a design decision changes.
- `README.md` explains installation and use.
- Run the tests before and after a change: `python -m unittest discover -s tests`. They run `tt.py` end to end against throwaway Git repositories.

## Layout

- `ttlib/` is the implementation. `ttlib/assets/` holds what `tt init` installs into a project: the AGENTS.md managed block, the six `tt-*` skills, the reviewer subagent, and the templates.
- `tests/` holds the test suite.
- `tt`, `tt.cmd`, and `tt.py` are the launchers and the entry point. `./tt install` puts the `tt` command on PATH.
- `docs/zh/` holds Chinese reading copies of the managed block, the skills, and the reviewer. When you change the English source in `ttlib/assets/`, update the matching copy.

## Conventions

- Runtime code uses only the Python standard library and must run on Python 3.9.
- `tt` keeps LF line endings and `tt.cmd` keeps CRLF, as `.gitattributes` enforces; a launcher with the wrong endings does not run.
- Don't push to the remote. The user pushes, and a push to `main` runs CI.

## Left over from the TypeScript era

`.trellis/`, `.agents/`, `.codex/`, and `.zcode/` hold this repository's own workflow from before the rewrite. Their workflow, specs, and tasks describe the removed `tiny/` package and do not apply to the Python code. In Codex, the `trellis-*` skills in `.agents/skills/` and any Trellis workflow state that a hook adds to your context come from that old workflow; don't follow them.
