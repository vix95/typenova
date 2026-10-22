/** CodeMirror compartments that allow reconfiguring wrapping, language, line numbers, performance mode and themes at runtime. */
import { Compartment } from "@codemirror/state";

export const wrapping = new Compartment();
export const languageCompartment = new Compartment();
export const lineNumbersCompartment = new Compartment();
export const performanceCompartment = new Compartment();
export const editorThemeCompartment = new Compartment();
export const syntaxThemeCompartment = new Compartment();
