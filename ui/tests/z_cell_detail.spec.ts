import { test, expect } from '@playwright/test'

test('cell controls are above the editor and the current draft is sent for viewing', async ({ page }) => {
    await page.addInitScript(() => {
        ;(window as any).acquireVsCodeApi = () => ({
            getState: () => undefined, setState: () => {},
            postMessage: async (request: { requestId: number, path: string, body: Uint8Array }) => {
                if (request.path === '/openCellInEditor') {
                    ;(window as any).cellViewRequest = request.body
                    window.postMessage({ type: 'sqlite3-editor-server', requestId: request.requestId, body: new Uint8Array([0xc0]) }, '*')
                    return
                }
                try {
                    const response = await fetch('http://localhost:8080' + request.path, { method: 'POST', body: request.body, headers: { 'Content-Type': 'application/octet-stream' } })
                    const message = response.ok ? { body: new Uint8Array(await response.arrayBuffer()) } : { err: await response.text() }
                    window.postMessage({ type: 'sqlite3-editor-server', requestId: request.requestId, ...message }, '*')
                } catch (error) { window.postMessage({ type: 'sqlite3-editor-server', requestId: request.requestId, err: String(error) }, '*') }
            },
        })
    })
    await page.goto('http://localhost:5173/')
    await page.evaluate(async () => {
        const remote = await (new Function('return import("/remote.ts")'))()
        await remote.query('DROP TABLE IF EXISTS cell_detail_test', [], 'w+')
        await remote.query('CREATE TABLE cell_detail_test (payload TEXT)', [], 'w+')
        await remote.query('INSERT INTO cell_detail_test VALUES (?)', ['original-' + '长😀'.repeat(4000)], 'w+')
        const table = (window as any).useTableStore
        await table.getState().reloadAllTables('cell_detail_test')
        await table.getState().setViewerQuery({ tableName: 'cell_detail_test' })
    })
    const savedValue = 'original-' + '长😀'.repeat(4000)
    const cellText = await page.getByTestId('cell 0, 0').textContent()
    expect(cellText!.length).toBeLessThan(520)
    expect(cellText).toContain('…')
    await page.getByTestId('cell 0, 0').click()
    const input = page.getByTestId('editor-textarea')
    await expect(input).toHaveValue(savedValue)
    await expect(page.getByTestId('commit')).toBeDisabled()
    const originalHeight = (await input.boundingBox())!.height
    await page.getByRole('button', { name: 'Expand', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Collapse', exact: true })).toBeVisible()
    expect((await input.boundingBox())!.height).toBeGreaterThan(originalHeight)
    await page.getByRole('button', { name: 'Collapse', exact: true }).click()
    expect(Math.abs((await input.boundingBox())!.height - originalHeight)).toBeLessThan(2)
    await expect(page.getByRole('status')).toContainText('Saved')
    const draft = '{"id":9223372036854775807,"items":[1,2]}'
    await input.fill(draft)
    await expect(page.getByTestId('commit')).toBeEnabled()
    await expect(page.getByRole('status')).toContainText('Unsaved')
    const textareaBox = await input.boundingBox()
    for (const button of [page.getByTestId('commit'), page.getByRole('button', { name: 'Cancel', exact: true }), page.getByTestId('view-cell-in-editor')]) {
        const box = await button.boundingBox()
        expect(box!.y + box!.height).toBeLessThanOrEqual(textareaBox!.y)
    }
    await page.getByTestId('view-cell-in-editor').click()
    await expect(input).toHaveValue(draft)
    const result = await page.evaluate(async () => {
        const { decodeMessage } = await (new Function('return import("/tests/message_helper.ts")'))()
        const request = decodeMessage((window as any).cellViewRequest)
        const remote = await (new Function('return import("/remote.ts")'))()
        const rows = await remote.query('SELECT payload FROM cell_detail_test', [], 'r')
        return { request, saved: rows.records[0].payload }
    })
    expect(result.request).toEqual({ content: draft, column: 'payload', table: 'cell_detail_test', row: 'row 1', source: 'draft' })
    expect(result.saved).toBe(savedValue)
    await page.getByTestId('cell 0, 0').click({ button: 'right' })
    await page.getByRole('button', { name: 'Preview Saved Value in Editor' }).click()
    const savedRequest = await page.evaluate(async () => {
        const { decodeMessage } = await (new Function('return import("/tests/message_helper.ts")'))()
        return decodeMessage((window as any).cellViewRequest)
    })
    expect(savedRequest).toEqual({ content: savedValue, column: 'payload', table: 'cell_detail_test', row: 'row 1', source: 'saved' })
    await expect(input).toHaveValue(draft)
})
