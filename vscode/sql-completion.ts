import vscode from "vscode"
import type { MySqlClient } from "./mysql-client"
import { suggest } from "./sql-completion-core"
import type { Suggestion } from "./sql-completion-core"

/** How long a schema snapshot is reused before the next completion refetches it. */
const CACHE_TTL_MS = 30_000

const sessionOf = (doc: vscode.TextDocument) => /^-- database: (.+)$/.exec(doc.lineAt(0).text)?.[1]

const KIND: Record<Suggestion["kind"], vscode.CompletionItemKind> = {
    column: vscode.CompletionItemKind.Field,
    table: vscode.CompletionItemKind.Class,
    keyword: vscode.CompletionItemKind.Keyword,
}

/**
 * Completion for SQL documents that belong to a MySQL session: columns of the tables the statement
 * mentions, then table names, then keywords. Everything comes from `information_schema`, cached for
 * a few seconds so that typing does not issue a query per keystroke.
 */
export const registerSqlCompletion = (context: vscode.ExtensionContext, getClient: (session: string) => MySqlClient | undefined) => {
    const cache = new Map<string, { fetchedAt: number, tables: Map<string, string[]> }>()

    const loadTables = async (session: string, client: MySqlClient): Promise<Map<string, string[]>> => {
        const cached = cache.get(session)
        if (cached !== undefined && Date.now() - cached.fetchedAt < CACHE_TTL_MS) { return cached.tables }
        const result = await client.query(
            "SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION",
            [])
        const tables = new Map<string, string[]>()
        for (const record of result.records ?? []) {
            const table = String(record.t)
            const column = String(record.c)
            const columns = tables.get(table)
            if (columns === undefined) { tables.set(table, [column]) } else { columns.push(column) }
        }
        cache.set(session, { fetchedAt: Date.now(), tables })
        return tables
    }

    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((doc) => {
            const session = sessionOf(doc)
            if (session !== undefined) { cache.delete(session) }
        }),
        vscode.languages.registerCompletionItemProvider({ language: "sql" }, {
            async provideCompletionItems(doc, position) {
                const session = sessionOf(doc)
                if (session === undefined) { return undefined }
                const client = getClient(session)
                if (client === undefined) { return undefined }

                const word = doc.getWordRangeAtPosition(position)
                const prefix = word !== undefined ? doc.getText(word) : ""
                // A bare `.` asks for the columns of the preceding table, so it opens the list too.
                if (prefix === "" && doc.getText().slice(Math.max(0, doc.offsetAt(position) - 1), doc.offsetAt(position)) !== ".") { return undefined }

                let tables: Map<string, string[]> = new Map()
                try {
                    tables = await loadTables(session, client)
                } catch (err) {
                    // A broken session still gets keywords rather than no list at all.
                    console.error("SQL completion could not read the schema", err)
                }

                const range = word ?? new vscode.Range(position, position)
                const items = suggest({ sql: doc.getText(), prefix, tables }).map((suggestion) => {
                    const item = new vscode.CompletionItem(suggestion.label, KIND[suggestion.kind])
                    item.detail = suggestion.kind === "column" ? `${suggestion.detail} column` : suggestion.kind === "table" ? "table or view" : "MySQL keyword"
                    item.range = range
                    return item
                })
                return new vscode.CompletionList(items, false)
            },
        }, ".")
    )
}
