## 2026-06-30 - Optimizing Array Searches in React Renders
**Learning:** Using `[...array].reverse().find(...)` inside a React component's render function (like in `OdessaLiveCenter.tsx`) creates a severe performance bottleneck for continuously growing arrays (like event logs). It forces O(N) memory allocation (shallow copy) and O(N) iteration on *every single render cycle*.
**Action:** Always replace this pattern with a backward `for` loop when you only need to find the most recent matching element. This achieves the same result with O(1) memory and stops immediately upon finding the match, preventing micro-stutters in UI.

## 2025-05-18 - Avoid O(N) allocations in `useRef` initializers
**Learning:** Initializing `useRef` directly with expensive operations (e.g., `useRef(new Set(array.map(...)))`) creates a performance bottleneck because the operation is evaluated on *every single render cycle*, even though React discards the new result after the first render. This causes unnecessary CPU usage and garbage collection overhead, particularly for lists that grow continuously.
**Action:** Use a lazy initialization pattern, such as combining `useState` with an initializer function (`const [initialState] = useState(() => expensiveOp()); const ref = useRef(initialState);`) to ensure the expensive allocation only runs once during the initial render.
