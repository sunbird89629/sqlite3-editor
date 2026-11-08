import { enableMapSet } from "immer"
enableMapSet()

import { render } from "preact"
import { Editor, useEditorStore } from "./editor"
import { useEffect, useRef, useState } from "preact/hooks"
import { QueryEditor } from "./query_editor"
import { TableSelector } from "./table_selector"
import * as remote from "./remote"
import { Button, Checkbox, flash, Highlight, persistentUseState, renderContextmenu, Select, SVGOnlyCheckbox } from "./components"
import { escapeSQLIdentifier, Table, useTableStore } from "./table"
import { SettingsView } from "./schema_view"
import { onKeydown } from "./keybindings"
// @ts-ignore
import codiconTxt from "./codicon.txt?raw"
import { useBoolean, useEventListener, useInterval } from "usehooks-ts"
import type { JSXInternal } from "preact/src/jsx"

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
    const requireReloading = useTableStore((s) => s.requireReloading)
    const isConfirmationDialogVisible = useTableStore((s) => s.isConfirmDialogVisible)
    const errorMessage = useTableStore((s) => s.errorMessage)
    const tableList = useTableStore((s) => s.tableList)
    const setViewerQuery = useTableStore((s) => s.setViewerQuery)
    const autoReload = useTableStore((s) => s.autoReload)
    const useCustomViewerQuery = useTableStore((s) => s.useCustomViewerQuery)
    const customViewerQuery = useTableStore((s) => s.customViewerQuery)
    const tableName = useTableStore((s) => s.tableName)
    const tableType = useTableStore((s) => s.tableList.find(({ name }) => name === tableName)?.type)
    const visibleColumnsSQL = useTableStore((s) => s.getVisibleColumnsSQL())
    const editorStatement = useEditorStore((s) => s.statement)
    const [isSettingsViewOpen, setIsSettingsViewOpen] = persistentUseState("isSettingsViewOpen", false)
    const confirmDialogRef = useRef<HTMLDialogElement>(null)
    const tableRef = useRef<HTMLDivElement>(null)
    const columnSelectDialogRef = useRef<HTMLDialogElement>(null)
    const moreActionsRef = useRef<HTMLDetailsElement>(null)

    useEffect(() => {
        const listener = (event: MessageEvent) => {
            if (event.data?.type === "sqlite3-editor-query-result") { setQueryResult(event.data) }
            if (event.data?.type === "sqlite3-editor-inserted") { useTableStore.getState().reloadAllTables().catch(console.error) }
        }
        window.addEventListener("message", listener)
        return () => window.removeEventListener("message", listener)
    }, [])

    // Show or close the confirmation dialog
    useEffect(() => {
        if (isConfirmationDialogVisible) {
            confirmDialogRef.current?.showModal()
            document.querySelector<HTMLButtonElement>(".confirm-dialog-commit")?.focus()
        } else {
            confirmDialogRef.current?.close()
        }
    }, [isConfirmationDialogVisible])
    useEventListener("close", () => {
        const { isConfirmDialogVisible } = useTableStore.getState()
        if (isConfirmDialogVisible) {
            isConfirmDialogVisible("cancel")
        }
    }, confirmDialogRef)

    // Reload all tables if the database file is updated
    useEventListener("message", ({ data }: remote.Message) => {
        if (data.type === "sqlite3-editor-server" && data.requestId === undefined) {
            if (useTableStore.getState().autoReload) {
                requireReloading()
            }
        }
    })
    useInterval(() => {
        if (useTableStore.getState().reloadRequired) {
            useTableStore.getState().reloadAllTables()
                .catch(console.error)
        }
    }, 1000)

    // Register keyboard shortcuts
    useEventListener("keydown", onKeydown)

    useEventListener("click", (event) => {
        const menu = moreActionsRef.current
        if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) {
            menu.open = false
        }
    })

    // Commit changes in the UPDATE editor when the margin on the right side of table is clicked.
    useEventListener("click", async (ev) => {
        if (useEditorStore.getState().statement !== "UPDATE") { return }
        if (!tableRef.current || ev.target !== document.body) { return }
        const tableRect = tableRef.current.getBoundingClientRect()
        if (!(tableRect.top <= ev.clientY && ev.clientY < tableRect.bottom)) { return }
        if (!await useEditorStore.getState().beforeUnmount()) { return }
        await useEditorStore.getState().discardChanges()
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

    const closeOnClickOutside = (ev: JSXInternal.TargetedMouseEvent<HTMLDialogElement>) => {
        if (/* undefined or 0 */!ev.clientX || !ev.clientY) { return }
        const rect = ev.currentTarget.getBoundingClientRect()
        if (rect.left <= ev.clientX && ev.clientX < rect.right &&
            rect.top <= ev.clientY && ev.clientY < rect.bottom) { return }
        ev.currentTarget.close()
    }

    return <>
        {/* @vscode/codicons/dist/codicon.svg, https://github.com/microsoft/vscode-codicons, Attribution 4.0 International */}
        <svg xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" dangerouslySetInnerHTML={{ __html: codiconTxt }}></svg>

        <LoadingIndicator />

        <section class="query-area" aria-label="Query and actions">
        <div class="area-heading"><span>查询与操作</span><span>QUERY &amp; ACTIONS</span></div>
        {/* Header `SELECT * FROM ...` */}
        <h2 class="pt-[var(--page-padding)]">
            <div class="mb-2">
                {/* SELECT * FROM ... */}
                {!useCustomViewerQuery && <>
                    <Highlight>SELECT </Highlight>
                    <button type="button" aria-label="Select visible columns" class="px-2 cursor-pointer hover:bg-gray-300 border-b-[1px] border-b-gray-500 focus:outline focus:outline-2" onClick={() => { columnSelectDialogRef.current?.showModal() }}>{visibleColumnsSQL}</button>
                    <Highlight> FROM </Highlight>
                    {tableName === undefined ? <>No tables</> : <TableSelector
                        value={tableName}
                        onChange={(value) => { setViewerQuery({ tableName: value }).catch(console.error) }}
                        tables={tableList}
                        onContextMenu={(ev) => {
                            renderContextmenu(ev, <>
                                <button onClick={async () => { setIsSettingsViewOpen(!isSettingsViewOpen) }}>Show Table Schema and Indexes</button>
                                {tableType === "table" && <button onClick={async () => { useEditorStore.getState().dropTable(tableName); flash(document.querySelector("#editor")!) }}>Drop Table</button>}
                                {tableType === "view" && <button onClick={async () => { useEditorStore.getState().dropView(tableName); flash(document.querySelector("#editor")!) }}>Drop View</button>}
                                {tableType === "table" && <button onClick={async () => { await useEditorStore.getState().alterTable(tableName, undefined); flash(document.querySelector("#editor")!) }}>Alter Table</button>}
                                <button onClick={async () => { useEditorStore.getState().createTable(tableName); flash(document.querySelector("#editor")!) }}>Create Table</button>
                                {tableType === "table" && <button onClick={async () => { useEditorStore.getState().createIndex(tableName); flash(document.querySelector("#editor")!) }}>Create Index</button>}
                                <hr />
                                <button onClick={async () => { await navigator.clipboard.writeText(tableName); flash(document.querySelector("#editor")!) }}>Copy Table Name</button>
                            </>)
                        }}
                        />}
                    {remote.isVSCode && tableName && <Button class="ml-2" data-testid="open-insert-editor" onClick={async () => {
                        if (!await useEditorStore.getState().beforeUnmount()) { return }
                        const fields = useTableStore.getState().tableInfo.map(({ name, type, notnull, dflt_value }) => ({
                            name, value: "", blob: null,
                            type: notnull && dflt_value === null ? (["real", "int", "integer"].includes(type.toLowerCase()) ? "number" : type.toLowerCase() === "blob" ? "blob" : "string") : "default",
                        }))
                        await remote.post("/openInsertEditor", { table: tableName, fields }).catch(console.error)
                    }}>+ New record</Button>}
                </>}

                {/* Custom Query */}
                {useCustomViewerQuery && <>
                    <input placeholder="SELECT * FROM table-name" class="w-96" value={customViewerQuery} onBlur={(ev) => { setViewerQuery({ customViewerQuery: ev.currentTarget.value }).catch(console.error) }}></input>
                </>}

                {/* The checkbox to toggle the custom query mode */}
                <label class="ml-4 select-none cursor-pointer"><input type="checkbox" checked={useCustomViewerQuery} onChange={() => { setViewerQuery({ useCustomViewerQuery: !useCustomViewerQuery }).catch(console.error) }}></input> Custom</label>

                {/* The checkbox to toggle auto reloading */}
                <label class="select-none cursor-pointer ml-2" title="Reload the table when the database is updated by another process."><input type="checkbox" checked={autoReload} onChange={() => { useTableStore.setState({ autoReload: !autoReload }) }}></input> Auto reload</label>

                {/* Buttons placed right after the table name */}
                <div class="my-2">
                    <Button class="mr-2" onClick={() => { if (remote.isVSCode) { remote.openNativeQuery(tableName).catch(console.error) } else { setShowQueryEditor(!showQueryEditor) } }} data-testid="query-editor-toggle">SQL Editor</Button>

                    <details ref={moreActionsRef} class="inline-block relative mr-2 align-middle">
                        <summary class="cursor-pointer px-2 py-1 bg-gray-200 focus:outline focus:outline-2">More actions</summary>
                        <div class="more-actions absolute z-50 min-w-[220px] p-2 bg-white border border-gray-400 shadow-lg" onClick={(event) => {
                            if (event.target instanceof Element && event.target.closest("button")) {
                                if (moreActionsRef.current) { moreActionsRef.current.open = false }
                            }
                        }}>
                    {/* Drop Table */}
                    {!useCustomViewerQuery && tableName && tableType === "table" && <SVGOnlyCheckbox icon="#trash" title="Drop Table" checked={editorStatement === "DROP TABLE"} onClick={(checked) => {
                        if (!checked) { useEditorStore.getState().cancel().catch(console.error); return }
                        useEditorStore.getState().dropTable(tableName)
                    }} data-testid="drop-table-button"></SVGOnlyCheckbox>}

                    {/* Drop View */}
                    {!useCustomViewerQuery && tableName && tableType === "view" && <SVGOnlyCheckbox icon="#trash" title="Drop View" checked={editorStatement === "DROP VIEW"} onClick={(checked) => {
                        if (!checked) { useEditorStore.getState().cancel().catch(console.error); return }
                        useEditorStore.getState().dropView(tableName)
                    }} data-testid="drop-view-button"></SVGOnlyCheckbox>}

                    {/* Alter Table */}
                    {!useCustomViewerQuery && tableName && tableType === "table" && <SVGOnlyCheckbox icon="#edit" title="Alter Table" checked={editorStatement === "ALTER TABLE"} onClick={(checked) => {
                        if (!checked) { useEditorStore.getState().cancel().catch(console.error); return }
                        useEditorStore.getState().alterTable(tableName, undefined).catch(console.error)
                    }} data-testid="alter-table-button"></SVGOnlyCheckbox>}

                    {/* Create Table button */}
                    <SVGOnlyCheckbox icon="#empty-window" title="Create Table" checked={editorStatement === "CREATE TABLE"} onClick={(checked) => {
                        if (!checked) { useEditorStore.getState().cancel().catch(console.error); return }
                        useEditorStore.getState().createTable(tableName)
                    }} data-testid="create-table-button"></SVGOnlyCheckbox>

                    {/* Create Index */}
                    {!useCustomViewerQuery && tableName && tableType === "table" && <SVGOnlyCheckbox icon="#book" title="Create Index" checked={editorStatement === "CREATE INDEX"} onClick={(checked) => {
                        if (!checked) { useEditorStore.getState().cancel().catch(console.error); return }
                        useEditorStore.getState().createIndex(tableName)
                    }} data-testid="create-index-button"></SVGOnlyCheckbox>}

                    <SVGOnlyCheckbox icon="#terminal" title="Custom Query" checked={editorStatement === "Custom Query"} onClick={(checked) => {
                        if (!checked) { useEditorStore.getState().cancel().catch(console.error); return }
                        useEditorStore.getState().custom(tableName)
                    }} data-testid="custom-query-button"></SVGOnlyCheckbox>

                        </div>
                    </details>
                    {/* Tools */}
                    <SVGOnlyCheckbox icon="#tools" title="Other Tools" onClick={(_, ev) => {
                        renderContextmenu(ev, <>
                            <button onClick={async () => {
                                await useTableStore.getState().setViewerQuery({
                                    useCustomViewerQuery: true,
                                    customViewerQuery: "SELECT * FROM pragma_journal_mode",  // PRAGMA functions require SQLite3 >=3.16.0 (2017-01-02)
                                    tableName: useTableStore.getState().tableName,
                                })
                            }}>Check Journal Mode</button>
                            <button onClick={async () => {
                                if (!await useEditorStore.getState().beforeUnmount()) { return }
                                useEditorStore.getState().custom(undefined, "PRAGMA journal_mode=WAL")
                                flash(document.querySelector("#editor")!)
                            }}>Enable WAL Mode…</button>
                            <hr />
                            <button onClick={() => remote.openTerminal(`{{install sqlite-utils &&}}echo '[{"x": 1, "y": 2}, {"x": 3, "y": 4}]' | {{pythonPath}} -m sqlite_utils insert {{databasePath}} table-name -`)}>Import Table from JSON…</button>
                            <button onClick={() => remote.openTerminal(`{{install sqlite-utils &&}}{{pythonPath}} -m sqlite_utils insert {{databasePath}} table-name input.csv --csv`)}>Import Table from CSV…</button>
                            <button onClick={() => remote.openTerminal(`sqlite3 {{databasePath}} < input.sql`)}>Import Tables from SQL…</button>
                            <hr />
                            <button onClick={() => remote.openTerminal(`{{install sqlite-utils &&}}{{pythonPath}} -m sqlite_utils query {{databasePath}} ${escapeShell(`SELECT * FROM ${escapeSQLIdentifier(tableName || "table-name")}`)} > out.json`)}>Export Table to JSON…</button>
                            <button onClick={() => remote.openTerminal(`{{install sqlite-utils &&}}{{pythonPath}} -m sqlite_utils query {{databasePath}} ${escapeShell(`SELECT * FROM ${escapeSQLIdentifier(tableName || "table-name")}`)} --csv > out.csv`)}>Export Table to CSV…</button>
                            <button onClick={() => remote.openTerminal(`sqlite3 {{databasePath}} .dump > out.sql`)}>Export Tables to SQL…</button>
                            <hr />
                            <button onClick={() => remote.openTerminal(`{{install sqlite-utils &&}}{{pythonPath}} -m sqlite_utils duplicate {{databasePath}} ${escapeShell(tableName || "table-name")} ${escapeShell((tableName || "table-name") + "-copy")}`)}>Copy Table…</button>
                        </>)
                    }}></SVGOnlyCheckbox>

                </div>
            </div>
        </h2>

        <div class="query-operation" style={{ display: (remote.isVSCode && editorStatement === "INSERT") || (isSettingsViewOpen && !useCustomViewerQuery && (editorStatement === "INSERT" || editorStatement === "UPDATE")) ? "none" : undefined }}><Editor /></div>
        </section>

        <section class="data-area" aria-label="Table data and schema">
        <div class="area-heading"><span>表格与结构</span><span>{!useCustomViewerQuery ? tableName : "Custom query"}</span></div>
        {!useCustomViewerQuery && <nav class="schema-tabs" aria-label="Table view">
            <button type="button" class={!isSettingsViewOpen ? "active" : ""} aria-current={!isSettingsViewOpen ? "page" : undefined} onClick={() => setIsSettingsViewOpen(false)}>Data</button>
            <button type="button" class={isSettingsViewOpen ? "active" : ""} aria-current={isSettingsViewOpen ? "page" : undefined} onClick={() => setIsSettingsViewOpen(true)} data-testid="schema-button">Schema</button>
        </nav>}
        {/* Schema and Index */}
        {isSettingsViewOpen && !useCustomViewerQuery && <SettingsView onBack={() => setIsSettingsViewOpen(false)} />}

        {/* Table */}
        {(!isSettingsViewOpen || useCustomViewerQuery) && <>
            <div ref={tableRef} class="relative w-max max-w-full pl-[var(--page-padding)] pr-[var(--page-padding)]">
                <Table />
            </div>

        </>}

        </section>

        {/* Error Message */}
        {errorMessage && <p class="text-error-fg bg-error-bg [padding:10px]">
            <pre class="whitespace-pre-wrap [font-size:inherit] overflow-auto h-28">{errorMessage}</pre>
            <Button class="mt-[10px]" onClick={() => useTableStore.setState({ errorMessage: "" })}>Close</Button>
        </p>}

        {/* Editor */}
        {queryResult && <section class="p-2 border border-[var(--td-border-color)]" data-testid="native-query-result">
            <div class="flex gap-2 items-center"><strong>Query result</strong><span>{queryResult.total} row(s){queryResult.total > 500 ? " (first 500 shown)" : ""}</span><Button secondary onClick={() => setQueryResult(null)}>Close</Button></div>
            <div class="overflow-auto max-h-[30vh]"><table><thead><tr>{queryResult.columns.map((column) => <th class="px-2">{column}</th>)}</tr></thead><tbody>{queryResult.rows.map((row) => <tr>{row.map((value) => <td class="px-2">{value}</td>)}</tr>)}</tbody></table></div>
        </section>}
        <div style={{ display: showQueryEditor ? undefined : "none" }}><QueryEditor /></div>

        {/* Confirmation Dialog */}
        <dialog class="py-4 px-8 bg-gray-100 shadow-lg mx-auto mt-[10vh]" ref={confirmDialogRef}>
            <h2 class="pb-2 pl-0 text-center [font-size:120%]">Commit changes to the database?</h2>
            <div class="float-right">
                <Button onClick={() => { if (isConfirmationDialogVisible) { isConfirmationDialogVisible("commit") } }} class="confirm-dialog-commit mr-1" data-testid="dialog > commit">Commit</Button>
                <Button onClick={() => { if (isConfirmationDialogVisible) { isConfirmationDialogVisible("discard changes") } }} secondary={true} class="mr-1" data-testid="dialog > discard-changes">Discard changes</Button>
                <Button onClick={() => { if (isConfirmationDialogVisible) { isConfirmationDialogVisible("cancel") } }} secondary={true} data-testid="dialog > cancel">Cancel</Button>
            </div>
        </dialog>

        {/* SELECT dialog */}
        <dialog class="py-4 px-8 bg-gray-100 shadow-lg mx-auto mt-[10vh]" ref={columnSelectDialogRef} onClick={closeOnClickOutside}>
            <SelectedColumnEditor />
        </dialog>

        <dialog
            id="contextmenu"
            class="contextmenu"
            onClick={(ev) => { ev.currentTarget.close() }}></dialog>
    </>
}

const SelectedColumnEditor = () => {
    const visibleColumns = useTableStore((s) => s.visibleColumns)
    const tableInfo = useTableStore((s) => s.tableInfo)
    const setVisibleColumns = useTableStore((s) => s.setVisibleColumns)
    const error = useBoolean()
    return <>
        <Highlight>SELECT </Highlight>
        {tableInfo.map(({ name }, i) => <>{i !== 0 && ", "}<Checkbox
            checked={visibleColumns.includes(name)}
            onChange={async (checked) => {
                error.setFalse()
                if (checked) {
                    await setVisibleColumns([...visibleColumns, name])
                } else {
                    if (visibleColumns.length === 1) {
                        error.setTrue()
                        return
                    }
                    await setVisibleColumns(visibleColumns.filter((v) => v !== name))
                }
            }}
            text={name}
            class="mr-0" /></>)}
        {error.value && <p class="text-red-700 mt-1">Please select at least one column.</p>}
    </>
}

const escapeShell = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;

(async () => {
    await remote.downloadState()
    const tableList = await remote.getTableList()
    const tableName = (() => {
        const restored = remote.getState<string>("tableName")
        return restored && tableList.some(({ name }) => name === restored) ?
            restored :
            tableList[0]?.name
    })()
    useTableStore.setState({ tableList })
    await useTableStore.getState().setViewerQuery({ tableName })
    await useEditorStore.getState().switchTable(tableName)
    const s = useEditorStore.getState()
    if (s.statement === "CREATE TABLE" && remote.isSQLiteOlderThan3_37) {
        useEditorStore.setState({ strict: false })
    }
    render(<App />, document.body)
})().catch((err) => {
    console.error(err)
    document.write(err)
    document.write(useTableStore.getState().errorMessage)
})
