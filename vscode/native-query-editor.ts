import vscode from "vscode"
import type { MySqlClient } from "./mysql-client"
import { registerSqlLens, sessionOf } from "./sql-lens"
import { createResultsController } from "./results-panel"
import type { ResultTabData } from "./results-tabs"

const RESULT_ROW_LIMIT = 500

/** A query document is associated only with a session the user has explicitly opened. */
export function registerQueryEditor(context: vscode.ExtensionContext, options: { openSnapshot: (content: string, name: string) => void }) {
    const clients = new Map<string, MySqlClient>()
    const results = createResultsController(context, {
        extensionUri: context.extensionUri,
        openSnapshot: options.openSnapshot,
        rerun: (session, sql) => executeStatement(session, sql, { addTab: false }),
    })

    const database = sessionOf
    const lensChanged = new vscode.EventEmitter<void>()
    context.subscriptions.push(lensChanged)

    const display = (value: unknown): string => value === null
        ? "NULL"
        : value instanceof Uint8Array
            ? `BLOB (${value.length} bytes)`
            : String(value ?? "")

    /** Runs one statement against an open session; a statement with rows lands in a results tab. */
    const executeStatement = async (db: string, sql: string, options: { addTab?: boolean } = {}): Promise<ResultTabData | undefined> => {
        const client = clients.get(db)
        if (!client) {
            void vscode.window.showErrorMessage("Open the MySQL connection in MySQL Viewer before running this query.")
            return undefined
        }
        const started = Date.now()
        try {
            const result = await client.query(sql, [])
            if (!result.columns || !result.records) {
                void vscode.window.showInformationMessage("SQL statement executed.")
                return undefined
            }
            const columns = result.columns
            const data: ResultTabData = {
                sql,
                columns,
                rows: result.records.slice(0, RESULT_ROW_LIMIT).map((record) => columns.map((column) => display(record[column]))),
                total: result.records.length,
                durationMs: Date.now() - started,
            }
            if (options.addTab !== false) { await results.show(db, data) }
            return data
        } catch (err) {
            void vscode.window.showErrorMessage(`SQL query failed: ${err instanceof Error ? err.message : String(err)}`)
            return undefined
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
        /** Closes the results panel of a session when its connection goes away. */
        disposeResults(db: string) { results.dispose(db) },
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
