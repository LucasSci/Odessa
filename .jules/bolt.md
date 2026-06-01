
## 2025-02-23 - Replaced O(N) Array Allocation/Iteration on Every Render
**Learning:** `[...array].reverse().find()` creates a full shallow copy of an array and iterates over it completely on every render. For rapidly growing arrays like `capturedText` in React live applications, this causes substantial memory thrashing and CPU spikes.
**Action:** Use a backward `for` loop starting from `array.length - 1` to search for the latest matching element in arrays that accumulate events. It requires O(1) memory and exits early once a match is found.
