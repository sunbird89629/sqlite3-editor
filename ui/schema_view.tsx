import Prism from "prismjs"
import "prismjs/components/prism-sql"
import { useState } from "preact/hooks"
import { useEditorStore } from "./editor"
import { useTableStore } from "./table"

export const SettingsView = ({ onBack }: { onBack: () => void }) => {
    const schema = useTableStore((s) => s.tableSchema)
    const indexList = useTableStore((s) => s.indexList)
    const indexInfo = useTableStore((s) => s.indexInfo)
    const indexSchema = useTableStore((s) => s.indexSchema)
    const tableName = useTableStore((s) => s.tableName)
    const [wrap, setWrap] = useState(true)
    const [copyStatus, setCopyStatus] = useState("")

    return <section class="schema-view" data-testid="schema-view">
        <div class="schema-heading"><div><h2>Table schema</h2><p>{tableName} <span>· Structure and indexes</span></p></div><button class="schema-action" onClick={onBack}>← Back to data</button></div>
        <section class="schema-card">
            <div class="schema-card-heading"><strong>CREATE TABLE</strong><span class="schema-caption">Original SQL</span><div class="schema-actions"><button class="schema-action" aria-pressed={wrap} onClick={() => setWrap(!wrap)}>Wrap: {wrap ? "On" : "Off"}</button><button class="schema-action" disabled={!schema} onClick={async () => {
                try { await navigator.clipboard.writeText(schema ?? ""); setCopyStatus("SQL copied") }
                catch { setCopyStatus("Could not copy SQL; select and copy it manually.") }
            }}>Copy SQL</button></div></div>
            <pre class={"schema-sql " + (wrap ? "schema-sql-wrap" : "schema-sql-nowrap")} data-testid="schema-sql" dangerouslySetInnerHTML={{ __html: Prism.highlight(schema ?? "", Prism.languages.sql!, "sql") }}></pre>
            <div class="schema-copy-status" role="status">{copyStatus}</div>
        </section>
        <section class="schema-card"><div class="schema-card-heading"><strong>Indexes</strong><span class="schema-caption">{indexList.length}</span></div>
            {indexList.length === 0 && <p class="schema-empty">No indexes</p>}
            {indexList.map((index, i) => {
                const automatic = index.name.startsWith("sqlite_")
                const definition = indexSchema[i] || `${index.unique ? "UNIQUE " : ""}(${[...(indexInfo[i] ?? [])].sort((a, b) => Number(a.seqno - b.seqno)).map((info) => info.cid === -2n ? "<expression>" : info.cid === -1n ? "rowid" : info.name).join(", ")})`
                return <div class="schema-index" key={index.name}><div class="schema-index-info"><div class="schema-index-name">{index.name}{automatic && <span class="schema-badge">Automatic</span>}</div><div class="schema-definition">{definition}</div></div>
                    {!automatic && <button class="schema-action schema-delete" onClick={async () => {
                        if (!await useEditorStore.getState().beforeUnmount()) { return }
                        useEditorStore.getState().dropIndex(tableName, index.name)
                    }}>Delete…</button>}
                </div>
            })}
        </section>
        <p class="schema-note">Automatic indexes are managed by SQLite. Deleting an index requires confirmation.</p>
    </section>
}
