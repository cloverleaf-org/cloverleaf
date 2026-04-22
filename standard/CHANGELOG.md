# Changelog

All notable changes to the Cloverleaf Interoperability Standard are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/spec/v2.0.0.html), with the pre-1.0 policy that MINOR releases may include breaking changes.

## [0.4.1] — 2026-04-21

### Added
- Compiled output at `dist/` — `dist/validators/index.js` + `.d.ts`. Package now ships runtime JS so downstream consumers don't need `tsx` to `import '@cloverleaf/standard/validators/index.js'`.
- `exports` map in package.json pointing at compiled output for `.`, `./validators`, `./validators/*.js`. Raw JSON/YAML paths (schemas, agent-contracts, state-machines) still exposed for direct reads.

### Changed
- `prepublishOnly` now runs `npm run build` in addition to tests + validate:examples.

### Compatibility
- Additive. Consumers don't need to change import paths; node's exports resolution redirects `@cloverleaf/standard/validators/index.js` to `./dist/validators/index.js` transparently.

## [0.4.0] — 2026-04-21

### Added
- `finding.attachments`: optional array of `{ label, path }` objects for artifact paths accompanying a finding (screenshots, reports). Paths are repoRoot-relative.
- `finding.metadata`: optional free-form object for source-specific structured data (e.g., axe rule metadata, viewport aggregations, diff ratios).

### Compatibility
- Additive only. Feedback documents valid under 0.3.1 remain valid under 0.4.0.

## [0.3.1] — 2026-04-20

### Added

- `isSpecificLevel(arg): arg is Level` type guard in `conformance/level-map.ts`.
- `conformance/tests/by-level/_helpers.ts` with shared sidecar-reading and fixture-walking helpers.
- `conformance/tests/by-level/_helpers.test.ts` covers the new helpers directly.

### Changed

- `conformance/runner.ts` replaces `as Level` casts with `isSpecificLevel(arg)` narrowing. No behavioral change.
- `conformance/tests/by-level/l{1,2,3}.test.ts` import helpers from `_helpers.ts` instead of duplicating logic locally. No behavioral change to test outcomes.

### Dependencies

- Unchanged.

## [0.3.0] — 2026-04-20

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
