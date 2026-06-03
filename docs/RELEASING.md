# Releasing durabl

## Release channel (v0.1.0)

**Shipped today:** version tags (`v*`) produce a downloadable **`npm pack` tarball**
via GitHub Actions. That is the supported install path for end users.

**Not shipped in v0.1.0:** `npm install durabl` from [npmjs.org](https://www.npmjs.com)
— no registry publish, no `NPM_TOKEN`. A future npm publish is a separate decision
(documented in forward planning only).

| Audience | Install | Doc |
|----------|---------|-----|
| End user / operator | `npm install /path/to/durabl-0.1.0.tgz` | [Install from a tarball](#install-from-a-tarball) below |
| Contributor | `git clone https://github.com/asklokesh/durabl.git` + `npm install` + `npm run build` | [README](../README.md#install), [QUICKSTART.md](./QUICKSTART.md) |

This project ships release tarballs via GitHub Actions when you push a version tag.
No npm registry publish step and no publish secrets are required.

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
npm run build && npm pack --dry-run
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

## What this workflow does not do

- Does not publish to npmjs.org (no `NPM_TOKEN` or registry credentials)
- Does not create GitHub Releases automatically (artifact only)
- Does not run the full adversarial gate suite (run `npm run gate:all` locally first)

## Related

- First run after install: [QUICKSTART.md](./QUICKSTART.md)
- Production deploy (bind, keys, backup): [OPERATOR.md](./OPERATOR.md)
- Maintainer gate cadence: [DEVELOPMENT.md](./DEVELOPMENT.md#gates)
