import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Chess, type Move, type Square } from 'chess.js'
import { StockfishEngine, type EngineLine, type EngineResult } from './engine'
import { playSound } from './sounds'
import PuzzleRoom from './PuzzleRoom'

type EngineStatus = 'loading' | 'ready' | 'failed'
type GamePhase = 'playing' | 'review'
type BoardTheme = 'sage' | 'sand' | 'slate' | 'ocean' | 'rose' | 'wood'
type PieceSet = 'livius' | 'meridian' | 'meridian_shaded'
type Grade = 'sharp' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'

type LoggedMove = {
  san: string
  from: Square
  to: Square
  color: 'w' | 'b'
}

type CoachMove = {
  san: string
  uci: string
  loss: number | null
  grade: Grade | null
  bestMove: string | null
}

type SearchSnapshot = {
  fen: string
  result: EngineResult
}

const THEMES: { id: BoardTheme; name: string; detail: string }[] = [
  { id: 'sage', name: 'Adaçayı', detail: 'sakin yeşil' },
  { id: 'sand', name: 'Kum', detail: 'sıcak doğal' },
  { id: 'slate', name: 'Gece', detail: 'soğuk taş' },
  { id: 'ocean', name: 'Okyanus', detail: 'mavi serin' },
  { id: 'rose', name: 'Gül', detail: 'yumuşak pembe' },
  { id: 'wood', name: 'Ahşap', detail: 'klasik ceviz' },
]

const PIECE_SETS: { id: PieceSet; name: string; detail: string }[] = [
  { id: 'livius', name: 'Livius', detail: 'modern' },
  { id: 'meridian', name: 'Meridian', detail: 'klasik' },
  { id: 'meridian_shaded', name: 'Gölgeli', detail: 'yumuşak' },
]

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1]

function classifyMove(loss: number): Grade {
  if (loss <= 0.15) return 'sharp'
  if (loss <= 0.45) return 'good'
  if (loss <= 0.9) return 'inaccuracy'
  if (loss <= 1.6) return 'mistake'
  return 'blunder'
}

function gradeLabel(grade: Grade) {
  return {
    sharp: 'Çok iyi',
    good: 'İyi hamle',
    inaccuracy: 'Küçük hata',
    mistake: 'Hata',
    blunder: 'Büyük hata',
  }[grade]
}

function adaptRating(currentRating: number, loss: number) {
  const change = loss <= 0.2 ? 18 : loss <= 0.55 ? 5 : loss <= 1.1 ? -24 : -48
  return Math.max(650, Math.min(2000, currentRating + change))
}

function moveFromUci(uci: string) {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    ...(uci.length > 4 ? { promotion: uci[4] as 'q' | 'r' | 'b' | 'n' } : {}),
  }
}

function toUci(move: Move) {
  return `${move.from}${move.to}${move.promotion ?? ''}`
}

function sanForUci(fen: string, uci: string | null) {
  if (!uci || uci === '0000') return null
  try {
    return new Chess(fen).move(moveFromUci(uci)).san
  } catch {
    return null
  }
}

function chooseAdaptiveLine(lines: EngineLine[], legalUcis: Set<string>, rating: number) {
  const valid = lines.filter((line) => legalUcis.has(line.uci)).sort((a, b) => b.scoreCp - a.scoreCp)
  if (!valid.length) return null

  const top = valid[0].scoreCp
  const tolerance = Math.round(Math.pow(Math.max(0, (1700 - rating) / 1000), 1.25) * 240)
  const options = valid.filter((line) => line.scoreCp >= top - tolerance)
  return options[Math.floor(Math.random() * options.length)]
}

function chooseFallbackMove(game: Chess, rating: number) {
  const moves = game.moves({ verbose: true })
  const scored = moves.map((move) => {
    const next = new Chess(game.fen())
    next.move(move)
    const capturedValue = move.captured ? ({ p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }[move.captured] ?? 0) : 0
    const promotionValue = move.promotion ? 7 : 0
    const checkValue = next.isCheck() ? 0.35 : 0
    return { move, score: capturedValue + promotionValue + checkValue + Math.random() * 0.45 }
  }).sort((a, b) => b.score - a.score)

  const poolSize = rating >= 1550 ? 1 : rating >= 1250 ? 2 : rating >= 900 ? Math.min(4, scored.length) : Math.min(8, scored.length)
  return scored[Math.floor(Math.random() * Math.max(1, poolSize))]?.move ?? null
}

function checkSquare(game: Chess): Square | null {
  if (!game.isCheck()) return null
  const kingColor = game.turn()
  const board = game.board()
  for (let rank = 0; rank < 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      const piece = board[rank][file]
      if (piece?.type === 'k' && piece.color === kingColor) {
        return `${FILES[file]}${8 - rank}` as Square
      }
    }
  }
  return null
}

function gameResult(game: Chess, resigned = false) {
  if (resigned) return 'Oyun terk edildi · rakip kazandı'
  if (game.isCheckmate()) return game.turn() === 'w' ? 'Mat · rakip kazandı' : 'Mat · sen kazandın'
  if (game.isStalemate()) return 'Pat · beraberlik'
  if (game.isThreefoldRepetition()) return 'Üç konum tekrarı · beraberlik'
  if (game.isInsufficientMaterial()) return 'Yetersiz taş · beraberlik'
  if (game.isDraw()) return 'Beraberlik'
  return 'Oyun tamamlandı'
}

function coachingText(move: CoachMove) {
  if (!move.grade) return 'Motor bu hamleyi değerlendiremedi; yine de tahtadaki fikri gözden geçirebilirsin.'
  if (move.grade === 'sharp') return `${move.san} ile konumsal avantajını korudun. Bu kararı verirken taş güvenliğini de iyi hesapladın.`
  if (move.grade === 'good') return `${move.san} sağlam bir tercih. Planını bozmadın; benzer konumlarda bu fikri tekrar kullanabilirsin.`
  if (move.grade === 'inaccuracy') return `Burada ${move.bestMove ?? 'daha etkin bir devam yolu'} daha fazla alan sağlayabilirdi. Hamleden önce rakibin tehditlerini de tara.`
  if (move.grade === 'mistake') return `${move.bestMove ? `${move.bestMove} daha dirençliydi. ` : ''}Bu hamle rakibin baskısını artırdı. Bir sonraki turda önce şah tehditlerini ve korunmayan taşları kontrol et.`
  return `${move.bestMove ? `${move.bestMove} kritik savunmaydı. ` : ''}Büyük bir fırsat kaçtı. Taşı oynatmadan önce rakibin her olası şahını, alışını ve saldırısını sırayla kontrol et.`
}

export default function App() {
  const [screen, setScreen] = useState<'home' | 'game' | 'puzzles'>('home')
  const [fen, setFen] = useState(() => new Chess().fen())
  const [phase, setPhase] = useState<GamePhase>('playing')
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('loading')
  const [baseline, setBaseline] = useState<SearchSnapshot | null>(null)
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null)
  const [legalTargets, setLegalTargets] = useState<Square[]>([])
  const [aiThinking, setAiThinking] = useState(false)
  const [boardTheme, setBoardTheme] = useState<BoardTheme>('sage')
  const [pieceSet, setPieceSet] = useState<PieceSet>('livius')
  const [flipped, setFlipped] = useState(false)
  const [playerRating, setPlayerRating] = useState(1050)
  const [moveLog, setMoveLog] = useState<LoggedMove[]>([])
  const [coachMoves, setCoachMoves] = useState<CoachMove[]>([])
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Square; to: Square } | null>(null)
  const [notice, setNotice] = useState('')
  const [resigned, setResigned] = useState(false)
  const [boardScale, setBoardScale] = useState(1)
  const [soundsEnabled, setSoundsEnabled] = useState(true)
  const [reviewPly, setReviewPly] = useState(0)
  const engineRef = useRef<StockfishEngine | null>(null)
  const gameGeneration = useRef(0)

  const game = useMemo(() => new Chess(fen), [fen])
  const reviewGame = useMemo(() => {
    if (phase !== 'review') return game
    const replay = new Chess()
    for (const move of moveLog.slice(0, reviewPly)) replay.move(move.san)
    return replay
  }, [phase, game, moveLog, reviewPly])
  const boardGame = phase === 'review' ? reviewGame : game
  const lastMove = phase === 'review' ? moveLog[reviewPly - 1] : moveLog.at(-1)
  const kingInCheck = checkSquare(boardGame)
  const evaluatedCoachMoves = coachMoves.filter((move) => move.loss !== null)
  const averageMoveLoss = evaluatedCoachMoves.length
    ? evaluatedCoachMoves.reduce((total, move) => total + (move.loss ?? 0), 0) / evaluatedCoachMoves.length
    : null
  const matchAccuracy = averageMoveLoss === null ? null : Math.round(100 * Math.exp(-0.28 * Math.sqrt(averageMoveLoss)))
  const selectedReviewMove = reviewPly > 0 ? moveLog[reviewPly - 1] : null
  const selectedReviewCoach = selectedReviewMove?.color === 'w' ? coachMoves.find((move) => move.uci.startsWith(`${selectedReviewMove.from}${selectedReviewMove.to}`)) : null
  const boardReady = phase === 'playing' && game.turn() === 'w' && !aiThinking &&
    (engineStatus === 'failed' || (engineStatus === 'ready' && baseline?.fen === fen))
  const waitingLabel = phase === 'review'
    ? 'Oyun tamamlandı'
    : aiThinking
      ? 'Rakip düşünüyor · acele yok'
      : engineStatus === 'loading'
        ? 'Rakip hazırlanıyor'
        : engineStatus === 'ready' && baseline?.fen !== fen
          ? 'Pozisyon inceleniyor'
          : 'Sıra sende'

  useEffect(() => {
    let active = true
    const engine = new StockfishEngine((status) => {
      if (active) setEngineStatus(status)
    })
    engineRef.current = engine
    engine.initialize().catch(() => {
      if (active) setEngineStatus('failed')
    })

    return () => {
      active = false
      engine.terminate()
    }
  }, [])

  useEffect(() => {
    if (phase === 'review') setReviewPly(moveLog.length)
  }, [phase, moveLog.length])

  useEffect(() => {
    if (phase !== 'review' || screen !== 'game') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      if ((event.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"]')) return
      event.preventDefault()
      setReviewPly((current) => Math.max(0, Math.min(moveLog.length, current + (event.key === 'ArrowRight' ? 1 : -1))))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [phase, screen, moveLog.length])

  useEffect(() => {
    if (phase !== 'playing' || game.turn() !== 'w' || aiThinking || engineStatus !== 'ready') return
    if (baseline?.fen === fen) return

    let active = true
    const generation = gameGeneration.current
    engineRef.current?.search(fen, 9, 4).then((result) => {
      if (active && generation === gameGeneration.current) setBaseline({ fen, result })
    }).catch(() => {
      if (active && generation === gameGeneration.current) {
        engineRef.current?.terminate()
        setEngineStatus('failed')
      }
    })

    return () => { active = false }
  }, [aiThinking, baseline, engineStatus, fen, game, phase])

  function clearSelection() {
    setSelectedSquare(null)
    setLegalTargets([])
  }

  async function playUserMove(from: Square, to: Square, promotion?: 'q' | 'r' | 'b' | 'n') {
    if (!boardReady) return
    const generation = gameGeneration.current
    const snapshot = baseline?.fen === fen ? baseline.result : null
    const playedGame = new Chess(fen)
    let playedMove: Move

    try {
      playedMove = playedGame.move({ from, to, ...(promotion ? { promotion } : {}) })
    } catch {
      clearSelection()
      return
    }

    const bestUci = snapshot?.lines[0]?.uci ?? snapshot?.bestMove ?? null
    const bestSan = sanForUci(fen, bestUci)
    if (soundsEnabled) playSound(playedMove.captured ? 'capture' : 'move')
    if (playedGame.isCheck() && soundsEnabled) playSound('check')
    clearSelection()
    setPendingPromotion(null)
    setBaseline(null)
    setFen(playedGame.fen())
    setMoveLog((current) => [...current, { san: playedMove.san, from: playedMove.from, to: playedMove.to, color: 'w' }])

    if (playedGame.isGameOver()) {
      if (snapshot) {
        setCoachMoves((current) => [...current, {
          san: playedMove.san,
          uci: toUci(playedMove),
          loss: playedGame.isCheckmate() ? 0 : null,
          grade: playedGame.isCheckmate() ? 'sharp' : null,
          bestMove: bestSan,
        }])
      }
      setPhase('review')
      return
    }

    setAiThinking(true)
    const aiTurnStartedAt = performance.now()
    const canUseEngine = engineStatus === 'ready' && engineRef.current !== null
    let response: EngineResult | null = null

    if (canUseEngine) {
      try {
        response = await engineRef.current!.search(playedGame.fen(), 10, 4)
      } catch {
        engineRef.current?.terminate()
        setEngineStatus('failed')
      }
    }
    const remainingThinkTime = Math.max(0, 3500 - (performance.now() - aiTurnStartedAt))
    if (remainingThinkTime > 0) await new Promise((resolve) => window.setTimeout(resolve, remainingThinkTime))
    if (generation !== gameGeneration.current) return

    let moveLoss: number | null = null
    let grade: Grade | null = null
    let nextRating = playerRating
    if (snapshot && response) {
      moveLoss = Math.max(0, (snapshot.scoreCp + response.scoreCp) / 100)
      grade = classifyMove(moveLoss)
      nextRating = adaptRating(playerRating, moveLoss)
      setPlayerRating(nextRating)
    }
    setCoachMoves((current) => [...current, {
      san: playedMove.san,
      uci: toUci(playedMove),
      loss: moveLoss,
      grade,
      bestMove: bestSan,
    }])

    const blackGame = new Chess(playedGame.fen())
    const legalMoves = blackGame.moves({ verbose: true })
    const legalUcis = new Set(legalMoves.map(toUci))
    const selectedLine = response ? chooseAdaptiveLine(response.lines, legalUcis, nextRating) : null
    let computerMoveInput: ReturnType<typeof moveFromUci> | null = selectedLine ? moveFromUci(selectedLine.uci) : null
    if (!computerMoveInput) {
      const fallbackMove = chooseFallbackMove(blackGame, nextRating)
      if (fallbackMove) computerMoveInput = {
        from: fallbackMove.from,
        to: fallbackMove.to,
        ...(fallbackMove.promotion ? { promotion: fallbackMove.promotion as 'q' | 'r' | 'b' | 'n' } : {}),
      }
    }
    if (!computerMoveInput) {
      setPhase('review')
      setAiThinking(false)
      setFen(blackGame.fen())
      return
    }

    const computerMove = blackGame.move(computerMoveInput)
    if (soundsEnabled) playSound(computerMove!.captured ? 'capture' : 'move')
    if (blackGame.isCheck() && soundsEnabled) playSound('check')
    setFen(blackGame.fen())
    setMoveLog((current) => [...current, { san: computerMove!.san, from: computerMove!.from, to: computerMove!.to, color: 'b' }])

    if (blackGame.isGameOver()) {
      setPhase('review')
      setAiThinking(false)
      return
    }

    if (engineStatus === 'ready' && engineRef.current) {
      try {
        const nextSnapshot = await engineRef.current.search(blackGame.fen(), 9, 4)
        if (generation === gameGeneration.current) setBaseline({ fen: blackGame.fen(), result: nextSnapshot })
      } catch {
        engineRef.current?.terminate()
        setEngineStatus('failed')
      }
    }
    if (generation === gameGeneration.current) setAiThinking(false)
  }

  function handleSquareClick(square: Square) {
    if (!boardReady) return
    const piece = game.get(square)

    if (selectedSquare && legalTargets.includes(square)) {
      requestUserMove(selectedSquare, square)
      return
    }

    if (piece?.color === 'w') {
      const moves = game.moves({ square, verbose: true })
      setSelectedSquare(square)
      setLegalTargets(moves.map((move) => move.to))
      return
    }
    clearSelection()
  }

  function requestUserMove(from: Square, to: Square) {
    const movingPiece = game.get(from)
    if (movingPiece?.type === 'p' && (to[1] === '8' || to[1] === '1')) {
      setPendingPromotion({ from, to })
      return
    }
    void playUserMove(from, to)
  }

  function handlePieceDragStart(event: DragEvent<HTMLButtonElement>, square: Square) {
    if (!boardReady || game.get(square)?.color !== 'w') {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', square)
    setSelectedSquare(square)
    setLegalTargets(game.moves({ square, verbose: true }).map((move) => move.to))
  }

  function startNewGame() {
    gameGeneration.current += 1
    const freshGame = new Chess()
    setFen(freshGame.fen())
    setPhase('playing')
    setBaseline(null)
    setSelectedSquare(null)
    setLegalTargets([])
    setAiThinking(false)
    setPlayerRating(1050)
    setMoveLog([])
    setCoachMoves([])
    setPendingPromotion(null)
    setResigned(false)
    setNotice('')
  }

  function changeReviewPly(delta: number) { setReviewPly((current) => Math.max(0, Math.min(moveLog.length, current + delta))) }

  function resignGame() {
    if (phase !== 'playing' || aiThinking || moveLog.length === 0) return
    setResigned(true)
    setPhase('review')
    clearSelection()
  }

  async function copyPgn() {
    try {
      await navigator.clipboard.writeText(game.pgn())
      setNotice('PGN kopyalandı')
    } catch {
      setNotice('PGN panoya kopyalanamadı')
    }
    window.setTimeout(() => setNotice(''), 2200)
  }

  const bestTeachingMoment = coachMoves.filter((move) => move.grade && move.grade !== 'sharp' && move.grade !== 'good')
    .sort((a, b) => (b.loss ?? 0) - (a.loss ?? 0))[0]
  const reviewHeadline = coachMoves.length === 0
    ? 'Bu oyun tek hamlede sona erdi. Yeni bir oyun açıp birlikte inceleyebiliriz.'
    : bestTeachingMoment
      ? `En öğretici an ${bestTeachingMoment.san} hamlesiydi. ${bestTeachingMoment.bestMove ? `${bestTeachingMoment.bestMove} seçeneğini tekrar incele.` : 'Bir sonraki oyunda taş güvenliğini bir kez daha kontrol et.'}`
      : engineStatus === 'failed'
        ? 'Bu oyun motor desteği olmadan oynandı. Taş güvenliğine ve şah tehditlerine bakarak kendi planını değerlendirebilirsin.'
        : 'Hamlelerin dengeliydi. Bu oyunda iyi yaptığın planı bir sonraki oyunda da sürdür.'

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => setScreen('home')} aria-label="Hamle ana sayfa">
          <span className="brand-mark">♞</span>
          <span>hamle<span className="brand-period">.</span></span>
        </button>
        <div className="topbar-right">
          <button className="sound-toggle" type="button" aria-pressed={soundsEnabled} onClick={() => setSoundsEnabled((enabled) => !enabled)}>{soundsEnabled ? '♫ Ses açık' : '♫ Ses kapalı'}</button>
          <span className="beta-pill"><span className="status-dot" /> KİŞİSEL ANTRENMAN</span>
          <button className="topbar-puzzles" type="button" onClick={() => setScreen('puzzles')}>Bulmacalar</button>
          <button className="topbar-play" type="button" onClick={() => { if (screen !== 'game') startNewGame(); setScreen('game') }}>
            {screen === 'game' ? 'Oyuna dön' : 'Oyna'} <span>↗</span>
          </button>
        </div>
      </header>

      <div className="screen-stage">
        <section className={`screen home-screen ${screen === 'home' ? 'screen-active' : ''}`} aria-hidden={screen !== 'home'}>
          <main className="home-content">
            <section className="hero-section">
              <div className="hero-copy">
                <p className="eyebrow"><span className="eyebrow-mark">✳</span> HAMLE · KİŞİSEL SATRANÇ ATÖLYESİ</p>
                <h1>Bir sonraki iyi hamlen <span>burada başlar.</span></h1>
                <p className="hero-description">Seviyene uyum sağlayan bir rakibe karşı oyna. Her hamlede düşünmek için zamanın olsun; oyun bitince koçunla birlikte güçlü kararlarını ve geliştirebileceğin anları keşfet.</p>
                <div className="hero-actions">
                  <button className="hero-play" type="button" onClick={() => { startNewGame(); setScreen('game') }}>Oyuna başla <span>↗</span></button>
                  <button className="hero-puzzles" type="button" onClick={() => setScreen('puzzles')}>Bulmaca çöz <span>→</span></button>
                  <span className="hero-meta">Ücretsiz · tek kişilik · tarayıcında</span>
                </div>
                <div className="hero-proof"><span>01</span> KENDİ RİTMİNDE <i /> <span>02</span> HER OYUNDAN BİR DERS</div>
              </div>
              <div className={`hero-visual theme-${boardTheme}`} aria-hidden="true">
                <div className="hero-visual-glow" />
                <div className="hero-visual-card">
                  <div className="hero-visual-top"><span>BUGÜNÜN TAHTASI</span><span className="hero-live-dot" /></div>
                  <div className="hero-mini-board">
                    {['wq', 'bk', 'wn', 'bp', 'br', 'wb', 'bq', 'wp', 'wk', 'bb', 'wq', 'bn', 'wp', 'br', 'bp', 'wk'].map((piece, index) => (
                      <div className={`hero-mini-square ${Math.floor(index / 4) % 2 === index % 2 ? 'mini-dark' : 'mini-light'}`} key={index}>
                        {index % 3 !== 1 && <img src={`${import.meta.env.BASE_URL}pieces/${pieceSet}/${piece}.svg`} alt="" />}
                      </div>
                    ))}
                  </div>
                  <div className="hero-visual-bottom"><span>♘</span><span>Bir hamle, yeni bir fikir.</span><span>↗</span></div>
                </div>
                <span className="hero-orbit orbit-one" /><span className="hero-orbit orbit-two" />
              </div>
            </section>

            <section className="how-section" id="features">
              <div className="how-heading"><div><p className="eyebrow">NASIL ÇALIŞIR?</p><h2>Oyna, düşün, <span>geliş.</span></h2></div><p>Satranç öğrenmek için kusursuz oynaman gerekmez. Her oyun sana yeni bir şey öğretir.</p></div>
              <div className="feature-grid">
                <article className="feature-card"><span className="feature-number">01</span><div className="feature-icon">♞</div><h3>Sana ayak uyduran rakip</h3><p>Stockfish destekli rakip, oyun gücünü tahmini seviyene göre ayarlar. Karar vermen için hamle arasında en az 3,5 saniye bırakır.</p></article>
                <article className="feature-card"><span className="feature-number">02</span><div className="feature-icon">⌁</div><h3>Antrenör gibi analiz</h3><p>Oyun sonunda iyi hamlelerini ve öğretici anları gösterir; bir sonraki oyunda deneyebileceğin fikirler verir.</p></article>
                <article className="feature-card"><span className="feature-number">03</span><div className="feature-icon">◫</div><h3>Kendi masanı kur</h3><p>Farklı tahta renkleri ve taş setleri arasından seç. Tahtayı çevir, oyunu kendi gözünle gör.</p></article>
                <article className="feature-card"><span className="feature-number">04</span><div className="feature-icon">♧</div><h3>Seviyene göre bulmacalar</h3><p>On binlerce açık bulmacayı çöz. Doğru cevapların seviyeni yükseltsin, sıradaki taktiği senin için seçelim.</p></article>
              </div>
            </section>
            <footer className="home-footer"><span>HAMLE <i>·</i> HER OYUNDA BİR ADIM</span><span>OYUNUN SANA AİT. GELİŞİM DE ÖYLE.</span></footer>
          </main>
        </section>

        <section className={`screen game-screen ${screen === 'game' ? 'screen-active' : ''}`} aria-hidden={screen !== 'game'}>
          <main id="top" className="main-content">
            <section className="game-heading">
              <div><p className="eyebrow">HAMLE · ANTRENMAN MASASI</p><h1>Tahta senin. <span>Acele yok.</span></h1></div>
              <button className="back-home" type="button" onClick={() => setScreen('home')}>← Ana menü</button>
            </section>
            <section className="game-layout" aria-label="Satranç oyunu">
          <div className="board-column" style={{ maxWidth: `${650 * boardScale}px` }}>
            <div className="player-strip opponent-strip">
              <div className="player-identity">
                <div className="player-avatar opponent-avatar">♟</div>
                <div><strong>Hamle Koçu</strong><span>{engineStatus === 'ready' ? 'Uyarlanabilir rakip' : 'Yerel antrenman rakibi'}</span></div>
              </div>
              <div className="player-rating"><span className="rating-label">TAHMİNİ SEVİYE</span><strong>{playerRating}</strong></div>
            </div>

            <div className={`board-frame theme-${boardTheme} ${flipped ? 'is-flipped' : ''}`}>
              <div className="chess-board" role="grid" aria-label="Satranç tahtası">
                {(flipped ? [...RANKS].reverse() : RANKS).flatMap((rank) =>
                  (flipped ? [...FILES].reverse() : FILES).map((file) => {
                    const square = `${file}${rank}` as Square
                    const fileIndex = FILES.indexOf(file)
                    const isLight = (fileIndex + rank) % 2 === 0
                    const piece = boardGame.get(square)
                    const isSelected = selectedSquare === square
                    const isLastMove = lastMove?.from === square || lastMove?.to === square
                    const isTarget = legalTargets.includes(square)
                    const isCapture = isTarget && Boolean(piece)
                    const isFileLabel = flipped ? rank === 8 : rank === 1
                    const isRankLabel = flipped ? file === 'h' : file === 'a'

                    return (
                      <button
                        type="button"
                        role="gridcell"
                        key={square}
                        aria-label={`${square}${piece ? ` ${piece.color === 'w' ? 'beyaz' : 'siyah'} ${piece.type}` : ''}`}
                        aria-disabled={!boardReady}
                        className={[
                          'square', isLight ? 'light-square' : 'dark-square', isSelected && 'selected-square',
                          isLastMove && 'last-move-square', isTarget && 'legal-target', isCapture && 'capture-target',
                          kingInCheck === square && 'check-square',
                        ].filter(Boolean).join(' ')}
                        onClick={() => handleSquareClick(square)}
                        draggable={Boolean(boardReady && piece?.color === 'w')}
                        onDragStart={(event) => handlePieceDragStart(event, square)}
                        onDragOver={(event) => { if (legalTargets.includes(square)) event.preventDefault() }}
                        onDrop={(event) => {
                          event.preventDefault()
                          const from = event.dataTransfer.getData('text/plain') as Square
                          if (from && legalTargets.includes(square)) requestUserMove(from, square)
                        }}
                      >
                        {isFileLabel && <span className="coordinate coordinate-file">{file}</span>}
                        {isRankLabel && <span className="coordinate coordinate-rank">{rank}</span>}
                        {piece && <img className={`piece piece-svg ${piece.color === 'w' ? 'white-piece' : 'black-piece'}`} src={`${import.meta.env.BASE_URL}pieces/${pieceSet}/${piece.color}${piece.type}.svg`} alt="" draggable="false" />}
                        {isTarget && <span className={isCapture ? 'move-ring' : 'move-dot'} />}
                      </button>
                    )
                  }),
                )}
              </div>
            </div>

            <div className="player-strip self-strip">
              <div className="player-identity">
                <div className="player-avatar self-avatar">M</div>
                <div><strong>Sen <span className="you-tag">SEN</span></strong><span>Beyaz taşlar · {waitingLabel}</span></div>
              </div>
              <div className={`turn-indicator ${phase === 'playing' && !aiThinking ? 'turn-active' : ''}`}><span /> {waitingLabel}</div>
            </div>

            <div className="board-actions">
              <div className="board-hint"><span className="hint-icon">↗</span> Taşı seçip kareye dokun veya sürükleyip bırak.</div>
              <div className="board-action-controls">
                <div className="board-zoom" aria-label="Tahta boyutu"><button type="button" aria-label="Tahtayı küçült" disabled={boardScale <= .7} onClick={() => setBoardScale((size) => Math.max(.7, +(size - .1).toFixed(1)))}>−</button><span>{Math.round(boardScale * 100)}%</span><button type="button" aria-label="Tahtayı büyüt" disabled={boardScale >= 1.3} onClick={() => setBoardScale((size) => Math.min(1.3, +(size + .1).toFixed(1)))}>+</button></div>
                <button className="subtle-button" type="button" onClick={() => setFlipped((value) => !value)} aria-label="Tahtayı çevir"><span>⟳</span> Çevir</button>
              </div>
            </div>
          </div>

          <aside className="side-panel">
            <div className="panel-topline"><span>OYUN MASASI</span><span className="turn-number">HAMLE <i>{String(Math.ceil((moveLog.length + 1) / 2)).padStart(2, '0')}</i></span></div>
            <h2>{phase === 'review' ? 'Oyununa bakalım.' : 'Tahta senin.'}</h2>
            <p className="panel-description">{phase === 'review' ? gameResult(game, resigned) : 'Acele etme. Her hamlede birkaç saniye durup neyi amaçladığını düşün.'}</p>

            <div className="coach-card">
              <div className="coach-card-heading"><div className="coach-icon">✳</div><div><strong>{phase === 'review' ? 'Antrenör notu' : 'Küçük bir hatırlatma'}</strong><span>{phase === 'review' ? 'Bu oyundan çıkarım' : 'Her hamleden önce'}</span></div></div>
              <p>{phase === 'review' ? reviewHeadline : 'Rakibin son hamlesine bak. Neyi tehdit ediyor? Önce bunu gör, sonra planını seç.'}</p>
              <div className="coach-signature"><span /> {phase === 'review' ? 'OYUN ANALİZİ' : 'HAMLE KOÇU'}</div>
            </div>

            {phase === 'review' && (
              <div className="accuracy-card" aria-label="Maç doğruluğu">
                <div><span>MAÇ DOĞRULUĞU</span><small>100 üzerinden</small></div>
                <strong>{matchAccuracy === null ? '—' : matchAccuracy}<i>/100</i></strong>
                <p>{matchAccuracy === null
                  ? 'Bu oyunda yeterli motor değerlendirmesi bulunmuyor.'
                  : "Stockfish'in değerlendirdiği " + evaluatedCoachMoves.length + " beyaz hamlesinden tahmin edildi."}</p>
              </div>
            )}

            <div className="moves-card">
              <div className="section-heading"><strong>{phase === 'review' ? 'ÖNE ÇIKAN HAMLELER' : 'HAMLELER'}</strong><span>{moveLog.length} hamle</span></div>
              {moveLog.length === 0 ? (
                <div className="empty-moves"><span>♧</span><p>İlk hamleni yaptığında oyunun hikâyesi burada başlayacak.</p></div>
              ) : (
                <div className="move-history" aria-label="Hamle geçmişi">
                  {Array.from({ length: Math.ceil(moveLog.length / 2) }, (_, index) => {
                    const white = moveLog[index * 2]
                    const black = moveLog[index * 2 + 1]
                    const whiteReview = coachMoves[index]
                    return (
                      <div className="move-row" key={index}>
                        <span className="move-number">{index + 1}.</span>
                        <button type="button" className={`white-move move-history-button ${phase === 'review' && reviewPly === index * 2 + 1 ? 'move-active' : ''}`} onClick={() => phase === 'review' && setReviewPly(index * 2 + 1)}>{white?.san ?? '—'}</button>
                        {whiteReview?.grade && <span className={`move-grade grade-${whiteReview.grade}`} title={gradeLabel(whiteReview.grade)} />}
                        {black && <button type="button" className={`black-move move-history-button ${phase === 'review' && reviewPly === index * 2 + 2 ? 'move-active' : ''}`} onClick={() => phase === 'review' && setReviewPly(index * 2 + 2)}>{black.san}</button>}
                      </div>
                    )
                  })}
                  {phase === 'review' && coachMoves.length > 0 && <div className="move-legend"><span className="legend-mark" /> Hamle kalitesi</div>}
                </div>
              )}
            </div>

            {phase === 'review' && (
              <div className="review-stepper" aria-label="Hamle analizi gezinme">
                <div className="review-stepper-top"><strong>{selectedReviewMove ? `${selectedReviewMove.color === 'w' ? 'Sen' : 'Rakip'} · ${selectedReviewMove.san}` : 'Başlangıç konumu'}</strong><span>{reviewPly} / {moveLog.length}</span></div>
                <p>{selectedReviewCoach ? coachingText(selectedReviewCoach) : selectedReviewMove ? 'Rakibin hamlesi. Tahtadaki yeni tehdidi ve korumasız taşları incele.' : 'Oyunun başlangıcı. İlk hamleden önce merkez kareleri ve taş gelişimini düşün.'}</p>
                {selectedReviewCoach && <div className="review-metrics"><span>{selectedReviewCoach.grade ? gradeLabel(selectedReviewCoach.grade) : 'Motor değerlendirmesi yok'}</span>{selectedReviewCoach.loss !== null && <span>En iyi hamle: {selectedReviewCoach.bestMove ?? '—'} · yaklaşık {selectedReviewCoach.loss.toFixed(1)} piyon fark</span>}</div>}
                <div className="review-stepper-buttons"><button type="button" onClick={() => changeReviewPly(-1)} disabled={reviewPly === 0}>← Önceki</button><button type="button" onClick={() => changeReviewPly(1)} disabled={reviewPly === moveLog.length}>Sonraki →</button></div>
                <small>Klavyede ← / → tuşlarıyla gezin</small>
              </div>
            )}

            {phase === 'review' && coachMoves.length > 0 && (
              <div className="coach-detail-list" aria-label="Antrenör hamle notları">
                {coachMoves.map((move, index) => (
                  <article className="coach-detail" key={`${move.uci}-${index}`}>
                    <div className="coach-detail-heading">
                      <strong>{index + 1}. {move.san}</strong>
                      <span className={move.grade ? `detail-grade grade-text-${move.grade}` : 'detail-grade'}>{move.grade ? gradeLabel(move.grade) : 'Değerlendirilemedi'}</span>
                    </div>
                    <p>{coachingText(move)}</p>
                  </article>
                ))}
              </div>
            )}

            <div className="customize-card">
              <div className="section-heading"><strong>TAHTANI KİŞİSELLEŞTİR</strong><span>01 / 02</span></div>
              <div className="theme-options" role="group" aria-label="Tahta renkleri">
                {THEMES.map((theme) => (
                  <button key={theme.id} type="button" title={theme.detail} className={`theme-option ${boardTheme === theme.id ? 'theme-selected' : ''}`} onClick={() => setBoardTheme(theme.id)} aria-pressed={boardTheme === theme.id}>
                    <span className={`theme-swatch swatch-${theme.id}`}><i /><i /><i /><i /></span>
                    <span className="theme-name">{theme.name}</span>
                  </button>
                ))}
              </div>
              <div className="section-heading piece-set-heading"><strong>TAŞ STİLİ</strong><span>02 / 02</span></div>
              <div className="piece-options" role="group" aria-label="Taş görünümü">
                {PIECE_SETS.map((set) => (
                  <button key={set.id} type="button" className={`piece-option ${pieceSet === set.id ? 'piece-option-selected' : ''}`} onClick={() => setPieceSet(set.id)} aria-pressed={pieceSet === set.id} title={set.detail}>
                    <span className="piece-option-preview"><img src={`${import.meta.env.BASE_URL}pieces/${set.id}/wk.svg`} alt="" /><img src={`${import.meta.env.BASE_URL}pieces/${set.id}/bn.svg`} alt="" /></span>
                    <span>{set.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {phase === 'playing' ? (
              <div className="panel-footer">
                <span className="engine-status"><span className={`engine-dot engine-${engineStatus}`} />{engineStatus === 'ready' ? 'Stockfish aktif' : engineStatus === 'loading' ? 'Motor yükleniyor' : 'Yerel motor'}</span>
                <button type="button" className="resign-button" onClick={resignGame} disabled={moveLog.length === 0 || aiThinking || (engineStatus === 'ready' && baseline?.fen !== fen)}><span aria-hidden="true">■</span> Oyunu bitir</button>
              </div>
            ) : (
              <div className="review-actions">
                <button type="button" className="primary-button" onClick={startNewGame}>Yeni oyuna başla <span>↗</span></button>
                <button type="button" className="secondary-button" onClick={() => void copyPgn()}>PGN'yi kopyala</button>
              </div>
            )}
          </aside>
        </section>

        <footer className="page-footer"><span>HAMLE <i>·</i> HER OYUNDA BİR ADIM</span><span>OYUNUN SANA AİT. GELİŞİM DE ÖYLE.</span></footer>
          </main>
        </section>
        <section className={`screen puzzle-screen ${screen === 'puzzles' ? 'screen-active' : ''}`} aria-hidden={screen !== 'puzzles'}>
          {screen === 'puzzles' && <PuzzleRoom boardTheme={boardTheme} pieceSet={pieceSet} onBack={() => setScreen('home')} />}
        </section>
      </div>

      {pendingPromotion && (
        <div className="modal-backdrop" role="presentation">
          <div className="promotion-dialog" role="dialog" aria-modal="true" aria-labelledby="promotion-title">
            <p className="eyebrow">SON BİR SEÇİM</p>
            <h2 id="promotion-title">Piyonun hangi taşa dönüşsün?</h2>
            <div className="promotion-options">
              {(['q', 'r', 'b', 'n'] as const).map((type) => (
                <button key={type} type="button" onClick={() => void playUserMove(pendingPromotion.from, pendingPromotion.to, type)} aria-label={{ q: 'Vezir', r: 'Kale', b: 'Fil', n: 'At' }[type]}><img src={`${import.meta.env.BASE_URL}pieces/${pieceSet}/w${type}.svg`} alt="" /></button>
              ))}
            </div>
          </div>
        </div>
      )}
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  )
}
