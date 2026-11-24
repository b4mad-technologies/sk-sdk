// #1921 browser-wasm regression fix (#1968): browser counterpart of
// `./observation-tokens.ts` — see that file's header for the full root-cause
// explanation. Resolved automatically (via this package's "browser" export
// condition on `./observation-tokens`) by any bundler building for a browser
// target (Vite's default client-build resolve conditions include "browser");
// Node hosts (shared tool runtime's own tests, `world-explorer`, CLIs) keep
// resolving `./observation-tokens.ts` unchanged.
//
// Sources the SAME Rust single-source-of-truth token list
// (`spellkave_validate::OBSERVATION_PLACEHOLDER_TOKENS`) through the
// wasm-bindgen `--target web` sibling build (`spellkave-validate-wasm-web`,
// already vendored and already used by `./browser.ts`) instead of the
// `--target nodejs` one: its loader fetches the .wasm binary lazily on first
// call (`init()`), never at module-import time, so merely importing this
// file — even when bundled into `apps/world-play` — is inert until the
// function below is actually invoked.
import initValidateWasm, { observation_placeholder_tokens_json } from "@spellkave/validate-wasm/browser";

let wasmReady: Promise<void> | null = null;

function ensureWasm(): Promise<void> {
	if (wasmReady === null) {
		wasmReady = initValidateWasm().then(() => undefined);
	}
	return wasmReady;
}

export async function observationPlaceholderTokens(): Promise<string[]> {
	await ensureWasm();
	return JSON.parse(observation_placeholder_tokens_json()) as string[];
}
