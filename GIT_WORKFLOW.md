# Website Git Workflow

## Worktrees

- `/Users/diego/Desktop/Ego/site-release` is the clean release checkout on `main`.
- `/Users/diego/Desktop/Ego/public_html` is the frozen mixed-work checkout on `wip/site-polish-2026-07-21`. Do not publish from it.
- `/Users/diego/Desktop/Ego/site-homepage` is the homepage checkout on `wip/homepage`.

Additional local topic branches preserve the remaining projects without mixing them into a release:

- `wip/periodic-table`
- `wip/youtube-transcripts`
- `wip/harmonizer`
- `wip/solstice`
- `wip/page-polish`

## Publishing

1. Work and test on a focused topic branch or worktree.
2. Review `git status --short` and `git diff --stat` before staging.
3. Stage named files or directories. Do not use `git add -A` in this repository.
4. Commit the focused change on its topic branch.
5. Integrate the reviewed commit into `main` from `site-release`.
6. Verify the exact `main` diff and generated website locally.
7. Push `main` only after the release contents are confirmed.

Never force-push `main`. Keeping `main` clean and deployable is more important than making every worktree clean.

## Recovery

The pre-cleanup repository, tracked changes, untracked files, and status reports are preserved at:

`/Users/diego/Desktop/Ego/git-rescue/2026-07-21-public-html`

That directory contains a complete Git bundle plus independent tracked and untracked working-tree backups. It is intentionally private because the untracked archive contains `.htpasswd`.

## Generated And Private Files

The repository ignores credentials, runtime SQLite data, Python bytecode, unpublished audio preview files, and generated word-alignment reader JSON. Public release assets such as final MP3 files must still be staged explicitly.
