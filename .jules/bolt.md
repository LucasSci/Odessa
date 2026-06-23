## 2025-02-14 - Optimize array searching in render cycles
**Learning:** Using `[...array].reverse().find()` for searching the last matching item in continuously growing arrays (like event logs) causes severe O(N) memory allocation and iteration overhead on every render.
**Action:** Use a backward `for` loop instead to achieve O(1) memory allocation and avoid continuous array shallow copies.
