import vscode from "vscode"
import { addTab, closeTab, replaceTab } from "./results-tabs"
import type { ResultTab, ResultTabData } from "./results-tabs"

/** What Re-run needs: the statement as written plus its bound parameter values. */
export type RerunPlan = { sql: string, params: unknown[] }

export type ResultsController = {
    /** Adds a result tab (evicting the oldest beyond five) and reveals the panel beside the editor. */
    show: (session: string, data: ResultTabData, plan?: RerunPlan) => Promise<void>
    /** Replaces the data of an existing tab; used by Re-run and by Execute again. */
    update: (session: string, id: string, data: ResultTabData, plan?: RerunPlan) => Promise<void>
    /** Closes the panel of a session, e.g. when the connection is closed. */
    dispose: (session: string) => void
}

type Deps = {
    extensionUri: vscode.Uri
    /** Opens a read-only snapshot of a truncated cell value in an editor tab. */
    openSnapshot: (content: string, name: string) => void
    /** Runs a statement again for Re-run; `undefined` means it failed and the panel keeps its rows. */
    rerun: (session: string, plan: RerunPlan) => Promise<ResultTabData | undefined>
    /** Diagnostic sink, shared with the editor's output channel. */
    log?: (message: string) => void
}

type State = {
    session: string
    panel: vscode.WebviewPanel
    tabs: ResultTab[]
    activeId: string | undefined
    error: string
    nextId: number
}

const MESSAGE = "sqlite3-editor-results"

/**
 * One results panel per session: every executed statement gets a tab (at most five), and the panel
 * lives in the editor column beside the SQL document instead of inside the database viewer.
 */
export const createResultsController = (context: vscode.ExtensionContext, deps: Deps): ResultsController => {
    const log = (message: string) => deps.log?.(`results: ${message}`)
    const states = new Map<string, State>()
    /** How to re-run each tab; kept here so the webview payload stays display-only. */
    const plans = new Map<string, RerunPlan>()

    const post = (state: State) => {
        void state.panel.webview.postMessage({ type: MESSAGE, tabs: state.tabs, activeId: state.activeId, session: state.session, error: state.error })
    }

    const html = async (webview: vscode.Webview) => (await vscode.workspace.fs.readFile(vscode.Uri.joinPath(deps.extensionUri, "webview", "results.html"))).toString()
        .replace(/((?:src|href)=")\/([^"]+)(")/g, (_, open: string, asset: string, close: string) => open + webview.asWebviewUri(vscode.Uri.joinPath(deps.extensionUri, "webview", asset)).toString() + close)

    const ensure = async (session: string): Promise<State> => {
        const existing = states.get(session)
        if (existing !== undefined) { log(`reusing the panel for ${session}`); existing.panel.reveal(undefined, true); return existing }
        log(`creating the panel for ${session}`)

        const panel = vscode.window.createWebviewPanel("sqlite3-editor.results", `Results · ${session}`, vscode.ViewColumn.Beside, {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(deps.extensionUri, "webview")],
            retainContextWhenHidden: true,
        })
        const state: State = { session, panel, tabs: [], activeId: undefined, error: "", nextId: 0 }
        states.set(session, state)
        try {
            panel.webview.html = await html(panel.webview)
        } catch (err) {
            log(`could not load results.html: ${err instanceof Error ? err.message : String(err)}`)
            throw err
        }
        panel.onDidDispose(() => { if (states.get(session) === state) { states.delete(session) } })
        context.subscriptions.push(panel.webview.onDidReceiveMessage(async (message: unknown) => {
            const request = message as { type?: string, command?: string, id?: string, value?: string, column?: number }
            if (request.type === "sqlite3-editor-results-ready") { post(state); return }
            if (request.command === "close" && typeof request.id === "string") {
                state.tabs = closeTab(state.tabs, request.id)
                if (state.tabs.length === 0) { panel.dispose(); return }
                state.activeId = state.activeId === request.id ? state.tabs[state.tabs.length - 1]?.id : state.activeId
                post(state)
                return
            }
            if (request.command === "rerun" && typeof request.id === "string") {
                const tab = state.tabs.find((candidate) => candidate.id === request.id)
                const plan = plans.get(request.id)
                if (tab === undefined || plan === undefined) { return }
                const data = await deps.rerun(session, plan)
                if (data === undefined) { state.error = "Re-run failed; the previous rows are still shown."; post(state); return }
                state.error = ""
                state.tabs = replaceTab(state.tabs, request.id, data)
                post(state)
                return
            }
            if (request.command === "openValue" && typeof request.value === "string") {
                deps.openSnapshot(request.value, `cell · ${session}`)
            }
        }))
        log(`panel ready for ${session}`)
        return state
    }

    return {
        async show(session, data, plan) {
            const state = await ensure(session)
            state.nextId += 1
            const id = `${session}#${state.nextId}`
            if (plan !== undefined) { plans.set(id, plan) }
            state.tabs = addTab(state.tabs, { id, ...data })
            state.activeId = id
            state.error = ""
            state.panel.reveal(undefined, true)
            post(state)
        },
        async update(session, id, data, plan) {
            const state = states.get(session)
            if (state === undefined) { return }
            if (plan !== undefined) { plans.set(id, plan) }
            state.tabs = replaceTab(state.tabs, id, data)
            state.error = ""
            post(state)
        },
        dispose(session) {
            states.get(session)?.panel.dispose()
        },
    }
}
