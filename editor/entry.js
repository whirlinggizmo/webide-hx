// What play.html uses of CodeMirror, as one module (build.py bundles it with esbuild).
export { basicSetup } from "codemirror";
export { EditorState, Compartment } from "@codemirror/state";
export { EditorView, keymap } from "@codemirror/view";
export { StreamLanguage, indentUnit } from "@codemirror/language";
export { haxe } from "@codemirror/legacy-modes/mode/haxe";
export { setDiagnostics, lintGutter, forEachDiagnostic, diagnosticCount } from "@codemirror/lint";
export { oneDark } from "@codemirror/theme-one-dark";
export { indentWithTab } from "@codemirror/commands";
