// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { groupSettings, SETTING_GROUPS } from './settingsgroups';
import { settingsList } from './settings';

// The settings menu in five groups (#1566, docs/specs/ui.md section 4.11): the items keep their elements, ids and listeners and
// are only moved under a visible heading.

const everyItem = (): string[] => [
  ...settingsList(false, 'system', 'scarab', 'smoked', 100, false, false, false, 'default', true).map((s) => `setting-${s.id}`),
  'setting-fps', 'setting-log-archive', 'setting-ledger', 'level-reset', 'copy-diagnostics', 'console-entry',
];

beforeEach(() => {
  document.body.innerHTML = '<div id="settings-menu"></div><button id="copy-diagnostics"></button>';
  const menu = document.getElementById('settings-menu')!;
  for (const id of everyItem()) {
    if (id === 'copy-diagnostics') continue;
    const button = menu.appendChild(document.createElement('button'));
    button.id = id;
  }
  for (const name of ['bloom', 'lamps', 'lights']) menu.insertAdjacentHTML('beforeend', `<label class="setting-lights" id="row-${name}"></label>`);
  menu.insertAdjacentHTML('beforeend', '<p id="difficulty-note"></p><label class="setting-volume" id="row-music"></label><div class="setting-archive"></div>');
});

describe('groupSettings', () => {
  it('lists the five groups in order, each under a visible heading, Advanced a collapsed disclosure', () => {
    const menu = document.getElementById('settings-menu')!;
    groupSettings(menu);
    const sections = [...menu.querySelectorAll(':scope > .setting-section')];
    expect(sections.map((s) => s.querySelector('.setting-heading')!.textContent)).toEqual(['Sound', 'Display', 'Accessibility', 'Controls', 'Advanced']);
    expect(sections.map((s) => s.tagName)).toEqual(['DIV', 'DIV', 'DIV', 'DIV', 'DETAILS']);
    expect(sections.map((s) => s.querySelector('.setting-heading')!.tagName)).toEqual(['H3', 'H3', 'H3', 'H3', 'SUMMARY']);
    expect((sections[4] as HTMLDetailsElement).open).toBe(false);
    for (const section of sections.slice(0, 4)) {
      expect(section.getAttribute('role')).toBe('group');
      expect(document.getElementById(section.getAttribute('aria-labelledby')!)).toBe(section.querySelector('.setting-heading'));
    }
  });

  it('puts every item in exactly one group, the pages of the menu staying its own children', () => {
    const menu = document.getElementById('settings-menu')!;
    const before = [...menu.querySelectorAll('button')];
    groupSettings(menu);
    const inGroups = [...menu.querySelectorAll('.setting-section button')];
    expect(inGroups.length).toBe(before.length + 1); // Copy diagnostics joins the menu from the page
    expect(new Set(inGroups).size).toBe(inGroups.length);
    for (const button of before) expect(inGroups).toContain(button);
    expect(menu.querySelector(':scope > .setting-volume')).not.toBeNull();
    expect(menu.querySelector(':scope > .setting-archive')).not.toBeNull();
    expect(menu.querySelector('.setting-section .setting-volume')).toBeNull();
    expect(inGroups.map((b) => b.id)).toEqual(SETTING_GROUPS.flatMap((g) => g.items).filter((s) => s.startsWith('#') && s !== '#difficulty-note').map((s) => s.slice(1)));
  });

  it('keeps the elements: the same nodes, with their ids, moved', () => {
    const menu = document.getElementById('settings-menu')!;
    const sound = document.getElementById('setting-sound');
    groupSettings(menu);
    expect(document.getElementById('setting-sound')).toBe(sound);
    expect(sound!.closest('.setting-section')!.querySelector('.setting-heading')!.textContent).toBe('Sound');
  });

  it('puts the developer tools under Advanced and the logs and the ledger with the Sound group', () => {
    const menu = document.getElementById('settings-menu')!;
    groupSettings(menu);
    const group = (id: string): string => document.getElementById(id)!.closest('.setting-section')!.querySelector('.setting-heading')!.textContent!;
    for (const id of ['setting-fps', 'setting-render-mode', 'setting-free-cam', 'setting-export-game', 'setting-import-game', 'console-entry', 'copy-diagnostics']) expect(group(id), id).toBe('Advanced'); // the Console is a tool (#1693)
    for (const id of ['setting-sound', 'setting-transcript', 'setting-log-archive', 'setting-ledger']) expect(group(id), id).toBe('Sound');
    expect(group('setting-reduced-motion')).toBe('Accessibility');
    expect(group('setting-palette')).toBe('Accessibility');
    expect(group('setting-theme')).toBe('Display');
    expect(group('level-reset')).toBe('Display');
    expect(group('setting-difficulty')).toBe('Controls');
    expect(group('difficulty-note')).toBe('Controls');
    expect(group('setting-steering')).toBe('Controls');
    expect(menu.querySelector('details')!.lastElementChild).toBe(document.getElementById('copy-diagnostics'));
  });
});
