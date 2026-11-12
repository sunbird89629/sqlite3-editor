import { PAGE_SIZE, useTableStore } from "./table"

// https://gist.github.com/yy0931/14f854aae53dfd4c090fab389b448844
type Code = "Abort" | "Again" | "AltLeft" | "AltRight" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "ArrowUp" | "AudioVolumeDown" | "AudioVolumeMute" | "AudioVolumeUp" | "Backquote" | "Backslash" | "Backspace" | "BracketLeft" | "BracketRight" | "BrightnessUp" | "BrowserBack" | "BrowserFavorites" | "BrowserForward" | "BrowserHome" | "BrowserRefresh" | "BrowserSearch" | "BrowserStop" | "CapsLock" | "Comma" | "ContextMenu" | "ControlLeft" | "ControlRight" | "Convert" | "Copy" | "Cut" | "Delete" | "Digit0" | "Digit1" | "Digit2" | "Digit3" | "Digit4" | "Digit5" | "Digit6" | "Digit7" | "Digit8" | "Digit9" | "Eject" | "End" | "Enter" | "Equal" | "Escape" | "F1" | "F10" | "F11" | "F12" | "F13" | "F14" | "F15" | "F16" | "F17" | "F18" | "F19" | "F2" | "F20" | "F21" | "F22" | "F23" | "F24" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8" | "F9" | "Find" | "Fn" | "Help" | "Home" | "Insert" | "IntlBackslash" | "IntlRo" | "IntlYen" | "KanaMode" | "KeyA" | "KeyB" | "KeyC" | "KeyD" | "KeyE" | "KeyF" | "KeyG" | "KeyH" | "KeyI" | "KeyJ" | "KeyK" | "KeyL" | "KeyM" | "KeyN" | "KeyO" | "KeyP" | "KeyQ" | "KeyR" | "KeyS" | "KeyT" | "KeyU" | "KeyV" | "KeyW" | "KeyX" | "KeyY" | "KeyZ" | "Lang1" | "Lang2" | "Lang3" | "Lang4" | "Lang5" | "LaunchApp1" | "LaunchApp2" | "LaunchMail" | "MediaPlayPause" | "MediaSelect" | "MediaStop" | "MediaTrackNext" | "MediaTrackPrevious" | "MetaLeft" | "MetaRight" | "Minus" | "NonConvert" | "NumLock" | "Numpad0" | "Numpad1" | "Numpad2" | "Numpad3" | "Numpad4" | "Numpad5" | "Numpad6" | "Numpad7" | "Numpad8" | "Numpad9" | "NumpadAdd" | "NumpadComma" | "NumpadDecimal" | "NumpadDivide" | "NumpadEnter" | "NumpadEqual" | "NumpadMultiply" | "NumpadParenLeft" | "NumpadParenRight" | "NumpadSubtract" | "OSLeft" | "OSRight" | "Open" | "PageDown" | "PageUp" | "Paste" | "Pause" | "Period" | "Power" | "PrintScreen" | "Props" | "Quote" | "ScrollLock" | "Select" | "Semicolon" | "ShiftLeft" | "ShiftRight" | "Slash" | "Sleep" | "Space" | "Tab" | "Undo" | "Unidentified" | "VolumeDown" | "VolumeMute" | "VolumeUp" | "WakeUp"

const createKeyboardShortcutMatcher = (ev: KeyboardEvent) => (pattern: `${"Ctrl + " | "" | "(Ctrl +) "}${"Shift + " | "" | "(Shift +) "}${"Alt + " | "" | "(Alt +) "}${Code}`): boolean => {
    const m = /^(Ctrl \+ |\(Ctrl \+\) |)(Shift \+ |\(Shift \+\) |)(Alt \+ |\(Alt \+\) |)(.*?)$/.exec(pattern)
    if (m === null) { throw new Error() }
    const [, c, s, a, code] = m
    if (c === "Ctrl + " && !ev.ctrlKey) { return false }
    if (c === "" && ev.ctrlKey) { return false }
    if (s === "Shift + " && !ev.shiftKey) { return false }
    if (s === "" && ev.shiftKey) { return false }
    if (a === "Alt + " && !ev.altKey) { return false }
    if (a === "" && ev.altKey) { return false }
    return ev.code === code
}

/** Moves the viewer selection by the given deltas, paging at the edges of the current page. */
const moveViewerSelection = async (rowDelta: number, columnDelta: number) => {
    const viewer = useTableStore.getState()
    const selection = viewer.selectedCell
    if (!selection) { return }
    const columns = viewer.columns.filter(({ name }) => viewer.visibleColumns.includes(name)).map(({ name }) => name)
    if (columns.length === 0) { return }
    const columnIndex = Math.max(0, columns.indexOf(selection.column))
    const nextColumn = columns[Math.max(0, Math.min(columns.length - 1, columnIndex + columnDelta))]!
    let nextRow = selection.row + rowDelta
    if (nextRow < 0 && viewer.paging.visibleAreaTop > 0n) {
        await viewer.setPaging({ visibleAreaTop: viewer.paging.visibleAreaTop - PAGE_SIZE })
        nextRow = Number(viewer.paging.visibleAreaSize) - 1
    } else if (nextRow >= Number(viewer.paging.visibleAreaSize) && viewer.paging.visibleAreaTop + PAGE_SIZE < viewer.paging.numRecords) {
        await viewer.setPaging({ visibleAreaTop: viewer.paging.visibleAreaTop + PAGE_SIZE })
        nextRow = 0
    }
    nextRow = Math.max(0, Math.min(useTableStore.getState().records.length - 1, nextRow))
    useTableStore.setState({ selectedCell: { row: nextRow, column: nextColumn } })
    // Keep the focus on the cell so that the next key press still reaches the table.
    requestAnimationFrame(() => { document.querySelector<HTMLElement>('td[data-cell-selected="true"]')?.focus() })
}

/** Selection and navigation only: the viewer never enters an edit state. */
export const onKeydown = async (ev: KeyboardEvent) => {
    try {
        const key = createKeyboardShortcutMatcher(ev)
        /** True when a button, input, textarea, select, option, or label is active. */
        const inputFocus = ev.target instanceof HTMLElement && ev.target.matches("label, button, input, textarea, select, option")
        const selection = useTableStore.getState().selectedCell

        if (inputFocus) {
            if (key("Escape")) { ev.preventDefault(); (ev.target as HTMLElement).blur() }
            return
        }
        if (selection === null || useTableStore.getState().useCustomViewerQuery) { return }
        if (key("Escape")) {
            ev.preventDefault()
            useTableStore.setState({ selectedCell: null })
            return
        }
        const delta = key("ArrowUp") ? [-1, 0] : key("ArrowDown") ? [1, 0] : key("ArrowLeft") ? [0, -1] : key("ArrowRight") ? [0, 1] : null
        if (delta !== null) {
            ev.preventDefault()
            await moveViewerSelection(delta[0]!, delta[1]!)
        }
    } catch (err) {
        console.error(err)
    }
}

// Fixes a problem where the user is unable to undo/redo on inputs due to VSCode calling preventDefault() on the events.
if (window.acquireVsCodeApi) {
    window.addEventListener("keydown", (ev) => {
        if (!ev.defaultPrevented) { return }
        if (!(document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement)) { return }
        const key = createKeyboardShortcutMatcher(ev)
        if (key("Ctrl + KeyZ")) {
            document.execCommand('undo', false)
        } else if (key("Ctrl + Shift + KeyZ") || key("Ctrl + KeyY")) {
            document.execCommand('redo', false)
        }
    })
}
