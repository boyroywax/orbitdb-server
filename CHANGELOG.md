# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added
- Config-gated Pinto v1 libp2p sync handler registration for `/pinto/v1.0.0/sync`.
- `pintoSync` configuration block:
  - `enabled`
  - `eventsDb`
  - `instance`
- Sync event feed wiring from OrbitDB events store for NDJSON sync responses.

### Fixed
- Runtime stability regression by reverting explicit Helia FS store overrides and restoring stable startup behavior with persisted mounted data.
- DID import and route typing hardening for more reliable TypeScript builds.

### Changed
- README expanded with Pinto sync stream behavior and configuration docs.
- `.gitignore` updated to ignore runtime state directories.

## [2026-05-22]

### Commits
- `4653404` feat(sync): wire Pinto v1 libp2p sync handler behind config
- `a6a0422` fix(types): stabilize DID imports and route typings
- `3899765` fix(runtime): revert helia fs store override for stable startup
