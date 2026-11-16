import { Chess } from 'chess.js'

/** Replay history rather than loading only a FEN, preserving repetition and PGN. */
export function replayGame(moves: ReadonlyArray<{ san: string }>, ply = moves.length) {
  const game = new Chess()
  for (const move of moves.slice(0, ply)) game.move(move.san)
  return game
}

export function gamePgn(moves: ReadonlyArray<{ san: string }>, resigned = false) {
  const game = replayGame(moves)
  const result = resigned ? '0-1' : game.isCheckmate() ? (game.turn() === 'w' ? '0-1' : '1-0') : game.isDraw() ? '1/2-1/2' : '*'
  game.header('White', 'Sen', 'Black', 'Hamle Koçu', 'Result', result)
  return game.pgn()
}
