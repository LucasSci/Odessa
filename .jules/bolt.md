## 2024-05-15 - Array reverse searching performance

**Learning:** To avoid severe render bottlenecks when searching for the latest matching item in continuously growing arrays (e.g., `capturedText`), use a backward `for` loop instead of creating shallow copies and reversing with `[...array].reverse().find(...)`, which forces O(N) memory allocation and iteration on every render. Polyfills like `findLast()` should be avoided since they are not natively available in ES2020 target.
**Action:** Replace `[...array].reverse().find()` with a backward `for` loop to find the last item efficiently without memory allocations.
