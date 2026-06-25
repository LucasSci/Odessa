## 2024-05-17 - Avoid `[...array].reverse().find(...)` for performance
**Learning:** Using `[...array].reverse().find(...)` to find the last matching element in an array forces O(N) memory allocation and iteration, causing severe render bottlenecks when the array grows continuously (e.g., event logs or captured text).
**Action:** Use a backward `for` loop instead to find the latest matching item without allocating new arrays, improving React component render performance significantly.
