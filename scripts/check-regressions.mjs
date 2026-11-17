import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, dirname } from 'node:path'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const modules = new Map()
function loadTs(file, overrides = {}) {
  const path = resolve(file)
  if (modules.has(path)) return modules.get(path)
  const source = readFileSync(path, 'utf8').replaceAll('import.meta.env.BASE_URL', "'/chess/'")
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {}
  modules.set(path, exports)
  new Function('require', 'exports', code)((id) => id in overrides ? overrides[id] : id.startsWith('.') ? loadTs(resolve(dirname(path), id + '.ts')) : require(id), exports)
  return exports
}
const { Chess } = require('chess.js')
const { OPENINGS } = loadTs('src/openings.ts')
const { replayGame, gamePgn } = loadTs('src/gameHistory.ts')
const { parsePgnCollection, selectedGames, openingGroups, repeatedFindings } = loadTs('src/opponentAnalysis.ts')
let checks = 0
function check(name, fn) { fn(); checks++; console.log('OK ' + name) }

check('All opening lines are legal and uniquely identified', () => {
  assert.equal(new Set(OPENINGS.map((line) => line.id)).size, OPENINGS.length)
  assert.ok(OPENINGS.length >= 26)
  for (const line of OPENINGS) {
    const game = new Chess()
    for (const san of line.moves) assert.ok(game.move(san))
  }
})
const repetition = 'Nf3 Nf6 Ng1 Ng8 Nf3 Nf6 Ng1 Ng8'.split(' ').map((san) => ({ san }))
check('Game replay preserves threefold repetition and review position', () => {
  assert.equal(replayGame(repetition).isThreefoldRepetition(), true)
  assert.equal(replayGame(repetition, 1).get('f3').type, 'n')
  assert.equal(replayGame(repetition, 0).history().length, 0)
})
check('PGN export retains complete history and final result', () => {
  const exported = new Chess()
  exported.loadPgn(gamePgn(repetition))
  assert.equal(exported.history().length, 8)
  assert.equal(exported.getHeaders().Result, '1/2-1/2')
  const resigned = new Chess()
  resigned.loadPgn(gamePgn([{ san: 'e4' }, { san: 'e5' }], true))
  assert.equal(resigned.getHeaders().Result, '0-1')
  assert.deepEqual(resigned.history(), ['e4', 'e5'])
})
const pgnA = '[Event "Test A"]\n[White "Target"]\n[Black "Player B"]\n[Date "2026.01.01"]\n[Result "1-0"]\n\n1. e4 {not a result: 0-1 [Event fake]} e5 2. Nf3 (2. Bc4 Nc6) Nc6 3. Bc4 Bc5 1-0'
const pgnB = '[Event "Test B"]\n[White "Player C"]\n[Black "Target"]\n[Date "2026.01.02"]\n[Result "1/2-1/2"]\n\n1. d4 d5 2. c4 e6 1/2-1/2'
let collection
check('Multi-PGN handles comments, variations and duplicate games', () => {
  collection = parsePgnCollection(pgnA + '\n\n' + pgnB + '\n\n' + pgnA)
  assert.equal(collection.games.length, 2)
  assert.equal(collection.duplicates, 1)
  assert.equal(collection.rejected, 0)
  assert.deepEqual(collection.games[0].history.map((move) => move.san), ['e4','e5','Nf3','Nc6','Bc4','Bc5'])
})
check('Player and opening results are separated by color', () => {
  assert.equal(selectedGames(collection.games, ' target ', 'w').length, 1)
  assert.equal(selectedGames(collection.games, 'Target', 'b').length, 1)
  const groups = openingGroups(collection.games, 'Target')
  assert.equal(groups.find((g) => g.color === 'w').wins, 1)
  assert.equal(groups.find((g) => g.color === 'b').draws, 1)
  assert.match(groups.find((g) => g.color === 'w').name, /İtalyan/)
})
check('Invalid PGN, special positions and file limits are handled', () => {
  assert.equal(parsePgnCollection('1. e4 e5 2. Qh9 *').rejected, 1)
  assert.throws(() => parsePgnCollection(' '.repeat(2 * 1024 * 1024 + 1)), /2 MB/)
  const special = parsePgnCollection('[SetUp "1"]\n[FEN "8/8/8/8/8/8/5k2/7K b - - 0 1"]\n[White "A"]\n[Black "Target"]\n\n1... Kf3 *')
  assert.equal(special.games.length, 1)
  assert.equal(special.games[0].opening, 'Özel başlangıç konumu')
})
check('Recurring errors require the same position in distinct games', () => {
  const base = { game: collection.games[0], move: collection.games[0].history[0], ply: 1, lossCp: 150, bestSan: 'd4', bestUci: 'd2d4' }
  assert.equal(repeatedFindings([base, base]).length, 0)
  assert.equal(repeatedFindings([base, { ...base, game: { ...base.game, id: 10 } }]).length, 1)
  assert.equal(repeatedFindings([base, { ...base, game: { ...base.game, id: 10 }, lossCp: 50 }]).length, 0)
})

const { useBoardTouch } = loadTs('src/useBoardTouch.ts', { react: { useRef: (current) => ({ current }) } })
function touchBoard() {
  let captured = false
  return { hasPointerCapture: () => captured, setPointerCapture: () => { captured = true }, releasePointerCapture: () => { captured = false }, querySelectorAll: () => [{ dataset: { square: 'e4' }, getBoundingClientRect: () => ({ left: 40, right: 50, top: 40, bottom: 50 }) }] }
}
check('Touch drag submits a legal move once and suppresses synthetic click', () => {
  const moves = []; const handlers = useBoardTouch(new Chess(), true, (from, to) => moves.push(from + to)); const board = touchBoard()
  const event = { pointerType: 'touch', pointerId: 1, clientX: 45, clientY: 65, currentTarget: board, target: { closest: () => ({ dataset: { square: 'e2' } }) } }
  handlers.onPointerDown(event); handlers.onPointerMove({ ...event, clientY: 45 }); handlers.onPointerUp({ ...event, clientY: 45 })
  assert.deepEqual(moves, ['e2e4']); assert.equal(board.hasPointerCapture(), false)
  let prevented = false; handlers.onClickCapture({ preventDefault: () => { prevented = true }, stopPropagation() {} }); assert.equal(prevented, true)
  handlers.onPointerUp({ ...event, clientY: 45 }); assert.equal(moves.length, 1)
})
check('Taps, disabled boards and cancelled touch gestures do not submit moves', () => {
  for (const mode of ['tap', 'disabled', 'cancel']) {
    const moves = []; const handlers = useBoardTouch(new Chess(), mode !== 'disabled', (from, to) => moves.push(from + to)); const board = touchBoard()
    const event = { pointerType: 'touch', pointerId: 1, clientX: 45, clientY: 65, currentTarget: board, target: { closest: () => ({ dataset: { square: 'e2' } }) } }
    handlers.onPointerDown(event); if (mode !== 'tap') handlers.onPointerMove({ ...event, clientY: 45 }); if (mode === 'cancel') handlers.onPointerCancel(); handlers.onPointerUp({ ...event, clientY: 45 }); assert.equal(moves.length, 0)
  }
})


const { explainFinding, opponentInsights } = loadTs('src/opponentInsights.ts')
check('Opponent explanations identify a concrete mate reply and compare sampled rates', () => {
  const game = new Chess(); game.move('f3'); game.move('e5'); const move = game.move('g4')
  const finding = { game: { ...collection.games[0], id: 50 }, move, ply: 3, lossCp: 9999, bestSan: 'e4', bestUci: 'e2e4', replyUci: 'd8h4' }
  assert.equal(explainFinding(finding).category, 'Mat tehdidini kaçırma')
  assert.match(explainFinding(finding).explanation, /Qh4#/)
  const summary = opponentInsights([finding, { ...finding, lossCp: 0 }])
  assert.equal(summary.openings[0].rate, 50)
  assert.equal(summary.categories[0].games, 1)
  assert.equal(opponentInsights([]).categories.length, 0)
})
check('Unknown strategic reasons are not fabricated from a score', () => {
  const game = new Chess(); const move = game.move('a3')
  const finding = { game: collection.games[0], move, ply: 1, lossCp: 120, bestSan: 'e4', bestUci: 'e2e4' }
  assert.equal(explainFinding(finding).category, 'Daha güçlü devamı kaçırma')
})

const timers = new Map()
let nextTimer = 1
globalThis.window = {
  setTimeout(callback, delay) { const id = nextTimer++; timers.set(id, { callback, delay }); return id },
  clearTimeout(id) { timers.delete(id) },
}
class MockWorker {
  static instances = []
  constructor(url) { this.url = url; this.events = {}; this.commands = []; this.terminated = false; MockWorker.instances.push(this) }
  addEventListener(name, handler) { this.events[name] = handler }
  postMessage(command) { this.commands.push(command) }
  emit(message) { this.events.message({ data: message }) }
  terminate() { this.terminated = true }
}
globalThis.Worker = MockWorker
const { StockfishEngine } = loadTs('src/engine.ts')
async function readyEngine() {
  const statuses = []
  const engine = new StockfishEngine((status) => statuses.push(status))
  const init = engine.initialize()
  const worker = MockWorker.instances.at(-1)
  assert.equal(worker.url, '/chess/engine/stockfish.js')
  worker.emit('uciok'); worker.emit('readyok')
  await init
  assert.equal(timers.size, 0)
  return { engine, worker, statuses }
}
async function checkAsync(name, fn) { await fn(); checks++; console.log('OK ' + name) }

await checkAsync('UCI parsing returns scored best move and clears timers', async () => {
  const { engine, worker } = await readyEngine()
  const pending = engine.search(new Chess().fen())
  await Promise.resolve()
  worker.emit('info depth 10 multipv 2 score cp 10 pv d2d4 d7d5')
  worker.emit('info depth 10 score cp 35 multipv 1 pv e2e4 e7e5')
  worker.emit('info depth 8 multipv 1 score cp -100 pv e2e4')
  worker.emit('bestmove e2e4 ponder e7e5')
  const result = await pending
  assert.equal(result.scoreCp, 35)
  assert.equal(result.lines.length, 2)
  assert.equal(result.bestMove, 'e2e4')
  assert.equal(timers.size, 0)
  engine.terminate()
})
await checkAsync('Terminate rejects in-flight search and ignores late output', async () => {
  const { engine, worker, statuses } = await readyEngine()
  const pending = engine.search(new Chess().fen())
  await Promise.resolve()
  const rejected = assert.rejects(pending, /iptal/)
  engine.terminate()
  await rejected
  worker.emit('readyok')
  worker.emit('bestmove e2e4')
  assert.equal(worker.terminated, true)
  assert.deepEqual(statuses, ['ready'])
  assert.equal(timers.size, 0)
})
await checkAsync('Timeout ends worker and rejects instead of hanging', async () => {
  const { engine, worker, statuses } = await readyEngine()
  const pending = engine.search(new Chess().fen())
  await Promise.resolve()
  const rejected = assert.rejects(pending, /yanıt/)
  const timer = [...timers.values()].find((item) => item.delay === 20_000)
  assert.ok(timer)
  timer.callback()
  await rejected
  assert.equal(worker.terminated, true)
  assert.equal(statuses.at(-1), 'failed')
  assert.equal(timers.size, 0)
})
await checkAsync('Unscored output is rejected and a subsequent search works', async () => {
  const { engine, worker } = await readyEngine()
  const pending = engine.search(new Chess().fen())
  await Promise.resolve()
  const rejected = assert.rejects(pending, /skor/)
  worker.emit('bestmove e2e4')
  await rejected
  const mate = engine.search(new Chess().fen())
  await Promise.resolve()
  worker.emit('info depth 9 score mate -3 pv e2e4')
  worker.emit('bestmove e2e4')
  assert.equal((await mate).scoreCp, -9997)
  engine.terminate()
})
await checkAsync('Concurrent search is rejected without losing first request', async () => {
  const { engine, worker } = await readyEngine()
  const first = engine.search(new Chess().fen())
  await Promise.resolve()
  await assert.rejects(engine.search(new Chess().fen()), /sürüyor/)
  worker.emit('info depth 9 score cp 22 pv e2e4')
  worker.emit('bestmove e2e4')
  assert.equal((await first).scoreCp, 22)
  engine.terminate()
})
await checkAsync('Termination during initialization rejects and clears timeout', async () => {
  const engine = new StockfishEngine(() => {})
  const pending = engine.initialize()
  const rejected = assert.rejects(pending, /iptal/)
  engine.terminate()
  await rejected
  assert.equal(timers.size, 0)
})
console.log('\n' + checks + ' regression checks passed.')
