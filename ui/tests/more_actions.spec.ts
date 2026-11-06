import { test, expect } from '@playwright/test'

test('more actions closes on outside clicks and after selecting an action', async ({ page }) => {
    await page.goto('http://localhost:5173/')
    const menu = page.locator('details').filter({ has: page.getByText('More actions') })
    const toggle = menu.locator('summary')
    const action = page.getByTestId('create-table-button')

    await toggle.click()
    await expect(action).toBeVisible()
    await page.getByTestId('query-editor-toggle').click()
    await expect(menu).not.toHaveAttribute('open', '')

    await toggle.click()
    await action.click()
    await expect(menu).not.toHaveAttribute('open', '')
    await expect(page.getByTestId('CREATE TABLE')).toBeVisible()
})
