## 2024-03-24 - [Avoid unnecessary map/filter recalculations for array-derived state during frequent rendering]

**Learning:** Found that `CaptureStudio.tsx` recalculates `successfulEvents`, `averageConfidence`, and `averageLatency` by re-mapping and reducing the `captureEvents` array on every single render. Given how often UI interactions happen during live capture and stream configuration, this scales poorly with the event array size.
**Action:** Used `useMemo` to cache arrays derived from other array state (like filtering active/successful elements) and wrapped `CaptureStudio` component with `React.memo` to improve rendering performance.
