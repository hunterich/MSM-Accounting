# Return deletion and linked notes

Issue #166: a draft sales or purchase return cannot be deleted while any credit
or debit note remains linked, regardless of note status. The refusal identifies
up to five notes in the same company and leaves the return, lines and notes in
place. Returns that are pending, finalized, posted or void cannot be deleted;
use the applicable approval or void workflow. No financial document is
automatically removed.

For an unposted draft note, the detail screen offers a confirmed unlink action,
which makes the note standalone, or a confirmed draft deletion. Each records
the previous return ID transactionally in the audit log. Deleting the return also records its number and source invoice or bill atomically. Unlinking and submitting
in the same request is refused; the user must deliberately perform separate
actions. Submitted, applied and void notes cannot be edited or unlinked here.
The existing authorization checks apply to each action.

Delete locks the return before checking the notes. The database foreign-key
locking for a concurrent note link means the link is either visible to the check
or cannot be created after the return has been deleted. Tests exercise both
customer and supplier paths, linked note states, draft deletion, explicit unlink,
audit history, finalized return refusal and overlapping delete/submission.
These safeguards do not recover links previously removed by historical deletes.
