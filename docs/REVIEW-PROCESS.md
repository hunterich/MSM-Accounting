# How changes get reviewed and merged (SEC-08)

Almost all code in this repository is written by AI coding agents, and the owner
approves pull requests without reading code. These three safeguards replace a
human code reviewer. Background: SEC-08 in [AUDIT-2026-11-26.md](AUDIT-2026-11-26.md).

| Safeguard | What it does | Who sets it up |
| --- | --- | --- |
| 1. Branch protection on `main` | Nothing can be merged until the automated tests pass on the latest code. | Repository admin, once (steps below) |
| 2. Plain-language AI review | Every pull request gets a comment that says, in business terms, what changes, what could go wrong, and whether to merge. | Repository admin adds one secret, once |
| 3. Pull request template | Every pull request says whether it touches money; if it does, the finance reviewer signs off. | Already in place (`.github/pull_request_template.md`) |

## 1. Turn on branch protection (about 2 minutes)

On GitHub, open the repository, then **Settings → Rules → Rulesets → New ruleset →
New branch ruleset**. Button names can shift slightly over time; the classic
alternative is **Settings → Branches → Add branch protection rule**.

- **Ruleset name:** `Protect main` · **Enforcement status:** Active
- **Bypass list:** leave empty, so the rules apply to everyone, including admins.
- **Target branches:** Add target → *Include default branch*.
- Tick **Restrict deletions** and **Block force pushes**.
- Tick **Require a pull request before merging**, with **Required approvals: 0**.
  Pull requests are opened under the owner's own GitHub account, and GitHub does
  not let the author approve their own pull request, so 1 would block every merge.
- Tick **Require status checks to pass**, then:
  - tick **Require branches to be up to date before merging**. Two pull requests that
    each pass on their own can still break together. On 2026-11-27, #278 and #279
    reached `main` minutes apart and had never been tested together. This setting
    makes the second one re-test against the first before it can merge.
  - **Add checks**, and choose these three (they appear once they have run at least once):
    - `Lint, Type-check & Test`
    - `Integration tests (real database)`
    - `End-to-end tests (real UI + API)`

  Leave `Dependency security audit` visible but **not required**: CI deliberately
  lets it fail on a published advisory that has no fix yet (see `ci.yml`). Leave the
  plain-language review **not required** too, so an API outage never blocks a merge.
- **Create**.

After this, a pull request with a red or still-running check shows a disabled merge
button. That is the point: wait for green.

## 2. Turn on the plain-language review

The workflow is `.github/workflows/claude-review.yml`. Until it has a key, it skips
with a notice and never fails. Add **one** repository secret under **Settings →
Secrets and variables → Actions → New repository secret**:

- `ANTHROPIC_API_KEY`: an API key from console.anthropic.com (pay per use), **or**
- `CLAUDE_CODE_OAUTH_TOKEN`: run `claude setup-token` in a terminal with a
  Claude Pro or Max plan and paste the result.

Never paste the key into a chat, an issue or a file in the repository.

The review only runs for authors with write access, ignores bots, and skips pull
requests from forks, so strangers cannot trigger it on this public repository.
It can read the code and post comments. It cannot push, approve or merge.

## 3. Before you merge: the owner's checklist

1. **All required checks are green** (branch protection enforces this).
2. **Read the review comment's verdict.** ✅ means safe once checks pass. ⚠️ means ask
   the agent to fix the listed risks first. ❌ means do not merge; ask why.
3. **"Needs finance sign-off: Yes"** (in the review or the template): the finance
   reviewer approves the accounting behaviour before you merge.
4. **"After merging"** steps in the description: note them for the next deployment.

If the review and the pull request description disagree, trust neither: ask the
agent to explain the difference before merging.
