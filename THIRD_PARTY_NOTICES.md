# Hamle · Third-party notices

This project includes or distributes the following third-party components and artwork. Review the component's license before changing how it is distributed.

## Stockfish.js 19.0.0

The browser engine files are generated/copied into `public/engine` by `scripts/copy-engine.mjs`. Stockfish.js is licensed under GNU GPL v3. Its license text is included as `public/engine/LICENSE.txt`. Commercial use and charging a fee are allowed by the GPL, subject to its terms. Because this site sends the engine's JavaScript and WebAssembly files to visitors, the corresponding-source and notice requirements must be handled for the exact engine version. Whether the rest of this application is treated as part of a covered combined work depends on the distribution details; get legal advice before commercial release.

Source: https://github.com/nmrugg/stockfish.js

## chess.js

Licensed under BSD-2-Clause. The upstream copyright and license are available at https://github.com/jhlywa/chess.js/blob/master/LICENSE.

## Chess piece artwork

The `livius`, `meridian`, and `meridian_shaded` SVG sets are by Martin Sedlák and released as CC0/public domain. License copies and source details are in `public/pieces`.

Source: https://github.com/kmar/chess_svg_piece_sets

## Sound effects

Move, capture, and check sounds are synthesized in `src/sounds.ts` with the Web Audio API; no third-party sound recordings are included.
