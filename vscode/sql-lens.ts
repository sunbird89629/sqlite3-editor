import vscode from "vscode"
import { splitStatements } from "./sql-statements"
import { paramsBlockAt, parseParams } from "./sql-params"

/** The session a query document belongs to, taken from its `-- database:` header. */
export const sessionOf = (doc: vscode.TextDocument) => /^-- database: (.+)$/.exec(doc.lineAt(0).text)?.[1]

/**
 * One `▶ Run` link above every statement of a document that belongs to an open session. The links
 * only appear while the connection is open, so a clickable link always has somewhere to run.
 */
export const registerSqlLens = (
    isConnected: (session: string) => boolean,
    changed: vscode.Event<void>,
): vscode.Disposable => {
    return vscode.languages.registerCodeLensProvider({ language: "sql" }, {
            onDidChangeCodeLenses: changed,
            provideCodeLenses(doc) {
                const session = sessionOf(doc)
                if (session === undefined || !isConnected(session)) { return [] }
                const lines = doc.getText().split(/\r?\n/)
                return splitStatements(doc.getText()).map((statement) => {
                    const block = paramsBlockAt(lines, statement.line)
                    const count = block === null ? 0 : parseParams(block).values.size
                    return new vscode.CodeLens(new vscode.Range(statement.line, 0, statement.line, 0), {
                        title: count === 0 ? "▶ Run" : `▶ Run (${count} param${count === 1 ? "" : "s"})`,
                        tooltip: count === 0
                            ? "Run this statement (Ctrl+Enter runs the selection or the whole document)"
                            : `Run this statement with the ${count} value(s) from its -- params: line`,
                        command: "sqlite3-editor.runStatement",
                        arguments: [session, statement.sql, block],
                    })
                })
        },
    })
}
