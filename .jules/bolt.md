## 2024-05-25 - Avoid formatting entire codebase during small PRs
**Learning:** Running `npm run format` on a codebase with existing legacy unformatted files generates massive unrelated diffs. This hides the actual performance optimizations and violates the < 50 lines rule.
**Action:** When making targeted fixes, only run formatters or limit linting/formatting to the specific files being modified instead of the global command, or manually adjust test assertions using whitespace normalization if they break.
