// keep-file(K1): Git's byte-framed batch protocol must reject incomplete historical evidence.
import { describe, expect, it } from "vitest";
import { gitBatchInput, parseGitBatch } from "../git-batch";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const decode = (bytes: Uint8Array) => decoder.decode(bytes);
const oid = "a".repeat(40);
const body = "évidence\nwith a newline";
const framed = encoder.encode(`${oid} blob ${encoder.encode(body).length}\n${body}\n`);

describe("Git batch framing", () => {
	it("counts bytes for Unicode and embedded newlines, with missing paths explicit", () => {
		const missing = encoder.encode("base:absent missing\n");
		const output = new Uint8Array(framed.length + missing.length);
		output.set(framed);
		output.set(missing, framed.length);
		expect([...parseGitBatch(["base:present", "base:absent"], output, decode)]).toEqual([
			["base:present", body],
			["base:absent", null],
		]);
		expect(gitBatchInput(["base:present", "base:absent"])).toBe("base:present\nbase:absent\n");
	});
	it("fails closed for every truncated byte of a complete batch response", () => {
		for (let size = 0; size < framed.length; size += 1) {
			expect(() => parseGitBatch(["base:present"], framed.subarray(0, size), decode)).toThrow();
		}
	});
	it("rejects invalid headers, wrong missing names, delimiters, extra output and request injection", () => {
		for (const output of [
			`${oid} tree 0\n\n`,
			`${oid} blob 99999999999999999\n`,
			"other:absent missing\n",
			`${oid} blob 1\na!`,
			`${oid} blob 1\na\nextra`,
		])
			expect(() => parseGitBatch(["base:present"], encoder.encode(output), decode)).toThrow();
		expect(() => gitBatchInput(["base:injected\nHEAD:private"])).toThrow("unsafe Git batch");
	});
});
