// @vitest-environment jsdom
// Carga el bundle construido (chrome-extension/content.js) en un DOM falso con un tablero
// y unas líneas como las de chess.com, y comprueba que dibuja las flechas.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const bundle = readFileSync(join(process.cwd(), 'chrome-extension', 'content.js'), 'utf8');
const tick = (ms = 50) => new Promise(r => setTimeout(r, ms));

function line(score, move) {
  return `<div class="engine-line-component"><span class="score-text-score">${score}</span><span class="engine-line-node">${move}</span></div>`;
}

describe('bundle en una página simulada', () => {
  beforeAll(async () => {
    window.requestAnimationFrame = globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
    document.documentElement.lang = 'en';
    document.body.innerHTML = '<input type="checkbox" id="analysis" checked>' +
      line('+0.30', '1.e4') + line('+0.25', '1.d4') + line('+0.10', '1.Nf3');
    const board = document.createElement('wc-chess-board');
    board.game = {
      getFEN: () => 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      getLegalMoves: () => [
        { san: 'e4', from: 'e2', to: 'e4' }, { san: 'd4', from: 'd2', to: 'd4' }, { san: 'Nf3', from: 'g1', to: 'f3' }
      ],
      getMode: () => ({ name: 'analysis' }),
      getVariant: () => 'chess',
      getOptions: () => ({ flipped: false }),
      isGameOver: () => false,
      isAtEndOfLine: () => true
    };
    document.body.appendChild(board);
    // eslint-disable-next-line no-new-func
    new Function(bundle)();
    await tick(100);
  });

  it('expone una API de solo lectura', () => {
    const api = window.__top3ArrowsHybrid;
    expect(api).toBeTruthy();
    expect(Object.isFrozen(api)).toBe(true);
    const cfg = api.config();
    cfg.fallbackEngine = false; // cambiar la copia no afecta al script
    expect(api.config().fallbackEngine).toBe(true);
    expect(() => { window.__top3ArrowsHybrid = null; }).toThrow();
  });

  it('dibuja las tres flechas leídas de las líneas de chess.com', () => {
    const ov = document.getElementById('chess-top3-hybrid-arrows-overlay');
    expect(ov).toBeTruthy();
    expect(ov.getAttribute('data-source')).toBe('dom');
    expect(ov.getAttribute('data-sig')).toContain('1e2e4,2d2d4,3g1f3');
    expect(ov.querySelectorAll('polygon').length).toBe(3);
  });

  it('Alt+A (tecla física) oculta y vuelve a mostrar las flechas', async () => {
    const ov = document.getElementById('chess-top3-hybrid-arrows-overlay');
    // En macOS Option+A da key "å": debe funcionar igual por e.code
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'å', code: 'KeyA', altKey: true }));
    await tick();
    expect(ov.getAttribute('data-sig')).toBe('');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', altKey: true }));
    await tick();
    expect(ov.getAttribute('data-sig')).toContain('1e2e4');
  });

  it('con el switch apagado no dibuja nada', async () => {
    const sw = document.getElementById('analysis');
    sw.checked = false;
    sw.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(document.getElementById('chess-top3-hybrid-arrows-overlay').getAttribute('data-sig')).toBe('');
    sw.checked = true;
    sw.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
  });
});
