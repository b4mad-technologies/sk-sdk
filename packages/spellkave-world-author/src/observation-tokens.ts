// #1921 browser-wasm regression fix (#1968): Node/default counterpart of
// `./observation-tokens.browser.ts`.
//
// `@spellkave/tool-authoring`'s `observation.ts` used to import
// `observationPlaceholderTokens` straight from this package's DEFAULT entry
// (`./index.ts` -> `./reference.ts`), whose static import graph also reaches
// `./compose.ts`/`./row-kinds.ts`/`./patch.ts`/`./manifest.ts`/`./validate.ts`
// /`./inspect.ts` — every one of which imports the `spellkave-authoring-wasm`
// / `spellkave-validate-wasm` wasm-bindgen `--target nodejs` builds. Those
// builds' generated loaders do `require('fs').readFileSync(path.join(__dirname,
// ...))` at MODULE TOP LEVEL: harmless under Node, fatal the instant a
// browser bundle (`apps/world-play`) merely imports the module graph that
// reaches them, whether or not any wasm function is ever actually called.
//
// This file (resolved via this package's "default"/"types" condition on the
// `./observation-tokens` export) exists ONLY to give `observation.ts` a
// single ASYNC call shape shared with the browser build
// (`./observation-tokens.browser.ts`, resolved instead via the "browser"
// condition) — the underlying value and Rust source
// (`spellkave_validate::OBSERVATION_PLACEHOLDER_TOKENS`) are identical; this
// wrapper adds no behavior beyond `Promise`-wrapping the existing synchronous
// `./reference.ts` accessor.
import { observationPlaceholderTokens as observationPlaceholderTokensSync } from "./reference";

export async function observationPlaceholderTokens(): Promise<string[]> {
	return observationPlaceholderTokensSync();
}
