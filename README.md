# Cloverleaf

An AI-first software development methodology and its machine-readable interoperability standard.

**Cloverleaf** is a two-track methodology (Discovery + Delivery) for teams where AI agents are the primary code authors and humans orchestrate, gate, and architect. The [Interoperability Standard](./standard/) makes Cloverleaf vendor-neutral: any tool can read, write, and verify Cloverleaf artifacts.

## Repository layout

- [`standard/`](./standard/) — the machine-readable specification: JSON Schemas, OpenAPI agent contracts, state machines, reference validators, and a conformance test pack. Published as `@cloverleaf/standard` on npm.
- [`reference-impl/`](./reference-impl/) — reference implementation of the methodology as Claude Code skills. Published as `@cloverleaf/reference-impl` on npm.
- [`site/`](./site/) — the methodology documentation site (Astro + MDX). Local-only during pre-publication.

## Quick start (Standard)

```bash
cd standard
npm install
npm test                                # unit-level schema + validator tests
npm run validate:examples               # full conformance runner
npm run validate:examples -- --level=1  # L1 (Producer) suite
npm run validate:examples -- --level=2  # L2 (Exchange) suite
npm run validate:examples -- --level=3  # L3 (Host) suite
```

## License

MIT — see [`LICENSE`](./LICENSE).
