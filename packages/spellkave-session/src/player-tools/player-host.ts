import { createActorClient, type SpellkaveSession, snapshotDb } from "@spellkave/sdk";
import type { SpellkaveToolContext } from "@spellkave/tool-player";
import { createActingContextSelector } from "../acting-context.ts";
import type { ActiveConnection, ConnectionController } from "../node/connection-controller.ts";
import { createWorldEventFeed, type WorldEventFeed } from "./world-events.ts";

export interface PlayerHost {
	context: SpellkaveToolContext;
	actingContext(): ReturnType<typeof createActingContextSelector>;
	worldEvents: WorldEventFeed;
	requireActive(): ActiveConnection;
	dispose(): void;
}

/** Connection-following ports shared by PLAYER hosts; the caller binds the canonical definitions. */
export function createPlayerHost(
	controller: ConnectionController,
	options: { boundCharacter?: boolean } = {},
): PlayerHost {
	let replyLifetime = new AbortController();
	const unsubscribe = controller.onDisconnected(() => {
		replyLifetime.abort(new Error("Spellkave connection closed"));
		replyLifetime = new AbortController();
	});
	const requireActive = () => {
		const active = controller.active();
		if (!active) throw new Error("Spellkave is not connected.");
		return active;
	};
	let selectingSession: SpellkaveSession | undefined;
	let selector: ReturnType<typeof createActingContextSelector> | undefined;
	const actingContext = () => {
		const session = requireActive().session as SpellkaveSession;
		if (session !== selectingSession) {
			selectingSession = session;
			selector = createActingContextSelector(session, {
				boundBodyId: options.boundCharacter ? requireActive().actor : undefined,
			});
		}
		if (!selector) throw new Error("acting_context_unavailable");
		return selector;
	};
	const worldEvents = createWorldEventFeed({
		active: () => controller.active()?.session.worldEvents,
	});
	const actingBody = () => {
		if (!options.boundCharacter) return actingContext().resolve().bodyId;
		const body = requireActive().actor;
		if (
			!actingContext()
				.read()
				.some((choice) => choice.kind === "character" && choice.bodyId === body)
		)
			throw new Error("acting_context_unavailable");
		return body;
	};
	const context = {
		db: () => snapshotDb(requireActive().session as SpellkaveSession),
		get controlReducers() {
			return (requireActive().session as SpellkaveSession).conn.reducers;
		},
		act: {
			actorId: () => actingBody(),
			actorClient: () =>
				createActorClient(requireActive().session as SpellkaveSession, actingBody(), {
					successOnProvenance: true,
				}),
		},
		worldEvents: {
			builder: worldEvents.builder,
			get replySignal() {
				return replyLifetime.signal;
			},
			estimator: () => controller.active()?.session.estimator,
			onUpdate: (notify: () => void) => {
				const subscribe = requireActive().onUpdate;
				if (!subscribe) throw new Error("Active connection has no cache-update subscription");
				return subscribe(notify);
			},
		},
	};
	return {
		context,
		actingContext,
		worldEvents,
		requireActive,
		dispose() {
			unsubscribe();
			replyLifetime.abort();
		},
	};
}
