## 2024-05-18 - Avoid reverse().find() on continuously growing arrays
**Learning:** Using `[...array].reverse().find(...)` on a continuously growing array like `capturedText` causes severe O(N) memory allocation and iteration bottlenecks on every render.
**Action:** Use a backward `for` loop to search for the latest matching item without creating a shallow copy and reversing the array.
