# Chess.com Top-3 Analysis Arrows

Draws the engine's three best moves as arrows on the chess.com board, each with its rank and evaluation.

Nothing else to install: when chess.com does not show engine lines, the script starts a second copy of the Stockfish build that chess.com already ships, in a Web Worker inside the page.

> It only works where chess.com itself offers analysis (its **Analysis** switch must be on). It does nothing during your own live games.

## Where it works

| Page | Where the moves come from |
|---|---|
| Events (broadcasts) | chess.com's engine lines |
| Analysis board and Self Analysis | chess.com's engine lines |
| Finished games (Analysis tab on the Play page) | chess.com's engine lines |
| Games you are watching, where chess.com shows only the evaluation bar | the script's own Stockfish worker |

## Install

Use one of the two, not both.

### Userscript

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Open [`chess_analysis_arrows.user.js`](https://github.com/USER/REPO/raw/main/chess_analysis_arrows.user.js) and confirm the install.

The script must keep `@grant none`: it has to run in the page itself to reach the board and the engine.

### Chrome or Edge extension

1. Download this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Choose **Load unpacked** and select the `chrome-extension` folder.

`chrome-extension/content.js` is a copy of the userscript. The manifest runs it with `"world": "MAIN"`, which needs Chrome 111 or later.

## Use

Open a game and turn on chess.com's **Analysis** switch.

- Green `1` is the best move, blue `2` the second, orange `3` the third.
- The number next to each arrowhead is the evaluation from White's side, the same convention chess.com uses.
- On pages without engine lines, the arrows appear about two seconds after the switch is turned on and keep improving up to depth 18.

## Settings

Edit the `CONFIG` block at the top of the script.

| Option | Default | Meaning |
|---|---|---|
| `fallbackEngine` | `true` | Set to `false` to only read the lines chess.com shows |
| `maxDepth` | `18` | The script's engine stops at this depth |
| `maxTimeMs` | `8000` | or after this time per position, whichever comes first |
| `minDepthToDraw` | `8` | No arrows are drawn below this depth, so they do not jump around |
| `graceNoPanelMs` | `1500` | Wait before starting the engine when the page has no lines panel |
| `graceEmptyPanelMs` | `3000` | Wait when the lines panel exists but is empty |
| `engineIdleKillMs` | `60000` | The worker is shut down after this long without use |
| `debug` | `false` | Detailed messages in the console |

## How it works

- **chess.com shows lines.** The script reads the first move of each line from the page (`wc-evaluation-lines` or `.engine-line-component`) and turns it into squares using the board's own list of legal moves.
- **chess.com shows no lines.** The script takes the exact position from the board (`wc-chess-board.game.getFEN()`), finds the Stockfish worker URL in `window.chesscom.featuresConfig`, and runs it with `MultiPV 3`. chess.com's own engine and evaluation bar are left alone.
- **Fallbacks.** Without the board API, the position is rebuilt from the page. If chess.com's engine cannot be found, the script loads stockfish.js 10.0.2 from cdnjs, checked against a fixed integrity hash. That engine is much slower.

## Fair play

The script's engine starts only when chess.com's Analysis switch exists and is on, and never while the board is in `playing` mode. chess.com does not offer that switch during your own live games, so the script stays idle there.

Using engine help in your own games breaks chess.com's Fair Play policy. This tool is for studying, following broadcasts and watching other people's games.

## Troubleshooting

Open the browser console on chess.com:

- `[Top3 Arrows] v9.0.0 (híbrido) cargado.` confirms the script is running.
- `__top3ArrowsHybrid.status()` shows where the arrows come from (`dom`, `engine`, `none` or `off`) and the engine's state.
- Double arrows mean two copies are active, for example the userscript and the extension, or an older version of the script.

## Disclaimer

This project is not affiliated with Chess.com. It depends on undocumented parts of the site and may stop working when chess.com changes them.
