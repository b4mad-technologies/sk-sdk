import type { SessionSnapshot } from "./session";

export interface CombatRosterEntry {
	actorId: string;
	name: string;
	hp?: number;
	defeated: boolean;
	isCurrent: boolean;
	isHero: boolean;
	nodeId?: string;
	cell?: { x: number; y: number };
}

export interface CombatGridCell {
	nodeId: string;
	x: number;
	y: number;
	occupants: string[];
}

export interface CombatMove {
	edgeId: string;
	toNodeId: string;
	direction: string;
	label: string;
	costCells: number;
	blocked: boolean;
}

export interface CombatFeedback {
	text: string;
	kind: "event" | "rejection" | "none";
}

export interface CombatSessionView {
	session: SessionSnapshot;
	roster: CombatRosterEntry[];
	currentActorName: string;
	nextActorName: string | null;
	isHeroTurn: boolean;
	waitingReason: string | null;
	grid: {
		graphId: string;
		anchorNodeId: string;
		width: number;
		height: number;
		cells: CombatGridCell[];
		moves: CombatMove[];
	} | null;
	feedback: CombatFeedback;
}
