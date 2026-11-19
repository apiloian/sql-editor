# 6. Work with the assistant

Use the floating composer, voice input, Express assistant handler, and schema metadata tools. Evaluate headless CopilotKit against the existing integration with one follow-up request before choosing the runtime.

- [ ] Keep one conversation per open editor tab across typed and dictated turns, composer collapse, and assistant toggles. Start fresh on reload. Expand the composer on focus and with longer input.
- [ ] Generate, explain, and revise SQL using restricted schema metadata. Apply each edit as one undoable change. Trial the read-only editor while the assistant works and restore editing on success, error, or cancellation. Compare selection edits with whole-editor edits.
- [ ] Let the assistant prepare a chart tied to its SQL. Allow user overrides. Populate it after the user runs the associated SQL successfully. Reuse existing results for view-only changes. Expose no query-execution tool to the model.
- [ ] Evaluate one trace ID per request with model/tool timing, outcomes, and available usage. Keep credentials on the server and exclude sensitive content from traces. Record only user-initiated SQL executions in query activity.

**Tests.** Use controlled assistant responses to check follow-up context, reload, input locking and recovery, undo, and the absence of execution requests during preparation. Override a prepared chart before Run and verify it uses the bound result. Change the view afterward and check the query request count. Simulate a schema lookup failure and inspect its trace for the failed step and omitted sensitive values. Extend the existing assistant, composer-focus, and voice suites where relevant.

**Review.** Ask for registrations over three months, request a revision, choose the chart, and press Run yourself. Verify the result, chart, and single activity entry. Review the fallback when the requested chart cannot represent the columns.
