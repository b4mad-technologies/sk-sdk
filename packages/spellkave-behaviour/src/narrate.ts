// Domain-free glue between Gherkin (QuickPickle) and Allure: tags become
// labels, and every step shows up as an Allure step named after its Gherkin
// sentence, prefixed with its keyword. Gherkin data tables are attached to
// their step.
//
// Tags: @persona:<slug> -> epic; Feature -> feature (the goal); Scenario ->
// story; a scenario inside `Rule:` -> layer=rule + rule=<text>, otherwise
// layer=intent; @code:<path>:<symbol> -> label code (the guide links it);
// @planned -> skipped, labels kept.
import * as allure from "allure-js-commons";
import { Before, Given as QpGiven, Then as QpThen, When as QpWhen } from "quickpickle";

export type NarratedWorld = {
	info: { feature: string; scenario: string; tags: string[]; step?: string };
	context: { task: { suite?: { name: string } }; skip: () => void };
};

Before(async (world: NarratedWorld) => {
	const persona = world.info.tags.find((t) => t.startsWith("@persona:"));
	if (persona) {
		const name = persona.slice("@persona:".length).replace(/-/g, " ");
		await allure.epic(name.replace(/^./, (c) => c.toUpperCase()));
	}
	await allure.feature(world.info.feature.replace(/^Feature:\s*/, ""));
	await allure.story(world.info.scenario);
	// QuickPickle does not fill info.rule; the enclosing Vitest suite is the Rule block.
	const rule = world.context.task.suite?.name.match(/^Rule:\s*(.*)/)?.[1];
	await allure.layer(rule ? "rule" : "intent");
	if (rule) await allure.label("rule", rule);
	for (const tag of world.info.tags) {
		if (tag.startsWith("@code:")) await allure.label("code", tag.slice("@code:".length));
	}
	// QuickPickle's own @todo skips this hook, so the report would lose the
	// labels above; skip here instead.
	if (world.info.tags.includes("@planned")) {
		await allure.tag("planned");
		world.context.skip();
	}
});

type Body<W, A extends unknown[]> = (world: W, ...args: A) => unknown;

function register(keyword: string, define: typeof QpGiven) {
	return <W extends NarratedWorld, A extends unknown[]>(expression: string, body: Body<W, A>) =>
		define(expression, (world: W, ...args: A) =>
			allure.step(`${keyword} ${world.info.step ?? expression}`, async () => {
				for (const arg of args) {
					if (arg && typeof (arg as { raw?: unknown }).raw === "function") {
						const rows = (arg as { raw: () => string[][] }).raw();
						const text = rows.map((cells) => `| ${cells.join(" | ")} |`).join("\n");
						await allure.attachment("table", text, "text/plain");
					}
				}
				await body(world, ...args);
			}),
		);
}

// Capitalised on purpose: a module exporting `then` is a thenable, and
// `await import()` of it never settles.
export const Given = register("Given", QpGiven);
export const When = register("When", QpWhen);
export const Then = register("Then", QpThen);
