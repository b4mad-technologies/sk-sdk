// Steps every JSONL command-line tool shares: how it answers, not what it
// does. A package registers them once, naming its tool, next to its own steps.

import { expect } from "vitest";

import { type Run, records } from "./cli.ts";
import { type NarratedWorld, Then } from "./narrate.ts";

export interface ContractStepOptions<W extends NarratedWorld> {
	/** The tool as the sentences name it: "sk", "skgate". */
	readonly tool: string;
	/** The run the scenario's last When made. */
	readonly lastRun: (world: W) => Run;
}

export function contractSteps<W extends NarratedWorld>({ tool, lastRun }: ContractStepOptions<W>) {
	const why = (run: Run) => `${run.stdout}\n${run.stderr}`;

	Then(`${tool} succeeds`, (world: W) => {
		expect(lastRun(world).exit, why(lastRun(world))).toBe(0);
	});

	Then(`${tool} exits with {int}`, (world: W, code: number) => {
		expect(lastRun(world).exit, why(lastRun(world))).toBe(code);
	});

	Then("stdout is JSONL and its last record has kind {string}", (world: W, kind: string) => {
		const lines = lastRun(world)
			.stdout.split("\n")
			.filter((line) => line.trim());
		expect(lines.length).toBeGreaterThan(0);
		for (const line of lines) expect(JSON.parse(line)).toHaveProperty("kind");
		expect(records(lastRun(world)).at(-1)?.kind).toBe(kind);
	});

	Then("stdout is empty and stderr carries the help", (world: W) => {
		expect(lastRun(world).stdout.trim()).toBe("");
		expect(lastRun(world).stderr).toMatch(/^(Usage|Commands):/m);
	});
	Then("stderr is empty and stdout carries the help", (world: W) => {
		expect(lastRun(world).stderr.trim()).toBe("");
		expect(lastRun(world).stdout).toMatch(/^(Usage|Commands):/m);
	});
}
