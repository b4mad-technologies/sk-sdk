import { describe, expect, it } from "vitest";
import { describeExportError } from "../node-resource.ts";

describe("describeExportError", () => {
	it("keeps the reason a network failure gives, not only its class", () => {
		// The defect this exists to prevent (sk-jay0.6.15.56.21). Node's fetch
		// reports every network-level failure as `TypeError: fetch failed`, so a
		// reporter printing only `error.name` logged "TypeError" — which reads as
		// a code defect and is really a dropped connection. It cost a wrong
		// diagnosis in a bead before anyone read the reporter.
		const fetchFailure = new TypeError("fetch failed");
		expect(describeExportError(fetchFailure)).toBe("TypeError: fetch failed");
	});

	it("keeps the class, so a real code defect is still identifiable", () => {
		// The opposite failure: printing only `message` loses the distinction
		// between a transport fault and a genuine bug. Both halves earn their place.
		expect(describeExportError(new RangeError("index out of range"))).toBe(
			"RangeError: index out of range",
		);
	});

	it("falls back to the class alone when there is no message", () => {
		expect(describeExportError(new Error(""))).toBe("Error");
	});

	it("never throws on a non-Error rejection", () => {
		// Sinks must not throw into the emitting run, so the reporter cannot
		// either — and a rejected promise can carry anything at all.
		expect(describeExportError("just a string")).toBe("string");
		expect(describeExportError(undefined)).toBe("undefined");
		expect(describeExportError(null)).toBe("object");
	});

	it("names the network cause code of a fetch failure (sk-jay0.6.15.56.21)", () => {
		// undici sets `cause` to the socket-level error. Its code says whether
		// the connect timed out, the peer reset it, or DNS failed.
		const timeout = new TypeError("fetch failed", {
			cause: Object.assign(
				new Error("Connect Timeout Error (attempted address: telemetry.example:443)"),
				{
					code: "UND_ERR_CONNECT_TIMEOUT",
				},
			),
		});
		expect(describeExportError(timeout)).toBe("TypeError: fetch failed [UND_ERR_CONNECT_TIMEOUT]");
		const reset = new TypeError("fetch failed", {
			cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
		});
		expect(describeExportError(reset)).toBe("TypeError: fetch failed [ECONNRESET]");
	});

	it("never prints the cause message or a code that is not a bare token", () => {
		const leaky = new TypeError("fetch failed", {
			cause: Object.assign(new Error("connect to https://telemetry.example/v1/logs"), {
				code: "https://telemetry.example/v1/logs",
			}),
		});
		expect(describeExportError(leaky)).toBe("TypeError: fetch failed");
		expect(describeExportError(new TypeError("fetch failed", { cause: "ECONNRESET" }))).toBe(
			"TypeError: fetch failed",
		);
	});

	it("omits the stack, which would carry request URLs into the operator log", () => {
		const error = new TypeError("fetch failed");
		error.stack = "TypeError: fetch failed\n    at https://telemetry.example/v1/logs";
		expect(describeExportError(error)).not.toContain("telemetry.example");
	});
});
