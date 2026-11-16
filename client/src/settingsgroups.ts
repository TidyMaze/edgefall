// The settings menu in five groups (#1566, docs/specs/ui.md section 4.11): Sound, Display, Accessibility, Controls and Advanced,
// each under a visible heading. The items are the elements main.ts builds, moved here with their ids and listeners; nothing is
// created or removed but the groups. Advanced holds the developer tools and is a disclosure shut until a press.

/** A group: the heading, the selectors of its items in order, and whether it is a shut disclosure. */
export interface SettingGroup {
  id: string;
  name: string;
  items: readonly string[];
  collapsed?: boolean;
}

export const SETTING_GROUPS: readonly SettingGroup[] = [
  // Logs and the Ledger are for the player: Logs replays the audio logs, whose text is the Transcript, and the Ledger is the written record beside them.
  { id: 'settings-sound', name: 'Sound', items: ['#setting-sound', '#setting-transcript', '#setting-log-archive', '#setting-ledger'] },
  { id: 'settings-display', name: 'Display', items: ['#setting-theme', '#setting-shell-skin', '#setting-glass-skin', '#setting-clear-board', '#setting-quality', '.setting-lights', '#level-reset'] },
  { id: 'settings-accessibility', name: 'Accessibility', items: ['#setting-reduced-motion', '#setting-flat-hud', '#setting-palette'] },
  { id: 'settings-controls', name: 'Controls', items: ['#setting-difficulty', '#difficulty-note', '#setting-steering', '#setting-guide'] },
  {
    id: 'settings-advanced',
    name: 'Advanced',
    items: ['#setting-fps', '#setting-render-mode', '#setting-free-cam', '#setting-export-game', '#setting-import-game', '#console-entry', '#copy-diagnostics'],
    collapsed: true,
  },
];

/** Builds the groups in front of the volume and archive pages of `menu` and moves each item under its heading. */
export function groupSettings(menu: HTMLElement): void {
  const doc = menu.ownerDocument;
  const sections = SETTING_GROUPS.map(({ id, name, items, collapsed }) => {
    const section = doc.createElement(collapsed ? 'details' : 'div');
    section.id = id;
    section.className = 'setting-section';
    const heading = doc.createElement(collapsed ? 'summary' : 'h3');
    heading.className = 'setting-heading';
    heading.textContent = name;
    if (!collapsed) {
      heading.id = `${id}-heading`;
      section.setAttribute('role', 'group');
      section.setAttribute('aria-labelledby', heading.id);
    }
    section.append(heading, ...items.flatMap((selector) => [...doc.querySelectorAll(selector)]));
    return section;
  });
  menu.prepend(...sections);
}
