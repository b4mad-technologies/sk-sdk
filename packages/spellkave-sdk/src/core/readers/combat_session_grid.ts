import type {
	PlaceEdgeAffordanceRow,
	PlaceEdgeRow,
	PlaceGraphDefinitionRow,
	PlaceNodeRow,
} from "../../binding_rows";
import { asNumber, asString } from "./_helpers";
import type { CombatMove, CombatRosterEntry, CombatSessionView } from "./combat_session_types";

export function gridForSession(
	sessionId: bigint,
	heroId: string,
	graphs: PlaceGraphDefinitionRow[],
	nodes: PlaceNodeRow[],
	edges: PlaceEdgeRow[],
	edgeAffordances: PlaceEdgeAffordanceRow[],
	roster: CombatRosterEntry[],
	positions: Map<string, string>,
): CombatSessionView["grid"] {
	const graphId = `session_grid_${sessionId.toString()}`;
	const graph = graphs.find(
		(row) => row.placeGraphId === graphId && Boolean(row.isEphemeralInstance),
	);
	if (!graph) return null;
	const cells = nodes
		.filter((node) => node.placeGraphId === graphId)
		.map((node) => ({
			nodeId: asString(node.nodeId),
			x: asNumber(node.posX),
			y: asNumber(node.posY),
			occupants: roster
				.filter((entry) => entry.nodeId === node.nodeId)
				.map((entry) => entry.actorId),
		}))
		.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));
	const width = cells.reduce((max, cell) => Math.max(max, cell.x + 1), 0);
	const height = cells.reduce((max, cell) => Math.max(max, cell.y + 1), 0);
	const heroNodeId = positions.get(heroId);
	const moves =
		heroNodeId === undefined
			? []
			: edges
					.filter((edge) => edge.placeGraphId === graphId && edge.fromNodeId === heroNodeId)
					.map((edge) => {
						const to = nodes.find((node) => node.nodeId === edge.toNodeId);
						const from = nodes.find((node) => node.nodeId === edge.fromNodeId);
						return {
							edgeId: asString(edge.edgeId),
							toNodeId: asString(edge.toNodeId),
							direction: directionFor(from, to),
							...movePolicyFor(edge, edgeAffordances),
						};
					})
					.sort(
						(a, b) =>
							a.direction.localeCompare(b.direction) || a.toNodeId.localeCompare(b.toNodeId),
					);
	return {
		graphId,
		anchorNodeId: asString(graph.anchorNodeId),
		width,
		height,
		cells,
		moves,
	};
}

function movePolicyFor(
	edge: PlaceEdgeRow,
	edgeAffordances: PlaceEdgeAffordanceRow[],
): Pick<CombatMove, "label" | "costCells" | "blocked"> {
	const bindings = edgeAffordances
		.filter((row) => row.edgeKey === edge.edgeKey)
		.map((row) => bindingsObject(row.bindingsJson))
		.reduce<Record<string, string>>((acc, row) => Object.assign(acc, row), {});
	const costCells = Number(bindings.movement_cost_cells ?? "1");
	const blocked = bindings.blocked === "true" || (Number.isFinite(costCells) && costCells >= 9999);
	return {
		label:
			bindings.movement_label ||
			(Number.isFinite(costCells) && costCells > 1 ? `Cost ${formatCost(costCells)} cells` : ""),
		costCells: Number.isFinite(costCells) && costCells > 0 ? costCells : 1,
		blocked,
	};
}

function formatCost(value: number): string {
	return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

function bindingsObject(raw: unknown): Record<string, string> {
	if (typeof raw !== "string" || raw.trim().length === 0) return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		return Object.fromEntries(
			Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
		);
	} catch {
		return {};
	}
}

function directionFor(from: PlaceNodeRow | undefined, to: PlaceNodeRow | undefined): string {
	if (!from?.posPresent || !to?.posPresent) return "move";
	const dx = asNumber(to.posX) - asNumber(from.posX);
	const dy = asNumber(to.posY) - asNumber(from.posY);
	if (dx === 0 && dy < 0) return "north";
	if (dx === 0 && dy > 0) return "south";
	if (dx > 0 && dy === 0) return "east";
	if (dx < 0 && dy === 0) return "west";
	if (dx > 0 && dy < 0) return "northeast";
	if (dx > 0 && dy > 0) return "southeast";
	if (dx < 0 && dy < 0) return "northwest";
	if (dx < 0 && dy > 0) return "southwest";
	return "move";
}
