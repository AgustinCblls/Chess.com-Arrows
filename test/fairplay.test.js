// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { isFallbackAllowed, isAnalysisActive } from '../src/fairplay.js';
import { CONFIG } from '../src/config.js';

function setup({ switchId = 'analysis', checked = true, mode = 'analysis', variant = 'chess', api = true, throwMode = false } = {}) {
  document.body.innerHTML = '';
  if (switchId) {
    const sw = document.createElement('input');
    sw.type = 'checkbox'; sw.id = switchId; sw.checked = checked;
    document.body.appendChild(sw);
  }
  const board = document.createElement('wc-chess-board');
  if (api) {
    board.game = {
      getMode: () => { if (throwMode) throw new Error('x'); return mode == null ? undefined : { name: mode }; },
      getVariant: () => variant
    };
  }
  document.body.appendChild(board);
  return board;
}

describe('fair play: el motor propio falla cerrado', () => {
  beforeEach(() => { CONFIG.fallbackEngine = true; });

  it('permite análisis y observación', () => {
    expect(isFallbackAllowed(setup({ mode: 'analysis' }))).toBe(true);
    expect(isFallbackAllowed(setup({ mode: 'observing', switchId: 'evaluationSettings' }))).toBe(true);
  });
  it('bloquea una partida propia', () => {
    expect(isFallbackAllowed(setup({ mode: 'playing' }))).toBe(false);
  });
  it('bloquea modos desconocidos', () => {
    expect(isFallbackAllowed(setup({ mode: 'puzzles' }))).toBe(false);
  });
  it('bloquea si no hay API del tablero o el modo no se puede leer', () => {
    expect(isFallbackAllowed(setup({ api: false }))).toBe(false);
    expect(isFallbackAllowed(setup({ mode: null }))).toBe(false);
    expect(isFallbackAllowed(setup({ throwMode: true }))).toBe(false);
  });
  it('bloquea con el switch apagado o sin switch', () => {
    expect(isFallbackAllowed(setup({ checked: false }))).toBe(false);
    expect(isFallbackAllowed(setup({ switchId: null }))).toBe(false);
  });
  it('bloquea variantes', () => {
    expect(isFallbackAllowed(setup({ variant: 'chess960' }))).toBe(false);
  });
  it('un interruptor cualquiera de la página no cuenta como Analysis', () => {
    const board = setup({ switchId: null });
    const other = document.createElement('input');
    other.type = 'checkbox'; other.className = 'cc-switch-checkbox-xyz'; other.checked = true;
    document.body.appendChild(other);
    expect(isAnalysisActive(board)).toBe(false);
  });
});
