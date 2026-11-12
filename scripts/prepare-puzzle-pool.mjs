import { createReadStream, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import readline from 'node:readline'
import { Chess } from 'chess.js'

const input = process.argv[2]
if (!input) {
  console.error('Usage: node scripts/prepare-puzzle-pool.mjs path/to/lichess-sample.ndjson')
  process.exit(1)
}

const output = resolve('public/puzzles')
mkdirSync(output, { recursive: true })
const shards = new Map()
let rejected = 0

const lines = readline.createInterface({
  input: createReadStream(resolve(input)),
  crlfDelay: Infinity,
})

for await (const line of lines) {
  if (!line) continue
  try {
    const puzzle = JSON.parse(line).puzzle
    const rating = Number(puzzle.Rating)
    const popularity = Number(puzzle.Popularity)
    const plays = Number(puzzle.NbPlays)
    const moves = String(puzzle.Moves || '').trim().split(/\s+/)
    if (!puzzle.PuzzleId || !puzzle.FEN || !Number.isFinite(rating) || rating < 500 || rating > 2900 ||
      popularity < 60 || plays < 10 || moves.length < 3) {
      rejected += 1
      continue
    }

    const game = new Chess(puzzle.FEN)
    for (const move of moves) {
      game.move({
        from: move.slice(0, 2),
        to: move.slice(2, 4),
        ...(move.length > 4 ? { promotion: move[4] } : {}),
      })
    }

    const item = {
      id: puzzle.PuzzleId,
      fen: puzzle.FEN,
      moves,
      rating,
      themes: String(puzzle.Themes || '').split(/\s+/).slice(0, 4),
    }
    const bucket = Math.floor(rating / 100) * 100
    const shard = shards.get(bucket) ?? []
    shard.push(item)
    shards.set(bucket, shard)
  } catch {
    rejected += 1
  }
}

const ratings = []
let accepted = 0
for (const [bucket, puzzles] of [...shards].sort(([left], [right]) => left - right)) {
  writeFileSync(resolve(output, 'rating-' + bucket + '.json'), JSON.stringify(puzzles))
  ratings.push({ bucket, count: puzzles.length })
  accepted += puzzles.length
}

writeFileSync(resolve(output, 'index.json'), JSON.stringify({
  source: 'Lichess Open Database puzzle sample',
  license: 'CC0-1.0',
  accepted,
  ratings,
}))
console.log('Prepared ' + accepted + ' puzzles in ' + ratings.length + ' rating bands; skipped ' + rejected + ' records.')
