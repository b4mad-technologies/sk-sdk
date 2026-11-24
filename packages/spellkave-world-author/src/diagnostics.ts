/** Severity of a validator diagnostic — mirrors `spellkave_validate::Severity`. */
export type DiagnosticSeverity = "info" | "warning" | "fatal";

/** Source span of a diagnostic — mirrors `spellkave_validate::Span`. */
export interface DiagnosticSpan {
	startLine: number;
	startCol: number;
	endLine: number;
	endCol: number;
}

/** One validator diagnostic — mirrors `spellkave_validate::Diagnostic` (canonical JSON). */
export interface Diagnostic {
	/** Stable diagnostic code, e.g. "MF-FMT-001", "MF-VAL-210". */
	code: string;
	severity: DiagnosticSeverity;
	message: string;
	/** Dotted path into the manifest the diagnostic points at, e.g. "$". */
	path: string;
	span?: DiagnosticSpan;
	hint?: string;
	details?: unknown;
}

/** Raw canonical-JSON diagnostic shape (snake_case, as the wasm emits it). */
interface RawDiagnostic {
	code: string;
	severity: DiagnosticSeverity;
	message: string;
	path: string;
	span?: { start_line: number; start_col: number; end_line: number; end_col: number } | null;
	hint?: string | null;
	details?: unknown;
}

function toDiagnostic(raw: RawDiagnostic): Diagnostic {
	const d: Diagnostic = {
		code: raw.code,
		severity: raw.severity,
		message: raw.message,
		path: raw.path,
	};
	if (raw.span) {
		d.span = {
			startLine: raw.span.start_line,
			startCol: raw.span.start_col,
			endLine: raw.span.end_line,
			endCol: raw.span.end_col,
		};
	}
	if (raw.hint != null) d.hint = raw.hint;
	if (raw.details !== undefined && raw.details !== null) d.details = raw.details;
	return d;
}

export function diagnosticsFromJson(json: string): Diagnostic[] {
	const raw = JSON.parse(json) as RawDiagnostic[];
	return raw.map(toDiagnostic);
}
