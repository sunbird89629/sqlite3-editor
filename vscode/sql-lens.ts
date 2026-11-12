import vscode from "vscode"
import { splitStatements } from "./sql-statements"

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
                return splitStatements(doc.getText()).map((statement) => new vscode.CodeLens(
                    new vscode.Range(statement.line, 0, statement.line, 0),
                    {
                        title: "▶ Run",
                        tooltip: "Run this statement (Ctrl+Enter runs the selection or the whole document)",
                        command: "sqlite3-editor.runStatement",
                        arguments: [session, statement.sql],
                    },
                ))
        },
    })
}
