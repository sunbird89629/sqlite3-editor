import { useState } from "preact/hooks"
import { Button } from "./components"
import * as remote from "./remote"

/** The standalone query editor used outside VS Code (development server). */
export const QueryEditor = () => {
    const [sql, setSql] = useState("")
    const [saved, setSaved] = useState("")
    const [filename, setFilename] = useState("")
    const [result, setResult] = useState<{ columns: string[], records: Record<string, remote.MySqlValue>[] } | null>(null)
    const [message, setMessage] = useState("")
    const [busy, setBusy] = useState(false)
    const canDiscard = () => sql === saved || window.confirm("Discard unsaved query changes?")

    const open = async () => {
        if (!canDiscard()) { return }
        const file = await remote.openQueryFile()
        if (file) { setSql(file.content); setSaved(file.content); setFilename(file.name); setResult(null); setMessage("") }
    }
    const save = async () => {
        const file = await remote.saveQueryFile(sql)
        if (file) { setSaved(sql); setFilename(file); setMessage("Query saved.") }
    }
    const run = async () => {
        if (!sql.trim() || busy) { return }
        setBusy(true); setMessage(""); setResult(null)
        try {
            const output = await remote.query(sql, [])
            if (output?.records && output.columns) {
                setResult({ columns: output.columns, records: output.records })
                setMessage(`${output.records.length} row(s).`)
            } else { setMessage("Statement executed.") }
        } catch (err) { setMessage(err instanceof Error ? err.message : String(err)) }
        finally { setBusy(false) }
    }
    const display = (value: remote.MySqlValue | undefined) => value === null ? "NULL" : value instanceof Uint8Array ? `BLOB (${value.length} bytes)` : String(value ?? "")

    return <section class="p-2 border border-[var(--td-border-color)]" data-testid="query-editor" onKeyDown={(ev) => {
        ev.stopPropagation()
        if (ev.ctrlKey && ev.key === "Enter") { ev.preventDefault(); void run() }
    }}>
        <div class="flex flex-wrap gap-2 items-center mb-2">
            <strong>SQL Query Editor</strong><span>{filename || "Untitled"}{sql !== saved ? " *" : ""}</span>
            <Button secondary onClick={() => { if (canDiscard()) { setSql(""); setSaved(""); setFilename(""); setResult(null); setMessage("") } }}>New</Button>
            <Button secondary onClick={() => { void open() }}>Open…</Button>
            <Button secondary onClick={() => { void save() }}>Save as…</Button>
            <Button disabled={busy || !sql.trim()} onClick={() => { void run() }}>Run read-only</Button>
        </div>
        <textarea data-testid="query-editor-sql" class="w-full h-[20vh]" spellcheck={false} value={sql} onInput={(ev) => setSql(ev.currentTarget.value)} />
        <p>Execute one statement at a time. Ctrl+Enter runs it.</p>
        {message && <pre class="whitespace-pre-wrap" role="status">{message}</pre>}
        {result && <div class="overflow-auto max-h-[30vh]"><table><thead><tr>{result.columns.map((column) => <th class="px-2">{column}</th>)}</tr></thead><tbody>{result.records.map((record) => <tr>{result.columns.map((column) => <td class="px-2">{display(record[column])}</td>)}</tr>)}</tbody></table></div>}
    </section>
}
