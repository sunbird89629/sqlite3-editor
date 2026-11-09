import { test, expect } from '@playwright/test'

test('the cell value lives in the right-hand editor and the panel keeps only the type and the actions', async ({ page }) => {
    await page.addInitScript(() => {
        const draft = { key: 'draft-key', text: '', open: true, dirty: false }
        const draftRequests: unknown[] = []
        const closeRequests: unknown[] = []
        ;(window as any).cellDrafts = { draft, draftRequests, closeRequests }
        ;(window as any).acquireVsCodeApi = () => ({
            getState: () => undefined, setState: () => {},
            postMessage: async (request: { requestId: number, path: string, body: Uint8Array }) => {
                const respond = (payload: Uint8Array) => window.postMessage({ type: 'sqlite3-editor-server', requestId: request.requestId, body: payload }, '*')
                // msgpack lives in the page, not in this classic script.
                const message = async () => (window as any).cellDrafts.decode(request.body)
                const snapshot = async () => (window as any).cellDrafts.encode({ ...draft })
                if (request.path === '/guardInsertEditor') { respond(new Uint8Array([0xc3])); return }
                if (request.path === '/openCellDraft') {
                    const body = await message() as { value: string }
                    draftRequests.push(body)
                    draft.text = body.value
                    draft.open = true
                    draft.dirty = false
                    respond(await snapshot())
                    return
                }
                if (request.path === '/setCellDraftText') {
                    const body = await message() as { text: string }
                    draft.text = body.text
                    draft.dirty = true
                    respond(await snapshot())
                    return
                }
                if (request.path === '/closeCellDraft') {
                    const body = await message() as { discard: boolean }
                    closeRequests.push(body)
                    if (body.discard) { draft.text = '' }
                    draft.open = false
                    respond(await snapshot())
                    return
                }
                if (request.path === '/openCellInEditor') {
                    ;(window as any).cellViewRequest = request.body
                    respond(new Uint8Array([0xc0]))
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
        const helper = await (new Function('return import("/tests/message_helper.ts")')()) as any
        ;(window as any).cellDrafts.encode = helper.encodeMessage
        ;(window as any).cellDrafts.decode = helper.decodeMessage
    })
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
    expect((await page.getByTestId('cell 0, 0').textContent())!.length).toBeLessThan(520)
    await page.getByTestId('cell 0, 0').click()
    await page.getByTestId('cell 0, 0').click()

    // The value is not rendered in the panel any more.
    await expect(page.getByTestId('editor-textarea')).toHaveCount(0)
    const opened = await page.evaluate(() => (window as any).cellDrafts.draftRequests)
    expect(opened).toEqual([{ table: 'cell_detail_test', column: 'payload', row: expect.stringMatching(/rowid = 1|row 1/), value: savedValue }])
    await expect(page.getByTestId('commit')).toBeDisabled()

    // Typing in the editor document marks the panel dirty.
    const draft = '{"id":9223372036854775807,"items":[1,2]}'
    await page.evaluate((text) => { window.postMessage({ type: 'sqlite-editor-cell-draft', key: 'draft-key', text, dirty: true, open: true }, '*') }, draft)
    await expect(page.getByTestId('commit')).toBeEnabled()

    // Commit writes the draft text and drops the draft.
    await page.getByTestId('commit').click()
    await expect.poll(async () => page.evaluate(async () => {
        const remote = await (new Function('return import("/remote.ts")'))()
        const rows = await remote.query('SELECT payload FROM cell_detail_test', [], 'r')
        return rows.records[0].payload
    })).toBe(draft)
    expect(await page.evaluate(() => (window as any).cellDrafts.closeRequests)).toEqual([{ key: 'draft-key', discard: true }])

    // A closed editor tab keeps the draft content, so the panel stays dirty.
    await page.getByTestId('cell 0, 0').click()
    await page.getByTestId('cell 0, 0').click()
    await page.evaluate(() => { window.postMessage({ type: 'sqlite-editor-cell-draft', key: 'draft-key', text: 'kept', dirty: true, open: false }, '*') })
    await expect(page.getByTestId('commit')).toBeEnabled()

    // Cancel discards the draft.
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect.poll(async () => page.evaluate(() => (window as any).cellDrafts.closeRequests.length)).toBe(2)
    expect(await page.evaluate(() => (window as any).cellDrafts.closeRequests[1])).toEqual({ key: 'draft-key', discard: true })

    // The right-click preview of the stored value still opens a read-only snapshot.
    await page.getByTestId('cell 0, 0').click({ button: 'right' })
    await page.getByRole('button', { name: 'Preview Saved Value in Editor' }).click()
    await expect.poll(async () => page.evaluate(async () => {
        const { decodeMessage } = await (new Function('return import("/tests/message_helper.ts")'))()
        return decodeMessage((window as any).cellViewRequest)
    })).toEqual({ content: draft, column: 'payload', table: 'cell_detail_test', row: 'row 1', source: 'saved' })
})
