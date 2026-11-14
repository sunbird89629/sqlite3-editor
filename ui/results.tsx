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

    const active = tabs.find((tab) => tab.id === activeId) ?? tabs[tabs.length - 1]

    const copy = (format: "csv" | "json") => {
        if (!active) { return }
        const cell = (value: string) => `"${value.replaceAll('"', '""')}"`
        const text = format === "csv"
            ? [active.columns.map(cell).join(","), ...active.rows.map((row) => row.map(cell).join(","))].join("\n")
            : JSON.stringify(active.rows.map((row) => Object.fromEntries(active.columns.map((column, index) => [column, row[index] ?? null]))), null, 2)
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
                <span class="label">{tab.sql.replace(/\s+/g, " ").trim().slice(0, 48)}</span>
                <span class="rows">{tab.total} {tab.total === 1 ? "row" : "rows"}</span>
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
                    <span class="sql" title={active.sql}>{active.sql.replace(/\s+/g, " ").trim()}</span>
                    <span class="stats">{active.total} {active.total === 1 ? "row" : "rows"} · {Math.round(active.durationMs)} ms{session !== "" ? ` · ${session}` : ""}</span>
                    <span class="actions">
                        <button class="btn" onClick={() => copy("csv")}>Copy CSV</button>
                        <button class="btn" onClick={() => copy("json")}>Copy JSON</button>
                        <button class="btn" onClick={() => post({ command: "rerun", id: active.id })}>Re-run</button>
                    </span>
                </div>
                <div class="body">
                    <table>
                        <thead><tr>{active.columns.map((column) => <th>{column}</th>)}</tr></thead>
                        <tbody>{active.rows.map((row) => <tr>{row.map((value, index) => {
                            const numeric = /^-?\d+(\.\d+)?$/.test(value)
                            const truncated = value.length >= 512
                            return <td
                                class={truncated ? "truncated" : numeric ? "number" : "value"}
                                onClick={truncated ? () => post({ command: "openValue", id: active.id, column: index, value }) : undefined}
                                title={truncated ? "Open the full value in an editor tab" : undefined}>
                                {truncated ? <>{value.slice(0, 512)}<span class="more">… click for the full value</span></> : display(value)}
                            </td>
                        })}</tr>)}</tbody>
                    </table>
                </div>
                <div class="foot">
                    {active.total > active.rows.length
                        ? `Showing the first ${active.rows.length} of ${active.total} rows.`
                        : "Click a truncated cell to open the full value in an editor tab."}
                </div>
            </div>}
    </>
}

render(<App />, document.body)
