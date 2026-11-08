import vscode from "vscode"
import { Packr, Unpackr } from "msgpackr"
import type { LocalPythonClient } from "./extension"
import { SQLITE_KEYWORDS } from "./sqlite-keywords"

const packr = new Packr({ useRecords: false, preserveNumericTypes: true })
const unpackr = new Unpackr({ largeBigIntToFloat: false, int64AsNumber: false, mapsAsObjects: true, useRecords: true, preserveNumericTypes: true })
type Location = { line: number | bigint, column: number | bigint }
type Lens = { kind: "Select" | "Explain" | "Other", range: { start: Location, end: Location }, stmt_executed: string, placeholders: unknown[], cte_identifier: string | null }

/** A query is associated only with a database the user has explicitly opened. */
export function registerQueryEditor(context: vscode.ExtensionContext) {
    const connections = new Map<string, Set<LocalPythonClient>>()
    const panels = new Map<string, Set<vscode.WebviewPanel>>()
    const diagnostics = vscode.languages.createDiagnosticCollection("sqlite3-editor")
    const codeLensChanged = new vscode.EventEmitter<void>()
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    context.subscriptions.push(diagnostics, codeLensChanged, { dispose: () => { for (const timer of timers.values()) { clearTimeout(timer) } } })
    const database = (doc: vscode.TextDocument) => /^-- database: (.+)$/.exec(doc.lineAt(0).text)?.[1]
    const connection = (doc: vscode.TextDocument) => {
        const name = database(doc)
        return name ? connections.get(name)?.values().next().value as LocalPythonClient | undefined : undefined
    }
    const position = (doc: vscode.TextDocument, loc: Location) => {
        const line = Math.min(Number(loc.line), doc.lineCount - 1)
        const column = Array.from(doc.lineAt(line).text).slice(0, Number(loc.column)).join("").length
        return new vscode.Position(line, column)
    }
    const range = (doc: vscode.TextDocument, value: Lens["range"]) => new vscode.Range(position(doc, value.start), position(doc, value.end))
    const requestQuery = (conn: LocalPythonClient, sql: string, mode: "r" | "w+") => new Promise<any>((resolve, reject) => {
        conn.request(packr.pack({ query: sql, params: [], mode }), (data) => {
            try { resolve(unpackr.unpack(data)) } catch (err) { reject(err) }
        }, reject)
    })
    const run = async (uri: vscode.Uri, version: number, sql: string, kind: Lens["kind"], placeholders: unknown[]) => {
        const doc = await vscode.workspace.openTextDocument(uri)
        if (doc.version !== version) { vscode.window.showWarningMessage("Query changed; use the updated Run link."); return }
        const db = database(doc)
        const conn = connection(doc)
        if (!db || !conn) { vscode.window.showErrorMessage("Open the database in SQLite3 Editor before running this query."); return }
        if (placeholders.length) { vscode.window.showErrorMessage("Queries with parameters are not yet supported in the SQL editor."); return }
        try {
            const result = await requestQuery(conn, sql, kind === "Other" ? "w+" : "r")
            if (result?.columns && result?.records) {
                const display = (value: unknown): string => value === null ? "NULL" : value instanceof Uint8Array ? `BLOB (${value.length} bytes)` : String(value ?? "")
                const rows = result.records.slice(0, 500).map((record: Record<string, unknown>) => result.columns.map((column: string) => display(record[column])))
                for (const panel of panels.get(db) ?? []) { panel.webview.postMessage({ type: "sqlite3-editor-query-result", columns: result.columns, rows, total: result.records.length }) }
                vscode.window.showInformationMessage(`Query returned ${result.records.length} row(s)${result.records.length > 500 ? "; first 500 shown" : ""}.`)
            } else { vscode.window.showInformationMessage("SQL statement executed.") }
        } catch (err) { vscode.window.showErrorMessage(`SQL query failed: ${err instanceof Error ? err.message : String(err)}`) }
    }
    const refreshDiagnostics = (doc: vscode.TextDocument) => {
        if (doc.languageId !== "sql") { return }
        const key = doc.uri.toString()
        const previous = timers.get(key)
        if (previous) { clearTimeout(previous) }
        const conn = connection(doc)
        if (!conn?.hasRust) { diagnostics.delete(doc.uri); return }
        const text = doc.getText(), version = doc.version
        timers.set(key, setTimeout(async () => {
            timers.delete(key)
            try {
                const entries = await conn.command("check_syntax", [text]) as { message: string, severity: string, possible_causes: { offset: number | bigint }[] }[]
                if (doc.isClosed || doc.version !== version) { return }
                diagnostics.set(doc.uri, entries.map((entry) => {
                    const offset = Array.from(text).slice(0, Number(entry.possible_causes[0]?.offset ?? 0)).join("").length
                    const pos = doc.positionAt(offset)
                    return new vscode.Diagnostic(new vscode.Range(pos, doc.positionAt(Math.min(text.length, offset + 1))), entry.message, entry.severity === "Warning" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error)
                }))
            } catch (err) { console.error("SQLite query diagnostics failed", err) }
        }, 300))
    }
    context.subscriptions.push(
        vscode.commands.registerCommand("sqlite3-editor.runQuery", run),
        vscode.languages.registerCompletionItemProvider({ language: "sql" }, {
            provideCompletionItems(doc, pos) {
                if (pos.line === 0 || !database(doc)) { return [] }
                return SQLITE_KEYWORDS.map((word) => {
                    const item = new vscode.CompletionItem(word, vscode.CompletionItemKind.Keyword)
                    item.detail = "SQLite keyword"
                    return item
                })
            },
        }),
        vscode.languages.registerCodeLensProvider({ language: "sql" }, {
            onDidChangeCodeLenses: codeLensChanged.event,
            async provideCodeLenses(doc, token) {
                const conn = connection(doc)
                if (!conn?.hasRust) { return [] }
                const version = doc.version
                try {
                    const lenses = await conn.command("code_lens", [doc.getText()]) as Lens[]
                    if (token.isCancellationRequested || doc.version !== version) { return [] }
                    return lenses.map((lens) => new vscode.CodeLens(range(doc, lens.range), {
                        title: lens.kind === "Other" ? "▶ Run write" : lens.cte_identifier ? `▶ Select ${lens.cte_identifier}` : "▶ Run query",
                        command: "sqlite3-editor.runQuery", arguments: [doc.uri, version, lens.stmt_executed, lens.kind, lens.placeholders],
                    }))
                } catch (err) { console.error("SQLite query CodeLens failed", err); return [] }
            },
        }),
        vscode.languages.registerCompletionItemProvider({ language: "sql" }, {
            async provideCompletionItems(doc, pos, token) {
                const conn = connection(doc)
                if (!conn?.hasRust) { return [] }
                const version = doc.version
                try {
                    const result = await conn.command("completion", [doc.getText(), BigInt(pos.line), BigInt(Array.from(doc.lineAt(pos.line).text.slice(0, pos.character)).length)]) as {
                        table_names: { table: string, schema: string }[], schema_names: string[], columns_in_tables_that_are_referenced_in_source: { column: string, table: string }[], cte_names: string[], as_clauses: string[]
                    }
                    if (token.isCancellationRequested || version !== doc.version) { return [] }
                    const items: vscode.CompletionItem[] = []
                    const add = (name: string, kind: vscode.CompletionItemKind, detail?: string) => {
                        const item = new vscode.CompletionItem(name, kind); item.detail = detail; items.push(item)
                    }
                    for (const item of result.table_names ?? []) { add(item.table, vscode.CompletionItemKind.Class, item.schema) }
                    for (const item of result.columns_in_tables_that_are_referenced_in_source ?? []) { add(item.column, vscode.CompletionItemKind.Field, item.table) }
                    for (const item of result.schema_names ?? []) { add(item, vscode.CompletionItemKind.Module) }
                    for (const item of [...result.cte_names ?? [], ...result.as_clauses ?? []]) { add(item, vscode.CompletionItemKind.Variable) }
                    return items
                } catch (err) { console.error("SQLite query completion failed", err); return [] }
            },
        }, "."),
        vscode.workspace.onDidChangeTextDocument(({ document }) => refreshDiagnostics(document)),
        vscode.workspace.onDidOpenTextDocument(refreshDiagnostics),
        vscode.workspace.onDidCloseTextDocument((doc) => { diagnostics.delete(doc.uri); const key = doc.uri.toString(); const timer = timers.get(key); if (timer) { clearTimeout(timer); timers.delete(key) } }),
    )
    return {
        addConnection(db: string, conn: LocalPythonClient) {
            const set = connections.get(db) ?? new Set<LocalPythonClient>(); set.add(conn); connections.set(db, set)
            codeLensChanged.fire()
            for (const doc of vscode.workspace.textDocuments) { if (database(doc) === db) { refreshDiagnostics(doc) } }
        },
        removeConnection(db: string, conn: LocalPythonClient) {
            const set = connections.get(db); set?.delete(conn); if (!set?.size) { connections.delete(db) }
            codeLensChanged.fire()
            for (const doc of vscode.workspace.textDocuments) { if (database(doc) === db) { refreshDiagnostics(doc) } }
        },
        addPanel(db: string, panel: vscode.WebviewPanel) {
            const set = panels.get(db) ?? new Set<vscode.WebviewPanel>(); set.add(panel); panels.set(db, set)
            return () => { set.delete(panel); if (!set.size) { panels.delete(db) } }
        },
        async open(db: string, tableName?: string, prefill?: string) {
            if (/[\r\n]/.test(db)) { throw new Error("Database paths containing line breaks cannot be used in query documents.") }
            const table = tableName ? `SELECT * FROM "${tableName.replace(/"/g, '""')}";` : "SELECT 1;"
            // A draft from the viewer replaces the default statement, so the user continues in the full editor.
            const body = prefill !== undefined && prefill.trim() !== "" ? prefill : table
            const doc = await vscode.workspace.openTextDocument({ language: "sql", content: `-- database: ${db}\n\n${body}\n` })
            await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false })
            refreshDiagnostics(doc)
            if (!connections.get(db)?.values().next().value?.hasRust) { vscode.window.showWarningMessage("The Rust backend is unavailable; SQL completion and Run links are unavailable on this platform.") }
        },
    }
}
