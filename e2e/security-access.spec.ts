import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { accountingCompany, cleanupAccountingCompany, db, api } from './accounting-helpers'

test.afterEach(async () => { await cleanupAccountingCompany() })
test.afterAll(async () => { await db.$disconnect() })
const API = 'http://localhost:3100/api/v1'

test('removed company membership immediately blocks an existing admin session', async ({ page }) => {
  const { orgId } = await accountingCompany(page)
  expect((await page.request.get(`${API}/users`)).ok()).toBeTruthy()
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@demo.com' } })
  await db.userOrganization.updateMany({ where: { userId: admin.id, organizationId: orgId }, data: { isActive: false } })
  const blocked = await page.request.get(`${API}/users`, { headers: { 'x-role-type': 'ADMIN', 'x-org-id': orgId } })
  expect(blocked.status()).toBe(403)
  expect(await blocked.json()).toMatchObject({ code: 'ORG_MEMBERSHIP' })
})

test('downgraded admin cannot keep settings privileges through its old cookie', async ({ page }) => {
  const { orgId } = await accountingCompany(page)
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@demo.com' } })
  const viewer = await db.role.create({ data: { organizationId: orgId, name: 'Security Viewer', roleType: 'VIEWER' } })
  await db.userOrganization.updateMany({ where: { userId: admin.id, organizationId: orgId }, data: { roleId: viewer.id } })
  expect((await page.request.get(`${API}/users`, { headers: { 'x-role-type': 'ADMIN' } })).status()).toBe(403)
  const session = await page.request.get(`${API}/auth/me`)
  expect((await session.json()).role.type).toBe('VIEWER')
})

test('temporary password gates business APIs until the real password form succeeds', async ({ page }) => {
  const { orgId } = await accountingCompany(page)
  const role = await db.role.findFirstOrThrow({ where: { organizationId: orgId, roleType: 'ADMIN' } })
  const email = `security-${randomUUID()}@example.test`
  const created = await api(page, '/users', { email, fullName: 'Security Test', roleId: role.id }, 'POST')
  const login = await page.request.post(`${API}/auth/login`, { data: { email, password: created.temporaryPassword } })
  expect(login.ok()).toBeTruthy()
  expect((await login.json()).mustChangePassword).toBe(true)
  const blocked = await page.request.get(`${API}/users`)
  expect(blocked.status()).toBe(403)
  expect(await blocked.json()).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' })
  await page.goto(`/?org=${orgId}`)
  await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible()
  const inputs = page.locator('input[type="password"]')
  await inputs.nth(0).fill(created.temporaryPassword)
  await inputs.nth(1).fill('Changed-Security-Password-42')
  await inputs.nth(2).fill('Changed-Security-Password-42')
  await page.getByRole('button', { name: 'Set Password' }).click()
  await expect(page.locator('nav').first()).toBeVisible()
  expect((await page.request.get(`${API}/users`)).ok()).toBeTruthy()
  const stored = await db.user.findUniqueOrThrow({ where: { id: created.id } })
  expect(stored.mustChangePassword).toBe(false)
  expect(stored.passwordHash).not.toBe(created.temporaryPassword)
  await db.user.update({ where: { id: created.id }, data: { status: 'INACTIVE' } })
  expect((await page.request.get(`${API}/users`)).status()).toBe(403)
  expect((await page.request.post(`${API}/auth/login`, { data: { email, password: 'Changed-Security-Password-42' } })).status()).toBe(403)
})
