import { test, expect } from '@playwright/test'
import { gotoApp, numberedRows, seed } from './helpers'

const seedSelection = async (page: import('@playwright/test').Page) => {
    await gotoApp(page)
    await seed(page, 'selection_test', '`id` INT PRIMARY KEY, `name` TEXT', ['id', 'name'], numberedRows(12, (i) => `n${i}`))
    await expect(page.getByTestId('row-count')).toHaveText('12 rows')
}

test('the first click selects a cell and nothing enters an edit state', async ({ page }) => {
    await seedSelection(page)
    const cell = page.getByTestId('cell 0, 1')
    await cell.click()
    await expect(cell).toHaveAttribute('data-cell-selected', 'true')
    // Selection never opens an in-place editor.
    await expect(page.locator('table textarea')).toHaveCount(0)
    // Escape clears the selection.
    await page.keyboard.press('Escape')
    await expect(page.locator('td[data-cell-selected="true"]')).toHaveCount(0)
})

test('double click and Enter open the full value in a read-only snapshot', async ({ page }) => {
    await seedSelection(page)
    const cell = page.getByTestId('cell 0, 1')
    await cell.click()

    // In the development server the snapshot opens as a browser tab.
    const byDoubleClick = page.waitForEvent('popup')
    await cell.dblclick()
    const first = await byDoubleClick
    await first.waitForLoadState()
    expect(await first.evaluate(() => document.body.innerText)).toBe('n1')

    const byEnter = page.waitForEvent('popup')
    await cell.press('Enter')
    const second = await byEnter
    await second.waitForLoadState()
    expect(await second.evaluate(() => document.body.innerText)).toBe('n1')

    // The value never becomes editable in the grid.
    await expect(page.locator('table textarea')).toHaveCount(0)
    await expect(cell).toHaveAttribute('data-cell-selected', 'true')
})

test('arrow keys move the selection across cells and pages', async ({ page }) => {
    await seedSelection(page)
    await page.getByTestId('cell 0, 0').click()
    await expect(page.getByTestId('cell 0, 0')).toHaveAttribute('data-cell-selected', 'true')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('cell 0, 1')).toHaveAttribute('data-cell-selected', 'true')
    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId('cell 1, 1')).toHaveAttribute('data-cell-selected', 'true')
    await page.keyboard.press('ArrowUp')
    await expect(page.getByTestId('cell 0, 1')).toHaveAttribute('data-cell-selected', 'true')
    // Moving up from the first row of the first page stays put.
    await page.keyboard.press('ArrowUp')
    await expect(page.getByTestId('cell 0, 1')).toHaveAttribute('data-cell-selected', 'true')
    // Moving down past the last visible row turns the page and selects its first row.
    for (let i = 0; i < 10; i++) { await page.keyboard.press('ArrowDown') }
    await expect(page.getByTestId('page-input')).toHaveValue('2')
    await expect(page.locator('td[data-cell-selected="true"]')).toHaveCount(1)
})

test('the row number opens a read-only snapshot', async ({ page }) => {
    await seedSelection(page)
    const popup = page.waitForEvent('popup')
    await page.getByTestId('row number 1').click()
    const opened = await popup
    await opened.waitForLoadState()
    expect(opened.url()).toContain('blob:')
})
