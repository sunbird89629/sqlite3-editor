import { test, expect } from '@playwright/test'
import { gotoApp, numberedRows, seed } from './helpers'

test('fixed pages, boundaries and data source changes', async ({ page }) => {
    await gotoApp(page)
    const arithmetic = await page.evaluate(async () => {
        const { pageCount, pageOffset } = await (new Function('return import("/table.tsx")'))()
        return [0n, 10n, 11n, 23n, 90071992547409931n].map((n) => [String(pageCount(n)), String(pageOffset(n, n))])
    })
    expect(arithmetic).toEqual([['0', '0'], ['1', '0'], ['2', '10'], ['3', '20'], ['9007199254740994', '90071992547409930']])

    await seed(page, 'pagination_test', '`id` INT PRIMARY KEY, `value` TEXT', ['id', 'value'], numberedRows(23, (i) => `value ${i}`))
    const totalPages = page.getByTestId('page-indicator')
    const pageInput = page.getByTestId('page-input')
    const previous = page.getByRole('button', { name: 'Previous', exact: true })
    const next = page.getByRole('button', { name: 'Next', exact: true })
    await expect(pageInput).toHaveValue('1')
    await expect(totalPages).toHaveText('3')
    await expect(previous).toBeDisabled()

    await next.click()
    await expect(pageInput).toHaveValue('2')
    await expect(page.getByTestId('row number 11')).toBeVisible()
    await next.click()
    await expect(pageInput).toHaveValue('3')
    await expect(next).toBeDisabled()
    await expect(page.getByTestId('row number 23')).toBeVisible()

    // A page jump past the last page is clipped.
    await pageInput.fill('99')
    await pageInput.press('Enter')
    await expect(pageInput).toHaveValue('3')

    // Switching the data source returns to the first page.
    await page.getByTestId('mode-query').click()
    await page.getByTestId('custom-query-input').fill('SELECT * FROM pagination_test WHERE id <= 3')
    await page.getByTestId('run-query').click()
    await expect(pageInput).toHaveValue('1')
    await expect(totalPages).toHaveText('1')

    // A query without rows shows the empty state.
    await page.getByTestId('custom-query-input').fill('SELECT * FROM pagination_test WHERE 1 = 0')
    await page.getByTestId('run-query').click()
    await expect(totalPages).toHaveText('0')
    await expect(previous).toBeDisabled()
})

test('a table without a single-column primary key pages by offset', async ({ page }) => {
    await gotoApp(page)
    await seed(page, 'pagination_nopk', '`a` INT, `b` INT', ['a', 'b'], Array.from({ length: 14 }, (_, i) => [i + 1, i * 2]))
    await expect(page.getByTestId('row-count')).toHaveText('14 rows')
    await expect(page.getByTestId('page-indicator')).toHaveText('2')
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(page.getByTestId('row number 11')).toBeVisible()
    await expect(page.getByTestId('cell 10, 0')).toHaveText('11')
    // Offset paging still sorts correctly.
    await page.locator('th[title="Sort by b"]').click()
    await expect(page.locator('th[title="Sort by b"]')).toHaveAttribute('aria-sort', 'ascending')
    await expect(page.getByTestId('page-input')).toHaveValue('1')
})

test('a composite primary key also falls back to offset paging', async ({ page }) => {
    await gotoApp(page)
    await seed(page, 'pagination_composite', '`a` INT, `b` INT, PRIMARY KEY (`a`, `b`)', ['a', 'b'], Array.from({ length: 12 }, (_, i) => [i + 1, i + 1]))
    await expect(page.getByTestId('row-count')).toHaveText('12 rows')
    await expect(page.getByTestId('page-input')).toHaveValue('1')
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(page.getByTestId('row number 11')).toBeVisible()
})
