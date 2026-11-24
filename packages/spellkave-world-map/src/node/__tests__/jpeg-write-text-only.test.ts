// The story job re-renders maps on runners without ffmpeg and then checks
// `git diff --quiet`. With SPELLKAVE_MAP_JPEG_TEXT_ONLY=1 the JPEG writer must
// touch nothing (no JPEG, no provenance sidecar), because the hash itself is
// host-dependent and a rewritten sidecar would be reported as drift. Needs a
// temp directory only; never shells out to ffmpeg. Bead: sk-zgbj.
// keep-file(K5): the contract with the story re-record job, which this suite does not drive
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { writeJpegWithChurnGuard } from "../jpeg-write.ts";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>';
const JPEG_BYTES = "not-really-a-jpeg";

/** Stand in for a committed artifact: bytes on disk plus a sidecar naming them. */
function seedCommittedArtifact(dir: string, name: string, hash: string): void {
	writeFileSync(join(dir, `${name}.jpg`), JPEG_BYTES);
	writeFileSync(join(dir, "provenance.json"), `${JSON.stringify({ [`${name}.jpg`]: hash })}\n`);
}

function readRaw(dir: string, file: string): string {
	return readFileSync(join(dir, file), "utf8");
}

function freshDir(): string {
	return mkdtempSync(join(tmpdir(), "jpeg-write-text-only-"));
}

describe("writeJpegWithChurnGuard — text-only mode (sk-zgbj)", () => {
	const previous = process.env.SPELLKAVE_MAP_JPEG_TEXT_ONLY;

	afterEach(() => {
		if (previous === undefined) delete process.env.SPELLKAVE_MAP_JPEG_TEXT_ONLY;
		else process.env.SPELLKAVE_MAP_JPEG_TEXT_ONLY = previous;
	});

	it("writes NOTHING when the recorded hash does not match — not the JPEG, not the sidecar", async () => {
		process.env.SPELLKAVE_MAP_JPEG_TEXT_ONLY = "1";
		const dir = freshDir();
		seedCommittedArtifact(dir, "map", "a-hash-this-host-will-never-reproduce");
		const sidecarBefore = readRaw(dir, "provenance.json");

		const result = await writeJpegWithChurnGuard(dir, "map", SVG, 64);

		expect(result.written).toBe(false);
		expect(readRaw(dir, "map.jpg")).toBe(JPEG_BYTES);
		// The regression this file exists for: a rewritten sidecar is a diff the
		// story job's `git diff --quiet` would report as drift on every runner.
		expect(readRaw(dir, "provenance.json")).toBe(sidecarBefore);
	});

	it("is idempotent — a second text-only pass still changes nothing", async () => {
		process.env.SPELLKAVE_MAP_JPEG_TEXT_ONLY = "1";
		const dir = freshDir();
		seedCommittedArtifact(dir, "map", "a-hash-this-host-will-never-reproduce");
		const sidecarBefore = readRaw(dir, "provenance.json");

		await writeJpegWithChurnGuard(dir, "map", SVG, 64);
		await writeJpegWithChurnGuard(dir, "map", SVG, 64);

		expect(readRaw(dir, "provenance.json")).toBe(sidecarBefore);
		expect(readRaw(dir, "map.jpg")).toBe(JPEG_BYTES);
	});

	it("still reports the path it would have written, so callers can keep linking to it", async () => {
		process.env.SPELLKAVE_MAP_JPEG_TEXT_ONLY = "1";
		const dir = freshDir();
		seedCommittedArtifact(dir, "chapter-07", "stale");

		const result = await writeJpegWithChurnGuard(dir, "chapter-07", SVG, 64);

		expect(result.path).toBe(join(dir, "chapter-07.jpg"));
	});

	it("is opt-in: with the flag unset the ordinary bootstrap skip still records provenance", async () => {
		delete process.env.SPELLKAVE_MAP_JPEG_TEXT_ONLY;
		const dir = freshDir();
		// No sidecar at all + an existing binary = `canSkipRewrite`'s bootstrap
		// branch, which trusts what is on disk. It never reaches ffmpeg, so this
		// case is safe to assert here — and it shows the difference: outside
		// text-only, the tail write DOES persist a sidecar entry.
		writeFileSync(join(dir, "map.jpg"), JPEG_BYTES);

		const result = await writeJpegWithChurnGuard(dir, "map", SVG, 64);

		expect(result.written).toBe(false);
		expect(JSON.parse(readRaw(dir, "provenance.json"))).toHaveProperty("map.jpg");
	});
});
