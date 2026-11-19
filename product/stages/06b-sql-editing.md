# 6B. Apply and revise SQL in the editor

**Outcome.** Using the [conversation from 6A](06a-conversation.md), the user describes the SQL they want in their own words, sees where the edit landed, and can undo it. This applies to ordinary reads, writes, and mixed scripts.

**Starting point.** The workspace currently checks for intervening edits before replacing the whole Monaco model. Replacement already creates one undoable edit. Existing browser tests cover undo/redo and a late response after a manual edit. [Workspace](../../src/App.tsx) · [Monaco editor](../../src/components/SqlEditor/SqlEditor.tsx) · [Assistant tests](../../tests/assistant.spec.ts)

**Implementation scope**

- Compare editing selected SQL with editing the whole document on the same multi-statement example. The Monaco selection sets the edit target. Run uses its own scope rules.
- React owns the edit target and applies each accepted assistant change as one undoable Monaco edit. In the selection trial, preserve the surrounding SQL.
- Trial a visible busy state with the editor read-only while the assistant prepares an edit. Restore editing on success, failure, and cancellation. Discard a late response if its request was canceled or its target changed.
- Keep model responses validated on the server. On an unusable response or unavailable schema, show an actionable message and preserve the draft. Use the request trace from 6A for diagnostics.

**Acceptance and review.** Generate a query in an empty editor, then ask for a revision. Select SQL in a script with adjacent statements and ask “Only include registrations from the last three months.” Verify the edit scope and one-step Undo and Redo. Exercise a failed request, cancellation followed by a late response, and recovery of editor input. Verify that sending a prompt or applying an edit never runs SQL. For manual review, revise the middle statement, undo the change, and compare the experience with requesting a whole-script edit.

**Implementation.** Send captures the selected SQL or, when the selection is empty, the whole editor. After a successful response Monaco replaces only the captured range in one undoable edit and highlights the revised selection. If the SQL document or selection changes while the request is pending, the editor keeps the current SQL and the composer restores the prompt for retry.
