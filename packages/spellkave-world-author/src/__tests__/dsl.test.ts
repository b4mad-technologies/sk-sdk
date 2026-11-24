import { describe, expect, it } from "vitest";
import { dsl } from "../dsl";

describe("dsl tagged template", () => {
	it("returns the same text as a plain template", () => {
		const id = "srd/ac";
		expect(dsl`actor.stat('${id}')`).toBe(`actor.stat('${id}')`);
		expect(dsl`1 == 1`).toBe("1 == 1");
	});
});
