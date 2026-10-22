/** Typed shortcut for `document.getElementById`, shared by every UI module. Pass the element type to get member access without casts. */
export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
