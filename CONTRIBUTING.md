# Contributing

Small, focused pull requests are welcome.

1. Create a branch from `main`.
2. Run `npm install`.
3. Add or update a deterministic test for engine changes.
4. Run `npm run verify`.
5. Explain the visual or workflow reason for the change in the pull request.

Please preserve the core contract: no network access, no document creation or saving, one undo step, and no avoidable formatting loss.
