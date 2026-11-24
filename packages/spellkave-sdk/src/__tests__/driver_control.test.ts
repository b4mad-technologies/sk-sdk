/** Client-side capture only; production server admission is proven live. */
import { describe, expect, it } from "vitest";
import { type DriverToken, freezeDriverReducers } from "../core/driver_control";
import {
	captureDriverToken,
	readControlContinuationRefusals,
	readControlContinuations,
	readControlTransitions,
	readSteeringEvents,
} from "../core/readers/driver_control";
import { snapshotDbFromFixture } from "../index";

describe("frozen driver decision transport", () => {
	it("every direct Service mutation carries the original world, body and generation", () => {
		const original: DriverToken = {
			worldInstanceId: "world",
			actorId: 7n,
			bodyEntityId: 9n,
			generation: 2n,
		};
		const sent: Record<string, unknown>[] = [];
		const names = [
			"rAdvanceTurn",
			"mtAdvanceCompoundIntent",
			"commitPendingResolution",
			"arbitrationRequestCreate",
			"arbitrationAnswerSubmit",
			"rMove",
			"rManipulate",
			"rSense",
			"rInscribeTrace",
			"rReact",
			"rReleaseClaim",
			"rActorWakeUp",
			"rSessionClose",
			"rSessionMove",
		];
		const reducers = Object.fromEntries(
			names.map((name) => [name, (args: Record<string, unknown>) => sent.push(args)]),
		);
		const frozen = freezeDriverReducers(reducers, original);
		original.generation = 99n;
		for (const name of names) frozen[name]?.({ driverToken: original });
		expect(sent).toHaveLength(names.length);
		for (const args of sent)
			expect(args.driverToken).toEqual({
				worldInstanceId: "world",
				actorId: 7n,
				bodyEntityId: 9n,
				generation: 2n,
			});
		expect(Object.isFrozen(sent[0]?.driverToken)).toBe(true);
	});
	it("captures from the perception snapshot and reads all private authorized projections", () => {
		const row = {
			worldInstanceId: "world",
			actorId: 7n,
			bodyEntityId: 9n,
			generation: 2n,
			held: false,
			tombstone: false,
		};
		const db = snapshotDbFromFixture({
			visible_actor_driver_control: [row],
			visible_actor_control_transition: [{ actorId: 7n }],
			visible_control_continuation: [{ workRef: "work" }],
			visible_control_continuation_refusal: [{ workRef: "work" }],
			visible_event_steering: [{ eventId: 1n }],
		});
		const captured = captureDriverToken(db, 9n);
		row.generation = 99n;
		expect(captured?.generation).toBe(2n);
		expect(readControlTransitions(db)).toHaveLength(1);
		expect(readControlContinuations(db)).toHaveLength(1);
		expect(readControlContinuationRefusals(db)).toHaveLength(1);
		expect(readSteeringEvents(db)).toHaveLength(1);
	});
});
