import vscode from 'vscode'
import { createHash, randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { Packr } from 'msgpackr'
import { buildInsert, InsertDraft, InsertField } from './insert-draft'
import type { LocalPythonClient } from './extension'

const scheme = 'sqlite-insert-draft'
const viewType = 'sqlite3-editor.insert'
const packr = new Packr({ useRecords: false, preserveNumericTypes: true })
type Model = { draft: InsertDraft, conn?: LocalPythonClient, revision: number, inserted: boolean, busy: boolean, refresh: () => void }
type Document = vscode.CustomDocument & { model: Model, saved: InsertDraft, savedPending: boolean, savedInserted: boolean, savedEpoch: number }

/** Right-hand insert editors own drafts; only the explicit Insert action writes SQLite. */
export function registerInsertEditor(context: vscode.ExtensionContext) {
    const models = new Map<string, Model>()
    const connections = new Map<string, Map<LocalPythonClient, Set<() => void>>>()
    const documents = new Map<string, Document>()
    const panels = new Map<string, Set<vscode.WebviewPanel>>()
    const pendingWrites = new Map<string, Promise<void>>()
    const changed = new vscode.EventEmitter<vscode.CustomDocumentContentChangeEvent<Document>>()
    const fileChanged = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
    const clone = (draft: InsertDraft): InsertDraft => JSON.parse(JSON.stringify(draft))
    type StoredDraft = { uri: string, draft: InsertDraft, inserted: boolean, pending: boolean }
    const directory = path.join(context.globalStorageUri.fsPath, 'insert-drafts')
    const filename = (key: string) => path.join(directory, createHash('sha256').update(key).digest('hex') + '.json')
    const load = (key: string): StoredDraft | undefined => {
        try { return JSON.parse(fs.readFileSync(filename(key), 'utf8')) as StoredDraft }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return undefined }; throw error }
    }
    const persist = (key: string, state: { draft: InsertDraft, inserted: boolean, pending: boolean }) => {
        const previous = pendingWrites.get(key) ?? Promise.resolve()
        const next = previous.catch(() => {}).then(async () => {
            await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 })
            const dest = filename(key), temporary = dest + '.' + randomUUID() + '.tmp'
            try {
                await fs.promises.writeFile(temporary, JSON.stringify({ uri: key, ...state }), { mode: 0o600 })
                await fs.promises.rename(temporary, dest)
            } finally { await fs.promises.rm(temporary, { force: true }) }
        })
        const done = next.then(() => {}, (error) => { throw error })
        pendingWrites.set(key, done)
        void done.finally(() => { if (pendingWrites.get(key) === done) { pendingWrites.delete(key) } }).catch(() => {})
        return done
    }
    const snapshot = (doc: Document) => ({ draft: doc.model.draft, revision: doc.model.revision, inserted: doc.model.inserted })
    const broadcast = (doc: Document, force = false) => { for (const panel of panels.get(doc.uri.toString()) ?? []) { void panel.webview.postMessage({ type: 'snapshot', force, ...snapshot(doc) }) } }
    const provider: vscode.CustomEditorProvider<Document> = {
        onDidChangeCustomDocument: changed.event,
        async openCustomDocument(uri, openContext) {
            let model = models.get(uri.toString())
            if (!model) {
                const saved = load(uri.toString())
                if (!saved) { throw new Error('Insert draft not found.') }
                const connection = connections.get(saved.draft.database)?.entries().next().value
                model = { draft: saved.draft, inserted: saved.inserted, conn: connection?.[0], refresh: connection?.[1].values().next().value ?? (() => {}), revision: saved.pending ? 1 : 0, busy: false }
                models.set(uri.toString(), model)
            }
            if (openContext.backupId) {
                const data = await vscode.workspace.fs.readFile(vscode.Uri.parse(openContext.backupId))
                model.draft = JSON.parse(Buffer.from(data).toString('utf8')) as InsertDraft
                model.revision++
            }
            const savedState = load(uri.toString())
            const doc: Document = { uri, model, saved: clone(savedState?.draft ?? model.draft), savedPending: savedState?.pending ?? false, savedInserted: savedState?.inserted ?? false, savedEpoch: 0, dispose() { documents.delete(uri.toString()) } }
            documents.set(uri.toString(), doc)
            return doc
        },
        async resolveCustomEditor(doc, panel) {
            panel.title = `新增记录 · ${doc.model.draft.table}`
            panel.webview.options = { enableScripts: true }
            let targets = panels.get(doc.uri.toString())
            if (!targets) { targets = new Set(); panels.set(doc.uri.toString(), targets) }
            targets.add(panel)
            panel.onDidDispose(() => { targets!.delete(panel); if (!targets!.size) { panels.delete(doc.uri.toString()) } })
            panel.onDidChangeViewState(() => { if (panel.visible) { broadcast(doc) } })
            panel.webview.html = formHtml(panel.webview.cspSource)
            panel.webview.onDidReceiveMessage(async (message: { type: string, index?: number, field?: InsertField }) => {
                if (message.type === 'ready') { broadcast(doc); return }
                if (message.type === 'edit') {
                    const i = message.index
                    const field = message.field
                    if (typeof i !== 'number' || !field || !doc.model.draft.fields[i] || field.name !== doc.model.draft.fields[i]!.name || !['default', 'null', 'string', 'number', 'blob'].includes(field.type)) { return }
                    doc.model.draft.fields[i] = { name: field.name, type: field.type, value: String(field.value), blob: Array.isArray(field.blob) ? field.blob : null }
                    doc.model.revision++
                    doc.model.inserted = false
                    changed.fire({ document: doc })
                    return
                }
                if (message.type === 'open-text') {
                    const i = message.index
                    if (typeof i !== 'number' || !doc.model.draft.fields[i] || doc.model.draft.fields[i]!.type !== 'string') { return }
                    const content = doc.model.draft.fields[i]!.value
                    let lastSynced = content
                    let language = 'plaintext'
                    try { JSON.parse(content); language = 'json' } catch { /* Plain text remains plain text. */ }
                    const textDoc = await vscode.workspace.openTextDocument({ language, content })
                    const listener = vscode.workspace.onDidChangeTextDocument((event) => {
                        if (event.document !== textDoc || !doc.model.draft.fields[i] || doc.model.draft.fields[i]!.type !== 'string') { return }
                        if (doc.model.draft.fields[i]!.value !== lastSynced) {
                            listener.dispose()
                            void vscode.window.showWarningMessage('The field was changed in the insert form. Copy the text from this editor to resolve the conflict.')
                            return
                        }
                        lastSynced = textDoc.getText()
                        doc.model.draft.fields[i]!.value = lastSynced
                        doc.model.revision++
                        doc.model.inserted = false
                        const active = documents.get(doc.uri.toString())
                        if (active) { changed.fire({ document: active }); broadcast(active) }
                        else { void persist(doc.uri.toString(), { draft: clone(doc.model.draft), inserted: false, pending: true }).catch((error) => vscode.window.showErrorMessage(`Could not save insert draft: ${error}`)) }
                    })
                    const closer = vscode.workspace.onDidCloseTextDocument((closed) => { if (closed === textDoc) { listener.dispose(); closer.dispose() } })
                    await vscode.window.showTextDocument(textDoc, { viewColumn: panel.viewColumn, preview: false })
                    return
                }
                if (message.type === 'cancel') {
                    const tab = vscode.window.tabGroups.all.flatMap((group) => group.tabs).find((item) => {
                        const input = item.input
                        return input instanceof vscode.TabInputCustom && input.viewType === viewType && input.uri.toString() === doc.uri.toString()
                    })
                    if (tab) { await vscode.window.tabGroups.close(tab) }
                    return
                }
                if (message.type === 'insert') {
                    if (doc.model.busy || doc.model.inserted) { return }
                    doc.model.busy = true
                    const revision = doc.model.revision
                    const draft = clone(doc.model.draft)
                    try {
                        const { query, params } = buildInsert(draft)
                        const conn = doc.model.conn
                        if (!conn) { throw new Error('The database is not open. Open it in SQLite3 Editor before inserting.') }
                        await new Promise<void>((resolve, reject) => conn.request(packr.pack({ query, params, mode: 'w+' }), () => resolve(), reject))
                        doc.saved = clone(draft)
                        doc.savedPending = false
                        doc.savedInserted = true
                        doc.savedEpoch++
                        // Never clear edits made while the insert was in flight.
                        if (revision === doc.model.revision) { doc.model.inserted = true }
                        try {
                            await persist(doc.uri.toString(), { draft: clone(doc.model.draft), inserted: doc.model.inserted, pending: !doc.model.inserted })
                        } catch (error) {
                            void vscode.window.showWarningMessage('The record was inserted, but the draft status could not be saved. Check the table before retrying.')
                        }
                        void panel.webview.postMessage({ type: 'result', ok: true, revision, current: doc.model.revision })
                        try {
                            const refreshers = connections.get(draft.database)
                            if (refreshers?.size) { for (const listeners of refreshers.values()) { for (const refresh of listeners) { refresh() } } }
                            else { doc.model.refresh() }
                        } catch { void vscode.window.showWarningMessage('The record was inserted, but the table could not be refreshed automatically.') }
                    } catch (error) {
                        void panel.webview.postMessage({ type: 'result', ok: false, message: error instanceof Error ? error.message : String(error) })
                    } finally {
                        doc.model.busy = false
                    }
                }
            })
        },
        async saveCustomDocument(doc) {
            const draft = clone(doc.model.draft), revision = doc.model.revision, inserted = doc.model.inserted, epoch = doc.savedEpoch
            const pending = revision > 0 && !inserted
            await persist(doc.uri.toString(), { draft, inserted, pending })
            if (doc.savedEpoch === epoch) { doc.saved = draft; doc.savedInserted = inserted; doc.savedPending = pending }
            for (const panel of panels.get(doc.uri.toString()) ?? []) { void panel.webview.postMessage({ type: 'saved', revision, inserted }) }
        },
        async saveCustomDocumentAs(doc, destination) { await vscode.workspace.fs.writeFile(destination, Buffer.from(JSON.stringify(doc.model.draft, null, 2))) },
        async revertCustomDocument(doc) { doc.model.draft = clone(doc.saved); doc.model.inserted = doc.savedInserted; doc.model.revision = doc.savedPending ? 1 : 0; broadcast(doc, true) },
        async backupCustomDocument(doc, backupContext) {
            await vscode.workspace.fs.writeFile(backupContext.destination, Buffer.from(JSON.stringify(doc.model.draft)))
            return { id: backupContext.destination.toString(), delete: () => { void vscode.workspace.fs.delete(backupContext.destination) } }
        },
    }
    context.subscriptions.push(changed, fileChanged, vscode.window.registerCustomEditorProvider(viewType, provider, { webviewOptions: { retainContextWhenHidden: true } }), vscode.workspace.registerFileSystemProvider(scheme, {
        onDidChangeFile: fileChanged.event,
        watch: () => new vscode.Disposable(() => {}),
        stat: (uri) => { if (!models.has(uri.toString()) && !load(uri.toString())) { throw vscode.FileSystemError.FileNotFound(uri) }; return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: 0 } },
        readFile: (uri) => { const draft = models.get(uri.toString())?.draft ?? load(uri.toString())?.draft; if (!draft) { throw vscode.FileSystemError.FileNotFound(uri) }; return Buffer.from(JSON.stringify(draft)) },
        writeFile: () => { throw vscode.FileSystemError.NoPermissions('Drafts are saved by the insert editor.') }, readDirectory: () => [], createDirectory: () => { throw vscode.FileSystemError.NoPermissions() }, delete: () => { throw vscode.FileSystemError.NoPermissions() }, rename: () => { throw vscode.FileSystemError.NoPermissions() },
    }))
    return {
        attach(database: string, conn: LocalPythonClient, refresh: () => void) {
            let active = connections.get(database)
            if (!active) { active = new Map(); connections.set(database, active) }
            let listeners = active.get(conn)
            if (!listeners) { listeners = new Set(); active.set(conn, listeners) }
            listeners.add(refresh)
            for (const model of models.values()) { if (model.draft.database === database) { model.conn = conn; model.refresh = refresh } }
            return () => { listeners!.delete(refresh); if (!listeners!.size) { active!.delete(conn) }; if (!active!.size) { connections.delete(database) } }
        },
        detach(database: string, conn: LocalPythonClient) {
            const active = connections.get(database)
            active?.delete(conn)
            if (!active?.size) { connections.delete(database) }
            const fallback = active?.entries().next().value
            for (const model of models.values()) { if (model.conn === conn) { model.conn = fallback?.[0]; model.refresh = fallback?.[1].values().next().value ?? (() => {}) } }
        },
        async guard(database: string): Promise<boolean> {
            const active = [...models.entries()].filter(([, model]) => model.draft.database === database && model.revision > 0 && !model.inserted)
            if (!active.length) { return true }
            if (active.some(([, model]) => model.busy)) { void vscode.window.showWarningMessage('Wait for the record insertion to finish.'); return false }
            const choice = await vscode.window.showWarningMessage('An insert draft has not been submitted. Keep it while changing the table or page?', { modal: true }, 'Keep draft')
            if (choice !== 'Keep draft') { return false }
            for (const [key, model] of active) { await persist(key, { draft: clone(model.draft), inserted: model.inserted, pending: true }) }
            return true
        },
        async open(conn: LocalPythonClient, draft: InsertDraft, refresh: () => void) {
            let files: string[] = []
            try { files = await fs.promises.readdir(directory) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error } }
            for (const file of files.filter((name) => /^[0-9a-f]{64}\.json$/.test(name))) {
                let saved: StoredDraft
                try { saved = JSON.parse(await fs.promises.readFile(path.join(directory, file), 'utf8')) as StoredDraft } catch { continue }
                const key = saved.uri
                if (typeof key !== 'string') { continue }
                if (models.has(key)) { continue }
                if (saved?.pending && !saved.inserted && saved.draft.database === draft.database && saved.draft.table === draft.table) {
                    models.set(key, { conn, draft: clone(saved.draft), revision: 1, inserted: false, busy: false, refresh })
                }
            }
            for (const [key, model] of models) {
                if (model.draft.database === draft.database && model.draft.table === draft.table && !model.inserted) {
                    model.conn = conn
                    model.refresh = refresh
                    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.parse(key), viewType, { viewColumn: vscode.ViewColumn.Beside, preview: false })
                    return
                }
            }
            const uri = vscode.Uri.from({ scheme, path: `/${randomUUID()}/${draft.table.replace(/[\\/]/g, '_')}.sqlite-insert-draft` })
            models.set(uri.toString(), { conn, draft: clone(draft), revision: 0, inserted: false, busy: false, refresh })
            await persist(uri.toString(), { draft: clone(draft), inserted: false, pending: false })
            await vscode.commands.executeCommand('vscode.openWith', uri, viewType, { viewColumn: vscode.ViewColumn.Beside, preview: false })
        },
    }
}

function formHtml(cspSource: string): string {
    const nonce = randomUUID().replace(/-/g, '')
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'"><style>
body{padding:20px;color:var(--vscode-foreground);font:var(--vscode-font-size) var(--vscode-font-family)}h2{margin:0 0 8px}p{color:var(--vscode-descriptionForeground)}.field{margin:20px 0}label{display:block;margin-bottom:6px;font-weight:600}textarea,select{box-sizing:border-box;width:100%;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent);padding:7px;font:inherit}textarea{min-height:70px;resize:vertical}select{width:auto;margin-bottom:8px}button{border:0;padding:7px 14px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);cursor:pointer}button:disabled{opacity:.5}#result{white-space:pre-wrap;color:var(--vscode-errorForeground)}.meta{font-family:monospace;overflow-wrap:anywhere}</style></head><body><h2>新增记录</h2><p class="meta" id="target"></p><p>保存编辑器只保存草稿；点击“插入记录”才会写入数据库。</p><div id="fields"></div><button id="insert">插入记录</button> <button id="cancel" type="button">取消</button><p id="result" role="status"></p><script nonce="${nonce}">
const vscode=acquireVsCodeApi();let draft=null,busy=false,revision=0;const root=document.getElementById('fields'),result=document.getElementById('result'),button=document.getElementById('insert');
function send(i){vscode.postMessage({type:'edit',index:i,field:draft.fields[i]});revision++;result.textContent='草稿尚未插入';button.disabled=false}
function render(){root.replaceChildren();document.getElementById('target').textContent=draft.database+' / '+draft.table;draft.fields.forEach((field,i)=>{const box=document.createElement('div');box.className='field';const label=document.createElement('label');label.textContent=field.name;box.append(label);const select=document.createElement('select');for(const [value,text] of [['default','DEFAULT'],['null','NULL'],['string','TEXT'],['number','NUMERIC'],['blob','BLOB']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option)}select.value=field.type;box.append(select);const input=document.createElement('textarea');input.value=field.value;input.disabled=field.type==='default'||field.type==='null'||field.type==='blob';box.append(input);const editText=document.createElement('button');editText.textContent='在编辑器中编辑';editText.type='button';editText.hidden=field.type!=='string';editText.onclick=()=>vscode.postMessage({type:'open-text',index:i});box.append(editText);const file=document.createElement('input');file.type='file';file.hidden=field.type!=='blob';box.append(file);select.onchange=()=>{field.type=select.value;input.disabled=['default','null','blob'].includes(field.type);file.hidden=field.type!=='blob';editText.hidden=field.type!=='string';send(i)};input.oninput=()=>{field.value=input.value;send(i)};file.onchange=async()=>{if(file.files[0]){field.blob=Array.from(new Uint8Array(await file.files[0].arrayBuffer()));send(i)}};root.append(box)})}
window.addEventListener('message',({data})=>{if(data.type==='snapshot'){if(draft&&!data.force&&data.revision<revision)return;draft=data.draft;revision=data.revision;render();button.disabled=data.inserted;result.textContent=data.inserted?'已插入。修改字段可创建下一条记录。':'草稿尚未插入'}else if(data.type==='saved'){if(data.revision===revision)result.textContent=data.inserted?'已插入':'草稿已保存 · 尚未插入'}else if(data.type==='result'){busy=false;button.disabled=data.ok&&data.revision===revision;result.textContent=data.ok?(data.current===data.revision?'插入成功':'插入成功；新的修改尚未插入'):data.message}});document.getElementById('cancel').onclick=()=>vscode.postMessage({type:'cancel'});button.onclick=()=>{if(!busy){busy=true;button.disabled=true;result.textContent='正在插入…';vscode.postMessage({type:'insert'})}};window.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key==='Enter'){e.preventDefault();button.click()}});vscode.postMessage({type:'ready'});
</script></body></html>`
}
