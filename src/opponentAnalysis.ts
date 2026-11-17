import { Chess, type Move } from 'chess.js'
import { OPENINGS } from './openings'

export const MAX_PGN_BYTES = 2 * 1024 * 1024
export const MAX_GAMES = 200
export type ImportedGame = {
  id: number
  white: string
  black: string
  result: string
  date: string
  event: string
  history: Move[]
  opening: string
  family: string
  eco: string
}
export type PlayerSide = 'w' | 'b'
export type ColorFilter = 'all' | PlayerSide
export type OpeningGroup = {
  name: string
  family: string
  eco: string
  color: PlayerSide
  games: ImportedGame[]
  wins: number
  draws: number
  losses: number
  unfinished: number
}
export type EngineFinding = {
  game: ImportedGame
  move: Move
  ply: number
  replyUci?: string
  lossCp: number
  bestSan: string
  bestUci: string
}

export function normalizeName(name: string) {
  return name.trim().toLocaleLowerCase('tr-TR')
}
export function playerColor(game: ImportedGame, player: string): PlayerSide | null {
  const name = normalizeName(player)
  if (normalizeName(game.white) === name) return 'w'
  if (normalizeName(game.black) === name) return 'b'
  return null
}
export function selectedGames(games: ImportedGame[], player: string, color: ColorFilter) {
  return games.filter((game) => {
    const side = playerColor(game, player)
    return side && (color === 'all' || side === color)
  })
}

function splitPgnGames(text: string) {
  const chunks: string[] = []
  let start = 0
  let braces = 0
  let variations = 0
  let inTag = false
  let quoted = false
  let lineComment = false
  let hasMoves = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (lineComment) { if (char === '\n') lineComment = false; continue }
    if (inTag) {
      if (char === '"' && text[index - 1] !== '\\') quoted = !quoted
      if (char === ']' && !quoted) inTag = false
      continue
    }
    if (char === '{') { braces += 1; continue }
    if (char === '}' && braces) { braces -= 1; continue }
    if (braces) continue
    if (char === ';' || (char === '%' && (index === 0 || text[index - 1] === '\n'))) { lineComment = true; continue }
    if (char === '(') { variations += 1; continue }
    if (char === ')' && variations) { variations -= 1; continue }
    if (variations) continue
    if (char === '[') {
      if (hasMoves) {
        chunks.push(text.slice(start, index).trim())
        start = index
        hasMoves = false
      }
      inTag = true
      quoted = false
      continue
    }
    if (!/\s/.test(char)) hasMoves = true
    if ((index === 0 || /\s/.test(text[index - 1])) && /[10*]/.test(char)) {
      const result = text.slice(index).match(/^(1\/2-1\/2|1-0|0-1|\*)(?=\s|$|\[)/)
      if (result) {
        const end = index + result[0].length
        chunks.push(text.slice(start, end).trim())
        start = end
        index = end - 1
        hasMoves = false
      }
    }
  }
  const tail = text.slice(start).trim()
  if (tail) chunks.push(tail)
  return chunks.filter(Boolean)
}

const BASE_OPENINGS: { moves: string[]; name: string; eco: string }[] = [
  { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], name: 'İspanyol Açılışı', eco: 'C60' },
  { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], name: 'İtalyan Açılışı', eco: 'C50' },
  { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4'], name: 'İskoç Açılışı', eco: 'C45' },
  { moves: ['e4', 'e5', 'Nf3', 'Nf6'], name: 'Petrov Savunması', eco: 'C42' },
  { moves: ['e4', 'e5', 'f4'], name: 'Şah Gambiti', eco: 'C30' },
  { moves: ['e4', 'e5', 'Nc3'], name: 'Viyana Oyunu', eco: 'C25' },
  { moves: ['e4', 'c5'], name: 'Sicilya Savunması', eco: 'B20' },
  { moves: ['e4', 'e6'], name: 'Fransız Savunması', eco: 'C00' },
  { moves: ['e4', 'c6'], name: 'Caro-Kann Savunması', eco: 'B10' },
  { moves: ['e4', 'd5'], name: 'İskandinav Savunması', eco: 'B01' },
  { moves: ['e4', 'd6'], name: 'Pirc / Şah piyonu yapıları', eco: 'B07' },
  { moves: ['d4', 'd5', 'c4'], name: 'Vezir Gambiti', eco: 'D06' },
  { moves: ['d4', 'Nf6', 'c4', 'g6'], name: 'Hint Savunmaları · g6', eco: 'E60' },
  { moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'], name: 'Nimzo-Hint Savunması', eco: 'E20' },
  { moves: ['d4', 'f5'], name: 'Hollanda Savunması', eco: 'A80' },
  { moves: ['c4'], name: 'İngiliz Açılışı', eco: 'A10' },
  { moves: ['Nf3'], name: 'At açılışları', eco: 'A04' },
  { moves: ['e4', 'e5'], name: 'Açık oyun · e4 e5', eco: 'C20' },
  { moves: ['d4', 'd5'], name: 'Kapalı oyun · d4 d5', eco: 'D00' },
  { moves: ['d4', 'Nf6'], name: 'Hint Savunmaları', eco: 'A45' },
]
function identifyOpening(history: Move[]) {
  if (!history.length || history[0].before !== new Chess().fen()) {
    return { opening: 'Özel başlangıç konumu', family: 'Özel başlangıç konumu', eco: '' }
  }
  const sans = history.map((move) => move.san)
  const detailed = [...OPENINGS].sort((a, b) => b.moves.length - a.moves.length)
    .find((line) => line.moves.every((move, index) => sans[index] === move))
  if (detailed) return { opening: detailed.name, family: detailed.family, eco: detailed.eco }
  const base = [...BASE_OPENINGS].sort((a, b) => b.moves.length - a.moves.length)
    .find((line) => line.moves.every((move, index) => sans[index] === move))
  return { opening: base?.name ?? 'Diğer / kısa oyun', family: base?.name ?? 'Diğer / kısa oyun', eco: base?.eco ?? '' }
}

export function parsePgnCollection(text: string) {
  if (new TextEncoder().encode(text).length > MAX_PGN_BYTES) throw new Error('Toplam PGN boyutu en fazla 2 MB olabilir.')
  const chunks = splitPgnGames(text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'))
  const games: ImportedGame[] = []
  const signatures = new Set<string>()
  let rejected = 0
  let duplicates = 0
  for (const chunk of chunks.slice(0, MAX_GAMES)) {
    try {
      if (chunk.length > 80_000) throw new Error('Oyun çok uzun.')
      const game = new Chess()
      game.loadPgn(chunk, { strict: false })
      const history = game.history({ verbose: true })
      if (!history.length || history.length > 500) throw new Error('Oyun hamleleri geçersiz.')
      const headers = game.getHeaders()
      const white = headers.White?.trim() || '?'
      const black = headers.Black?.trim() || '?'
      const signature = [white, black, headers.Date, headers.Result, history[0].before, ...history.map((move) => move.san)].join('|')
      if (signatures.has(signature)) { duplicates += 1; continue }
      signatures.add(signature)
      games.push({
        id: games.length + 1,
        white, black,
        result: headers.Result || '*',
        date: headers.Date || 'Tarih yok',
        event: headers.Event || 'İsimsiz oyun',
        history,
        ...identifyOpening(history),
      })
    } catch { rejected += 1 }
  }
  return { games, rejected, duplicates, skipped: Math.max(0, chunks.length - MAX_GAMES) }
}

export function playerNames(games: ImportedGame[]) {
  const counts = new Map<string, { name: string; count: number }>()
  for (const game of games) {
    for (const name of [game.white, game.black]) {
      if (name === '?' || !name.trim()) continue
      const key = normalizeName(name)
      const entry = counts.get(key) ?? { name, count: 0 }
      entry.count += 1
      counts.set(key, entry)
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)
}
export function gameOutcome(game: ImportedGame, color: PlayerSide) {
  if (game.result === '1/2-1/2') return 'draw'
  if (game.result !== '1-0' && game.result !== '0-1') return 'unfinished'
  return game.result === (color === 'w' ? '1-0' : '0-1') ? 'win' : 'loss'
}
export function openingGroups(games: ImportedGame[], player: string): OpeningGroup[] {
  const groups = new Map<string, OpeningGroup>()
  for (const game of games) {
    const color = playerColor(game, player)
    if (!color) continue
    const key = color + game.opening
    const group = groups.get(key) ?? { name: game.opening, family: game.family, eco: game.eco, color, games: [], wins: 0, draws: 0, losses: 0, unfinished: 0 }
    group.games.push(game)
    const outcome = gameOutcome(game, color)
    if (outcome === 'win') group.wins++
    else if (outcome === 'draw') group.draws++
    else if (outcome === 'loss') group.losses++
    else group.unfinished++
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => b.games.length - a.games.length)
}
export function formattedLine(moves: Move[], length = 12) {
  return moves.slice(0, length).map((move, index) => {
    const fullMove = move.before.split(' ')[5]
    return (move.color === 'w' ? fullMove + '. ' : index === 0 ? fullMove + '... ' : '') + move.san
  }).join(' ')
}
export function variationGroups(games: ImportedGame[], player: string) {
  const variations = new Map<string, { line: string; color: PlayerSide; count: number; games: ImportedGame[] }>()
  for (const game of games) {
    const color = playerColor(game, player)
    if (!color) continue
    const line = formattedLine(game.history)
    const key = color + line
    const entry = variations.get(key) ?? { line, color, count: 0, games: [] }
    entry.count += 1
    entry.games.push(game)
    variations.set(key, entry)
  }
  return [...variations.values()].sort((a, b) => b.count - a.count).slice(0, 8)
}
export function repeatedFindings(findings: EngineFinding[]) {
  const groups = new Map<string, EngineFinding[]>()
  for (const finding of findings.filter((item) => item.lossCp >= 100)) {
    const key = finding.move.before.split(' ').slice(0, 4).join(' ') + ' ' + finding.move.from + finding.move.to + (finding.move.promotion ?? '')
    const group = groups.get(key) ?? []
    if (!group.some((item) => item.game.id === finding.game.id)) group.push(finding)
    groups.set(key, group)
  }
  return [...groups.values()].filter((group) => group.length >= 2).sort((a, b) => b.length - a.length)
}
