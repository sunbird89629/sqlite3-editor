import vscode from "vscode"
import { createHash, randomUUID } from "crypto"
import fs from "fs"
import path from "path"
import { applyEdits, format, parse, ParseError } from "jsonc-parser/lib/esm/main"

/**
 * Cell values are edited in a real VS Code text document on the right-hand side.
 * The document scheme is separate from `sqlite-editor-cell`, which serves read-only snapshots.
 */
const scheme = "sqlite-editor-cell-draft"

export type CellDraftSnapshot = { key: string, text: string, dirty: boolean, open: boolean }

type Draft = {
    key: string
    uri: vscode.Uri
    database: string
    table: string
    column: string
    row: string
    /** The value as it was first shown in the editor. A draft is dirty when the text differs from it. */
    original: string
    text: string
    language: "json" | "plaintext"
    open: boolean
    pending: Promise<void> | null
}

/** Returns formatted JSON when `text` is JSON, and the original text otherwise. */
const prettify = (text: string): { text: string, language: Draft["language"] } => {
    if (text.trim() === "") { return { text, language: "plaintext" } }
    const errors: ParseError[] = []
    parse(text, errors, { disallowComments: true, allowTrailingComma: false })
    if (errors.length) { return { text, language: "plaintext" } }
    try {
        return { text: applyEdits(text, format(text, undefined, { insertSpaces: true, tabSize: 2 })), language: "json" }
    } catch {
        return { text, language: "plaintext" }
    }
}

/** The file name mirrors the table, row and column the draft belongs to. */
const documentName = (table: string, column: string, row: string, language: Draft["language"]) =>
    [table, row, column].filter(Boolean).join(" · ").replace(/[\\/\x00-\x1f:*?"<>|]/g, "_").slice(0, 120) + (language === "json" ? ".json" : ".txt")

/**
 * Cell drafts own the text of one cell while it is edited. Only the webview commits the
 * draft to SQLite; saving the document writes a local draft and never touches the database.
 */
export function registerCellEditor(context: vscode.ExtensionContext) {
    const drafts = new Map<string, Draft>()
    const byUri = new Map<string, Draft>()
    const panels = new Map<string, Set<vscode.WebviewPanel>>()
    const fileChanged = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
    const directory = path.join(context.globalStorageUri.fsPath, "cell-drafts")
    const filename = (key: string) => path.join(directory, createHash("sha256").update(key).digest("hex") + ".json")

    type StoredDraft = { key: string, database: string, table: string, column: string, row: string, original: string, text: string }
    const load = (key: string): StoredDraft | undefined => {
        try { return JSON.parse(fs.readFileSync(filename(key), "utf8")) as StoredDraft }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") { return undefined }; throw error }
    }
    const persist = (draft: Draft) => {
        const next = (draft.pending ?? Promise.resolve()).catch(() => {}).then(async () => {
            await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 })
            const destination = filename(draft.key), temporary = destination + "." + randomUUID() + ".tmp"
            const stored: StoredDraft = { key: draft.key, database: draft.database, table: draft.table, column: draft.column, row: draft.row, original: draft.original, text: draft.text }
            try {
                await fs.promises.writeFile(temporary, JSON.stringify(stored), { mode: 0o600 })
                await fs.promises.rename(temporary, destination)
            } finally { await fs.promises.rm(temporary, { force: true }) }
        })
        const done = next.then(() => {}, (error) => { throw error })
        draft.pending = done.catch(() => {})
        void done.catch((error) => vscode.window.showWarningMessage(`Could not save the cell draft: ${error instanceof Error ? error.message : String(error)}`))
        return done
    }
    const forget = async (draft: Draft) => {
        drafts.delete(draft.key)
        byUri.delete(draft.uri.toString())
        await (draft.pending ?? Promise.resolve()).catch(() => {})
        await fs.promises.rm(filename(draft.key), { force: true })
    }

    const snapshot = (draft: Draft): CellDraftSnapshot => ({ key: draft.key, text: draft.text, dirty: draft.text !== draft.original, open: draft.open })
    const notify = (draft: Draft) => {
        for (const panel of panels.get(draft.database) ?? []) { void panel.webview.postMessage({ type: "sqlite-editor-cell-draft", ...snapshot(draft) }) }
    }

    /** Closes the draft tab without a save prompt. The model text is already in `draft.text`. */
    const closeTab = async (draft: Draft) => {
        const target = draft.uri.toString()
        const tab = vscode.window.tabGroups.all.flatMap((group) => group.tabs).find((item) => {
            const input = item.input
            return input instanceof vscode.TabInputText && input.uri.toString() === target
        })
        if (!tab) { return }
        try {
            const doc = await vscode.workspace.openTextDocument(draft.uri)
            if (doc.isDirty) { await doc.save() }
            await vscode.window.tabGroups.close(tab)
        } catch (error) { console.error("Could not close the cell draft tab", error) }
    }

    context.subscriptions.push(fileChanged, vscode.workspace.registerFileSystemProvider(scheme, {
        onDidChangeFile: fileChanged.event,
        watch: () => new vscode.Disposable(() => {}),
        stat: (uri) => {
            const draft = byUri.get(uri.toString())
            if (!draft) { throw vscode.FileSystemError.FileNotFound(uri) }
            return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: Buffer.byteLength(draft.text) }
        },
        readFile: (uri) => {
            const draft = byUri.get(uri.toString())
            if (!draft) { throw vscode.FileSystemError.FileNotFound(uri) }
            return Buffer.from(draft.text, "utf8")
        },
        writeFile: (uri, content) => {
            const draft = byUri.get(uri.toString())
            if (!draft) { throw vscode.FileSystemError.FileNotFound(uri) }
            draft.text = Buffer.from(content).toString("utf8")
            notify(draft)
            return persist(draft)
        },
        readDirectory: () => [],
        createDirectory: () => { throw vscode.FileSystemError.NoPermissions() },
        delete: () => { throw vscode.FileSystemError.NoPermissions("Cell drafts are deleted by the cell editor.") },
        rename: () => { throw vscode.FileSystemError.NoPermissions() },
    }), vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.scheme !== scheme) { return }
        const draft = byUri.get(event.document.uri.toString())
        if (!draft) { return }
        draft.text = event.document.getText()
        notify(draft)
    }))

    return {
        /** Panels receive draft changes for their database only. */
        addPanel(database: string, panel: vscode.WebviewPanel) {
            let targets = panels.get(database)
            if (!targets) { targets = new Set(); panels.set(database, targets) }
            targets.add(panel)
            return () => { targets!.delete(panel); if (!targets!.size) { panels.delete(database) } }
        },
        /** Opens (or focuses) the draft for one cell in the editor column right of the webview. */
        async open(panel: vscode.WebviewPanel, database: string, request: { table: string, column: string, row: string, value: string }): Promise<CellDraftSnapshot> {
            const key = [database, request.table, request.column, request.row].join("\u0000")
            let draft = drafts.get(key)
            if (!draft) {
                const shown = prettify(request.value)
                const stored = load(key)
                const { text, language } = stored ? prettify(stored.text) : shown
                draft = {
                    key,
                    uri: vscode.Uri.from({ scheme, path: `/${randomUUID()}/${documentName(request.table, request.column, request.row, language)}` }),
                    database, table: request.table, column: request.column, row: request.row,
                    original: shown.text,
                    text,
                    language,
                    open: false,
                    pending: null,
                }
                drafts.set(key, draft)
                byUri.set(draft.uri.toString(), draft)
            }
            const doc = await vscode.workspace.openTextDocument(draft.uri)
            if (draft.language === "json" && doc.languageId !== "json") {
                try { await vscode.languages.setTextDocumentLanguage(doc, "json") } catch { /* Plain text is acceptable. */ }
            }
            const viewColumn = panel.viewColumn !== undefined ? panel.viewColumn + 1 : vscode.ViewColumn.Beside
            await vscode.window.showTextDocument(doc, { viewColumn, preview: false })
            draft.open = true
            notify(draft)
            return snapshot(draft)
        },
        /** Replaces the draft text, used when a value is typed into the cell itself. */
        async setText(key: string, text: string): Promise<CellDraftSnapshot> {
            const draft = drafts.get(key)
            if (!draft) { throw new Error("The cell draft is closed.") }
            const doc = await vscode.workspace.openTextDocument(draft.uri)
            if (doc.getText() !== text) {
                const edit = new vscode.WorkspaceEdit()
                edit.replace(draft.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text)
                if (!await vscode.workspace.applyEdit(edit)) {
                    draft.text = text
                    notify(draft)
                }
            }
            return snapshot(draft)
        },
        /** Closes the draft tab. `discard` also deletes the stored draft. */
        async close(key: string, discard: boolean): Promise<CellDraftSnapshot | null> {
            const draft = drafts.get(key)
            if (!draft) { return null }
            await closeTab(draft)
            draft.open = false
            if (discard) {
                await forget(draft)
                notify(draft)
                return { ...snapshot(draft), open: false }
            }
            await persist(draft)
            notify(draft)
            return snapshot(draft)
        },
        /** Current state of one draft, used when the webview reattaches. */
        snapshot(key: string) { const draft = drafts.get(key); return draft ? snapshot(draft) : null },
        /** Drops drafts of a database that is no longer open. */
        async detach(database: string) {
            for (const draft of [...drafts.values()]) {
                if (draft.database !== database) { continue }
                await closeTab(draft)
                await forget(draft)
            }
            panels.delete(database)
        },
    }
}
