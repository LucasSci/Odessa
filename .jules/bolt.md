## 2024-05-24 - Avoid shallow copies of continuously growing arrays
**Learning:** Operations like `[...array].reverse().find(...)` force O(N) memory allocation and full iteration on every render. This creates severe render bottlenecks for continuously growing arrays like `capturedText` (live event arrays).
**Action:** Use a backward `for` loop to search for the latest matching item instead of reversing a shallow copy of the entire array.
