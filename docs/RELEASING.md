# Releasing durabl

## Release channels (dual-channel, v0.1.0)

**Channel A — GitHub tarball (always):** version tags (`v*`) produce a downloadable
`npm pack` artifact via GitHub Actions. Use this when npmjs.org is unavailable or
you need the exact CI-built bits.

**Channel B — npmjs.org (when published):** `npm install durabl@0.1.0` after a
maintainer runs [Publish to npmjs.org](#publish-to-npmjsorg). Verify with
`npm view durabl version`. Until that publish succeeds, Channel B is **not**
available — do not tell users to `npm install durabl` without checking.

| Audience | Install | Doc |
|----------|---------|-----|
| End user (registry) | `npm install durabl@0.1.0` | [Publish to npmjs.org](#publish-to-npmjsorg) — only after `npm view` shows the version |
| End user (tarball) | `npm install /path/to/durabl-0.1.0.tgz` | [Install from a tarball](#install-from-a-tarball), CI artifact `npm-pack-v*` |
| Contributor | `git clone` + `npm install` + `npm run build` | [README](../README.md#install), [QUICKSTART.md](./QUICKSTART.md) |

### v0.1 operator install (pick one channel)

**Tarball (Channel A):**

1. Push or find tag `v0.1.0` (see [Cut a release](#cut-a-release)).
2. GitHub Actions run for that tag → artifact `npm-pack-v0.1.0`.
3. `npm install -g /path/to/durabl-0.1.0.tgz` (or project-local without `-g`).

**Registry (Channel B):**

1. Confirm `npm view durabl version` prints `0.1.0` (or your target).
2. `npm install durabl@0.1.0` (or `npm install -g durabl@0.1.0`).

Then `durabl --help` and [QUICKSTART.md](./QUICKSTART.md).

Tag pushes still produce tarball artifacts; registry publish is a separate maintainer
step and does not require committing any token to the repo.

## Tag format

Use annotated semver tags prefixed with `v`:

```text
v0.1.0
v0.2.0-rc.1
```

The workflow triggers on any tag matching `v*`.

## Pre-release checks

Fast gate before tagging:

```bash
bash scripts/verify-release.sh
npm run verify:npm-pack    # build + npm pack --dry-run + contents check
```

Before a milestone merge or public release, run the full gate suite locally:

```bash
npm run gate:all
```

Update `version` in `package.json` on `main` (or your release branch) so the packed
tarball matches the tag you intend to ship.

## Cut a release

```bash
git checkout main
git pull
npm install
bash scripts/verify-release.sh

# Bump version in package.json, commit, then tag:
git tag -a v0.1.0 -m "durabl v0.1.0"
git push origin main
git push origin v0.1.0
```

Pushing the tag starts the [Release workflow](../.github/workflows/release.yml).

## CI artifact

The workflow:

1. Checks out the tagged commit
2. Runs `npm ci`, `npm run typecheck`, and `npm run build`
3. Runs `npm pack` to produce `durabl-<version>.tgz`
4. Uploads the tarball as a workflow artifact named `npm-pack-<tag>`

Download the artifact from the GitHub Actions run for that tag. Retention is 90 days.

## Install from a tarball

```bash
npm install /path/to/durabl-0.1.0.tgz
durabl --help
```

Or link globally for local smoke:

```bash
npm install -g /path/to/durabl-0.1.0.tgz
```

## Publish to npmjs.org

**Never commit** `NPM_TOKEN`, `.npmrc` with tokens, or OTP secrets. Use environment
variables or CI secret stores only.

### Prerequisites

```bash
npm run verify:npm-pack
bash scripts/verify-release.sh
# optional before a public cut:
npm run gate:all
```

`package.json` must not set `"private": true` (publishable package). `publishConfig.access`
is `public` (unscoped name `durabl`).

### Authenticate

One of:

- **Env (CI / local):** export `NPM_TOKEN` to an npm automation or granular publish
  token for the `durabl` package, then:
  ```bash
  npm config set //registry.npmjs.org/:_authToken "${NPM_TOKEN}"
  ```
- **Interactive:** `npm login` and confirm `npm whoami` succeeds.

### Dry-run and publish

```bash
npm run build
npm publish --dry-run
npm publish --access public   # first publish of public unscoped package
```

Pin the version in `package.json` (e.g. `0.1.0`) before publishing; bump semver on
`main` in a separate commit from doc-only release prep.

### Verify after publish

```bash
npm view durabl
npm view durabl version
```

Update [README](../README.md#install) if the registry channel is live.

### Current blocker (maintainer machine)

If `NPM_TOKEN` is unset and `npm whoami` returns **401 Unauthorized**, registry
publish cannot proceed. Document status in [docs/TODOS.md](./TODOS.md) until a
maintainer publishes with a valid token.

## What the GitHub tag workflow does not do

- Does not publish to npmjs.org (no `NPM_TOKEN` in Actions for v0.1.0)
- Does not create GitHub Releases automatically (artifact only)
- Does not run the full adversarial gate suite (run `npm run gate:all` locally first)

## Related

- First run after install: [QUICKSTART.md](./QUICKSTART.md)
- Production deploy (bind, keys, backup): [OPERATOR.md](./OPERATOR.md)
- Maintainer gate cadence: [DEVELOPMENT.md](./DEVELOPMENT.md#gates)
