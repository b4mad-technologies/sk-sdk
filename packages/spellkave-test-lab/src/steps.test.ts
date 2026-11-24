import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	advanceSessionTurn,
	advanceTurn,
	castAction,
	manualTick,
	manualTicks,
	type TestWorld,
} from "./live";
import { agentStep } from "./patterns";
import {
	beginStepBudget,
	countedStep,
	endStepBudget,
	MAX_STEPS,
	StepBudgetError,
	stepCounts,
} from "./steps";

const dir = mkdtempSync(path.join(tmpdir(), "test-lab-steps-"));
const FINAL_FILE = path.join(dir, "final.local-node.test.ts");
const PARALLEL_FILE = path.join(dir, "parallel.local-node.test.ts");
writeFileSync(FINAL_FILE, "// live-phase: final\nimport {} from 'x';\n");
writeFileSync(PARALLEL_FILE, "import {} from 'x';\n");

function fakeWorld(sessions: unknown[] = [], driverControl: unknown[] = []) {
	const reducers = {
		manualTick: vi.fn(async () => {}),
		manualTicks: vi.fn(async () => {}),
		rManipulate: vi.fn(async () => {}),
		rAdvanceTurn: vi.fn(async () => {}),
	};
	const db = {
		visibleSession: { iter: () => sessions },
		visibleActorDriverControl: { iter: () => driverControl },
	};
	const world = {
		identity: "c0ffee",
		conn: { reducers },
		db: () => db,
		subscribeReaders: async () => {},
		disconnect: () => {},
	} as unknown as TestWorld;
	return { world, reducers };
}

afterEach(() => endStepBudget());

describe("step budget", () => {
	it("is off until a test begins a budget", async () => {
		const { world, reducers } = fakeWorld();
		for (let i = 0; i < MAX_STEPS + 5; i++) await manualTick(world);
		expect(reducers.manualTick).toHaveBeenCalledTimes(MAX_STEPS + 5);
		expect(stepCounts()).toEqual({});
	});

	it("resets per test", async () => {
		const { world } = fakeWorld();
		beginStepBudget("first", FINAL_FILE);
		await manualTick(world);
		await manualTick(world);
		expect(stepCounts()).toEqual({ manualTick: 2 });
		beginStepBudget("second", FINAL_FILE);
		expect(stepCounts()).toEqual({});
	});

	it("counts one castAction as one step although it ticks and acts inside", async () => {
		const { world, reducers } = fakeWorld();
		beginStepBudget("cast once", FINAL_FILE);
		await castAction(world, 1n, 2n, "core/attack");
		expect(stepCounts()).toEqual({ castAction: 1 });
		expect(reducers.manualTick).toHaveBeenCalledTimes(1);
		expect(reducers.rManipulate).toHaveBeenCalledTimes(1);
	});

	it("throws at the eleventh step before dispatch and names the test and kinds", async () => {
		const { world, reducers } = fakeWorld();
		beginStepBudget("eleven turns", FINAL_FILE);
		for (let i = 0; i < MAX_STEPS; i++) await advanceTurn(world);
		const eleventh = advanceTurn(world);
		await expect(eleventh).rejects.toBeInstanceOf(StepBudgetError);
		await expect(eleventh).rejects.toThrow(/"eleven turns".*advanceTurn=10/);
		expect(reducers.manualTick).toHaveBeenCalledTimes(MAX_STEPS);
	});

	it("checks a multi-tick call before it reaches the server", async () => {
		const { world, reducers } = fakeWorld();
		beginStepBudget("thirty-one ticks", FINAL_FILE);
		await expect(manualTicks(world, { ticks: 31 })).rejects.toThrow(/manualTicks would add 31/);
		expect(reducers.manualTicks).not.toHaveBeenCalled();
		await manualTicks(world, { ticks: 3 });
		expect(stepCounts()).toEqual({ manualTicks: 3 });
	});

	it("counts a pattern act that calls no helper as one step", async () => {
		beginStepBudget("plain act", FINAL_FILE);
		await countedStep("act", 1, async () => {});
		expect(stepCounts()).toEqual({ act: 1 });
	});

	it("counts the helpers inside a pattern act instead of the act", async () => {
		const { world } = fakeWorld();
		beginStepBudget("act with a cast", FINAL_FILE);
		await countedStep("act", 1, () => castAction(world, 1n, 2n, "core/attack"));
		expect(stepCounts()).toEqual({ castAction: 1 });
	});

	it("does not let a loop inside a pattern act escape the budget", async () => {
		const { world, reducers } = fakeWorld();
		beginStepBudget("loop in act", FINAL_FILE);
		const act = countedStep("act", 1, async () => {
			for (let i = 0; i < 50; i++) await manualTick(world);
		});
		await expect(act).rejects.toBeInstanceOf(StepBudgetError);
		expect(reducers.manualTick).toHaveBeenCalledTimes(MAX_STEPS);
	});

	it("counts two concurrent outermost steps separately", async () => {
		beginStepBudget("concurrent", FINAL_FILE);
		await Promise.all([
			countedStep("act", 1, async () => {}),
			countedStep("act", 1, async () => {}),
		]);
		expect(stepCounts()).toEqual({ act: 2 });
	});

	it("counts each agent step", async () => {
		beginStepBudget("agent", PARALLEL_FILE);
		const actor = { step: vi.fn(async () => {}) };
		await agentStep(actor, { steps: 3 });
		expect(actor.step).toHaveBeenCalledTimes(3);
		expect(stepCounts()).toEqual({ agentStep: 3 });
	});
});

describe("final phase", () => {
	it("accepts the same markers as the live-test-shared-db gate", async () => {
		const lifecycle = path.join(dir, "lifecycle.local-node.test.ts");
		writeFileSync(lifecycle, "// lifecycle-proof: the DB upgrade is the unit under test\n");
		const bare = path.join(dir, "bare-lifecycle.local-node.test.ts");
		writeFileSync(bare, "// lifecycle-proof:\n");
		const { world, reducers } = fakeWorld();
		beginStepBudget("lifecycle proof", lifecycle);
		await manualTick(world);
		expect(reducers.manualTick).toHaveBeenCalledTimes(1);
		beginStepBudget("lifecycle marker without reason", bare);
		await expect(manualTick(world)).rejects.toThrow(/live-phase: final/);
	});

	it("refuses a clock advance in a file without the marker", async () => {
		const { world, reducers } = fakeWorld();
		beginStepBudget("tick in parallel phase", PARALLEL_FILE);
		await expect(manualTick(world)).rejects.toThrow(/live-phase: final/);
		expect(reducers.manualTick).not.toHaveBeenCalled();
		expect(stepCounts()).toEqual({});
	});
});

describe("advanceSessionTurn", () => {
	const session = { sessionId: 7n, lifecycle: "active", currentActor: "42" };
	const control = {
		worldInstanceId: 1n,
		actorId: 9n,
		bodyEntityId: 42n,
		generation: 1n,
		tombstone: false,
	};

	it("refuses before dispatch when the caller does not control the outgoing actor", async () => {
		const { world, reducers } = fakeWorld([session], []);
		beginStepBudget("not my turn", FINAL_FILE);
		await expect(advanceSessionTurn(world, 7n)).rejects.toThrow(
			/does not control outgoing actor 42/,
		);
		expect(reducers.rAdvanceTurn).not.toHaveBeenCalled();
		expect(stepCounts()).toEqual({});
	});

	it("refuses before dispatch while the session awaits reactions", async () => {
		const { world, reducers } = fakeWorld(
			[{ ...session, lifecycle: "awaiting-reactions" }],
			[control],
		);
		beginStepBudget("reaction window", FINAL_FILE);
		await expect(advanceSessionTurn(world, 7n)).rejects.toThrow(/awaits reactions/);
		expect(reducers.rAdvanceTurn).not.toHaveBeenCalled();
	});

	it("dispatches with the captured driver token and counts one step", async () => {
		const { world, reducers } = fakeWorld([session], [control]);
		beginStepBudget("advance", FINAL_FILE);
		await advanceSessionTurn(world, 7n);
		expect(reducers.rAdvanceTurn).toHaveBeenCalledWith({
			sessionId: 7n,
			driverToken: expect.objectContaining({ bodyEntityId: 42n }),
		});
		expect(stepCounts()).toEqual({ advanceSessionTurn: 1 });
	});
});
