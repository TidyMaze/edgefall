import type { OpenWorldMode } from './openworldmode';

// The question of a wild marble in the way (#1662): a dialog at the top centre with Fight and Back away. The world keeps going while it shows and
// the focus stays where it is (#1762); this file only shows it and sends the answer back to the mode. Enter fights, Escape backs away.
const LIVE_LINE = 'Wild marble in your way. Fight or back away.';

/** Binds the dialog of the page to `mode` (its `onAsk`), and gives the focus back to `canvas` when it closes. */
export function bindAsk(mode: OpenWorldMode, canvas: HTMLElement): void {
  const box = document.getElementById('openworld-ask')!;
  const live = document.getElementById('openworld-live')!;
  document.getElementById('openworld-ask-fight')!.addEventListener('click', () => mode.startFight());
  document.getElementById('openworld-ask-back')!.addEventListener('click', () => mode.backAway());
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation(); // the page's own Enter and Escape (leave the world) do not see it
    if (e.key === 'Enter') mode.startFight();
    else mode.backAway();
  });
  mode.onAsk = (open) => {
    box.hidden = !open;
    if (open) {
      live.textContent = LIVE_LINE;
    } else if (box.contains(document.activeElement)) canvas.focus({ preventScroll: true });
  };
}
