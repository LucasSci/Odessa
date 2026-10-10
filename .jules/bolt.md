## 2026-06-30 - Optimizing Array Searches in React Renders
**Learning:** Using `[...array].reverse().find(...)` inside a React component's render function (like in `OdessaLiveCenter.tsx`) creates a severe performance bottleneck for continuously growing arrays (like event logs). It forces O(N) memory allocation (shallow copy) and O(N) iteration on *every single render cycle*.
**Action:** Always replace this pattern with a backward `for` loop when you only need to find the most recent matching element. This achieves the same result with O(1) memory and stops immediately upon finding the match, preventing micro-stutters in UI.
## 2026-07-10 - Avoid O(N) useRef initialization
**Learning:** Initializing hooks with inline computations like `useRef(new Set(array.map(...)))` forces O(N) execution on every single render.
**Action:** Conditionally initialize `useRef` inside an if-block (`if (ref.current === null)`) and use non-null assertions for subsequent access.
## 2026-07-28 - Optimizing React array state deduplication
**Learning:** Updating React state arrays that require merging and deduplicating new items (e.g. `setCapturedText`) using patterns like `[...current.filter(x => !newItems.some(y => y.id === x.id)), ...newItems]` creates multiple shallow copies and an O(N*M) lookup bottleneck.
**Action:** Replace chained `.filter().some()` methods inside state setters with a single-pass loop and a `Set` of IDs for fast O(1) lookups, greatly reducing GC pressure and micro-stutters during high-frequency events.
## 2026-08-15 - Optimizing Array Search for Selection Check in React
**Learning:** Using `array.filter(node => selectedIds.includes(node.id))` when selecting multiple nodes creates an O(N*M) check bottleneck because `.includes` performs a linear search over `selectedIds` for every item in `array`.
**Action:** Replace `selectedIds.includes` with `new Set(selectedIds).has()` to reduce the search complexity from O(N*M) to O(N).
## 2026-08-15 - Fastapi TestClient host configuration
**Learning:** Fastapi's TestClient uses `testserver` as its default `base_url`. If your FastAPI app has middleware or checks that strictly require specific host headers (e.g. `RequestGuard` checking for `localhost` or `127.0.0.1`), tests might incorrectly fail with 400 Bad Request.
**Action:** When using `TestClient` with host-validating endpoints, instantiate it with a valid base URL like `TestClient(app, base_url="http://127.0.0.1")`.
