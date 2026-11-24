#!/usr/bin/env tsx
// Daemon process launcher — `spawn.ts`'s default `ensureDaemon` spawn target.
// Mirrors `packages/spellkave-cli/bin/sk.js`'s shape: a thin launcher whose
// one job is running the real (TypeScript) entry point.
await import("../src/node/daemon-entry.ts");
