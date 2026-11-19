# 3. Insert data from a CSV file

A user with a CSV can add its records to an existing ClickHouse table from the SQL workspace. Before committing to an import, they should know which table will change, how much of the file was checked, and whether the sample passed. Afterward, they should know what ClickHouse confirmed and, if something failed, where to look in the file. [Product requirements](../product-requirements.md#insert-data-from-a-file)

## Where the existing product starts

The React workspace already loads database and table names. Its schema helpers can also retrieve column names, types, and default expressions. These provide a starting point for choosing a destination. The workspace currently has no file-import action. Express serves query and assistant requests and has a ClickHouse client, but it has no CSV upload, verification, or import handler. [Workspace](../../src/App.tsx) · [Schema helpers](../../src/lib/schema.ts) · [Express server](../../../src/index.ts)

## Frontend experience

1. **Choose the destination.** Open **Insert data from a file** in the workspace. In the modal, select an existing table, then drop a CSV or use the file picker. Keep the qualified name visible throughout the operation, particularly when two databases have tables with the same name.
2. **Upload and verify.** Send the file to the server. Show that the file is uploading or being checked and keep **Import** disabled. An upload failure should give the user a way to choose or submit the file again. A completed upload alone does not enable Import.
3. **Show the verdict beside Import.** Use the server’s actual checked-record count, qualified table, and indication of further records. On failure, show the first invalid data record, column, and reason when available. For a header error, identify the header problem. Changing the destination or file clears the verdict and requires verification again. A late response for an earlier choice must never enable the current Import button.
4. **Confirm and report.** Clicking **Import** starts the verified import. While it runs, show its state and prevent a second click from submitting the same import again. Show completion only after the server confirms the final chunk. On failure, show confirmed progress and actionable error details.

| Server verdict | Example in the modal | Import |
| --- | --- | --- |
| All 8 records pass | All 8 rows passed validation for `default.orders`. Ready to import. | Enabled |
| Exactly 20 records, all pass | All 20 rows passed validation for `default.orders`. Ready to import. | Enabled |
| A 21st record exists and the sample passes | The first 20 rows passed validation for `default.orders`. Remaining rows will be checked during import. | Enabled |
| Invalid sampled value | Data row 7 has `abc` in `amount`. Expected a number. Correct the CSV and upload it again. | Disabled |

## Backend behavior

**Verification, before any insert.** Receive the upload and resolve the qualified destination against the current ClickHouse schema. Map the CSV header to insertable columns and validate the values using the same interpretation that import will use. Reject an empty file, a header-only file, an incompatible header, or any invalid sampled record. Check up to 20 logical data records, excluding the header. A quoted field can contain a comma or newline and still belong to one record. Detect whether another record exists so exactly 20 and more than 20 produce the correct messages.

**Handoff to confirmation.** Associate the verification outcome with the specific uploaded file and destination. Return enough information for the modal to show the verdict and for a later confirmation to refer to that verified pair. Enforce eligibility on the server as well as in the UI. If the destination disappears or becomes incompatible, report the problem. The user can select and verify a new destination.

**Import, after confirmation.** Read the verified upload on the server in bounded chunks so large files can be processed incrementally. Insert the sampled records once along with the rest of the file. Continue validating later records using the same mapping. Track which inserts ClickHouse has acknowledged. Repeated confirmation of the same import must not duplicate its rows.

**Partial and uncertain outcomes.** Stop processing on a validation or insert failure and report the first known cause. For example, if one chunk of 100 rows was acknowledged and record 137 fails validation in the next chunk before that chunk is sent, report 100 confirmed inserts and identify record 137. If ClickHouse received a chunk but its acknowledgment was lost, identify that chunk’s outcome as unknown. Preserve the distinction so the user can inspect the destination before deciding how to recover.

## Acceptance scenarios to automate during implementation

| Scenario | Expected outcome |
| --- | --- |
| Choose a target and upload by either input | File picker and drag-and-drop lead to the same verification flow. The modal shows the qualified destination. Before confirmation, the destination row count is unchanged. |
| Empty file, header only, or incompatible header | Verification explains the issue in the modal. Import remains disabled and there are zero writes. |
| Files with 8, 20, and 21 valid records | The server reports 8, 20, and 20 checked respectively. Only the 21-record file gets the remaining-records message. |
| Invalid record 20 versus invalid record 21 | A bad 20th record blocks confirmation with zero writes. A bad 21st record passes the sample check and is identified during import. Quoted multiline values still yield the correct data-record number. |
| File or table changes while verification is in flight | The old response cannot authorize the new pair in the UI or on the server. Verify the new pair before importing. |
| Valid file spanning multiple chunks | A ClickHouse query confirms every expected record and value, including the first 20, exactly once. Repeated confirmation leaves those counts unchanged. |
| Later failure or lost acknowledgment | A known failure reports confirmed inserts and the location or cause. A lost acknowledgment shows the uncertain outcome separately. Verify confirmed rows against a disposable ClickHouse table. |

Cover the modal states and stale responses in browser tests, CSV verification in server tests, and actual inserts with a disposable ClickHouse destination. For manual review, import a valid file and query its rows from the editor. Then try a file whose sample passes but a later record fails, and compare the displayed outcome with the destination.

## Decisions for implementation

The import accepts UTF-8 CSV up to 16 MiB, with a limit of 256 KiB per logical record. The header uses exact column names in any order. Explicit defaults and nullable columns can fill omitted fields. The server rejects duplicate and generated columns in the header.

Verification keeps the file in server temporary storage. Confirmation checks the destination again and validates each batch of up to 100 rows before sending it to ClickHouse. The modal shows the final confirmed count and any unacknowledged range. It can check the result of the same confirmation after a connection problem. [Decision log](../../DECISION_LOG.md)

Playwright verified file selection, drag-and-drop, stale verdicts, and completion and failure messages. The live checks used disposable ClickHouse tables to verify record 20 and 21, simultaneous confirmation requests, and the reported row counts after partial or uncertain imports. In a browser walkthrough, verification left the table empty, two imports left 103 confirmed rows, and a query in the editor returned that count. [Browser tests](../../tests/csv-import.spec.ts) · [ClickHouse integration tests](../../../tests/csv-import.test.ts)
