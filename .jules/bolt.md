## 2024-06-25 - Prevent Render Bottlenecks from Multiple Array Iterations
**Learning:** Using multiple `.filter()` and `.reduce()` operations to derive distinct metrics from a single continuously growing array (e.g., event logs, action queues, capture events) creates an O(N) penalty multiplier that causes noticeable UI stutter during high-frequency live event tracking.
**Action:** Always refactor multiple map/filter/reduce derivations into a single-pass loop inside a `useMemo` block when deriving distinct counts or subsets from arrays tied to rapid state updates.
