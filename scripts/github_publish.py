#!/usr/bin/env python3
"""Read/write-isolated GitHub publish helper for /publish-pr (wf-004).

This is the **only** place GitHub (`gh`) and `git push` logic lives. The
`/publish-pr` command orchestrates it (passes a branch, title, and body) and
never embeds `git`/`gh` invocation logic itself — keeping the command thin and
this integration isolated, testable, and swappable. This mirrors the ADR-005
pattern used by `scripts/clickup_intake.py`. Decision record: ADR-007.

Behaviour:
  - Prechecks `gh` BEFORE any mutation: it must be installed (GH-1) and
    authenticated (GH-2). If either fails, NOTHING is committed/pushed and no PR
    is created — it exits non-zero with a coded error (AC-9).
  - SINGLE GIT DELIVERY BOUNDARY (wf-005 / ADR-008, PB-8): stages and creates the
    one publishable commit on the branch when the working tree has uncommitted
    changes, BEFORE any push. On a ticket branch those changes are exactly the
    implementation + `_specs/<slug>/` artifacts + closure update (PB-9). If the
    tree is already clean, no commit is made (idempotent).
  - Pushes the given branch to `origin` (AC-1).
  - Creates a Pull Request via `gh` (AC-2). Idempotent: if a PR for the branch
    already exists, returns its URL instead of creating a duplicate.
  - GitHub is a delivery surface only: no workflow state is read from GitHub; no
    merge, no auto-merge, no branch deletion, no status/comment sync (ADR-007).
  - On success: prints {"pr_url": "..."} as JSON to stdout, exit 0.
  - On failure: prints a GH-coded error to stderr and exits non-zero, having made
    no partial change beyond what is reported.

Usage:
    python scripts/github_publish.py --branch <branch> --title <title> \
        --body-file <path> [--base <base-branch>] [--commit-message <msg>]
"""
import argparse
import json
import shutil
import subprocess
import sys


def _run(cmd: list) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True)


def _precheck_gh() -> None:
    """gh must exist and be authenticated BEFORE any push/PR (AC-9)."""
    if shutil.which("gh") is None:
        raise SystemExit("GH-1 ERROR: GitHub CLI (gh) is not installed or not on PATH")
    auth = _run(["gh", "auth", "status"])
    if auth.returncode != 0:
        raise SystemExit("GH-2 ERROR: GitHub CLI is not authenticated (`gh auth status` failed)")


def _existing_pr_url(branch: str) -> str:
    """Return the URL of an open PR for `branch`, or "" if none (idempotency)."""
    result = _run(["gh", "pr", "list", "--head", branch, "--state", "open",
                   "--json", "url", "--jq", ".[0].url // empty"])
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


def _prepare_commit(message: str) -> bool:
    """Single git delivery boundary (PB-8): stage and commit the working-tree
    changes as the one publishable commit. Returns True if a commit was created,
    False if the tree was already clean (nothing to publish-commit). On a ticket
    branch the staged changes are exactly the ticket's work (PB-9)."""
    status = _run(["git", "status", "--porcelain"])
    if status.returncode != 0:
        raise SystemExit(f"GH-5 ERROR: failed to read git status: {status.stderr.strip()}")
    if not status.stdout.strip():
        return False  # already clean — the branch already holds the work
    add = _run(["git", "add", "-A"])
    if add.returncode != 0:
        raise SystemExit(f"GH-6 ERROR: failed to stage changes: {add.stderr.strip()}")
    commit = _run(["git", "commit", "-m", message])
    if commit.returncode != 0:
        raise SystemExit(f"GH-7 ERROR: failed to create publishable commit: {commit.stderr.strip()}")
    return True


def publish(branch: str, title: str, body_file: str, base: str, commit_message: str) -> dict:
    _precheck_gh()

    # Single git delivery boundary: stage + create the publishable commit (PB-8)
    # BEFORE any push, so the full publishable set (implementation + artifacts +
    # closure) is captured exactly once.
    committed = _prepare_commit(commit_message)

    push = _run(["git", "push", "-u", "origin", branch])
    if push.returncode != 0:
        raise SystemExit(f"GH-3 ERROR: failed to push '{branch}' to origin: {push.stderr.strip()}")

    # Idempotency: if a PR already exists for this branch, reuse it instead of
    # opening a duplicate (the push above still delivered any new commit).
    existing = _existing_pr_url(branch)
    if existing:
        return {"pr_url": existing, "created": False, "committed": committed}

    create = _run(["gh", "pr", "create", "--base", base, "--head", branch,
                   "--title", title, "--body-file", body_file])
    if create.returncode != 0:
        raise SystemExit(f"GH-4 ERROR: failed to create PR for '{branch}': {create.stderr.strip()}")

    return {"pr_url": create.stdout.strip(), "created": True, "committed": committed}


def main(argv) -> int:
    parser = argparse.ArgumentParser(description="Publish a ticket branch as a GitHub PR.")
    parser.add_argument("--branch", required=True, help="branch to push and open a PR for")
    parser.add_argument("--title", required=True, help="PR title (generated from artifacts)")
    parser.add_argument("--body-file", required=True, help="path to a file holding the PR body")
    parser.add_argument("--base", default="main", help="base branch for the PR (default: main)")
    parser.add_argument("--commit-message", default=None,
                        help="message for the single publishable commit (default: 'Publish <branch>')")
    args = parser.parse_args(argv[1:])

    commit_message = args.commit_message or f"Publish {args.branch}"
    result = publish(args.branch, args.title, args.body_file, args.base, commit_message)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
