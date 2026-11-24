// Kernel live group timed out at 5 s in both scoped reads and authority
// (sk-jay0.7.400). Round up twice the longest observed case (6,348 ms)
// to allow for contention between the parts sharing the runner.
export const LIVE_NODE_TEST_TIMEOUT_MS = 15_000;
