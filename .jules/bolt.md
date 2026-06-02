## 2026-06-02 - Array Reverse Memory Allocation Issue
**Learning:** Reversing and finding an item in an array using `[...array].reverse().find(...)` forces O(N) memory allocation and processing on every React render which bottlenecks performance significantly.
**Action:** Use a backward `for` loop to find the latest matching item in O(1) space, especially for arrays that are continuously updated or large in size.
