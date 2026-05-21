## 2024-05-30 - [CaptureStudio Metrics Optimization]
**Learning:** Computing multiple aggregations (e.g. `successfulEvents`, `averageConfidence`, `averageLatency`) from the frequently updating `captureEvents` array in `CaptureStudio.tsx` using chained `.filter()` and `.reduce()` operations causes significant performance bottlenecks.
**Action:** When deriving multiple subsets and aggregated metrics from a frequently updating array, combine these computations into a single-pass loop within a `useMemo` block to minimize temporary array allocations and optimize processing.
