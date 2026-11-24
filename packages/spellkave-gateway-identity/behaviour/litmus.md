# Guide litmus

A fresh agent gets only `docs/guide.md` (and `docs/scenarios.md` if the guide
links there), quotes its sources, and answers "NOT IN GUIDE" instead of
guessing. Pass: at most one miss, no invented command, flag or variable.

1. Token for player `sim2`? → `authkit-refresh-token sim2`, token on stdout.
2. Safe to redirect into a file? → Yes, stdout holds only the token.
3. Exit 1: where is the reason, is there a token? → One stderr line, no token.
4. "no machine-user seed": what now? → `scripts/sim/install-machine-seed.sh --player <name>`.
5. Where does the rotated refresh token go? → The runtime file (0600); the seed stays.
6. Second run sends which refresh token? → The rotated one, not the seed's.
7. Seed elsewhere? → `SPELLKAVE_MACHINE_SEED_FILE`, `SPELLKAVE_MACHINE_RUNTIME_FILE`.
8. Does `invalid_grant` leak the refresh token? → No; stderr names the code only.
9. Refused although AuthKit said 200? → Foreign `iss`, or not a JWT.
10. Seed names the User Management issuer? → Never sent; reads as "no seed".
