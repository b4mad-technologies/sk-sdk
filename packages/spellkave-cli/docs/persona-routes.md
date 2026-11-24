# Choose guidance for your task and access

A persona describes a task, not a grant. One person may use several of these
routes. Public help does not reveal private world rows, select a role or authorize
an action. Check the offered tools and their current results before acting.

## Access routes

| Task lens | Repository and shell | Installed CLI, no checkout | Connector/browser, no filesystem | Guide owner |
|---|---|---|---|---|
| Game System Author | Authoring sources and proof tests | `sk docs find-an-authoring-pattern` → pattern and examples | `spellkave_docs` with the same `doc` IDs when offered; execution depends on available payload tools | world-author |
| Adventure Author | Adventure sources and authored bundles | Same authoring guide; excerpts state required bundle/graph inputs | Same public guidance; scene setup remains pending its owning feature and hosted port | world-author and adventure package |
| DM | Repository optional for product help | CLI workflow and offered connected tools | Public docs plus offered gameplay tools; presence, takeover, time control and private hints require their owning features | tool-player for gameplay; feature owner for privileged tasks |
| Elevated Player | Same product guidance | Same player loop; rights remain server-enforced | Same offered tools; missing mutation tools do not hide public help | tool-player |
| Player | Source unnecessary | `sk docs player/workflows` | `spellkave_docs` with `doc: "player/workflows"`, then offered gameplay tools | tool-player |
| AI Inhabitant | Driver development is separate | Host provides actor observations/actions | Driver receives bounded observations and action contracts, not hidden world facts | tool-player and host adapter |
| Observer | Product view help | Use only an offered observation route | Product UI or connector explains its available observations; no new observer runtime is promised | observation surface owner |
| Publisher/operator | Operational runbooks and deployment tooling | `sk help op`; infrastructure setup still needs its operational distribution | Only explicitly offered operational routes; gameplay docs cannot provide operator credentials | sk-op and operations runbooks |
| Kernel developer/CI maintainer | AGENTS, specs, ADRs, source and tests | A product installation is not a development checkout | Product help does not replace repository workflows | repository governance |
| Reviewer/canon steward | PR/spec/evidence review | Versioned read-only evidence where supplied | Explicit public evidence; product help does not become a code-review environment | owning feature and review workflow |

## Focused guides

Use `sk docs cli/workflows` for installed CLI loops and
`sk docs find-an-authoring-pattern` for problem search, source-backed excerpts
and complete examples. The player loop is `player/workflows`. Large pages
support exact headings and opt-in full retrieval.

Hosted consumers call `spellkave_docs` using `query`, `doc`, `section`, `outline`
or `full`; they do not need to install a shell skill. A connector must actually
offer that docs tool. This guide does not claim a deployed revision or a hosted
role context. Use `hosted-authoring-workflow` for public help, caller-owned presence selection
and portable payloads. `hosted-authoring-guidance` retains planned compound stories.

## Version and evidence

The response identifies its document and corpus revision. Missing connected
server evidence is `unknown`, not a claim of compatibility. The distribution
receipt and versioned proof accompanying a candidate identify the exact tested
artifact. Historical captures retain their historical label.

Compound scene setup, atomic hand-over and confidential hints retain their
owning feature’s planned/unverified status. Native presence, payload and steering
proofs retain their named runtime/surface limits; they do not certify a deployed
connector or external application. Repository working rules, Beads, local-node setup and
CI instructions stay with repository skills; they are not installed product steps.
