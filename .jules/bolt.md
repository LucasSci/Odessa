## 2024-03-24 - [Optimize Multiple State Derived Arrays]
**Learning:** When calculating multiple subsets or counts from a continuously growing array in React state (like event logs or content lists), combining multiple O(N) `.filter()` calls into a single-pass `.reduce()` or `for` loop inside a `useMemo` avoids performance degradation and unnecessary rendering bottlenecks as the array grows large.
**Action:** When I encounter multiple derived data subsets mapped sequentially from the same array, consolidate them into a single-pass `.reduce` with `useMemo`.
