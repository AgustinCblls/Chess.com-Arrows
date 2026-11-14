// Estado compartido entre módulos (lo actualiza el bucle principal)
export const state = {
  lastSource: 'none',   // dom | engine | dom+engine | none | off
  linesListed: false,   // chess.com muestra ahora su panel de líneas
  arrowsHidden: false,  // Alt + tecla oculta o muestra las flechas; no se guarda
  hoverSquare: null,    // casilla bajo el ratón (para ver la variante de una flecha)
  lastLines: []         // últimas líneas del motor propio dibujadas (con su variante)
};

// Planificador: lo registra main.js para que cualquier módulo pueda pedir un repintado
let scheduler = () => {};
export function setScheduler(fn) { scheduler = fn; }
export function schedule() { scheduler(); }
