// ─────────────────────────── Motor propio (Stockfish en un Web Worker) ───────────────────────────
import { CONFIG, CDN_ENGINES, BUNDLED_ENGINE } from './config.js';
import { log, info, warn, diag, markOnce } from './log.js';
import { parseInfoLine, createLineCollector } from './uci.js';

export function createEngine(PAGE) {
  let worker = null;
  let state = 'off';        // off | booting | ready
  let label = '';
  let bootSeq = 0;
  let bootTimer = null, idleTimer = null, stopTimer = null, commitTimer = null, silenceTimer = null;
  let silentKills = 0;
  let candidates = null, candIdx = 0, deadUntil = 0, crashes = 0;
  let bootAttempt = 0, bootCount = 0;
  let optsDirty = false, hashMax = Infinity;
  let blobUrls = [];

  let searching = false;    // hay un "go" en curso (se espera su "bestmove")
  let discard = false;      // la búsqueda en curso ya no interesa (se envió "stop")
  let searchFen = null;
  let wantedFen = null;
  const collector = createLineCollector(() => CONFIG.multiPv);
  let result = null;        // { fen, turn, depth, lines: [{rank, move, reply, pv, type, value, depth}], done }
  let onUpdate = function () {};

  function fetchVerified(url, integrity) {
    return fetch(url, { integrity, credentials: 'omit', mode: 'cors' })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url); return r.blob(); });
  }

  function blobUrl(blob, type) {
    const u = URL.createObjectURL(new Blob([blob], { type }));
    blobUrls.push(u);
    return u;
  }

  // Motor descargado de una CDN: el JS (y el WASM si lo hay) se verifican con SRI antes de usarse.
  // El cargador de Stockfish lee la ruta del .wasm de lo que va tras "#" en la URL del worker.
  function cdnCandidate(c) {
    return {
      label: c.label,
      create: () => Promise.all([
        fetchVerified(c.js, c.jsIntegrity),
        c.wasm ? fetchVerified(c.wasm, c.wasmIntegrity) : Promise.resolve(null)
      ]).then(([js, wasm]) => {
        const jsUrl = blobUrl(js, 'application/javascript');
        return new Worker(wasm ? jsUrl + '#' + encodeURIComponent(blobUrl(wasm, 'application/wasm')) + ',worker' : jsUrl);
      })
    };
  }

  function findEngineCandidates() {
    const urls = [];
    const push = u => { if (typeof u === 'string' && u && urls.indexOf(u) === -1) urls.push(u); };
    const isolated = !!PAGE.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined';

    // chess.com publica en su configuración las rutas del Stockfish que usa para la barra de evaluación
    try {
      const fc = PAGE.chesscom && PAGE.chesscom.featuresConfig;
      if (fc && typeof fc === 'object') {
        const releases = Object.keys(fc)
          .filter(k => /^stockfish_release/i.test(k))
          .map(k => fc[k])
          .filter(r => r && typeof r === 'object')
          .sort((a, b) => (Number(b.version) || 0) - (Number(a.version) || 0));
        for (const r of releases) {
          const p = r.lite && r.lite.paths;
          if (!p) continue;
          push(p.singleThreaded && p.singleThreaded.loader);
          if (isolated) push(p.multiThreaded && p.multiThreaded.loader);
        }
        for (const r of releases) {
          const p = r.lite && r.lite.paths;
          if (p) push(p.asm);
        }
      }
    } catch (e) { /* se intenta la búsqueda genérica */ }

    // Si cambian los nombres de la configuración: buscar cualquier ruta del motor dentro de window.chesscom
    if (!urls.length) {
      try {
        const found = [];
        const seen = new Set();
        let budget = 20000;
        (function walk(o, depth) {
          if (!o || typeof o !== 'object' || depth > 6 || seen.has(o) || budget <= 0) return;
          seen.add(o);
          let keys;
          try { keys = Object.keys(o); } catch (e) { return; }
          for (const k of keys) {
            if (--budget <= 0) return;
            let v;
            try { v = o[k]; } catch (e) { continue; }
            if (typeof v === 'string') {
              if (/assets-chess-engine\/Stockfish\/stockfish[\w.-]*\.js$/i.test(v)) found.push(v);
            } else if (v && typeof v === 'object') walk(v, depth + 1);
          }
        })(PAGE.chesscom, 0);
        found.filter(u => /lite-single/i.test(u)).forEach(push);
        if (isolated) found.filter(u => /lite/i.test(u) && !/single|asm/i.test(u)).forEach(push);
        found.filter(u => /asm/i.test(u)).forEach(push);
      } catch (e) { /* quedan las CDN */ }
    }

    const list = urls.map(u => ({ label: u, create: () => new Worker(u) }));
    return list.concat(reserveCandidates());
  }

  // Motores de reserva: el incluido en la extensión (si la hay) y luego los de CDN (solo el userscript)
  function reserveCandidates() {
    const list = [];
    const base = document.documentElement.getAttribute(BUNDLED_ENGINE.baseAttr);
    if (base && /^(moz|chrome|safari-web)-extension:\/\/[^/]+\/.*\/$/.test(base)) {
      list.push(cdnCandidate({
        label: BUNDLED_ENGINE.label,
        js: base + BUNDLED_ENGINE.js, jsIntegrity: BUNDLED_ENGINE.jsIntegrity,
        wasm: base + BUNDLED_ENGINE.wasm, wasmIntegrity: BUNDLED_ENGINE.wasmIntegrity
      }));
    }
    CDN_ENGINES.forEach(c => list.push(cdnCandidate(c)));
    return list;
  }

  function post(cmd) {
    try { if (worker) worker.postMessage(cmd); } catch (e) { warn('no se pudo enviar "' + cmd + '" al motor:', e); }
  }

  function killWorker() {
    bootSeq++;
    clearTimeout(bootTimer); clearTimeout(stopTimer); clearTimeout(commitTimer); clearTimeout(silenceTimer);
    bootTimer = stopTimer = commitTimer = silenceTimer = null;
    if (worker) { try { worker.terminate(); } catch (e) { /* ya terminado */ } }
    worker = null;
    blobUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) { /* nada */ } });
    blobUrls = [];
    searching = false; discard = false; searchFen = null;
    state = 'off';
  }

  function boot() {
    if (state !== 'off' || Date.now() < deadUntil) return;
    if (!candidates) candidates = findEngineCandidates();
    if (candIdx >= candidates.length) {
      candIdx = 0; bootAttempt = 0;
      deadUntil = Date.now() + 30000;
      warn('ningún motor propio respondió; se reintenta en 30 s');
      return;
    }
    const cand = candidates[candIdx];
    const seq = ++bootSeq;
    const timeouts = CONFIG.engineBootTimeoutsMs;
    const limit = timeouts[Math.min(bootAttempt, timeouts.length - 1)];
    state = 'booting';
    hashMax = Infinity;
    label = cand.label;
    bootCount++;
    markOnce('engineBoot');
    log('arrancando motor (intento ' + (bootAttempt + 1) + '):', label);
    bootTimer = setTimeout(() => { if (seq === bootSeq) bootTimedOut(limit); }, limit);
    Promise.resolve()
      .then(() => cand.create())
      .then(w => {
        if (seq !== bootSeq) { try { w.terminate(); } catch (e) { /* nada */ } return; }
        worker = w;
        w.onmessage = ev => { if (seq === bootSeq) onMessage(ev.data); };
        w.onerror = ev => {
          if (ev && ev.preventDefault) ev.preventDefault();
          if (seq === bootSeq) onWorkerError(ev && ev.message);
        };
        post('uci');
      })
      .catch(err => { if (seq === bootSeq) failCandidate((err && err.message) || String(err)); });
  }

  // El worker no respondió a tiempo. A veces se queda colgado si arranca mientras la página carga,
  // así que primero se reintenta el mismo motor con más margen y solo después se pasa al siguiente.
  function bootTimedOut(limit) {
    bootAttempt++;
    if (bootAttempt < CONFIG.engineBootTimeoutsMs.length) {
      log('el motor no respondió en ' + limit + ' ms; se reintenta');
      killWorker();
      boot();
    } else {
      failCandidate('sin respuesta');
    }
  }

  function failCandidate(reason) {
    warn('el motor "' + label + '" no arrancó (' + reason + '); se prueba el siguiente');
    diag('engineFailed', { label, reason });
    killWorker();
    candIdx++; bootAttempt = 0;
    boot();
  }

  function onWorkerError(message) {
    if (state === 'booting') { failCandidate(message || 'error'); return; }
    warn('el motor falló:', message || 'error');
    crashes++;
    killWorker();
    result = null;
    if (crashes >= 2) { crashes = 0; candIdx++; bootAttempt = 0; }
    if (wantedFen) boot();
  }

  function onMessage(data) {
    const text = typeof data === 'string' ? data : (data && typeof data.data === 'string' ? data.data : '');
    if (!text) return;
    if (text.indexOf('\n') === -1) { handleLine(text.trim()); return; }
    const parts = text.split('\n');
    for (let i = 0; i < parts.length; i++) handleLine(parts[i].trim());
  }

  function handleLine(line) {
    if (!line) return;
    if (state === 'booting') {
      const hm = /^option name Hash .*\bmax (\d+)/.exec(line);
      if (hm) hashMax = parseInt(hm[1], 10);
      if (line === 'uciok') {
        applyOptions();
        post('isready');
      } else if (line === 'readyok') {
        clearTimeout(bootTimer); bootTimer = null;
        state = 'ready';
        bootAttempt = 0;
        markOnce('engineReady');
        info('motor propio listo:', label);
        pump();
      }
      return;
    }
    if (state !== 'ready') return;
    if (line.lastIndexOf('info ', 0) === 0) {
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; silentKills = 0; }
      if (searching && !discard) {
        const parsed = parseInfoLine(line, CONFIG.multiPv);
        if (parsed) {
          collector.add(parsed);
          if (!commitTimer) commitTimer = setTimeout(() => { commitTimer = null; if (flushCommit()) onUpdate(); }, 40);
        }
      }
      return;
    }
    if (line.lastIndexOf('bestmove', 0) === 0) {
      clearTimeout(stopTimer); stopTimer = null;
      clearTimeout(silenceTimer); silenceTimer = null;
      const stale = discard;
      searching = false; discard = false;
      if (!stale && result && result.fen === searchFen) {
        flushCommit();
        result.done = true;
        crashes = 0;
        onUpdate();
      }
      pump();
    }
  }

  // Pasa a "result" las líneas recibidas (el motor las envía en ráfagas de multiPv líneas)
  function flushCommit() {
    clearTimeout(commitTimer); commitTimer = null;
    if (!result || discard) return false;
    const lines = collector.commit();
    if (!lines) return false;
    result.lines = lines;
    result.depth = lines[0].depth;
    return true;
  }

  // Envía al motor los ajustes actuales (solo se llama cuando no hay una búsqueda en curso)
  function applyOptions() {
    optsDirty = false;
    post('setoption name MultiPV value ' + CONFIG.multiPv);
    post('setoption name Hash value ' + Math.max(1, Math.min(CONFIG.hashMb, hashMax)));
  }

  // El usuario cambió un ajuste: se descarta el análisis actual y se repite con los valores nuevos
  function reconfigure() {
    optsDirty = true;
    result = null;
    clearTimeout(commitTimer); commitTimer = null;
    if (state !== 'ready') return;
    if (searching) { interrupt(); return; } // al llegar "bestmove", pump() vuelve a empezar
    pump();
  }

  function start(fen) {
    if (optsDirty) applyOptions();
    searching = true; discard = false; searchFen = fen;
    collector.reset();
    result = { fen, turn: fen.split(' ')[1] === 'b' ? 'b' : 'w', depth: 0, lines: [], done: false };
    log('analizando', fen);
    post('position fen ' + fen);
    post('go depth ' + CONFIG.maxDepth + ' movetime ' + CONFIG.maxTimeMs);
    // Vigilancia: a veces el worker se queda sin responder (visto al empezar una revancha). Si no dice
    // nada enseguida se reinicia; tras tres seguidas se trata como un fallo del motor.
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      silenceTimer = null;
      if (!searching || discard || searchFen !== fen) return;
      silentKills++;
      diag('engineSilent', { n: silentKills });
      if (silentKills >= 3) { silentKills = 0; onWorkerError('sin respuesta'); return; }
      warn('el motor no responde; se reinicia');
      killWorker();
      result = null;
      if (wantedFen) boot();
    }, CONFIG.engineSilenceMs);
  }

  function pump() {
    if (state !== 'ready' || searching || !wantedFen) return;
    if (result && result.fen === wantedFen) return; // ya analizada
    start(wantedFen);
  }

  function interrupt() {
    if (!searching || discard) return;
    discard = true;
    result = null;
    clearTimeout(commitTimer); commitTimer = null;
    post('stop');
    clearTimeout(stopTimer);
    stopTimer = setTimeout(() => {
      stopTimer = null;
      if (searching && discard) {
        diag('engineStopTimeout', {});
        warn('el motor no respondió a "stop"; se reinicia');
        killWorker();
        if (wantedFen) boot();
      }
    }, CONFIG.engineStopTimeoutMs);
  }

  function request(fen) {
    clearTimeout(idleTimer); idleTimer = null;
    wantedFen = fen;
    if (state === 'off') { boot(); return; }
    if (state !== 'ready') return; // arrancando: pump() al estar listo
    if (searching) {
      if (!discard && searchFen !== fen) interrupt();
      return;
    }
    pump();
  }

  function armIdleTimer() {
    if (state !== 'off' && !idleTimer) {
      idleTimer = setTimeout(() => {
        idleTimer = null;
        if (wantedFen === null && state !== 'off') { log('motor apagado por inactividad'); killWorker(); result = null; }
      }, CONFIG.engineIdleKillMs);
    }
  }

  // Arranca el worker sin analizar nada, para que esté listo cuando haga falta
  function prewarm() {
    if (state === 'off') boot();
    if (wantedFen === null) armIdleTimer();
  }

  function release() {
    if (wantedFen !== null) {
      wantedFen = null;
      if (state === 'ready' && searching) interrupt();
    }
    armIdleTimer();
  }

  function getResult(fen) {
    return result && result.fen === fen && result.lines.length ? result : null;
  }

  function status() {
    return {
      state, label, boots: bootCount, searching, discard, searchFen, wantedFen,
      depth: result ? result.depth : null,
      done: result ? result.done : null,
      lines: result ? result.lines.map(l => l.rank + ':' + l.move + ' ' + l.type + ' ' + l.value + ' d' + l.depth) : []
    };
  }

  // Solo para pruebas: fuerza los motores de reserva (incluido y CDN) saltándose el de chess.com
  function forceReserveOnly() {
    killWorker();
    candidates = reserveCandidates();
    candIdx = 0; bootAttempt = 0; deadUntil = 0;
    if (wantedFen) boot();
  }

  return { request, release, prewarm, reconfigure, getResult, status, forceReserveOnly, setOnUpdate: fn => { onUpdate = fn; } };
}
