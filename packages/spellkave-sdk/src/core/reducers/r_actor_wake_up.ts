// Per-reducer wrapper for r_actor_wake_up — connect-path perception seeding.
//
// The server reducer is idempotent and emits no provenance (it seeds
// observer_knowledge for the actor's current node). There is therefore no
// terminal signal to observe: this wrapper is fire-and-confirm. It reports
// "submitted" once the reducer invocation resolves, or "rejected" if the
// invocation itself throws. Callers that need to confirm perception should read
// observer_knowledge / observer_place_knowledge afterwards.

import type { DbConnection } from "@spellkave/bindings";
import type { EntityRef } from "../ids";
import { actorEntityId } from "./transport";

type RActorWakeUpFn = DbConnection["reducers"]["rActorWakeUp"];

export interface ActorWakeUpResult {
	status: "submitted" | "rejected";
	actor_id: EntityRef;
	reason?: string;
}

export async function rActorWakeUpWrapper(
	actorId: EntityRef,
	rActorWakeUp: RActorWakeUpFn,
): Promise<ActorWakeUpResult> {
	try {
		await rActorWakeUp({ actorId: actorEntityId(actorId) });
		return { status: "submitted", actor_id: actorId };
	} catch (err) {
		return { status: "rejected", actor_id: actorId, reason: String(err) };
	}
}
