# 6. Work with the SQL assistant

The user can ask for SQL, refine it in a follow-up, and prepare a table or chart. The user controls execution. CopilotKit’s prebuilt input accepts one free-form prompt through typing or dictation. [Product requirements](../product-requirements.md#ai-assistant)

| Implement in order | Working outcome to review |
| --- | --- |
| [6A. Conversation and runtime](06a-conversation.md) | Ask for registrations in the last three months, collapse the composer, and say “Group those by week.” The assistant retains the date range. |
| [6B. SQL editing](06b-sql-editing.md) | Ask for a change to the intended SQL in a mixed script. Undo the assistant’s change in one step. |
| [6C. Table and chart preparation](06c-visualization.md) | Ask for a chart, change the proposed view, and run the corresponding SQL. Adjust the visualization afterward using the existing result. |

Each part includes client and server responsibilities, acceptance scenarios to automate during implementation, and a manual review. Record the composer and voice integration choices in 6A, the editing-scope decision in 6B, and the visualization UX decisions in 6C in the decision log.
