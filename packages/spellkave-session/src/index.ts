// Isomorphic core: no `node:*` imports anywhere in this barrel's closure.
// Node-only lifecycle (sockets, spawn, credential/fs resolution) lives behind
// the `@spellkave/session/node` subpath — see `./node/index.ts`.

export * from "./acting-context";
export {
	BINDING_HASH_LENGTH,
	type CanonicalBinding,
	canonicalBindingJson,
	canonicalizeBinding,
	hashBinding,
	type SessionBinding,
	type Sha256Hex,
	webCryptoSha256Hex,
} from "./binding.ts";
export {
	type LiveSession,
	type OpenSessionDeps,
	OpenSessionTimeoutError,
	openSession,
	PLAY_CONNECT_PHASE_TIMEOUT_MS,
	SessionClosedError,
	type SessionPhase,
} from "./session.ts";
