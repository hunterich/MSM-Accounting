import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { login } from './helpers'

/**
 * Sales return → credit note → posted journal entry, driven through the real UI
 * against the real API and a real database.
 *
 * This is the journey nothing covered. The unit tests mock the API, and the
 * integration suite builds documents with `prisma.creditNote.create` — so both
 * sides were individually green while the client and the server disagreed about
 * the shape of a credit note. Every defect below was live at once, each hidden
 * behind the one in front of it:
 *
 *   - the prefilled note never reached the user (router state does not survive
 *     the workspace shell)
 *   - the return was never saved at all (a status enum value the schema had
 *     dropped, swallowed by a fire-and-forget mutation)
 *   - return lines sent the invoice LINE id as `itemId`
 *   - the note payload omitted `customerId` and never mapped `returnId` to
 *     `salesReturnId`
 *   - the posting landed on whatever account happened to be first
 *
 * So the assertions deliberately span the whole chain: the UI hand-off, what the
 * API actually stored, and what reached the ledger. Checking only the screen
 * would have missed most of it.
 */

const money = (v: unknown) => Number(v ?? 0)

async function apiJson(request: APIRequestContext, path: string) {
  const res = await request.get(`http://localhost:3100${path}`)
  expect(res.ok(), `${path} → ${res.status()}`).toBeTruthy()
  const body = await res.json()
  return body.data ?? body
}

/**
 * Ids present before the run, so the assertions can name what this run created.
 * Every caller asks for `limit=100`, the API maximum: repeated local runs pile up
 * rows, and a day's documents all share one date, so page 1 is not stable.
 */
async function idsOf(request: APIRequestContext, path: string): Promise<Set<string>> {
  const rows: Array<{ id: string }> = await apiJson(request, path)
  return new Set(rows.map((r) => r.id))
}

/** The single row this run added. Fails loudly if the run added none, or several. */
function theNewOne<T extends { id: string }>(rows: T[], before: Set<string>, what: string): T {
  const created = rows.filter((r) => !before.has(r.id))
  expect(created, `expected exactly one new ${what} from this run`).toHaveLength(1)
  return created[0]
}

/**
 * Open a SearchableSelect by its placeholder and choose an option.
 *
 * The option click is scoped to the dropdown panel, which is the control's next
 * sibling. That matters more than it looks: `.cursor-pointer` also matches every
 * row of the catalog behind the form, and once this spec has run once those rows
 * contain the very customer name the next run tries to pick — so an unscoped
 * `.first()` grabbed a hidden table row and waited for it to become visible
 * until the test timed out.
 */
async function choose(page: Page, placeholder: string, option: string | RegExp) {
  const control = page.locator('div.cursor-pointer', { hasText: placeholder }).first()
  await control.click()
  const panel = control.locator('xpath=following-sibling::div[1]')
  await panel.locator('div.cursor-pointer', { hasText: option }).first().click()
}

test.describe('sales return → credit note → ledger', () => {
  test('a returned invoice line becomes an applied credit note and a balanced journal entry', async ({
    page,
  }) => {
    await login(page)

    // Every assertion below is about what THIS run created, not what the whole
    // database holds. An applied credit note is deliberately immutable — void
    // reverses it with a second entry rather than removing it — so the spec
    // cannot put the database back, and asserting on totals made a second run
    // fail on the leftovers of the first. (The suite cannot reach a development
    // database anyway: `playwright.config.ts` forces the `_e2e` suffix onto
    // whatever DATABASE_URL it is given.)
    const notesBefore = await idsOf(page.request, '/api/v1/credit-notes?limit=100')
    const returnsBefore = await idsOf(page.request, '/api/v1/sales-returns?limit=100')

    await page.goto('/ar/credits')
    await page.locator('.workbench-doc-tab-new').click()

    await choose(page, 'Select Customer...', 'Acme Corp')
    await choose(page, 'Select Invoice...', /INV-0004/)

    // Return 2 of the 5 units on the invoice line (Rp 100.000 each).
    const qtyReturn = page.locator('main input[type="number"]').nth(1)
    await qtyReturn.fill('2')
    // Assert on the form's own total, not the first Rp 222.000,00 anywhere on
    // the page: the same figure also appears in the sticky status bar, and
    // whichever of the two `.first()` picks may be scrolled out of view.
    await expect(page.locator('.panel-summary-total .value')).toHaveText('Rp 222.000,00')

    await page.getByRole('button', { name: 'Save & Create Credit Note' }).click()

    // The hand-off: the return tab closes and a PREFILLED credit note opens.
    // This used to drop the user on the empty list with the draft gone.
    await expect(page.getByRole('heading', { name: 'Credit Note' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Widget A x5').first()).toBeVisible()

    // The return really was persisted, with a server-assigned number — the step
    // that silently failed for every auto-numbered return.
    const salesReturn = theNewOne(
      await apiJson(page.request, '/api/v1/sales-returns?limit=100'),
      returnsBefore,
      'sales return',
    )
    expect(salesReturn.number).toMatch(/^SRN-/)
    expect(salesReturn.status).toBe('PENDING_CREDIT_NOTE')

    // Apply it against the source invoice.
    const settlement = page
      .locator('main select')
      .filter({ has: page.locator('option', { hasText: 'INV-' }) })
      .first()
    const invoiceOption = await settlement
      .locator('option', { hasText: 'INV-0004' })
      .first()
      .getAttribute('value')
    await settlement.selectOption(invoiceOption!)
    await page.getByRole('button', { name: 'Save & Apply' }).click()

    // Back on the catalog, showing document numbers rather than raw cuids.
    await expect(page.getByText(/^CRN-/).first()).toBeVisible({ timeout: 15_000 })

    // What the API actually stored: linked to the return, the customer and the
    // source invoice — the three fields the client used to get wrong.
    const note = theNewOne(
      await apiJson(page.request, '/api/v1/credit-notes?limit=100'),
      notesBefore,
      'credit note',
    )
    expect(note.number).toMatch(/^CRN-/)
    expect(note.status).toBe('APPLIED')
    expect(note.salesReturnId, 'note must link back to its sales return').toBe(salesReturn.id)
    expect(note.customerId, 'customerId is required by the API').toBeTruthy()
    expect(note.sourceInvoiceId).toBeTruthy()
    expect(money(note.amount)).toBe(222_000)
    expect(money(note.taxAmount)).toBe(22_000)

    // And what reached the ledger: balanced, posted, and on a returns account
    // rather than whichever account happened to sort first.
    const entries = await apiJson(page.request, '/api/v1/journal-entries?limit=100')
    const entry = entries.find((e: { memo?: string }) => e.memo?.includes(note.number))
    expect(entry, `no journal entry for ${note.number}`).toBeTruthy()
    expect(entry.status).toBe('POSTED')

    const lines: Array<{ debit: unknown; credit: unknown; account?: { code?: string } }> = entry.lines
    const debits = lines.reduce((sum, l) => sum + money(l.debit), 0)
    const credits = lines.reduce((sum, l) => sum + money(l.credit), 0)
    expect(debits, 'journal entry must balance').toBe(credits)
    expect(debits).toBe(222_000)

    const codes = lines.map((l) => l.account?.code)
    expect(codes, 'the return must debit a sales-returns account').toContain('5-2000')
    expect(codes, 'and credit A/R').toContain('1-1200')
    expect(codes, 'never Cash and Bank — nothing moved through a bank').not.toContain('1-1000')
  })
})
