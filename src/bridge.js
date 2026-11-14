// Corre en el contexto aislado de la extensión (no en el de la página), antes que content.js.
// content.js corre en el contexto de la página y no puede preguntar dónde están los archivos de la
// extensión: este script le deja la URL de la carpeta engine/ (Stockfish incluido) en un atributo.
(function () {
  'use strict';
  const api = typeof browser !== 'undefined' && browser.runtime ? browser : (typeof chrome !== 'undefined' ? chrome : null);
  if (!api || !api.runtime || typeof api.runtime.getURL !== 'function') return;
  document.documentElement.setAttribute('data-top3arrows-engine-base', api.runtime.getURL('engine/'));
})();
