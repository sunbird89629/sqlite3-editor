import vscode from "vscode"
import type { MySqlClient } from "./mysql-client"
import { registerSqlLens, sessionOf } from "./sql-lens"

const RESULT_ROW_LIMIT = 500

/** A query document is associated only with a session the user has explicitly opened. */
export function registerQueryEditor(context: vscode.ExtensionContext) {
    const clients = new Map<string, MySqlClient>()
    const panels = new Map<string, Set<vscode.WebviewPanel>>()

    const database = sessionOf
    const lensChanged = new vscode.EventEmitter<void>()
    context.subscriptions.push(lensChanged)

    const display = (value: unknown): string => value === null
        ? "NULL"
        : value instanceof Uint8Array
            ? `BLOB (${value.length} bytes)`
            : String(value ?? "")

    /** Runs one statement against an open session and pushes the rows to that session's viewer. */
    const executeStatement = async (db: string, sql: string) => {
        const client = clients.get(db)
        if (!client) { vscode.window.showErrorMessage("Open the MySQL connection in MySQL Viewer before running this query."); return }
        try {
            const result = await client.query(sql, [])
            if (!result.columns || !result.records) { vscode.window.showInformationMessage("SQL statement executed."); return }
            const columns = result.columns
            const rows = result.records.slice(0, RESULT_ROW_LIMIT).map((record) => columns.map((column) => display(record[column])))
            for (const panel of panels.get(db) ?? []) {
                void panel.webview.postMessage({ type: "sqlite3-editor-query-result", columns, rows, total: result.records.length })
            }
            vscode.window.showInformationMessage(`Query returned ${result.records.length} row(s)${result.records.length > RESULT_ROW_LIMIT ? `; first ${RESULT_ROW_LIMIT} shown` : ""}.`)
        } catch (err) {
            void vscode.window.showErrorMessage(`SQL query failed: ${err instanceof Error ? err.message : String(err)}`)
        }
    }

    /** Ctrl+Enter / the editor title button: run the selection, or the whole document. */
    const run = async () => {
        const editor = vscode.window.activeTextEditor
        const doc = editor?.document
        if (!editor || !doc || doc.languageId !== "sql") { vscode.window.showWarningMessage("Open a SQL document to run a query."); return }
        const db = database(doc)
        if (db === undefined) { vscode.window.showErrorMessage("This document has no `-- database:` header, so it is not linked to a session. Open the database with SQL Editor first."); return }
        const selection = editor.selection.isEmpty ? doc.getText().split(/\r?\n/).slice(1).join("\n") : doc.getText(editor.selection)
        const sql = selection.trim()
        if (sql === "") { vscode.window.showWarningMessage("The document does not contain a statement."); return }
        await executeStatement(db, sql)
    }

    context.subscriptions.push(
        vscode.commands.registerCommand("sqlite3-editor.runQuery", run),
        vscode.commands.registerCommand("sqlite3-editor.runStatement", (db: unknown, sql: unknown) => {
            if (typeof db !== "string" || typeof sql !== "string" || sql.trim() === "") { return }
            return executeStatement(db, sql)
        }),
        registerSqlLens((session) => clients.has(session), lensChanged.event),
    )

    return {
        addConnection(db: string, client: MySqlClient) { clients.set(db, client); lensChanged.fire() },
        /** The session behind a `-- database:` header, used by the completion provider. */
        getClient(db: string): MySqlClient | undefined { return clients.get(db) },
        removeConnection(db: string, client: MySqlClient) { if (clients.get(db) === client) { clients.delete(db); lensChanged.fire() } },
        addPanel(db: string, panel: vscode.WebviewPanel) {
            const set = panels.get(db) ?? new Set<vscode.WebviewPanel>()
            set.add(panel)
            panels.set(db, set)
            return () => { set.delete(panel); if (!set.size) { panels.delete(db) } }
        },
        async open(db: string, tableName?: string, prefill?: string) {
            if (/[\r\n]/.test(db)) { throw new Error("Session names containing line breaks cannot be used in query documents.") }
            const statement = tableName ? `SELECT * FROM \`${tableName.replaceAll("`", "``")}\`;` : "SELECT 1;"
            // A draft from the viewer replaces the default statement, so the user continues in the full editor.
            const body = prefill !== undefined && prefill.trim() !== "" ? prefill : statement
            const doc = await vscode.workspace.openTextDocument({ language: "sql", content: `-- database: ${db}\n\n${body}\n` })
            await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false })
        },
    }
}
