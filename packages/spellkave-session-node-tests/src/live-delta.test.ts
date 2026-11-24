import { isManifestAlreadyApplied } from "@spellkave/session/node";
import { describe, expect, it } from "vitest";

describe("isManifestAlreadyApplied", () => {
	it("recognizes the stable server code and wrapped server prose", () => {
		expect(isManifestAlreadyApplied(new Error("MF-APPLY-012 manifest already applied"))).toBe(true);
		expect(isManifestAlreadyApplied("SenderError: manifest already applied")).toBe(true);
	});

	it("does not swallow other manifest or transport failures", () => {
		expect(isManifestAlreadyApplied(new Error("MF-APPLY-013 apply already draining"))).toBe(false);
		expect(isManifestAlreadyApplied(new Error("connection lost"))).toBe(false);
	});
});
