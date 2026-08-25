## 2026-06-30 - Optimizing Array Searches in React Renders
**Learning:** Using `[...array].reverse().find(...)` inside a React component's render function (like in `OdessaLiveCenter.tsx`) creates a severe performance bottleneck for continuously growing arrays (like event logs). It forces O(N) memory allocation (shallow copy) and O(N) iteration on *every single render cycle*.
**Action:** Always replace this pattern with a backward `for` loop when you only need to find the most recent matching element. This achieves the same result with O(1) memory and stops immediately upon finding the match, preventing micro-stutters in UI.
## 2026-07-10 - Avoid O(N) useRef initialization
**Learning:** Initializing hooks with inline computations like `useRef(new Set(array.map(...)))` forces O(N) execution on every single render.
**Action:** Conditionally initialize `useRef` inside an if-block (`if (ref.current === null)`) and use non-null assertions for subsequent access.
