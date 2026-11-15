// The icon set (#287): line icons drawn here on a 24 px grid, thin strokes in currentColor, so a button's text colour
// paints them (docs/specs/world.md section 5). The settings menu uses them, the HUD buttons will too (#297).
export const ICONS = {
  fog: 'M3 8c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0M3 12c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0M3 16c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0',
  sound: 'M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  export: 'M12 15V4M7.5 8.5 12 4l4.5 4.5M5 14v5h14v-5',
  import: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 14v5h14v-5',
  newgame: 'M5 12a7 7 0 1 0 2.05-4.95M5 4v4h4',
  online: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18',
  diagnostics: 'M9 4h6v3H9zM8 5H5v15h14V5h-3M9 12h6M9 16h6',
  theme: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 3v18',
  skin: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M8 8.5a5 5 0 0 1 3-2',
  safe: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z',
  scale: 'M10 4.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11M14.5 14.5 20 20M10 7.5v5M7.5 10h5',
  palette: 'M12 3a9 9 0 0 0 0 18c.8 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16c3.3 0 6-2.7 6-6 0-4.4-4-8-10-8z',
  motion: 'M17 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M3 9h7M2 12h8M3 15h7',
  flat: 'M4 5h16v14H4zM7 9h10M7 12h10M7 15h6',
  transcript: 'M3 6h18v12H3zM6 11h5M13 11h5M6 14h9',
  ledger: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h3', // the Ledger of the settings menu (#1585)
  render: 'M12 2l9 5v10l-9 5-9-5V7zM12 12l9-5M12 12v10M12 12l-9-5',
  steer: 'M6 16a2 2 0 1 0 0 4a2 2 0 1 0 0-4M18 4a2 2 0 1 0 0 4a2 2 0 1 0 0-4M8 18h5a4 4 0 0 0 0-8h-2a4 4 0 0 1 0-8h5',
  camera: 'M3 7h4l2-3h6l2 3h4v13H3zM12 10a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7',
  guide: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01',
} as const;

export type IconName = keyof typeof ICONS;

/** The icon as inline SVG markup, decorative: the button's text names it. */
export const icon = (name: IconName): string =>
  `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name]}"/></svg>`;
