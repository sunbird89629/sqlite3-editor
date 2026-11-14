import { render } from "preact"
import { useEffect, useState } from "preact/hooks"
import type { ResultTab } from "../vscode/results-tabs"

/**
 * The results panel of one MySQL session: one tab per executed statement, newest last, at most five.
 * It only renders what the extension host sends; every action is a message back to the host.
 */
type Message = { type: "sqlite3-editor-results", tabs: ResultTab[], activeId?: string, session?: string, error?: string }

type VsCodeApi = { postMessage(data: unknown): void }
const vscode = (window as Window & { acquireVsCodeApi?: () => VsCodeApi }).acquireVsCodeApi?.()
const post = (message: unknown) => vscode?.postMessage(message)

const display = (value: string) => value === "" ? "\u00a0" : value

const App = () => {
    const [tabs, setTabs] = useState<ResultTab[]>([])
    const [activeId, setActiveId] = useState<string | undefined>(undefined)
    const [session, setSession] = useState("")
    const [error, setError] = useState("")
    /** Columns hidden per tab id. Display only: hiding a column never re-runs the statement. */
    const [hidden, setHidden] = useState<Record<string, string[]>>({})
    const [pickerOpen, setPickerOpen] = useState(false)
    const [pickerQuery, setPickerQuery] = useState("")

    useEffect(() => {
        const listener = (event: MessageEvent) => {
            const message = event.data as Message | undefined
            if (message?.type !== "sqlite3-editor-results") { return }
            setTabs(message.tabs)
            setActiveId((current) => message.activeId ?? (message.tabs.some((tab) => tab.id === current) ? current : message.tabs[message.tabs.length - 1]?.id))
            setSession(message.session ?? "")
            setError(message.error ?? "")
        }
        window.addEventListener("message", listener)
        post({ type: "sqlite3-editor-results-ready" })
        return () => window.removeEventListener("message", listener)
    }, [])

    // The column picker belongs to one tab at a time.
    useEffect(() => { setPickerOpen(false) }, [activeId])
    useEffect(() => {
        if (!pickerOpen) { return }
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as Element | null
            if (target?.closest(".column-filter") === null || target?.closest(".column-filter") === undefined) { setPickerOpen(false) }
        }
        const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { setPickerOpen(false) } }
        document.addEventListener("pointerdown", onPointerDown)
        document.addEventListener("keydown", onKeyDown, true)
        return () => {
            document.removeEventListener("pointerdown", onPointerDown)
            document.removeEventListener("keydown", onKeyDown, true)
        }
    }, [pickerOpen])

    const active = tabs.find((tab) => tab.id === activeId) ?? tabs[tabs.length - 1]
    const hiddenOf = (id: string) => hidden[id] ?? []
    const visibleColumns = (active?.columns ?? []).map((name, index) => ({ name, index }))
        .filter((column) => active === undefined || !hiddenOf(active.id).includes(column.name))
    const hideColumn = (id: string, name: string, hide: boolean) => {
        setHidden((current) => {
            const names = new Set(current[id] ?? [])
            const visibleCount = (tabs.find((tab) => tab.id === id)?.columns.length ?? 0) - names.size
            // The table needs at least one column, so the last visible one stays.
            if (hide && visibleCount <= 1) { return current }
            if (hide) { names.add(name) } else { names.delete(name) }
            return { ...current, [id]: [...names] }
        })
    }

    const copy = (format: "csv" | "json" | "sql") => {
        if (!active) { return }
        const cell = (value: string) => `"${value.replaceAll('"', '""')}"`
        if (format === "sql") { void navigator.clipboard.writeText(active.sql.trim()); return }
        // Copying follows the columns that are visible, so the clipboard matches the screen.
        const shown = active.columns.map((column, index) => ({ column, index })).filter(({ column }) => !hiddenOf(active.id).includes(column))
        const text = format === "csv"
            ? [shown.map(({ column }) => cell(column)).join(","), ...active.rows.map((row) => shown.map(({ index }) => cell(row[index] ?? "")).join(","))].join("\n")
            : JSON.stringify(active.rows.map((row) => Object.fromEntries(shown.map(({ column, index }) => [column, row[index] ?? null]))), null, 2)
        navigator.clipboard.writeText(text).catch(console.error)
    }

    return <>
        <div class="tabstrip" role="tablist" aria-label="Query results">
            {tabs.map((tab) => <div
                class="tab"
                role="tab"
                aria-selected={tab.id === active?.id}
                key={tab.id}
                onClick={() => setActiveId(tab.id)}
                title={tab.sql}>
                <span class="label">{tab.summary ?? tab.sql.replace(/\s+/g, " ").trim().slice(0, 48)}</span>
                <span class="rows">{tab.running ? "…" : `${tab.total} ${tab.total === 1 ? "row" : "rows"}`}</span>
                <button
                    class="close close-danger"
                    aria-label="Close result"
                    onClick={(event) => { event.stopPropagation(); post({ command: "close", id: tab.id }) }}>×</button>
            </div>)}
            <span class="count">{tabs.length} / 5</span>
        </div>

        {error !== "" && <div class="error">{error}</div>}

        {active === undefined
            ? <div class="empty">
                <div><strong>No results</strong>Run a statement from the SQL editor; each result gets its own tab here.</div>
            </div>
            : <div class="result">
                <div class="head">
                    {/* The whole statement, wrapped: no clipping and no inner scrolling. */}
                    <div class="sql-row">
                        <pre class="sql" data-testid="result-sql">{active.sql.trim()}</pre>
                        <button class="btn copy-sql" onClick={() => copy("sql")} title="Copy this statement">Copy SQL</button>
                    </div>
                    <div class="meta-row">
                        <span class="stats">{active.running ? "running…" : `${active.total} ${active.total === 1 ? "row" : "rows"} · ${Math.round(active.durationMs)} ms`}{session !== "" ? ` · ${session}` : ""}</span>
                        <span class="actions column-filter">
                            <button
                                class="btn"
                                aria-expanded={pickerOpen}
                                data-testid="result-columns-button"
                                onClick={() => { setPickerOpen(!pickerOpen); setPickerQuery("") }}
                                disabled={active.columns.length === 0}
                                title="Choose which columns are shown. Display only: the statement is not re-run.">
                                Columns {visibleColumns.length}/{active.columns.length}
                            </button>
                            {pickerOpen && <div class="column-popover" role="dialog" aria-label="Visible columns" data-testid="result-columns">
                                <input
                                    class="column-search"
                                    aria-label="Filter columns"
                                    placeholder="Filter columns…"
                                    value={pickerQuery}
                                    onInput={(event) => setPickerQuery(event.currentTarget.value)} />
                                <div class="column-bulk">
                                    <button class="link" onClick={() => setHidden((current) => ({ ...current, [active.id]: [] }))}>Select all</button>
                                    <span>·</span>
                                    <button
                                        class="link"
                                        onClick={() => setHidden((current) => ({ ...current, [active.id]: active.columns.slice(1) }))}
                                        disabled={active.columns.length <= 1}>Clear all</button>
                                </div>
                                <div class="column-list">
                                    {active.columns
                                        .filter((name) => pickerQuery.trim() === "" || name.toLowerCase().includes(pickerQuery.trim().toLowerCase()))
                                        .map((name) => <label class="column-item" data-testid={`result-column-item ${name}`}>
                                            <input
                                                type="checkbox"
                                                checked={!hiddenOf(active.id).includes(name)}
                                                onChange={(event) => hideColumn(active.id, name, !event.currentTarget.checked)} />
                                            <span>{name}</span>
                                        </label>)}
                                </div>
                                <div class="column-foot">Display only; the statement is not re-run.</div>
                            </div>}
                            <button class="btn" onClick={() => copy("csv")} disabled={active.rows.length === 0}>Copy CSV</button>
                            <button class="btn" onClick={() => copy("json")} disabled={active.rows.length === 0}>Copy JSON</button>
                            <button class="btn" onClick={() => post({ command: "rerun", id: active.id })}>Re-run</button>
                        </span>
                    </div>
                </div>
                {active.running
                    ? <div class="body running" data-testid="result-running">
                        <div class="spinner"></div>
                        <div><strong>Running…</strong><div class="running-hint">Waiting for the server. Large tables and remote connections can take a while.</div></div>
                    </div>
                    : <div class="body">
                    <table>
                        <thead><tr>{visibleColumns.map(({ name }) => <th>{name}</th>)}</tr></thead>
                        <tbody>{active.rows.map((row) => <tr>{visibleColumns.map(({ index }) => {
                            const value = row[index] ?? ""
                            const numeric = /^-?\d+(\.\d+)?$/.test(value)
                            const truncated = value.length >= 512
                            // Every cell can be opened; the truncated ones are also openable with one click.
                            const openable = value !== "NULL" && value !== ""
                            const open = () => post({ command: "openValue", id: active.id, column: index, value })
                            return <td
                                class={(openable ? "cell " : "") + (truncated ? "truncated" : numeric ? "number" : "value")}
                                onClick={truncated ? open : undefined}
                                onDblClick={openable ? open : undefined}
                                title={openable ? "Double-click to open the full value in an editor tab" : undefined}>
                                {truncated ? <>{value.slice(0, 512)}<span class="more">… click for the full value</span></> : display(value)}
                            </td>
                        })}</tr>)}</tbody>
                    </table>
                </div>}
                <div class="foot">
                    {active.running
                        ? "The statement is still running; the tab fills when it returns."
                        : <>{active.total > active.rows.length ? `Showing the first ${active.rows.length} of ${active.total} rows. ` : ""}Double-click any cell to open its value in an editor tab; truncated cells open with one click.</>}
                </div>
            </div>}
    </>
}

render(<App />, document.body)
