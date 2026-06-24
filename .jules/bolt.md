## 2024-05-18 - Avoid O(N) array allocation when searching backward in large reactive states
**Learning:** Using `[...array].reverse().find(...)` to get the last matching item forces O(N) memory allocation and an O(N) iteration on every render. This becomes a major bottleneck for large, continuously growing arrays (like event logs or captured texts) in React components.
**Action:** Always use a traditional backward `for` loop (e.g., `for (let i = array.length - 1; i >= 0; i--)`) to search from the end of an array. It requires O(1) memory and stops immediately when the item is found.
