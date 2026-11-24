import type { DbConnection } from "@spellkave/bindings";
export type DriverToken = NonNullable<
	Parameters<DbConnection["reducers"]["rMove"]>[0]["driverToken"]
>;

const DRIVER_REDUCERS = [
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
] as const;

/** Capture once with the decision. Dispatch never reads the current generation. */
export function freezeDriverReducers<T extends object>(reducers: T, observed?: DriverToken): T {
	if (observed === undefined) return reducers;
	const token = Object.freeze({ ...observed });
	const result = { ...reducers } as Record<string, unknown>;
	for (const name of DRIVER_REDUCERS) {
		const reducer = (reducers as Record<string, unknown>)[name];
		if (typeof reducer !== "function") continue;
		result[name] = (args: Record<string, unknown>) => reducer({ ...args, driverToken: token });
	}
	const batch = (reducers as Record<string, unknown>).rAdvanceTurns;
	if (typeof batch === "function")
		result.rAdvanceTurns = (args: Record<string, unknown>) =>
			batch({ ...args, driverTokens: [token] });
	const open = (reducers as Record<string, unknown>).rSessionOpen;
	if (typeof open === "function")
		result.rSessionOpen = (args: Record<string, unknown>) =>
			open({ ...args, driverTokens: [token] });
	return result as T;
}

export type ControlReducerPort = Pick<
	DbConnection["reducers"],
	| "rOfferControl"
	| "rWithdrawControl"
	| "rTakeNpcControl"
	| "rReturnNpcControl"
	| "rPrepareSteeredActor"
	| "rMove"
	| "rManipulate"
	| "rSense"
>;
