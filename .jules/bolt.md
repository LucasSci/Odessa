## 2026-06-20 - Backward Loops for Growing Arrays
**Learning:** Using `[...array].reverse().find()` on continuously growing arrays (like event logs or OCR capture text) forces O(N) memory allocation and iteration on every render, severely degrading performance.
**Action:** Always use backward `for` loops instead of creating shallow copies when searching for the latest matching item in arrays that grow over time.
