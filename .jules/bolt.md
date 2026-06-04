## 2024-05-24 - Avoid O(N) allocations for finding latest items in growing arrays
**Learning:** Creating shallow copies and reversing arrays to find the latest matching item (e.g., `[...capturedText].reverse().find(...)`) forces O(N) memory allocation and iteration on every render, causing severe render bottlenecks when the array is continuously growing.
**Action:** Use a backward `for` loop to find the latest matching item instead.
