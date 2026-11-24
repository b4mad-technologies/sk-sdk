import { describe, expect, it } from "vitest";

import {
	BINDING_HASH_LENGTH,
	canonicalBindingJson,
	canonicalizeBinding,
	hashBinding,
	type SessionBinding,
	webCryptoSha256Hex,
} from "../binding.ts";
import { bindingHash12, sha256HexNode } from "../node/paths.ts";

const base: SessionBinding = {
	url: "http://127.0.0.1:3000",
	db: "spellkave-dev",
	identity: "tok-abc",
	actorId: "hero-1",
};

describe("canonicalizeBinding", () => {
	it("folds localhost to 127.0.0.1, lowercases the host, and strips a trailing slash", () => {
		const canonical = canonicalizeBinding(base);
		const spelled = canonicalizeBinding({ ...base, url: "HTTP://LOCALHOST:3000/" });
		expect(spelled).toEqual(canonical);
	});

	it("trims db/identity/actorId but does not case-fold them (case-sensitive identifiers)", () => {
		const padded = canonicalizeBinding({
			...base,
			db: "  spellkave-dev  ",
			identity: " tok-abc ",
			actorId: " hero-1 ",
		});
		expect(padded).toEqual(canonicalizeBinding(base));

		const differentCase = canonicalizeBinding({ ...base, actorId: "HERO-1" });
		expect(differentCase.actorId).not.toBe(canonicalizeBinding(base).actorId);
	});

	it("keeps two databases on the same url distinct", () => {
		const a = canonicalizeBinding(base);
		const b = canonicalizeBinding({ ...base, db: "spellkave-other" });
		expect(a.db).not.toBe(b.db);
	});

	it("falls back to a best-effort string normalization for a non-URL host", () => {
		expect(canonicalizeBinding({ ...base, url: "127.0.0.1:3000/" }).url).toBe("127.0.0.1:3000");
	});
});

describe("hashBinding", () => {
	it("is stable across equivalent spellings of the same binding", async () => {
		const stable = await hashBinding(base);
		const spelled = await hashBinding({ ...base, url: "http://localhost:3000/" });
		expect(spelled).toBe(stable);
		expect(stable).toHaveLength(BINDING_HASH_LENGTH);
	});

	it("differs when url, db, identity, or actorId differ", async () => {
		const baseline = await hashBinding(base);
		await expect(hashBinding({ ...base, url: "http://127.0.0.1:4000" })).resolves.not.toBe(
			baseline,
		);
		await expect(hashBinding({ ...base, db: "other-db" })).resolves.not.toBe(baseline);
		await expect(hashBinding({ ...base, identity: "tok-xyz" })).resolves.not.toBe(baseline);
		await expect(hashBinding({ ...base, actorId: "hero-2" })).resolves.not.toBe(baseline);
	});

	it("hashes the canonical JSON through an injected hasher", async () => {
		let seen: string | undefined;
		const digest = await hashBinding(base, (input) => {
			seen = input;
			return "0".repeat(64);
		});
		expect(seen).toBe(canonicalBindingJson(base));
		expect(digest).toBe("0".repeat(BINDING_HASH_LENGTH));
	});
});

describe("node/paths hashing agrees with core's default hasher", () => {
	it("bindingHash12 (sync node:crypto) equals hashBinding's default (async WebCrypto)", async () => {
		expect(bindingHash12(base)).toBe(await hashBinding(base));
	});

	it("sha256HexNode and webCryptoSha256Hex agree on the same input", async () => {
		const input = canonicalBindingJson(base);
		expect(sha256HexNode(input)).toBe(await webCryptoSha256Hex(input));
	});
});
