## 2024-06-14 - O(N) Render Bottleneck with `.reverse().find()`
**Learning:** In continuously growing event arrays (`capturedText`), using `[...array].reverse().find(...)` inside `useMemo` forces $O(N)$ memory allocation and iteration on every single render. This anti-pattern can cause severe UI lag over time.
**Action:** Replace `[...array].reverse().find()` with a backward `for` loop, especially when `target` is ES2020 and native `findLast()` is unavailable, to achieve $O(1)$ memory usage and $O(K)$ iteration time.
