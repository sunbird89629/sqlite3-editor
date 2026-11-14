import vscode from "vscode"
import type { MySqlClient } from "./mysql-client"
import { registerSqlLens, sessionOf } from "./sql-lens"
import { createResultsController } from "./results-panel"
import { bindParams, paramsBlockAt, parseParams, placeholderNames } from "./sql-params"
import type { BindResult, ParamValue } from "./sql-params"
import { splitStatements } from "./sql-statements"
import type { ResultTabData } from "./results-tabs"

const RESULT_ROW_LIMIT = 500

/** A query document is associated only with a session the user has explicitly opened. */
export function registerQueryEditor(context: vscode.ExtensionContext, options: { openSnapshot: (content: string, name: string) => void }) {
    const clients = new Map<string, MySqlClient>()

    // A click that produces nothing is impossible to diagnose from the UI, so every step of a run
    // is written to the "MySQL Viewer" output channel.
    const output = vscode.window.createOutputChannel("MySQL Viewer")
    context.subscriptions.push(output, {
        dispose: () => output.dispose(),
    })
    const log = (message: string) => output.appendLine(`[${new Date().toISOString()}] ${message}`)

    const results = createResultsController(context, {
        extensionUri: context.extensionUri,
        openSnapshot: options.openSnapshot,
        rerun: (session, plan) => executeStatement(session, plan.sql, plan.params as ParamValue[], { addTab: false }),
        log,
    })

    const database = sessionOf
    const lensChanged = new vscode.EventEmitter<void>()
    context.subscriptions.push(lensChanged)

    const display = (value: unknown): string => value === null
        ? "NULL"
        : value instanceof Uint8Array
            ? `BLOB (${value.length} bytes)`
            : String(value ?? "")

    /**
     * Applies the `-- params:` block of a statement. A placeholder without a value, an unused value
     * or a `:name` without a block is reported instead of being sent to the server.
     */
    const prepare = (sql: string, block: string | null): BindResult => {
        log(`prepare: block=${block === null ? "none" : JSON.stringify(block).slice(0, 200)} sql=${JSON.stringify(sql).slice(0, 200)}`)
        if (block === null) {
            const names = [...new Set(placeholderNames(sql))]
            return names.length === 0 ? { sql, params: [] } : {
                error: `The statement uses ${names.map((name) => `:${name}`).join(", ")}, but there is no -- params: line above it. Add e.g. -- params: ${names[0]} = 'value'.`,
            }
        }
        const parsed = parseParams(block)
        if (parsed.errors.length > 0) { return { error: parsed.errors.join("\n") } }
        return bindParams(sql, parsed.values)
    }

    /** Runs one statement against an open session; a statement with rows lands in a results tab. */
    const executeStatement = async (db: string, sql: string, params: readonly ParamValue[] = [], options: { addTab?: boolean } = {}): Promise<ResultTabData | undefined> => {
        log(`execute: session=${db} params=${params.length} addTab=${options.addTab !== false} sql=${JSON.stringify(sql).slice(0, 200)}`)
        const client = clients.get(db)
        if (!client) {
            log(`execute: no open client for ${db} (open sessions: ${[...clients.keys()].join(", ") || "none"})`)
            void vscode.window.showErrorMessage("Open the MySQL connection in MySQL Viewer before running this query.")
            return undefined
        }
        const started = Date.now()
        // A tab appears before the query runs, so a slow statement does not look like a dead click.
        const tabId = options.addTab !== false ? await results.begin(db, sql) : undefined
        if (tabId !== undefined) { log(`execute: running tab ${tabId}`) }
        try {
            const summary = sql.replace(/\s+/g, " ").trim().slice(0, 60)
            const result = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Running ${summary}…` },
                () => client.query(sql, [...params]),
            )
            log(`execute: rows=${result.records?.length ?? 0} columns=${result.columns?.length ?? 0} after ${Date.now() - started} ms`)
            if (!result.columns || !result.records) {
                if (tabId !== undefined) { results.close(db, tabId) }
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
            if (tabId !== undefined) {
                await results.update(db, tabId, data, { sql, params: [...params] })
                log(`execute: filled tab ${tabId}`)
            } else {
                await results.show(db, data, { sql, params: [...params] })
            }
            return data
        } catch (err) {
            if (tabId !== undefined) { results.close(db, tabId) }
            log(`execute: failed after ${Date.now() - started} ms ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
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
        // Without a selection, use the statement around the caret so its -- params: line applies.
        const lines = doc.getText().split(/\r?\n/)
        const statement = editor.selection.isEmpty
            ? [...splitStatements(doc.getText())].reverse().find((candidate) => candidate.line <= editor.selection.active.line)
            : undefined
        const block = editor.selection.isEmpty
            ? paramsBlockAt(lines, statement?.line ?? editor.selection.active.line)
            : paramsBlockAt(lines, editor.selection.start.line)
        const prepared = prepare(editor.selection.isEmpty && statement ? statement.sql : sql, block)
        if ("error" in prepared) { void vscode.window.showErrorMessage(prepared.error); return }
        await executeStatement(db, prepared.sql, prepared.params)
    }

    context.subscriptions.push(
        vscode.commands.registerCommand("sqlite3-editor.runQuery", run),
        vscode.commands.registerCommand("sqlite3-editor.runStatement", async (db: unknown, sql: unknown, block: unknown) => {
            log(`runStatement: session=${String(db)} block=${block === null ? "null" : typeof block} sql=${typeof sql === "string" ? JSON.stringify(sql).slice(0, 200) : typeof sql}`)
            if (typeof db !== "string" || typeof sql !== "string" || sql.trim() === "") {
                // Never fail silently: a click with no visible reaction is indistinguishable from a bug.
                void vscode.window.showWarningMessage("Run needs a session and a statement. Open the document with SQL Editor first.")
                return
            }
            const prepared = prepare(sql, typeof block === "string" ? block : null)
            if ("error" in prepared) { log(`runStatement: rejected: ${prepared.error}`); void vscode.window.showErrorMessage(prepared.error); return }
            try {
                await executeStatement(db, prepared.sql, prepared.params)
            } catch (err) {
                log(`runStatement: unexpected ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
                void vscode.window.showErrorMessage(`Run failed: ${err instanceof Error ? err.message : String(err)}`)
            }
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
