// What the IDE (web/index.html) uses of CodeMirror, as one module (build.py bundles it with esbuild).
// The editor's setup is basicSetup's parts, so preferences can turn them on and off.
export { EditorState, Compartment, StateField, StateEffect } from "@codemirror/state";
export { EditorView, keymap, hoverTooltip, showTooltip, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor,
         rectangularSelection, crosshairCursor, highlightActiveLine } from "@codemirror/view";
export { StreamLanguage, indentUnit, foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching,
         foldKeymap } from "@codemirror/language";
export { history, defaultKeymap, historyKeymap, indentWithTab, undo, redo, undoDepth, redoDepth, selectAll, toggleComment,
         indentMore, indentLess } from "@codemirror/commands";
export { highlightSelectionMatches, searchKeymap, openSearchPanel, gotoLine } from "@codemirror/search";
export { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap, startCompletion, currentCompletions,
         completionStatus } from "@codemirror/autocomplete";
export { haxe } from "@codemirror/legacy-modes/mode/haxe";
export { setDiagnostics, lintGutter, lintKeymap, forEachDiagnostic, diagnosticCount } from "@codemirror/lint";
export { oneDark } from "@codemirror/theme-one-dark";
