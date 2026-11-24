// Hand-edited. The strict table surface is derived from
// CONNECTION_BASELINE union READER_SCOPED_TABLES in @spellkave/sdk's
// connection.ts.
//
// Strict reducers are the SDK-helper reducer set; add a reducer here only
// when the SDK starts calling it through the generated bindings.
export const STRICT_REDUCERS: readonly string[] = [
  "r_manipulate",
  "r_move",
  "r_sense",
  "r_session_close",
  "r_session_move",
  "r_session_open",
];
