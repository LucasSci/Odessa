## 2024-05-30 - Combining Multiple Array Operations in Render Cycle

**Learning:** In the React frontend, deriving multiple subsets or counts from continuously growing arrays (like `captureEvents`) using multiple chained `.filter()` and `.reduce()` operations creates significant rendering bottlenecks.
**Action:** Combine these O(N) operations into a single-pass loop inside `useMemo` to prevent render bottlenecks and reduce the number of times the array is iterated over.
