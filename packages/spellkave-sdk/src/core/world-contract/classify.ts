export interface SchemaTable {
	readonly access: string;
	readonly kind: string;
	readonly event: boolean;
	readonly columns: readonly string[];
	readonly primaryKey: readonly string[];
	readonly unique: readonly string[];
	readonly indexes: Readonly<Record<string, string>>;
	readonly autoInc: readonly string[];
	readonly schedule?: string;
}
export interface SchemaView {
	readonly public: boolean;
	readonly anonymous: boolean;
	readonly params: readonly string[];
	readonly returns: string;
	readonly columns?: readonly string[];
}
export interface SchemaReducer {
	readonly visibility: string;
	readonly params: readonly string[];
	readonly ok: string;
	readonly err: string;
}
export interface SchemaProcedure {
	readonly visibility: string;
	readonly params: readonly string[];
	readonly returns: string;
}
export interface SchemaSnapshot {
	readonly tables: Readonly<Record<string, SchemaTable>>;
	readonly views: Readonly<Record<string, SchemaView>>;
	readonly reducers: Readonly<Record<string, SchemaReducer>>;
	readonly procedures: Readonly<Record<string, SchemaProcedure>>;
	readonly lifecycle: Readonly<Record<string, string>>;
	readonly types: Readonly<Record<string, unknown>>;
	readonly explicitNames?: unknown;
}
