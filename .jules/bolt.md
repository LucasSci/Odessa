## 2024-05-16 - Avoid Multiple O(N) Passes on Fast-Growing Event Arrays

**Learning:** React state variables tracking live event streams (like `captureEvents` in CaptureStudio) grow quickly. Computations derived from these arrays frequently use multiple `.filter()` and `.reduce()` chains for readability. When multiple such chains run on every update, they compound into severe render bottlenecks.
**Action:** When deriving subsets or aggregates from high-frequency event arrays, aggressively combine these operations into a single-pass loop inside a single `useMemo` to minimize operations.
