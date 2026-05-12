# Contributing

Thanks for helping with Aurral.

## Picking work

- Start with an open issue that is not already assigned or actively in progress
- If there is no issue yet, open one first for anything non-trivial so the approach can be discussed before you build it
- Prefer focused changes over broad refactors unless the issue explicitly calls for a wider change

## Branching

- Branch from `main`
- Keep your branch narrow and descriptive
- Use one of these prefixes:
  - `feat/short-description`
  - `fix/short-description`
  - `hotfix/short-description`
  - `chore/short-description`
  - `refactor/short-description`

Examples:

- `feat/artist-merge-actions`
- `fix/request-history-pagination`
- `chore/update-healthcheck-tests`

Rules:

- Use kebab-case
- Keep names short
- If your branch starts with `hotfix/`, your commits should still use the `fix:` commit type

## Pull request flow

- Open your PR against `main`
- Do not open contributor PRs against `test`
- Maintainers use `test` as the prerelease branch for validation and feedback
- If we want to test your branch before merging to `main`, we will merge or replay it into `test` ourselves and leave review feedback on the `main` PR

What to expect:

- You open one PR to `main`
- Maintainers may test that work on `test`
- Feedback still happens on the `main` PR
- Once approved, the PR merges to `main`

## Commit messages

This repo uses commitlint plus semantic-release. Commit messages matter because they drive automated versioning.

Allowed commit types:

- `feat`
- `fix`
- `refactor`
- `chore`
- `docs`
- `ci`

Format:

```text
type(scope): short summary
```

Scope is optional:

```text
feat: add onboarding health check
fix(auth): reject expired bearer sessions
refactor(discovery): simplify provider cache namespaces
```

Rules enforced here:

- `type` must be one of the allowed values above
- `scope`, if present, must be kebab-case
- subject cannot be empty
- breaking changes must use `!` in the header and include a `BREAKING CHANGE:` footer when needed

Examples:

```text
feat(search): add album release filters
fix: prevent duplicate tag requests
docs: update docker quick start
ci: tighten release branch validation
feat(api)!: rename status response fields

BREAKING CHANGE: clients must read the new response fields.
```

## Husky behavior

The repo has a `commit-msg` hook that can normalize plain commit subjects based on your branch name.

Example:

- On branch `feat/global-search`, a plain commit like `add empty state` can be normalized to `feat: add empty state`

That hook is only a convenience layer. You should still write proper conventional commits yourself.

## Naming things

- Branch names: kebab-case with one of the approved prefixes
- Commit scopes: kebab-case
- Keep PR titles clear and specific
- Match the existing naming in the codebase instead of inventing new terminology for the same concept

## Before opening a PR

- Make sure the app still builds
- Run the relevant tests for your change
- Update or add tests when behavior changes
- Keep the PR description focused on the user-visible change and any review context we need

Typical local checks:

```bash
npm test
npm run build
cd frontend && npm run lint
```

CI behavior:

- PRs to `main` and `test` run the full validation suite
- Pushes to `main` and `test` run release automation only
- Docs-only changes may skip heavy CI and release workflows

## Merge strategy

- Prefer merge commits over squash or rebase when landing work that should preserve commit intent for release automation
- If a change is squashed, the final squashed commit message still needs to be a valid conventional commit

## Questions

If an issue is unclear, ask in the issue or PR before building too far in the wrong direction.
