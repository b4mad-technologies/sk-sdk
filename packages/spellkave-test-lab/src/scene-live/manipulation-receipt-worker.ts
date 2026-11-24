// Separate real transport connection; parent releases both calls only after both are ready.
import { type ActorManipulateResult, createActorClient } from "@spellkave/sdk";
import { connectTestWorld, syncConnection } from "../live";

type Options = {
	url: string;
	db: string;
	token: string;
	body: string;
	target: string;
	action: string;
	participants: string[];
};
process.once("message", async (options: Options) => {
	let world: Awaited<ReturnType<typeof connectTestWorld>> | undefined;
	try {
		world = await connectTestWorld({ ...options, connectedActorId: options.body });
		await syncConnection(world);
		let sent: object | undefined;
		const contexts: { id: string; own: boolean }[] = [];
		world.conn.db.visibleEvaluationProvenance.onInsert((ctx, row) => {
			if (ctx.event.tag === "Reducer" && ctx.event.value.reducer.name === "r_manipulate") {
				const eventArgs = ctx.event.value.reducer.args as { args?: object };
				contexts.push({ id: row.provenanceId, own: eventArgs.args === sent });
			}
		});
		const conn = world.conn;
		const client = createActorClient(conn, options.body, {
			successOnProvenance: true,
			rManipulate: async (args) => {
				sent = args.args;
				// Baseline and receipt listener are installed before this transport barrier.
				process.send?.({ kind: "ready" });
				await new Promise<void>((resolve) => process.once("message", () => resolve()));
				await conn.reducers.rManipulate(args);
			},
		});
		const result: ActorManipulateResult<null> = await client.manipulate(
			options.target,
			options.action,
			JSON.stringify({ participant_entity_ids: options.participants }),
			() => false,
			() => null,
		);
		process.send?.({
			kind: "result",
			status: result.status,
			provenance: result.provenance?.id,
			contexts,
		});
	} catch (error) {
		process.send?.({ kind: "error", error: String(error) });
		process.exitCode = 1;
	} finally {
		world?.disconnect();
		process.disconnect?.();
	}
});
