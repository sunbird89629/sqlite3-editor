import { test, expect } from '@playwright/test'
import { exec, gotoApp, seed } from './helpers'

test('the schema view lists columns, the CREATE TABLE statement and the indexes', async ({ page }) => {
    await gotoApp(page)
    await seed(page, 'schema_test', '`id` VARCHAR(36) PRIMARY KEY, `value` VARCHAR(64) NOT NULL DEFAULT \'\'', ['id', 'value'], [['a', 'first']])
    await exec(page, 'CREATE INDEX `schema_test_value` ON `schema_test` (`value`)')
    await page.evaluate(async () => {
        const table = (window as any).useTableStore
        await table.getState().reloadAllTables('schema_test')
        await table.getState().setViewerQuery({ tableName: 'schema_test' })
    })

    await page.getByTestId('schema-button').click()
    await expect(page.getByTestId('schema-view')).toBeVisible()

    // Columns come from information_schema, so types and keys match the server.
    await expect(page.getByRole('cell', { name: 'id', exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'varchar(36)', exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'varchar(64)', exact: true })).toBeVisible()

    // The original statement is shown, with indexes included.
    await expect(page.getByTestId('schema-sql')).toContainText('CREATE TABLE `schema_test`')
    await expect(page.getByTestId('schema-sql')).toContainText('schema_test_value')

    // Wrapping can be turned off for long statements.
    await page.getByRole('button', { name: 'Wrap: On' }).click()
    await expect(page.getByTestId('schema-sql')).toHaveClass(/schema-sql-nowrap/)

    // The index list is read-only: no delete action exists.
    await expect(page.getByText('schema_test_value', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete…' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Back to data' }).click()
    await expect(page.getByTestId('viewer-table')).toBeVisible()
})
