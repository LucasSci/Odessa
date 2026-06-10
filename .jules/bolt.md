## 2025-02-18 - Optimize lastOcr search array allocation
**Learning:** Using `[...array].reverse().find(...)` inside memoized components (or on every render) on continuously growing arrays (like event logs) forces severe O(N) memory allocation and O(N) iteration, causing render bottlenecks.
**Action:** Replace `[...array].reverse().find(...)` with a backward `for` loop to search from the end. This pattern achieves O(1) memory complexity and avoids shallow copying the array entirely.
