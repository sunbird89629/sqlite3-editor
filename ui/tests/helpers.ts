import type { Page } from '@playwright/test'

export const APP_URL = 'http://localhost:5173/'

/** Loads the webview against the development server. */
export const gotoApp = async (page: Page) => { await page.goto(APP_URL) }

/**
 * Seeds fixtures through the test-only endpoint of the development server.
 * The extension itself can only read, so every fixture has to exist beforehand.
 */
export const exec = async (page: Page, sql: string, params: unknown[] = []) => {
    await page.evaluate(async ([sql, params]) => {
        const remote = await (new Function('return import("/remote.ts")'))()
        await remote.post('/test/execute', { query: sql, params })
    }, [sql, params] as [string, unknown[]])
}

/** Inserts rows built as one multi-row `INSERT`, so seeding stays a single round trip. */
export const insertRows = async (page: Page, table: string, columns: string[], rows: unknown[][]) => {
    const values = rows.map((row) => `(${row.map(() => "?").join(", ")})`).join(", ")
    await exec(page, `INSERT INTO \`${table}\` (${columns.map((column) => `\`${column}\``).join(", ")}) VALUES ${values}`, rows.flat())
}

/** Replaces the fixtures of a table and points the viewer at it. */
export const seed = async (page: Page, table: string, definition: string, columns: string[], rows: unknown[][] = []) => {
    await exec(page, `DROP TABLE IF EXISTS \`${table}\``)
    await exec(page, `CREATE TABLE \`${table}\` (${definition})`)
    if (rows.length > 0) { await insertRows(page, table, columns, rows) }
    await page.evaluate(async (name) => {
        const table = (window as any).useTableStore
        await table.getState().reloadAllTables(name)
        await table.getState().setViewerQuery({ tableName: name })
    }, table)
}

/** The rows `1..count` with a `name` column that makes ordering easy to verify. */
export const numberedRows = (count: number, name: (i: number) => string = (i) => `name ${i}`) =>
    Array.from({ length: count }, (_, i) => [i + 1, name(i + 1)])
