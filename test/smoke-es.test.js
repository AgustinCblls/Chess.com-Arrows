// @vitest-environment jsdom
// Página en español (Events): las líneas de chess.com usan R = Rey, D = Dama, T = Torre, A = Alfil, C = Caballo.
// Posición del informe: "25.Re2" es el rey de d1 a e2, no la torre de e1.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const bundle = readFileSync(join(process.cwd(), 'chrome-extension', 'content.js'), 'utf8');
const tick = (ms = 50) => new Promise(r => setTimeout(r, ms));

// Cada jugada en su propio elemento, como hace chess.com (sin espacios en textContent)
function line(score, moves) {
  return `<div class="evaluation-lines-component"><span class="evaluation-lines-score">${score}</span>` +
    moves.map((m, i) => `<span class="evaluation-lines-node" data-move-index="${i}">${m}</span>`).join('') + '</div>';
}

describe('página en español', () => {
  beforeAll(async () => {
    window.requestAnimationFrame = globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
    document.documentElement.lang = 'es';
    document.body.innerHTML = '<input type="checkbox" id="analysis" checked><wc-evaluation-lines>' +
      line('-2.17', ['25.Re2', 'Da2', '26.Tb1', 'Ad8', '27.Dg3']) +
      line('-3.80', ['25.Df2', 'Da1+', '26.Re2', 'Dxb2']) +
      line('-4.87', ['25.Dg3', 'Da1+', '26.Re2', 'Dxb2', '27.Rf2']) + '</wc-evaluation-lines>';
    const board = document.createElement('wc-chess-board');
    board.game = {
      getFEN: () => '2k1r3/q3b2r/2n1pn1p/3p4/1ppP1BPQ/2P2P1N/1P1N4/3KR2R w - - 0 25',
      getLegalMoves: () => [
        { san: 'Ke2', from: 'd1', to: 'e2' }, { san: 'Re2', from: 'e1', to: 'e2' },
        { san: 'Qf2', from: 'h4', to: 'f2' }, { san: 'Qg3', from: 'h4', to: 'g3' }
      ],
      getMode: () => ({ name: 'observing' }),
      getVariant: () => 'chess',
      getOptions: () => ({ flipped: false }),
      isGameOver: () => false,
      isAtEndOfLine: () => true
    };
    document.body.appendChild(board);
    new Function(bundle)();
    await tick(100);
  });

  it('la primera flecha es el rey d1-e2 y las otras dos la dama', () => {
    const ov = document.getElementById('chess-top3-hybrid-arrows-overlay');
    expect(ov.getAttribute('data-source')).toBe('dom');
    expect(ov.getAttribute('data-sig')).toContain('1d1e2,2h4f2,3h4g3');
    expect(ov.getAttribute('data-sig')).not.toContain('e1e2');
  });
});
