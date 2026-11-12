import { render } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { QueryEditor } from "./query_editor"
import { TableSelector } from "./table_selector"
import * as remote from "./remote"
import { Button, Highlight, renderContextmenu } from "./components"
import { escapeIdentifier, getTableList } from "./dialect"
import { Table, useTableStore } from "./table"
import { SchemaView } from "./schema_view"
import { onKeydown } from "./keybindings"
// @ts-ignore
import codiconTxt from "./codicon.txt?raw"
import { useEventListener } from "usehooks-ts"

export type VSCodeAPI = {
    postMessage(data: unknown): void
    getState(): unknown
    setState(value: unknown): void
}

declare global {
    interface Window {
        acquireVsCodeApi?: () => VSCodeAPI
    }
}

/** Looping animation to indicate loading state, visible only when body.querying. */
const LoadingIndicator = () => {
    const ref = useRef<HTMLDivElement>(null)
    let x = 0
    const width = 200
    const t = Date.now()
    useEffect(() => {
        if (ref.current === null) { return }
        let canceled = false
        const loop = () => {
            if (canceled) { return }
            if (document.body.classList.contains("querying")) {
                ref.current!.style.left = `${x}px`
                x = (Date.now() - t) % (window.innerWidth + width) - width
                ref.current!.style.opacity = "1"
            } else {
                ref.current!.style.opacity = "0"
            }
            requestAnimationFrame(loop)
        }
        loop()
        return () => { canceled = true }
    }, [])
    return <div class="progressbar inline-block select-none pointer-events-none absolute top-0 z-[100] h-[5px] bg-primary opacity-0 [transition:opacity_0.5s_cubic-bezier(1.000,0.060,0.955,-0.120)]" ref={ref} style={{ width: width + "px" }}></div>
}

/** The root element. */
const App = () => {
    const [showQueryEditor, setShowQueryEditor] = useState(false)
    const [queryResult, setQueryResult] = useState<{ columns: string[], rows: string[][], total: number } | null>(null)
    const errorMessage = useTableStore((s) => s.errorMessage)
    const tableList = useTableStore((s) => s.tableList)
    const setViewerQuery = useTableStore((s) => s.setViewerQuery)
    const useCustomViewerQuery = useTableStore((s) => s.useCustomViewerQuery)
    const customViewerQuery = useTableStore((s) => s.customViewerQuery)
    const tableName = useTableStore((s) => s.tableName)
    // The schema tab is a transient view: it always starts on the data tabs.
    const [isSchemaViewOpen, setIsSchemaViewOpen] = useState(false)
    const tableRef = useRef<HTMLDivElement>(null)
    const moreActionsRef = useRef<HTMLDetailsElement>(null)

    useEffect(() => {
        const listener = (event: MessageEvent) => {
            if (event.data?.type === "sqlite3-editor-query-result") { setQueryResult(event.data) }
        }
        window.addEventListener("message", listener)
        return () => window.removeEventListener("message", listener)
    }, [])

    // Register keyboard shortcuts
    useEventListener("keydown", onKeydown)

    useEventListener("click", (event) => {
        const menu = moreActionsRef.current
        if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) {
            menu.open = false
        }
    })

    // Call preventDefault() on unhandled contextmenu events while the context menu is open
    useEventListener("contextmenu", (ev) => {
        if (!document.querySelector<HTMLDialogElement>("#contextmenu")!.open) { return }
        if (ev.defaultPrevented) { return }
        ev.preventDefault()
        if (document.querySelector<HTMLDialogElement>("#contextmenu")!.open) {
            document.querySelector<HTMLDialogElement>("#contextmenu")!.close()
        }
    }, { current: document.body })

    // Viewer query draft, ordering, filtering and the read-only query mode.
    const sort = useTableStore((s) => s.sort)
    const setSort = useTableStore((s) => s.setSort)
    const filter = useTableStore((s) => s.filter)
    const setFilter = useTableStore((s) => s.setFilter)
    const invalidQuery = useTableStore((s) => s.invalidQuery)
    const numRecords = useTableStore((s) => s.paging.numRecords)
    const reloadAllTables = useTableStore((s) => s.reloadAllTables)
    const viewerLoading = useTableStore((s) => s.viewerLoading)
    const viewerStale = useTableStore((s) => s.viewerStale)
    const pendingQuery = useTableStore((s) => s.pendingQuery)
    const [queryDraft, setQueryDraft] = useState(customViewerQuery)
    const [queryError, setQueryError] = useState("")
    const [filterDraft, setFilterDraft] = useState(filter)
    const [pendingLeaveQuery, setPendingLeaveQuery] = useState(false)
    const leaveQueryDialogRef = useRef<HTMLDialogElement>(null)
    const [queryTextarea, setQueryTextarea] = useState<HTMLTextAreaElement | null>(null)
    const filterTimer = useRef<number | undefined>(undefined)

    const queryDraftDirty = queryDraft.trim() !== customViewerQuery.trim() && queryDraft.trim() !== ""
    const queryIsEmpty = useCustomViewerQuery && customViewerQuery.trim() === ""
    const noTables = !useCustomViewerQuery && tableList.length === 0
    const examples = [
        `SELECT * FROM ${escapeIdentifier(tableName ?? "table-name")}`,
        "SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()",
        "SHOW CREATE TABLE table-name",
    ]

    useEffect(() => { setQueryDraft(customViewerQuery) }, [customViewerQuery])
    useEffect(() => {
        if (pendingQuery === null) { return }
        useTableStore.setState({ pendingQuery: null })
        setQueryError("")
        setQueryDraft(pendingQuery)
    }, [pendingQuery])
    useEffect(() => { setFilterDraft(filter) }, [filter])
    useEffect(() => { if (useCustomViewerQuery) { queryTextarea?.focus() } }, [useCustomViewerQuery, queryTextarea])
    useEffect(() => {
        if (!pendingLeaveQuery) { return }
        leaveQueryDialogRef.current?.showModal()
    }, [pendingLeaveQuery])
    useEventListener("close", () => { setPendingLeaveQuery(false) }, leaveQueryDialogRef)

    const switchMode = (toQuery: boolean) => {
        if (toQuery === useCustomViewerQuery) { return }
        setQueryError("")
        // Leaving the query mode with an unexecuted draft asks first; the draft itself is kept either way.
        if (!toQuery && queryDraftDirty) { setPendingLeaveQuery(true); return }
        setViewerQuery({ useCustomViewerQuery: toQuery }).catch(console.error)
    }
    const applyFilter = (value: string) => {
        window.clearTimeout(filterTimer.current)
        setFilter(value).catch(console.error)
    }
    const runQuery = async () => {
        const sql = queryDraft.trim().replace(/;\s*$/, "")
        if (sql === "") { setQueryError("Enter a SQL query first."); return }
        if (!/^\s*(select|with|show|desc|describe|explain|table)\b/i.test(sql)) { setQueryError("The viewer is read-only. Use the SQL Editor for other statements."); return }
        setQueryError("")
        await setViewerQuery({ customViewerQuery: sql }).catch(console.error)
    }

    // Column visibility picker, anchored under the column list in `SELECT ... FROM`.
    const visibleColumns = useTableStore((s) => s.visibleColumns)
    const setVisibleColumns = useTableStore((s) => s.setVisibleColumns)
    const columns = useTableStore((s) => s.columns)
    const [columnPickerOpen, setColumnPickerOpen] = useState(false)
    const [columnPickerError, setColumnPickerError] = useState(false)
    const columnPickerRef = useRef<HTMLDivElement>(null)
    const columnPickerTriggerRef = useRef<HTMLButtonElement>(null)

    useEffect(() => {
        setColumnPickerOpen(false)
        setColumnPickerError(false)
    }, [useCustomViewerQuery, tableName])
    useEffect(() => {
        if (!columnPickerOpen) { return }
        columnPickerRef.current?.querySelector<HTMLInputElement>("input")?.focus()
        const close = () => { setColumnPickerOpen(false); setColumnPickerError(false) }
        const onPointerDown = (ev: PointerEvent) => {
            const target = ev.target as Node
            if (columnPickerRef.current?.contains(target) || columnPickerTriggerRef.current?.contains(target)) { return }
            close()
        }
        const onKeyDown = (ev: KeyboardEvent) => {
            if (ev.key !== "Escape") { return }
            ev.preventDefault()
            ev.stopPropagation()
            close()
            columnPickerTriggerRef.current?.focus()
        }
        document.addEventListener("pointerdown", onPointerDown)
        document.addEventListener("keydown", onKeyDown, true)
        return () => {
            document.removeEventListener("pointerdown", onPointerDown)
            document.removeEventListener("keydown", onKeyDown, true)
        }
    }, [columnPickerOpen])
    const toggleColumn = async (name: string) => {
        setColumnPickerError(false)
        if (visibleColumns.includes(name)) {
            if (visibleColumns.length === 1) { setColumnPickerError(true); return }
            await setVisibleColumns(visibleColumns.filter((column) => column !== name))
        } else {
            await setVisibleColumns([...visibleColumns, name])
        }
    }
    const visibleColumnsSQL = useTableStore((s) => s.getVisibleColumnsSQL())

    return <>
        {/* @vscode/codicons/dist/codicon.svg, https://github.com/microsoft/vscode-codicons, Attribution 4.0 International */}
        <svg xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" dangerouslySetInnerHTML={{ __html: codiconTxt }}></svg>

        <LoadingIndicator />

        <section class="query-area" aria-label="Query and actions">
            <div class="viewer-toolbar">
                <div class="viewer-modes" role="tablist" aria-label="Data view mode">
                    <button type="button" role="tab" aria-selected={!useCustomViewerQuery} class={!useCustomViewerQuery ? "active" : ""} onClick={() => { switchMode(false) }} data-testid="mode-table">Table</button>
                    <button type="button" role="tab" aria-selected={useCustomViewerQuery} class={useCustomViewerQuery ? "active" : ""} onClick={() => { switchMode(true) }} data-testid="mode-query">Custom query{queryDraftDirty && <span class="viewer-dirty-dot" title="This draft has not been run">●</span>}</button>
                </div>
                <div class="viewer-globals">
                    <Button onClick={() => { if (remote.isVSCode) { remote.openNativeQuery(tableName).catch(console.error) } else { setShowQueryEditor(!showQueryEditor) } }} data-testid="query-editor-toggle">SQL Editor</Button>
                    <Button secondary onClick={() => { reloadAllTables().catch(console.error) }} data-testid="refresh">Refresh</Button>

                    <details ref={moreActionsRef} class="inline-block relative align-middle">
                        <summary class="cursor-pointer px-2 py-1 bg-gray-200 focus:outline focus:outline-2">More actions</summary>
                        <div class="more-actions absolute z-50 min-w-[240px] p-2 bg-white border border-gray-400 shadow-lg" onClick={(event) => {
                            if (event.target instanceof Element && event.target.closest("button")) {
                                if (moreActionsRef.current) { moreActionsRef.current.open = false }
                            }
                        }}>
                            {!useCustomViewerQuery && tableName && <button onClick={() => { setIsSchemaViewOpen(true) }}>Show Table Schema and Indexes</button>}
                            <button onClick={() => { reloadAllTables().catch(console.error) }}>Refresh</button>
                            {!useCustomViewerQuery && tableName && <button onClick={() => { navigator.clipboard.writeText(tableName).catch(console.error) }}>Copy Table Name</button>}
                            {tableName && <button onClick={async () => { await useTableStore.getState().seedQuery(`SELECT * FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${JSON.stringify(tableName)}`) }}>Describe Columns in Query Mode</button>}
                        </div>
                    </details>
                </div>
            </div>

            {!useCustomViewerQuery
                ? <h2 class="pt-[var(--page-padding)]">
                    <div class="mb-2">
                        <Highlight>SELECT </Highlight>
                        <span class="column-picker">
                            <button
                                type="button"
                                ref={columnPickerTriggerRef}
                                aria-label="Select visible columns"
                                aria-haspopup="dialog"
                                aria-expanded={columnPickerOpen}
                                data-testid="column-picker-trigger"
                                class="column-picker-trigger"
                                onClick={() => { setColumnPickerOpen(!columnPickerOpen); setColumnPickerError(false) }}>{visibleColumnsSQL}</button>
                            {columnPickerOpen && <div ref={columnPickerRef} class="column-picker-popover" role="dialog" aria-label="Visible columns" data-testid="column-picker">
                                <div class="column-picker-title">Visible columns</div>
                                <div class="column-picker-list">
                                    {columns.map(({ name }) => <label class="column-picker-item" data-testid={`column-picker-item ${name}`}>
                                        <input
                                            type="checkbox"
                                            checked={visibleColumns.includes(name)}
                                            onChange={() => { toggleColumn(name).catch(console.error) }} />
                                        <span class="column-picker-name">{name}</span>
                                    </label>)}
                                </div>
                                {columnPickerError && <p class="column-picker-error" role="status">Keep at least one column visible.</p>}
                            </div>}
                        </span>
                        <Highlight> FROM </Highlight>
                        {tableName === undefined ? <>No tables</> : <TableSelector
                            value={tableName}
                            onChange={(value) => { setViewerQuery({ tableName: value }).catch(console.error) }}
                            tables={tableList}
                            onContextMenu={(ev) => {
                                renderContextmenu(ev, <>
                                    <button onClick={() => { setIsSchemaViewOpen(!isSchemaViewOpen) }}>Show Table Schema and Indexes</button>
                                    <hr />
                                    <button onClick={() => { navigator.clipboard.writeText(tableName).catch(console.error) }}>Copy Table Name</button>
                                </>)
                            }}
                        />}
                    </div>
                </h2>
                : <section class="viewer-query" aria-label="Custom query">
                    <textarea
                        ref={setQueryTextarea}
                        class="viewer-query-sql"
                        spellcheck={false}
                        autocomplete="off"
                        placeholder="SELECT * FROM table-name"
                        aria-label="Custom query SQL"
                        data-testid="custom-query-input"
                        value={queryDraft}
                        onInput={(ev) => { setQueryDraft(ev.currentTarget.value); setQueryError("") }}
                        onKeyDown={(ev) => {
                            if (ev.ctrlKey && ev.code === "Enter") { ev.preventDefault(); ev.stopPropagation(); runQuery().catch(console.error) }
                        }}
                    ></textarea>
                    {queryDraft.trim() === "" && <div class="viewer-query-examples">
                        <span>Try</span>
                        {examples.map((sql) => <button type="button" class="viewer-query-example" key={sql} onClick={() => { setQueryDraft(sql); queryTextarea?.focus() }}>{sql}</button>)}
                    </div>}
                    <div class="viewer-query-actions">
                        <Button onClick={() => { runQuery().catch(console.error) }} data-testid="run-query">Run query<span class="opacity-60 ml-2 [font-size:70%]">Ctrl+Enter</span></Button>
                        {remote.isVSCode && <Button secondary={true} data-testid="open-in-sql-editor" onClick={() => { remote.openNativeQuery(tableName, queryDraft).catch(console.error) }}>Open in SQL Editor</Button>}
                        <span class="viewer-query-hint">Read-only · counting a complex query can take a while</span>
                    </div>
                    {(queryError !== "" || invalidQuery !== null) && <p class="viewer-error" role="alert" data-testid="query-error">{queryError !== "" ? queryError : invalidQuery}</p>}
                </section>}
        </section>

        <section class="data-area" aria-label="Table data and schema">
            <div class="viewer-meta" style={{ display: isSchemaViewOpen && !useCustomViewerQuery ? "none" : undefined }}>
                <div class="viewer-meta-info">
                    {useCustomViewerQuery && <span class="viewer-readonly-badge">Read-only</span>}
                    {viewerLoading && <span class="viewer-loading-chip" role="status">Loading…</span>}
                    {viewerStale && <span class="viewer-stale-chip">Showing the last successful result</span>}
                    <span data-testid="row-count">{numRecords.toString()} {numRecords === 1n ? "row" : "rows"}</span>
                    {sort !== null && <span class="viewer-meta-sub">· sorted by {sort.column} {sort.direction === "asc" ? "↑" : "↓"}</span>}
                    {filter.trim() !== "" && <span class="viewer-meta-sub">· filtered</span>}
                    <span class="viewer-meta-sub" data-testid="capability-notice" title="This session has no SQL analysis engine: completion, code lenses, diagnostics and parameter binding are unavailable.">· no completion or diagnostics</span>
                </div>
                <div class="viewer-meta-actions">
                    <input
                        class="viewer-filter"
                        aria-label="Filter rows"
                        placeholder="Filter rows…"
                        data-testid="viewer-filter"
                        value={filterDraft}
                        disabled={noTables || queryIsEmpty}
                        onInput={(ev) => {
                            const value = ev.currentTarget.value
                            setFilterDraft(value)
                            window.clearTimeout(filterTimer.current)
                            filterTimer.current = window.setTimeout(() => { applyFilter(value) }, 250)
                        }}
                        onKeyDown={(ev) => {
                            if (ev.key === "Enter") { ev.preventDefault(); window.clearTimeout(filterTimer.current); applyFilter(filterDraft) }
                        }}
                        onBlur={() => { window.clearTimeout(filterTimer.current); applyFilter(filterDraft) }}
                    />
                    {sort !== null && <button type="button" class="viewer-clear-sort" onClick={() => { setSort(null).catch(console.error) }} data-testid="clear-sort">Clear sort ×</button>}
                </div>
            </div>
            {queryResult && <section class="native-query-result" data-testid="native-query-result">
                <div class="native-query-head">
                    <strong>Query result</strong>
                    <span>{queryResult.total} row(s){queryResult.total > 500 ? " (first 500 shown)" : ""}</span>
                    <span class="native-query-actions">
                        <Button secondary onClick={() => {
                            const cell = (value: string) => `"${value.replaceAll('"', '""')}"`
                            const csv = [queryResult.columns.map(cell).join(","), ...queryResult.rows.map((row) => row.map(cell).join(","))].join("\n")
                            navigator.clipboard.writeText(csv).catch(console.error)
                        }}>Copy CSV</Button>
                        <Button secondary onClick={() => {
                            const records = queryResult.rows.map((row) => Object.fromEntries(queryResult.columns.map((column, i) => [column, row[i]])))
                            navigator.clipboard.writeText(JSON.stringify(records, null, 2)).catch(console.error)
                        }}>Copy JSON</Button>
                        <Button secondary onClick={() => { setQueryResult(null) }}>Close</Button>
                    </span>
                </div>
                <div class="native-query-body"><table><thead><tr>{queryResult.columns.map((column) => <th class="px-2">{column}</th>)}</tr></thead><tbody>{queryResult.rows.map((row) => <tr>{row.map((value) => <td class="px-2">{value}</td>)}</tr>)}</tbody></table></div>
            </section>}
            {!useCustomViewerQuery && <nav class="schema-tabs" aria-label="Table view">
                <button type="button" class={!isSchemaViewOpen ? "active" : ""} aria-current={!isSchemaViewOpen ? "page" : undefined} onClick={() => setIsSchemaViewOpen(false)}>Data</button>
                <button type="button" class={isSchemaViewOpen ? "active" : ""} aria-current={isSchemaViewOpen ? "page" : undefined} onClick={() => setIsSchemaViewOpen(true)} data-testid="schema-button">Schema</button>
            </nav>}
            {/* Schema and Index */}
            {isSchemaViewOpen && !useCustomViewerQuery && <SchemaView onBack={() => setIsSchemaViewOpen(false)} />}

            {/* Table */}
            {(!isSchemaViewOpen || useCustomViewerQuery) && <>
                {noTables
                    ? <div class="viewer-empty" data-testid="empty-tables">
                        <strong>This database has no tables</strong>
                        <p>The MySQL user for this connection may not see any table in its default database.</p>
                    </div>
                    : queryIsEmpty
                        ? <div class="viewer-empty" data-testid="empty-query">
                            <strong>Run a query to see results</strong>
                            <p>Type a read-only SQL statement above, or pick one of the examples.</p>
                        </div>
                        : <>
                            {!useCustomViewerQuery && invalidQuery !== null && <p class="viewer-error" role="alert">{invalidQuery}</p>}
                            <div ref={tableRef} class="relative w-max max-w-full pl-[var(--page-padding)] pr-[var(--page-padding)]">
                                <Table />
                            </div>
                        </>}
            </>}
        </section>

        {/* Error Message */}
        {errorMessage && <p class="text-error-fg bg-error-bg [padding:10px]">
            <pre class="whitespace-pre-wrap [font-size:inherit] overflow-auto h-28">{errorMessage}</pre>
            <Button class="mt-[10px]" onClick={() => useTableStore.setState({ errorMessage: "" })}>Close</Button>
        </p>}

        <div style={{ display: showQueryEditor ? undefined : "none" }}><QueryEditor /></div>

        {/* Confirmation Dialog for an unexecuted query draft */}
        <dialog class="py-4 px-8 bg-gray-100 shadow-lg mx-auto mt-[10vh]" ref={leaveQueryDialogRef}>
            <h2 class="pb-2 pl-0 text-center [font-size:120%]">This query has not been run</h2>
            <p class="pb-3 text-center">The draft is kept, and you can continue editing it next time.</p>
            <div class="float-right">
                <Button class="mr-1" onClick={() => { setPendingLeaveQuery(false); leaveQueryDialogRef.current?.close() }} data-testid="query-dialog > keep-editing">Keep editing</Button>
                <Button secondary={true} onClick={() => { setPendingLeaveQuery(false); leaveQueryDialogRef.current?.close(); setViewerQuery({ useCustomViewerQuery: false }).catch(console.error) }} data-testid="query-dialog > keep-draft">Keep draft and go back</Button>
            </div>
        </dialog>

        <dialog
            id="contextmenu"
            class="contextmenu"
            onClick={(ev) => { ev.currentTarget.close() }}></dialog>
    </>
}

(async () => {
    await remote.downloadState()
    const tableList = await getTableList()
    const tableName = (() => {
        const restored = remote.getState<string>("tableName")
        return restored && tableList.some(({ name }) => name === restored) ?
            restored :
            tableList[0]?.name as string | undefined
    })()
    useTableStore.setState({ tableList })
    await useTableStore.getState().setViewerQuery({ tableName })
    render(<App />, document.body)
})().catch((err) => {
    console.error(err)
    document.write(err)
    document.write(useTableStore.getState().errorMessage)
})
