/**
 * Print one AuthKit access token for the loop machine user (stdout only).
 * Seed comes from a provisioned machine-user.seed.json; the rotated
 * refresh token is written only to the host runtime file (ADR-0124 D-7).
 */
import { mintMachineAccessToken } from "../refresh-auth.ts";

const player = process.argv[2]?.trim() || process.env.SPELLKAVE_SIM_NAME?.trim() || "sim1";

try {
	const result = await mintMachineAccessToken({
		player,
		...(process.env.SPELLKAVE_MACHINE_SEED_FILE?.trim()
			? { seedPath: process.env.SPELLKAVE_MACHINE_SEED_FILE.trim() }
			: {}),
		...(process.env.SPELLKAVE_MACHINE_RUNTIME_FILE?.trim()
			? { runtimePath: process.env.SPELLKAVE_MACHINE_RUNTIME_FILE.trim() }
			: {}),
	});
	process.stdout.write(`${result.accessToken}\n`);
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`authkit-refresh-token: ${message}\n`);
	process.exit(1);
}
