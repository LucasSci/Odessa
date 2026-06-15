## 2024-06-15 - Optimize array slice and reverse in React renders
**Learning:** Using `[...array].reverse().find()` and `array.slice(-N).reverse()` on continuously growing arrays (like event logs or chat messages) causes expensive O(N) memory allocation and iteration on every render. This creates severe render bottlenecks.
**Action:** Use a backward `for` loop to scan or collect items from the end of the array, avoiding shallow copies and reducing memory pressure during renders.
