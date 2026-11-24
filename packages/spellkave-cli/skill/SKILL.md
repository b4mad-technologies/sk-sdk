---
name: spellkave-cli
description: Discover the installed Spellkave CLI authoring and connected-player workflows through version-matched packaged documentation.
---

# Spellkave CLI discovery

Use the installed CLI's shared documentation for the current task. Help is public
product guidance; it grants no world authority. Repository development rules stay
with the checkout's own skills and instructions.

1. Run `sk docs --query "<task or symptom>"` to find a bounded guide.
2. Open its stable document ID with `sk docs <id>`; large documents default to an
   outline. Retrieve one heading with `sk docs <id> --section "<heading>"`.
3. For the installed CLI loop, open `sk docs cli/workflows`. For authoring pattern
   discovery, open `sk docs find-an-authoring-pattern`. For persona/access routing,
   open `sk docs personas/access`; the player loop is `sk docs player/workflows`.
4. To find a place, definition or placed row by name, run `sk explore search "<text>"`
   (add `--target <manifest>` before `explore` for files, or set it once in
   `.spellkave/config.toml`), then run the commands it prints under `next` exactly as
   printed. It shows the best five matches first in TOON (a table of rows, `total`, `next`;
   source and completeness lines only when something is off); narrow with `--kind`,
   `--tag` or `--within-*`, or widen with the printed `--limit 20` command. Add
   `--format jsonl` before `explore` for the full JSON record.
5. Use `sk help <command>` for schema-derived arguments. Keep planned/unsupported
   guidance distinct from a verified interaction on your connected surface.

`sk skill path` continues to locate this packaged discovery file. Detailed workflow
prose lives in the CLI-owned guide, projected through the same docs contract as
other public guides. Hosted users use their connector's available tools and have
no shell prerequisite; this CLI discovery skill does not certify hosted support.
