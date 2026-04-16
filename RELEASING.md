# Releasing @centient packages

This document describes the release process for packages in this monorepo.
It exists to prevent a repeat of the 0.4.0 publish snag where the version
bump landed in a feature PR, causing `make publish` to fail mid-flow.

## The happy path

```
1. Land feature PRs on main (each PR includes a .changeset/*.md file)
2. From a clean main:
   make publish
3. Done — packages are on npm, tags are on GitHub.
```

`make publish` runs: `build → check → changeset version → commit (if needed) → changeset publish → push + tags`.

## Rules

### Feature PRs include changesets, NOT version bumps

A feature PR should contain:

- The code changes
- A `.changeset/<name>.md` file describing the change and the bump level
- Tests

A feature PR should **NOT** contain:

- Manually edited `package.json` version fields
- `CHANGELOG.md` updates
- The output of `pnpm changeset version`

The `make publish` target owns the version bump. If a feature PR consumes
its own changeset before `make publish` runs, the publish target's
`changeset version` step becomes a no-op and (prior to the idempotency
fix in PR #19) the subsequent `git commit` would fail, aborting the
entire release. The idempotency fix makes this survivable, but the
correct flow is still: changesets in the PR, version bump in `make publish`.

### One `make publish` per release batch

All pending changesets are consumed together in a single `make publish`
run. This produces one version bump per affected package, one CHANGELOG
entry per package, and one npm publish per package. Do not run `make
publish` multiple times for the same set of changesets.

### npm 2FA

`make publish` will prompt for an OTP if the npm account has 2FA enabled
for publish operations (which it should). Have your authenticator ready.

If the OTP prompt fails or times out, run the remaining steps manually:

```bash
pnpm changeset publish --otp=<code>
git push origin main --tags
```

### Recovery from a failed publish

If `make publish` fails partway through:

1. Check `git status` — are there uncommitted version-bump changes?
   - Yes → commit them: `git add -A && git commit -m "chore: version packages"`
   - No → version bump either already committed or was a no-op
2. Check npm: `npm view @centient/<pkg> version` — did the publish succeed?
   - Yes → just push tags: `git push origin main --tags`
   - No → re-run: `pnpm changeset publish` (add `--otp=<code>` if prompted)
3. Push: `git push origin main --tags`

### Pre-publish checklist

Before running `make publish`:

- [ ] You are on `main`, up to date with `origin/main`
- [ ] Working tree is clean (`git status` shows nothing)
- [ ] All pending changesets are the ones you want to release
- [ ] You are logged in to npm as the correct user (`npm whoami`)
- [ ] You have your 2FA authenticator available
- [ ] `pnpm build && pnpm test && pnpm lint` all pass (make publish does this, but catching failures early is faster)

## Versioning policy

- **0.x packages** (pre-1.0): minor bumps may include breaking changes.
  This is standard semver for 0.x — consumers should pin `^0.x.0` and
  read the CHANGELOG on each update.
- **1.x+ packages**: standard semver. Breaking changes require a major bump.

All version bumps go through changesets. Never edit `package.json`
version fields manually.

## CLAUDE.md package table

After a release, the `CLAUDE.md` package table should be updated to
reflect the new version(s). Run `make claudemd-check` to detect drift.
If it reports a mismatch, update `CLAUDE.md` and open a small docs PR.

This is not automated in the release flow because `CLAUDE.md` is a
human-curated document with descriptions that may need updating alongside
the version number.
