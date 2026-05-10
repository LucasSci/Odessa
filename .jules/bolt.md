## 2024-03-24 - [Avoid unnecessary map/filter recalculations for array-derived state during frequent rendering]
**Learning:** Found that `CaptureStudio.tsx` recalculates `successfulEvents`, `averageConfidence`, and `averageLatency` by re-mapping and reducing the `captureEvents` array on every single render. Given how often UI interactions happen during live capture and stream configuration, this scales poorly with the event array size.
**Action:** Used `useMemo` to cache arrays derived from other array state (like filtering active/successful elements) and wrapped `CaptureStudio` component with `React.memo` to improve rendering performance.

## 2024-05-24 - [Optimize Multiple Array Passes in React Memos]
**Learning:** Found multiple distinct array traversals (`.filter`, `.map`, `.reduce`) operating on the same continuously growing `cycles` array inside `useAutopilotRuntime.ts` on every render.
**Action:** When deriving multiple aggregates from the same array, always combine the loops into a single O(n) pass inside a single `useMemo` block to minimize computational overhead during frequent state updates.
