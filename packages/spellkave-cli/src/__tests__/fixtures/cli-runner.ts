// AUTH-37 amortizes module/bindings loading, not live connections. Each message
// runs the production command dispatcher with its default connector and cleanup.
const { runCli } = await import("../../cli.ts");

process.on("message", async (request: { argv: string[]; credential: string }) => {
	process.env.SPELLKAVE_CONNECT_TOKEN = request.credential;
	const stdout: string[] = [];
	const stderr: string[] = [];
	try {
		const exit = await runCli(request.argv, {
			out: (line) => stdout.push(line),
			err: (line) => stderr.push(line),
		});
		process.send?.({ exit, stdout: stdout.join("\n"), stderr: stderr.join("\n") });
	} catch (error) {
		process.send?.({ error: error instanceof Error ? error.message : String(error) });
	}
});
process.send?.({ ready: true });

export {};
