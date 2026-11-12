import { useState } from "preact/hooks"
import Prism from "prismjs"
import "prismjs/components/prism-sql"
import { useTableStore } from "./table"

/** Read-only structure view: the column list, the indexes and the CREATE TABLE statement. */
export const SchemaView = ({ onBack }: { onBack: () => void }) => {
    const schema = useTableStore((s) => s.tableSchema)
    const indexList = useTableStore((s) => s.indexList)
    const columns = useTableStore((s) => s.columns)
    const tableName = useTableStore((s) => s.tableName)
    const [wrap, setWrap] = useState(true)
    const [copyStatus, setCopyStatus] = useState("")

    return <section class="schema-view" data-testid="schema-view">
        <div class="schema-heading"><div><h2>Table schema</h2><p>{tableName} <span>· Structure and indexes</span></p></div><button class="schema-action" onClick={onBack}>← Back to data</button></div>
        <section class="schema-card">
            <div class="schema-card-heading"><strong>Columns</strong><span class="schema-caption">{columns.length}</span></div>
            <div class="overflow-auto"><table class="schema-columns">
                <thead><tr><th>#</th><th>Name</th><th>Type</th><th>Null</th><th>Default</th><th>Key</th><th>Extra</th></tr></thead>
                <tbody>{columns.map((column, i) => <tr key={column.name}>
                    <td>{i + 1}</td>
                    <td>{column.name}</td>
                    <td>{column.type}</td>
                    <td>{column.nullable ? "YES" : "NO"}</td>
                    <td>{column.default === null ? "NULL" : column.default}</td>
                    <td>{column.primaryKey ? "PRI" : ""}</td>
                    <td>{column.autoIncrement ? "auto_increment" : ""}</td>
                </tr>)}</tbody>
            </table></div>
        </section>
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
            {indexList.map((index) => <div class="schema-index" key={index.name}><div class="schema-index-info">
                <div class="schema-index-name">{index.name}{index.name === "PRIMARY" && <span class="schema-badge">Primary</span>}</div>
                <div class="schema-definition">{index.unique ? "UNIQUE " : ""}({index.columns.join(", ")})</div>
            </div></div>)}
        </section>
        <p class="schema-note">This view is read-only. Changing the structure needs a separate MySQL client.</p>
    </section>
}
