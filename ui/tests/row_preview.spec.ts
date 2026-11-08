import { test, expect } from '@playwright/test'

test('row numbers preview saved records without discarding edits; delete remains available from the context menu', async ({ page }) => {
    await page.addInitScript(() => {
        ;(window as any).acquireVsCodeApi = () => ({
            getState: () => undefined, setState: () => {},
            postMessage: async (request: { requestId: number, path: string, body: Uint8Array }) => {
                if (request.path === '/guardInsertEditor' || request.path === '/openRowInEditor') {
                    if (request.path === '/openRowInEditor') { (window as any).rowPreviewRequest = request.body }
                    window.postMessage({ type: 'sqlite3-editor-server', requestId: request.requestId, body: new Uint8Array([request.path === '/guardInsertEditor' ? 0xc3 : 0xc0]) }, '*')
                    return
                }
                try {
                    const response = await fetch('http://localhost:8080' + request.path, { method: 'POST', body: request.body, headers: { 'Content-Type': 'application/octet-stream' } })
                    const result = response.ok ? { body: new Uint8Array(await response.arrayBuffer()) } : { err: await response.text() }
                    window.postMessage({ type: 'sqlite3-editor-server', requestId: request.requestId, ...result }, '*')
                } catch (error) { window.postMessage({ type: 'sqlite3-editor-server', requestId: request.requestId, err: String(error) }, '*') }
            },
        })
    })
    await page.goto('http://localhost:5173/')
    await page.evaluate(async () => {
        const remote = await (new Function('return import("/remote.ts")'))()
        await remote.query('CREATE TABLE IF NOT EXISTS row_preview_test (id INTEGER PRIMARY KEY, payload TEXT, binary BLOB)', [], 'w+')
        await remote.query('DELETE FROM row_preview_test', [], 'w+')
        await remote.query("INSERT INTO row_preview_test VALUES (9223372036854775807, 'original', X'00FF')", [], 'w+')
        const table = (window as any).useTableStore
        await table.getState().reloadAllTables('row_preview_test')
        await table.getState().setViewerQuery({ tableName: 'row_preview_test' })
    })
    const top = page.getByRole('region', { name: 'Query and actions' })
    const data = page.getByRole('region', { name: 'Table data and schema' })
    expect((await top.boundingBox())!.y).toBeLessThan((await data.boundingBox())!.y)
    expect((await page.getByTestId('row number 1').boundingBox())!.height).toBeGreaterThanOrEqual(38)
    await page.getByTestId('cell 0, 1').click()
    await page.getByTestId('inplaceInput').fill('unsaved edit')
    await page.getByTestId('row number 1').click()
    await expect(page.getByTestId('inplaceInput')).toHaveValue('unsaved edit')
    await expect(page.getByTestId('row number 1').locator('..')).toHaveClass(/editing/)
    const request = await page.evaluate(async () => {
        const { decodeMessage } = await (new Function('return import("/tests/message_helper.ts")'))()
        return decodeMessage((window as any).rowPreviewRequest)
    })
    expect(request.table).toBe('row_preview_test')
    expect(request.row).toBe('row 1')
    expect(request.source).toBe('saved')
    expect(JSON.parse(request.content)).toEqual({ id: { type: 'INTEGER', value: '9223372036854775807' }, payload: 'original', binary: { type: 'BLOB', hex: '00ff' } })
    await page.getByTestId('row number 1').press('Enter')
    await page.getByTestId('row number 1').click({ button: 'right' })
    await page.getByRole('button', { name: 'Delete…' }).click()
    await page.getByTestId('dialog > discard-changes').click()
    await expect(top.getByTestId('DELETE FROM')).toBeVisible()
    await expect(data.getByTestId('DELETE FROM')).toHaveCount(0)
})
