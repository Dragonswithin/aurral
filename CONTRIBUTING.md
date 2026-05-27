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
  - `feature/short-description`
  - `fix/short-description`
  - `hotfix/short-description`
  - `chore/short-description`
  - `refactor/short-description`
  - `docs/short-description`
  - `ci/short-description`

Examples:

- `feature/artist-merge-actions`
- `fix/request-history-pagination`
- `chore/update-healthcheck-tests`

Rules:

- Use kebab-case
- Keep names short

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

Commit messages no longer drive versioning or release automation.

Use clear, descriptive commit subjects. Conventional commits are fine if you prefer them, but they are not required for release correctness.

## Naming things

- Branch names: kebab-case with one of the approved prefixes
- Keep PR titles clear and specific
- Match the existing naming in the codebase instead of inventing new terminology for the same concept

PR title examples:

- `Add album sorting and refreshed search cards`
- `Refresh Soulseek shares during weekly flow updates`

## Before opening a PR

- Make sure the app still builds
- Run the relevant tests for your change
- Update or add tests when behavior changes
- Keep the PR description focused on the user-visible change and any review context we need

Typical local checks:

```bash
npm test
npm run build
npm run lint --workspace frontend
```

CI behavior:

- PRs to `main` and `test` run the full validation suite
- Pushes to `test` create prerelease tags and publish the `test` GHCR image after validation passes
- Pushes to `main` create stable tags, publish the `latest` GHCR image, and publish a GitHub Release after validation passes
- Versions and tags are CI-owned; you do not need to choose or create them manually
- Docs-only changes may skip heavy CI and release workflows

## Merge strategy

- Merge strategy is up to the maintainer. Release automation is branch-driven and does not depend on PR titles or commit message format.

## Questions

If an issue is unclear, ask in the issue or PR before building too far in the wrong direction.
