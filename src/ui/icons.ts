/** Inline SVG icons for buttons and list items (16x16, drawn with the current text colour): buttons use these, never text characters. */

const svg = (body: string): string => `<svg class="ui-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  plus: svg('<path d="M8 3v10M3 8h10"/>'),
  minus: svg('<path d="M3 8h10"/>'),
  fitWidth: svg('<path d="M2 8h12M5 5 2 8l3 3M11 5l3 3-3 3"/>'),
  chevronLeft: svg('<path d="m10 3-5 5 5 5"/>'),
  chevronRight: svg('<path d="m6 3 5 5-5 5"/>'),
  check: svg('<path d="m3 8.5 3.5 3.5L13 4.5"/>'),
  blank: svg(""),
  layers: svg('<path d="M8 2 2 5.5 8 9l6-3.5L8 2zM2 8.5 8 12l6-3.5"/>'),
  currentBranch: svg('<circle cx="8" cy="8" r="3.4" fill="currentColor" stroke="none"/>'),
  tag: svg('<path d="M2.5 2.5h5l6 6-5 5-6-6v-5z"/><circle cx="5.3" cy="5.3" r=".8" fill="currentColor" stroke="none"/>'),
  arrowUp: svg('<path d="M8 13V3M4 7l4-4 4 4"/>'),
  arrowDown: svg('<path d="M8 3v10M4 9l4 4 4-4"/>'),
  fileAdded: svg('<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M8 5.5v5M5.5 8h5"/>'),
  fileModified: svg('<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none"/>'),
  fileDeleted: svg('<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M5.5 8h5"/>'),
  fileRenamed: svg('<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M5.5 8h5M8.5 6l2 2-2 2"/>'),
  matchCase: svg('<path d="M1.8 12 5 4l3.2 8M2.9 9.6h4.2"/><circle cx="11.3" cy="10.1" r="1.9"/><path d="M13.2 8.2V12"/>'),
  play: svg('<path d="M4.5 3v10l8-5z" fill="currentColor"/>'),
  save: svg('<path d="M3 2.5h8l2.5 2.5v8.5H3z"/><path d="M5.5 2.5v3.5h5V2.5M5.5 13.5v-4h5v4"/>'),
  expandAll: svg('<path d="m4 6 4-3 4 3M4 10l4 3 4-3"/>'),
  collapseAll: svg('<path d="m4 3 4 3 4-3M4 13l4-3 4 3"/>'),
  pause: svg('<path d="M4.5 3h2.5v10H4.5zM9 3h2.5v10H9z" fill="currentColor"/>'),
  close: svg('<path d="m4 4 8 8M12 4l-8 8"/>'),
  volume: svg('<path d="M3 6.2h2.2L8.5 3.5v9L5.2 9.8H3z"/><path d="M11 5.8a3.2 3.2 0 0 1 0 4.4M12.8 4a5.6 5.6 0 0 1 0 8"/>'),
  volumeOff: svg('<path d="M3 6.2h2.2L8.5 3.5v9L5.2 9.8H3z"/><path d="m11 6 3.5 4M14.5 6 11 10"/>'),
  speed: svg('<path d="M2.5 11.5a5.5 5.5 0 1 1 11 0M8 11.5l2.5-4"/>'),
  fullscreen: svg('<path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3"/>'),
  wholeWord: svg('<path d="M3 3.5v9M13 3.5v9M5.5 8h5"/>'),
  regex: svg('<circle cx="4" cy="12" r="1.2" fill="currentColor" stroke="none"/><path d="M10 3.5v6M7.2 5l5.6 3M12.8 5 7.2 8"/>'),
} as const;

export type IconName = keyof typeof ICONS;
