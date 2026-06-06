## 2024-06-06 - Avoid array allocations when searching backward in large arrays
**Learning:** To avoid severe render bottlenecks when searching for the latest matching item in continuously growing arrays (e.g., `capturedText`), use a backward `for` loop instead of creating shallow copies and reversing with `[...array].reverse().find(...)`, which forces O(N) memory allocation and iteration on every render.
**Action:** Always use backward `for` loops instead of copying and reversing large, frequently updated arrays inside React components.
