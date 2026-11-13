# Linked return credit/debit note limits (#164)

Policy approved in review on 19 October 2026. Applies equally to AR credit notes
and AP debit notes. Physical inventory posting remains separate from settlement.

## Sales-return valuation

New sales returns and edits to drafts derive the subtotal, tax and gross from
the original invoice, including proportional line and header discounts. The
server calculates the authoritative amount; cumulative rounding assigns cents
to lines without changing the document total. The form previews the same basis,
and the credit-note handoff uses the saved amounts. Existing finalized returns
are not rewritten: inconsistent historical valuations require finance review.

A browser journey returns two of five items with both line and invoice discounts:
Rp162,000 subtotal plus Rp17,820 tax produces an applied Rp179,820 credit and
matching journal. Database coverage also exercises a tax-inclusive draft edit.

## Value and reservations

All notes linked to one return share its gross value, including tax. Sales value
uses original invoice line subtotals proportionally to returned quantities (line
discounts already included), then the proportionate invoice header discount and
original invoice tax treatment. Shipping and other invoice charges are excluded.
Supplier returns use the agreed prices on the purchase return and its tax
treatment, independent of inventory carrying cost. The recorded return gross
must match the calculated basis; inconsistent historical data requires review.
Tax and totals round half-up to two decimal places. No overage tolerance applies.

`APPLIED` and `PENDING_APPROVAL` notes count at their full gross amount, including
cash refunds. Draft notes reserve nothing. Submission reserves available value
without posting GL or moving cash. Approval converts the same reservation to
applied value; rejection returns the note to Draft and releases it. A successful
note void releases value only when its transaction commits the GL reversal.
Failed reversal preserves the original consumption. Goodwill and price
concessions use standalone notes without a physical-return link; existing
source-document balance and account controls still apply.

Submission/application locks the note, then the return, before source documents
or journals. The aggregate is read after the return lock, excluding the current
note, and its effective new amount is added once. Final approval checks again.
An exhausted/overdrawn return refuses further consumption. A pending historical
overdraw cannot be approved until finance resolves it through rejection or
reviewed corrective transactions. Posted retries remain idempotent.

## Historical review

With `DATABASE_URL` explicitly set for the intended database, run:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/audit-linked-return-limits.ts --company COMPANY_ID
```

The report runs in a read-only repeatable-read transaction, scoped to one
company. It lists exhausted/overdrawn returns, applied and pending totals, linked
note identities and settlement types, and invalid valuations. It never repairs
data or rewrites posted history. Review findings before rollout. Correct posted
mistakes using authorized reversals/replacements in an open accounting period,
preserving the original documents and audit trail. Do not unlink, reduce, or
delete posted notes directly to conceal an excess.

## Verification

```powershell
node node_modules/vitest/vitest.mjs run --configLoader runner lib/__tests__/note-return-limits.test.ts
node node_modules/vitest/vitest.mjs run --configLoader runner --config vitest.integration.config.ts lib/__tests__/integration/linked-return-note.int.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

The integration harness requires a migrated disposable PostgreSQL database and
forces its name to end in `_test`. Tests exercise actual AR/AP PUT submission,
approval/rejection, split application, refunds, reversal, historical audits,
unchanged stock/GL on refusal, and actual PostgreSQL lock waits between notes.
No schema migration is required by this change.
