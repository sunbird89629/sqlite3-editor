import vscode from "vscode"
import path from "path"
import { Packr, Unpackr } from "msgpackr"
import { randomUUID } from "crypto"
import { applyEdits, format, parse, ParseError } from "jsonc-parser/lib/esm/main"
import { MySqlClient } from "./mysql-client"
import type { MySqlConnectionConfig } from "./mysql-client"
import { registerQueryEditor } from "./native-query-editor"
import { registerSqlCompletion } from "./sql-completion"
export { registerQueryEditor } from "./native-query-editor"

const packr = new Packr({ useRecords: false, preserveNumericTypes: true })
const unpackr = new Unpackr({ largeBigIntToFloat: false, int64AsNumber: false, mapsAsObjects: true, useRecords: true, preserveNumericTypes: true })

/** A MySQL session has no file: `<connectionId>/<database>` identifies it in the query editor. */
const sessionKey = (config: MySqlConnectionConfig) => `${config.id}/${config.database}`

export const readConnections = (): MySqlConnectionConfig[] => {
    const raw = vscode.workspace.getConfiguration("sqlite3-editor").get<unknown[]>("mysqlConnections")
    if (!Array.isArray(raw)) { return [] }
    return raw.filter((entry): entry is MySqlConnectionConfig => {
        if (typeof entry !== "object" || entry === null) { return false }
        const { id, host, database } = entry as Record<string, unknown>
        return typeof id === "string" && id !== "" && typeof host === "string" && host !== "" && typeof database === "string" && database !== ""
    })
}

const connectionLabel = (config: MySqlConnectionConfig) => config.name || `${config.host}/${config.database}`

export const activate = (context: vscode.ExtensionContext) => {
    const queryEditor = registerQueryEditor(context)
    registerSqlCompletion(context, (session) => queryEditor.getClient(session))
    const sessions = new Map<string, { client: MySqlClient, panel: vscode.WebviewPanel }>()
    const snapshots = new Map<string, string>()

    const connect = async () => {
        const configs = readConnections()
        if (configs.length === 0) {
            const open = "Open settings"
            const picked = await vscode.window.showErrorMessage("No MySQL connection is configured. Add one to 'sqlite3-editor.mysqlConnections'.", open)
            if (picked === open) { await vscode.commands.executeCommand("workbench.action.openSettings", "sqlite3-editor.mysqlConnections") }
            return
        }
        const picked = await vscode.window.showQuickPick(configs.map((config) => ({ label: connectionLabel(config), description: `${config.user ?? ""}@${config.host}:${config.port ?? 3306}`, config })), { placeHolder: "Connect to MySQL" })
        if (!picked) { return }
        const key = sessionKey(picked.config)
        const existing = sessions.get(key)
        if (existing) { existing.panel.reveal(); return }

        let client: MySqlClient
        try {
            client = await MySqlClient.connect(picked.config)
        } catch (err) {
            void vscode.window.showErrorMessage(`Could not connect to ${connectionLabel(picked.config)}: ${err instanceof Error ? err.message : String(err)}`)
            return
        }
        const panel = vscode.window.createWebviewPanel("sqlite3-editor.mysql", `${connectionLabel(picked.config)} · ${picked.config.database}`, vscode.ViewColumn.Active, {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "webview")],
            enableFindWidget: false,
            retainContextWhenHidden: true,
        })
        sessions.set(key, { client, panel })
        queryEditor.addConnection(key, client)
        const removePanel = queryEditor.addPanel(key, panel)
        let messageListener: vscode.Disposable | undefined
        panel.onDidDispose(() => {
            messageListener?.dispose()
            removePanel()
            queryEditor.removeConnection(key, client)
            sessions.delete(key)
            void client.close()
        })
        panel.webview.html = (await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, "webview", "index.html"))).toString()
            .replace(/((?:src|href)=")\/([^"]+)(")/g, (_, m1, m2, m3) => m1 + panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "webview", m2)).toString() + m3)
        const panelId = Math.random().toString(36)
        messageListener = panel.webview.onDidReceiveMessage(({ requestId, path: url, body, coalesceKey }: { requestId: number, path: string, body: Uint8Array, coalesceKey?: string }) => {
            const res = {
                send: (buf: Buffer | Uint8Array) => { void panel.webview.postMessage({ type: "sqlite3-editor-server", requestId, body: new Uint8Array(buf) }) },
                status: (_code: 400) => ({ send: (text: string) => { void panel.webview.postMessage({ type: "sqlite3-editor-server", requestId, err: text }) } }),
            }
            switch (url) {
                case "/setState": {
                    const { key: stateKey, value } = packr.unpack(body) as { key: string, value: unknown }
                    context.workspaceState.update(stateKey, value)
                        .then(() => { res.send(packr.pack(null)) }, (err) => { res.status(400).send((err as Error).message) })
                    break
                } case "/downloadState": {
                    res.send(packr.pack(Object.fromEntries(context.workspaceState.keys().map((stateKey) => [stateKey, context.workspaceState.get(stateKey)]))))
                    break
                } case "/openRowInEditor": case "/openCellInEditor": {
                    // A read-only snapshot: the value is shown in an editor tab and never written back.
                    const { content, column, table, row } = unpackr.unpack(body) as { content: unknown, column: unknown, table?: string, row?: string }
                    if (typeof content !== "string" || typeof column !== "string") { res.status(400).send("Invalid cell content"); break }
                    const errors: ParseError[] = []
                    parse(content, errors, { disallowComments: true, allowTrailingComma: false })
                    const isJSON = content.trim().length > 0 && errors.length === 0
                    const text = isJSON ? applyEdits(content, format(content, undefined, { insertSpaces: true, tabSize: 2 })) : content
                    const name = [table, row, column].filter(Boolean).join(" · ").replace(/[\\/\x00-\x1f:*?"<>|]/g, "_").slice(0, 160) || "value snapshot"
                    const uri = vscode.Uri.from({ scheme: "sqlite-editor-snapshot", path: `/${randomUUID()}/${name}.${isJSON ? "json" : "txt"}` })
                    snapshots.set(uri.toString(), text)
                    vscode.workspace.openTextDocument(uri).then((doc) => vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true })).then(
                        () => res.send(packr.pack(null)),
                        (err) => { snapshots.delete(uri.toString()); res.status(400).send((err as Error).message) },
                    )
                    break
                } case "/openNativeQuery": {
                    const { tableName, prefill } = unpackr.unpack(body) as { tableName?: string, prefill?: string }
                    queryEditor.open(key, tableName, prefill).then(() => res.send(packr.pack(null)), (err) => res.status(400).send((err as Error).message))
                    break
                } case "/openQueryFile": {
                    vscode.window.showOpenDialog({ canSelectMany: false, filters: { SQL: ["sql"] } }).then(async (uris) => {
                        if (!uris?.[0]) { res.send(packr.pack(null)); return }
                        const bytes = await vscode.workspace.fs.readFile(uris[0])
                        res.send(packr.pack({ name: uris[0].fsPath, content: Buffer.from(bytes).toString("utf8") }))
                    }).then(undefined, (err: Error) => res.status(400).send(err.message))
                    break
                } case "/saveQueryFile": {
                    const { content } = unpackr.unpack(body) as { content: string }
                    if (typeof content !== "string") { res.status(400).send("Invalid query content"); break }
                    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
                    const defaultUri = folder ? vscode.Uri.file(path.join(folder, "query.sql")) : undefined
                    vscode.window.showSaveDialog({ filters: { SQL: ["sql"] }, defaultUri }).then(async (uri) => {
                        if (!uri) { res.send(packr.pack(null)); return }
                        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"))
                        res.send(packr.pack(uri.fsPath))
                    }).then(undefined, (err: Error) => res.status(400).send(err.message))
                    break
                } default: {
                    let coalesce: string | undefined
                    try {
                        if (url === "/query" && coalesceKey && unpackr.unpack(body).mode === "r") { coalesce = panelId + ":" + coalesceKey }
                    } catch { /* Invalid requests are reported by the client. */ }
                    client.request(body, (data) => res.send(data), (err) => { res.status(400).send(err.message) }, coalesce)
                    break
                }
            }
        })
    }

    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider("sqlite-editor-snapshot", {
            provideTextDocumentContent: (uri) => snapshots.get(uri.toString()) ?? "",
        }),
        vscode.workspace.onDidCloseTextDocument((doc) => { if (doc.uri.scheme === "sqlite-editor-snapshot") { snapshots.delete(doc.uri.toString()) } }),
        vscode.commands.registerCommand("sqlite3-editor.connectMySql", connect),
    )
}

export const deactivate = () => { }
