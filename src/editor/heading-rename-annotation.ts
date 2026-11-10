/** Marks the edits that the link update makes to a document, so that the heading tracker does not take them for a rename. */
import { Annotation } from "@codemirror/state";

export const annotationOfRename = Annotation.define<boolean>();
