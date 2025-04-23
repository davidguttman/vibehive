# Queue Manager (Tutorial 27) Completion Checklist

This checklist tracks the steps required to fully implement and test the `lib/queueManager.js` module based on `docs/tutorials/27-queue-manager.md` and ensure all tests pass.

- [ ] **Verify Implementation:** Review `lib/queueManager.js` against the code examples and logic described in `docs/tutorials/27-queue-manager.md`. Ensure `enqueueTask`, `processQueue`, and `init` functions are implemented correctly.
- [ ] **Fix `enqueueTask` Test Failures:**
    - [ ] Investigate and fix the `TypeError: Attempted to wrap error which is already wrapped` in the tests for `enqueueTask` when `channelId` or `taskData` is missing. This likely involves correcting how `sinon.spy(console, 'error')` is used within those tests or the `beforeEach`/`afterEach` hooks.
    - [ ] Fix the assertion failures in `enqueueTask should call findOneAndUpdate...` (ensure `mockTaskQueue.findOneAndUpdate` is called once).
    - [ ] Fix the assertion failure in `enqueueTask should trigger processQueue...` (ensure the `processQueue` stub is called once).
- [ ] **Debug `processQueue` Test Timeouts/Pending:**
    - [ ] Investigate why the 13 `processQueue` tests (concurrency, sequential execution, error handling, locking, empty queue, initialization) are timing out or remaining pending.
    - [ ] Debug potential infinite loops, unhandled promises, or race conditions in the `processQueue` implementation or its tests.
    - [ ] Ensure mocks (`mockTaskQueue`, `mockTaskExecutor`) are correctly configured and reset for each `processQueue` test scenario.
- [ ] **Run Full Test Suite:** Execute `npm run test:docker` and confirm that *all* tests pass, including those in `test/queueManager.test.js`.
- [ ] **Code Style:** Run `npx standard --fix lib/queueManager.js test/queueManager.test.js` to ensure code style consistency.
- [ ] **Final Review:** Read through the tutorial, code, and tests one last time to ensure everything aligns and is robust. 