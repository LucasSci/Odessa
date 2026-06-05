## 2025-06-05 - Avoid O(N) array copying for backward searches
**Learning:** Using `[...array].reverse().find()` on continuously growing state arrays (like event logs or `capturedText`) creates a severe render bottleneck. It forces O(N) memory allocation and iteration on every single render.
**Action:** Use a backward `for` loop to search for the latest matching item in continuously growing arrays to avoid unnecessary memory allocations and iterations.
