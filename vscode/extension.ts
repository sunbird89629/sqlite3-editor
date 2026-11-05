import vscode from "vscode"
import { spawn, spawnSync } from "child_process"
import { temporaryFile } from "tempy"
import fs from "fs"
import path from "path"
import which from "which"
import { Packr, Unpackr } from "msgpackr"
import os from "os"
import { randomUUID } from "crypto"
import { applyEdits, format, parse, ParseError } from "jsonc-parser/lib/esm/main"
import { registerQueryEditor } from "./native-query-editor"
export { registerQueryEditor } from "./native-query-editor"

const packr = new Packr({ useRecords: false, preserveNumericTypes: true })
const unpackr = new Unpackr({ largeBigIntToFloat: false, int64AsNumber: false, mapsAsObjects: true, useRecords: true, preserveNumericTypes: true })

export class LocalPythonClient {
    readonly #p
    readonly #rust: boolean
    #queryMode: "r" | "w+" = "r"
    #command = "query"
    readonly #requestBody = temporaryFile({ extension: "msgpack" })
    readonly #responseBody = temporaryFile({ extension: "msgpack" })
    #closed: false | "success" | "error" = false

    #resolve!: (data: Buffer) => void
    #reject!: (message: Error) => void
    #failure: Error | null = null
    #stdout = ""

    #fail(err: Error) {
        if (this.#failure) { return }
        this.#failure = err
        for (const job of this.#queue.splice(0)) { job.reject(err) }
    }

    constructor(pythonPath: string, serverScriptPath: string, databasePath: string, rustPath?: string) {
        this.#rust = !!rustPath
        this.#p = spawn(rustPath ?? pythonPath, [
            rustPath ? "server" : serverScriptPath,
            "--database-filepath", databasePath,
            "--request-body-filepath", this.#requestBody,
            "--response-body-filepath", this.#responseBody,
        ])
        this.#p.on("error", (err) => {
            this.#fail(err)
            vscode.window.showErrorMessage(err.message)
        })
        this.#p.stdin.on("error", (err) => this.#fail(err))
        let errors = ""
        this.#p.stderr.on("data", (err: Buffer) => {
            const errStr = err.toString()
            if (errStr.includes("Traceback (") || this.#closed === "error") {
                // Show the error if it is a runtime error.
                vscode.window.showErrorMessage(errStr)
            } else {
                console.error(errStr)
                errors += errStr + "\n"
            }
        })
        this.#p.stdout.on("data", (data: Buffer) => {
            this.#stdout += data.toString()
            let newline: number
            while ((newline = this.#stdout.indexOf("\n")) !== -1) {
                const status = this.#stdout.slice(0, newline).trim()
                this.#stdout = this.#stdout.slice(newline + 1)
                try {
                    if (!this.#rust && status !== "400" && status !== "200") { this.#fail(new Error(`Invalid server response: ${status}`)); continue }
                    fs.promises.readFile(this.#responseBody).then((data) => {
                        if (this.#failure) { return }
                        if (this.#rust) {
                            try {
                                if (data.subarray(-3).toString() !== "END") { throw new Error("Incomplete Rust server response") }
                                const payload = data.subarray(0, -3)
                                if (status !== "Success") { this.#reject(new Error(payload.toString())); return }
                                if (this.#command !== "query") { this.#resolve(payload); return }
                                if (this.#queryMode === "w+") { this.#resolve(packr.pack(undefined)); return }
                                const response = unpackr.unpack(payload) as { records?: Record<string, unknown[]> }
                                const columnar = response.records ?? {}
                                const columns = Object.keys(columnar)
                                if (!columns.length) { this.#resolve(packr.pack(undefined)); return }
                                const count = columnar[columns[0]!]!.length
                                const records = Array.from({ length: count }, (_, i) => Object.fromEntries(columns.map((name) => [name, columnar[name]![i]])))
                                this.#resolve(packr.pack({ columns, records }))
                            } catch (err) { this.#fail(err as Error) }
                        } else if (status === "400") { this.#reject(new Error(data.toString())) }
                        else { this.#resolve(data) }
                    }, (err) => this.#fail(err))
                } catch (err) { this.#fail(err as Error) }
            }
        })
        this.#p.on("exit", (code) => {
            if (this.#closed) { return }
            this.#closed = "error"
            this.#fail(new Error(`Python process exited: ${code}\n${errors}`))
            vscode.window.showErrorMessage(`Process exited: ${code}\n${errors}`)
        })
        this.#p.once("close", () => {
            fs.rmSync(this.#requestBody, { force: true })
            fs.rmSync(this.#responseBody, { force: true })
        })
    }

    #queue = new Array<{ start: () => void, reject: (err: Error) => void, key?: string }>()
    request(body: Buffer | Uint8Array, resolve: (data: Buffer) => void, reject: (err: Error) => void, key?: string) {
        this.#enqueue("query", body, resolve, reject, key)
    }

    get hasRust() { return this.#rust }

    command(command: "code_lens" | "completion" | "check_syntax", args: unknown[]): Promise<any> {
        if (!this.#rust) { return Promise.reject(new Error("SQL language features require the Rust backend.")) }
        return new Promise((resolve, reject) => this.#enqueue(command, packr.pack(args), (data) => {
            try { resolve(unpackr.unpack(data)) } catch (err) { reject(err) }
        }, reject))
    }

    #enqueue(command: string, body: Buffer | Uint8Array, resolve: (data: Buffer) => void, reject: (err: Error) => void, key?: string) {
        if (this.#failure || this.#closed) { reject(this.#failure ?? new Error("Database connection closed")); return }
        // Coalesce only consecutive queued reads, never across a write or another operation.
        if (key) {
            for (let i = this.#queue.length - 1; i >= 1; i--) {
                const queued = this.#queue[i]!
                if (!queued.key) { break }
                if (queued.key === key) {
                    this.#queue.splice(i, 1)
                    queued.reject(new Error("Request superseded"))
                }
            }
        }
        const job = () => {
            this.#command = command
            this.#resolve = (data) => { resolve(data); this.#queue.shift(); this.#queue[0]?.start() }
            this.#reject = (err) => { reject(err); this.#queue.shift(); this.#queue[0]?.start() }
            try {
                let requestBody = body
                if (this.#rust && command === "query") {
                    const request = unpackr.unpack(body) as { query: string, params: unknown[], mode: "r" | "w+" }
                    this.#queryMode = request.mode
                    requestBody = packr.pack([request.query, request.params, request.mode === "r" ? "read_only" : "read_write", { changes: null, allow_fewer_changes: false, pre_stmt: null, check_placeholders: null }])
                }
                fs.promises.writeFile(this.#requestBody, requestBody).then(() => {
                    if (!this.#failure) { this.#p.stdin.write(this.#rust ? command + "\n" : "handle\n") }
                }, (err) => this.#fail(err))
            } catch (err) { this.#fail(err as Error) }
        }
        this.#queue.push({ start: job, reject, key })
        if (this.#queue.length === 1) {
            this.#queue[0]!.start()
        }
    }

    close() {
        this.#closed ||= "success"
        this.#fail(new Error("Database connection closed"))
        if (!this.#p.stdin.destroyed) { this.#p.stdin.write("close\n") }
    }
}

/**
 * Calls spawnSync() returns the child process's stdout as a string.
 * If the child process returns a non-zero exit code, or if an error occurs, the `or` value is returned.
 */
const spawnSyncOr = (command: string, args: readonly string[], or: string) => {
    try {
        const p = spawnSync(command, args)
        if (p.status !== 0) { return or }
        return p.stdout.toString()
    } catch (err) {
        return or
    }
}

const supportedPythonVersion = [3, 6] as const
const supportedSQLiteVersion = [3, 8]

const checkPythonVersion = (filepath: string) => {
    const pythonVersionCheck = spawnSyncOr(filepath, ["-c", `import sys; print(sys.version_info >= (${supportedPythonVersion[0]}, ${supportedPythonVersion[1]}))`], "")
    if (!pythonVersionCheck.includes("True")) { return false }
    const sqliteVersionCheck = spawnSyncOr(filepath, ["-c", `import sqlite3; print(tuple(map(int, sqlite3.sqlite_version.split("."))) >= (${supportedSQLiteVersion[0]}, ${supportedSQLiteVersion[1]}))`], "")
    if (!sqliteVersionCheck.includes("True")) { return false }
    return true
}

const findPython = async () => {
    const [major, minor] = supportedPythonVersion

    // Microsoft store
    for (const name of [
        ...[...Array(10).keys()].map((x) => `python${major}.${x + minor}`).reverse(),
        `python${major}`,
    ]) {
        // fs.existsSync(filepath) throws permission errors so we need to try executing the binary.
        const filepath = `${os.homedir()}\\AppData\\Local\\Microsoft\\WindowsApps\\${name}.exe`
        if (!spawnSyncOr(filepath, ["--version"], "").includes("Python")) { continue }
        if (!checkPythonVersion(filepath)) { continue }
        return filepath
    }

    // Other installations
    for (const name of [
        ...[...Array(10).keys()].map((x) => `python${major}.${x + minor}`).reverse(),
        `python${major}`,
        "python",
        "py",
    ]) {
        try {
            const filepath = await which(name)  // which() doesn't find applications in the WindowsApps directory.
            if (!checkPythonVersion(filepath)) { continue }
            return filepath
        } catch (err) {
            if ((err as any).code !== "ENOENT") {
                console.error(err)
            }
        }
    }
    return null
}

export const activate = (context: vscode.ExtensionContext) => {
    let terminal: vscode.Terminal | undefined
    const queryEditor = registerQueryEditor(context)
    const cellSnapshots = new Map<string, string>()
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider("sqlite-editor-cell", {
            provideTextDocumentContent: (uri) => cellSnapshots.get(uri.toString()) ?? "",
        }),
        vscode.workspace.onDidCloseTextDocument((doc) => { if (doc.uri.scheme === "sqlite-editor-cell") { cellSnapshots.delete(doc.uri.toString()) } }),
        {
            dispose: () => {
                terminal?.dispose()
                terminal = undefined
            }
        },
        vscode.window.registerCustomEditorProvider("sqlite3-editor.editor", {
            async openCustomDocument(uri, openContext, token) {
                const rustPath = context.asAbsolutePath(`bin/sqlite3-editor-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`)
                const hasRust = fs.existsSync(rustPath)
                const pythonPath = (vscode.workspace.getConfiguration("sqlite3-editor").get<string>("pythonPath") || await findPython()) ?? undefined
                if (!pythonPath && !hasRust) {
                    const msg = `Could not find a Python >=${supportedPythonVersion[0]}.${supportedPythonVersion[1]} binary compiled with SQLite >=${supportedSQLiteVersion[0]}.${supportedSQLiteVersion[1]} .Install one from https://www.python.org/ or your OS's package manager (Microsoft Store, brew, apt, etc.).`
                    vscode.window.showErrorMessage(msg)
                    throw new Error(msg)
                }
                if (uri.scheme === "file") {
                    const conn = new LocalPythonClient(pythonPath ?? "", context.asAbsolutePath("server.py"), uri.fsPath, hasRust ? rustPath : undefined)
                    queryEditor.addConnection(uri.fsPath, conn)
                    // Watch the database file
                    const watcher = fs.watch(uri.fsPath)

                    // Watch the -wal file. We use setInterval instead of fs.watch because fs.watch doesn't accept non-existent files.
                    let mtime = 0
                    const timer = setInterval(() => {
                        const walFile = `${uri.fsPath}-wal`
                        try {
                            const newMtime = fs.statSync(walFile).mtimeMs
                            if (mtime !== newMtime) {
                                watcher.emit("change", walFile)
                            }
                            mtime = newMtime
                        } catch (err) {
                            if (!(err instanceof Error && "code" in err && err.code === "ENOENT")) {
                                console.error(err) // Show the error if it isn't an ENOENT
                            }
                        }
                    }, 1000)

                    return {
                        uri,
                        unsupportedScheme: false,
                        dispose: () => {
                            queryEditor.removeConnection(uri.fsPath, conn)
                            conn.close()
                            watcher.removeAllListeners()
                            watcher.close()
                            clearInterval(timer)
                        },
                        conn,
                        watcher,
                        pythonPath,
                    }
                } else {  // unsupportedScheme such as the diff view.
                    return {
                        uri,
                        unsupportedScheme: true,
                        dispose: () => { },
                    }
                }
            },
            async resolveCustomEditor(document, webviewPanel, token) {
                if (document.unsupportedScheme) {
                    if (document.uri.scheme === "git") {
                        let options = ""
                        try {
                            if (JSON.parse(decodeURIComponent(document.uri.query)).ref === "") {
                                options = " --staged"
                            }
                        } catch (err) { console.error(err) }
                        webviewPanel.webview.html = `The sqlite3 - editor extension doesn't support the git-diff view. Use the following command instead.<br /><code>${escapeHTML(`git -c 'diff.default.textconv = echo.dump | sqlite3' diff${options} '${document.uri.fsPath}'`)}</code>`
                    } else {
                        webviewPanel.webview.html = `Unsupported file scheme: ${escapeHTML(document.uri.scheme)}`
                    }
                    return
                }
                webviewPanel.webview.options = {
                    enableScripts: true,
                    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "webview")],
                }
                webviewPanel.webview.html = (await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, "webview", "index.html"))).toString()
                    .replace(/((?:src|href)=")\/([^"]+)(")/g, (_, m1, m2, m3) => m1 + webviewPanel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "webview", m2)).toString() + m3)

                const panelId = Math.random().toString(36)
                const unregisterPanel = queryEditor.addPanel(document.uri.fsPath, webviewPanel)
                webviewPanel.onDidDispose(unregisterPanel)
                context.subscriptions.push(webviewPanel.webview.onDidReceiveMessage(({ requestId, path: url, body, coalesceKey }: { requestId: number, path: string, body: Uint8Array, coalesceKey?: string }) => {
                    const res = {
                        send: (buf: Buffer | Uint8Array) => { webviewPanel.webview.postMessage({ type: "sqlite3-editor-server", requestId, body: new Uint8Array(buf) }) },
                        status: (code: 400) => ({ send: (text: string) => { webviewPanel.webview.postMessage({ type: "sqlite3-editor-server", requestId, err: text }) } })
                    }
                    switch (url) {
                        case "/setState": {
                            const { key, value } = packr.unpack(body) as { key: string, value: unknown }
                            context.workspaceState.update(key, value)
                                .then(() => { res.send(packr.pack(null)) }, (err) => { res.status(400).send((err as Error).message) })
                            break
                        } case "/downloadState": {
                            res.send(packr.pack(Object.fromEntries(context.workspaceState.keys().map((key) => [key, context.workspaceState.get(key)]))))
                            break
                        } case "/openCellInEditor": {
                            const { content, column, table, row, source } = unpackr.unpack(body) as { content: unknown, column: unknown, table?: string, row?: string, source?: string }
                            if (typeof content !== "string" || typeof column !== "string") { res.status(400).send("Invalid cell content"); break }
                            const errors: ParseError[] = []
                            parse(content, errors, { disallowComments: true, allowTrailingComma: false })
                            const isJSON = content.trim().length > 0 && errors.length === 0
                            const text = isJSON ? applyEdits(content, format(content, undefined, { insertSpaces: true, tabSize: 2 })) : content
                            const name = [table, row, column, source === "saved" ? "saved snapshot" : "draft snapshot"].filter(Boolean).join(" · ").replace(/[\\/\x00-\x1f:*?"<>|]/g, "_").slice(0, 160) || "cell snapshot"
                            const uri = vscode.Uri.from({ scheme: "sqlite-editor-cell", path: `/${randomUUID()}/${name}.${isJSON ? "json" : "txt"}` })
                            cellSnapshots.set(uri.toString(), text)
                            vscode.workspace.openTextDocument(uri).then((doc) => vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false })).then(
                                () => res.send(packr.pack(null)),
                                (err) => { cellSnapshots.delete(uri.toString()); res.status(400).send((err as Error).message) },
                            )
                            break
                        } case "/openNativeQuery": {
                            const { tableName } = unpackr.unpack(body) as { tableName?: string }
                            queryEditor.open(document.uri.fsPath, tableName).then(() => res.send(packr.pack(null)), (err) => res.status(400).send((err as Error).message))
                            break
                        } case "/openQueryFile": {
                            vscode.window.showOpenDialog({ canSelectMany: false, filters: { SQL: ["sql"] } }).then(async (uris) => {
                                if (!uris?.[0]) { res.send(packr.pack(null)); return }
                                const bytes = await vscode.workspace.fs.readFile(uris[0])
                                res.send(packr.pack({ name: uris[0].fsPath, content: Buffer.from(bytes).toString("utf8") }))
                            }).then(undefined, (err) => res.status(400).send((err as Error).message))
                            break
                        } case "/saveQueryFile": {
                            const { content } = unpackr.unpack(body) as { content: string }
                            if (typeof content !== "string") { res.status(400).send("Invalid query content"); break }
                            vscode.window.showSaveDialog({ filters: { SQL: ["sql"] }, defaultUri: vscode.Uri.file(path.join(path.dirname(document.uri.fsPath), "query.sql")) }).then(async (uri) => {
                                if (!uri) { res.send(packr.pack(null)); return }
                                await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"))
                                res.send(packr.pack(uri.fsPath))
                            }).then(undefined, (err) => res.status(400).send((err as Error).message))
                            break
                        } case "/import": {
                            const { filepath } = packr.unpack(body) as { filepath: string }
                            fs.promises.readFile(path.resolve(path.dirname(document.uri.fsPath), filepath))
                                .then((buf) => { res.send(packr.pack(buf)) })
                                .catch((err) => { res.status(400).send(err.message) })
                            break
                        } case "/export": {
                            const { filepath, data } = packr.unpack(body) as { filepath: string, data: Uint8Array | Buffer }
                            fs.promises.writeFile(path.resolve(path.dirname(document.uri.fsPath), filepath), data)
                                .then(() => { res.send(packr.pack(null)) })
                                .catch((err) => { res.status(400).send(err.message) })
                            break
                        } case "/openTerminal": {
                            const { text } = packr.unpack(body) as { text: string }
                            if (!document.pythonPath && (text.includes("{{pythonPath}}") || text.includes("{{install sqlite-utils &&}}"))) { res.status(400).send("Python is required for this command."); break }
                            if (!terminal || terminal.exitStatus !== undefined) {
                                terminal = vscode.window.createTerminal("SQLite3 Editor")
                            }
                            const pipList = JSON.parse(document.pythonPath ? spawnSyncOr(document.pythonPath, ["-m", "pip", "list", "--format=json"], "[]") : "[]") as { name: string, version: string }[]
                            terminal.sendText(text
                                .replaceAll("{{install sqlite-utils &&}}", pipList.some(({ name, version }) => name === "sqlite-utils" && +version.split(".")[0]! >= 3) ? "" : "{{pythonPath}} -m pip install -qU --user sqlite-utils && ")
                                .replaceAll("{{pythonPath}}", escapeShell(document.pythonPath ?? "python3"))
                                .replaceAll("{{databasePath}}", escapeShell(document.uri.fsPath)), false)
                            terminal.show()
                            res.send(packr.pack(null))
                            break
                        } default: {
                            let key: string | undefined
                            try {
                                if (url === "/query" && coalesceKey && unpackr.unpack(body).mode === "r") { key = panelId + ":" + coalesceKey }
                            } catch { /* Invalid requests are handled by the database server. */ }
                            document.conn.request(body, (body) => res.send(body), (err) => { res.status(400).send((err as Error).message) }, key)
                            break
                        }
                    }
                }))

                document.watcher.on("change", () => {
                    webviewPanel.webview.postMessage({ type: "sqlite3-editor-server" })
                })
            },
        } /* satisfies */ as vscode.CustomReadonlyEditorProvider<vscode.Disposable & (
            | {
                uri: vscode.Uri
                unsupportedScheme: false
                conn: LocalPythonClient
                watcher: fs.FSWatcher
                pythonPath: string | undefined
            }
            | {
                uri: vscode.Uri
                unsupportedScheme: true
            }
        )>, {
            supportsMultipleEditorsPerDocument: true,
            webviewOptions: {
                enableFindWidget: false,
                retainContextWhenHidden: true,
            },
        }),
    )
}

export const deactivate = () => { }

const escapeHTML = (t: string) => t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")

const escapeShell = (s: string) => `'${s.replaceAll("'", "'\\''")}'`
