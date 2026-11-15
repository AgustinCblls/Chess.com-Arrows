import { describe, it, expect } from 'vitest';
import { followAction, FOLLOW_MAX_DEPTH } from '../src/follow.js';

const base = { target: 23, stable: true, ourDepth: 10, searching: true, stopSent: false, done: false, capped: false, maxDepth: 18 };

describe('seguir la profundidad de chess.com', () => {
  it('sigue buscando hasta alcanzar la profundidad de chess.com, aunque supere la máxima', () => {
    expect(followAction({ ...base, ourDepth: 18 })).toBeNull();
    expect(followAction({ ...base, ourDepth: 23 })).toBe('stop');
  });
  it('no para mientras chess.com sigue subiendo', () => {
    expect(followAction({ ...base, ourDepth: 23, stable: false })).toBeNull();
  });
  it('no repite el stop', () => {
    expect(followAction({ ...base, ourDepth: 24, stopSent: true })).toBeNull();
  });
  it('retoma la búsqueda si chess.com llegó más hondo después', () => {
    expect(followAction({ ...base, searching: false, done: true, ourDepth: 20, target: 25 })).toBe('extend');
    expect(followAction({ ...base, searching: false, done: true, ourDepth: 25, target: 25 })).toBeNull();
  });
  it('no retoma si se cortó por el límite de tiempo', () => {
    expect(followAction({ ...base, searching: false, done: true, ourDepth: 20, capped: true })).toBeNull();
  });
  it('sin depth de chess.com usa la profundidad máxima del panel', () => {
    expect(followAction({ ...base, target: null, ourDepth: 18 })).toBe('stop');
    expect(followAction({ ...base, target: null, ourDepth: 17 })).toBeNull();
  });
  it('respeta el tope de profundidad', () => {
    expect(followAction({ ...base, target: 60, ourDepth: FOLLOW_MAX_DEPTH })).toBe('stop');
  });
});
