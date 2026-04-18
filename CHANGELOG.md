# Changelog

All notable changes to the Cloverleaf Interoperability Standard are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/spec/v2.0.0.html), with the pre-1.0 policy that MINOR releases may include breaking changes.

## [Unreleased]

## [0.3.0] — 2026-04-XX

### Added

- Conformance levels: L1 Producer, L2 Exchange, L3 Host. Every schema, validator, agent contract, state machine, and scenario is assigned to a level via `conformance/level-map.ts`.
- `--level=<1|2|3|all>` flag on the conformance runner (`npm run validate:examples -- --level=2`).
- Per-example `.meta.json` sidecars declaring which level(s) each fixture targets.
- Per-level Vitest suites: `conformance/tests/by-level/l1.test.ts`, `l2.test.ts`, `l3.test.ts`.
- `standard/docs/conformance.md` rewritten around the three-level model.
- `standard/docs/versioning.md` section on levels and SemVer.
- GitHub Actions workflow `.github/workflows/standard.yml` running tests + filtered conformance on Node 20 and 22.
- npm package metadata: `publishConfig`, `files`, `prepublishOnly`, `repository`, `homepage`, `bugs`, `license`, `keywords`.
- Repo-root `README.md`, `CHANGELOG.md`, `LICENSE` (MIT).

### Changed

- `@cloverleaf/standard` bumped to `0.3.0`.
- `standard/README.md` adds Conformance and Publish sections.

## [0.2.0] — 2026-04-17

- First tracked release in this changelog. See `docs/superpowers/specs/2026-04-17-cloverleaf-standard-v0.2-design.md` for content.
