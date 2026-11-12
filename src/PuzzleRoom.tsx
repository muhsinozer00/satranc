import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Chess, type Square } from 'chess.js'
import type { BoardTheme, PieceSet } from './types'

type PuzzleRecord = {
  id: string
  fen: string
  moves: string[]
  rating: number
  themes: string[]
}
type RatingShard = { bucket: number; count: number }
type PuzzleIndex = { accepted: number; ratings: RatingShard[] }
type PuzzleStatus = 'loading' | 'ready' | 'solved' | 'missed' | 'error'
type PuzzleSession = { rating: number; solved: number; attempts: number; seenIds: string[] }

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1]
const STORAGE_KEY = 'hamle-puzzle-session-v1'
const shardCache = new Map<number, Promise<PuzzleRecord[]>>()
let indexCache: Promise<PuzzleIndex> | null = null

function readSession(): PuzzleSession {
  const fallback = { rating: 1050, solved: 0, attempts: 0, seenIds: [] }
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return fallback
    const parsed = JSON.parse(saved) as Partial<PuzzleSession>
    return {
      rating: Math.max(500, Math.min(2800, Number(parsed.rating) || fallback.rating)),
      solved: Math.max(0, Number(parsed.solved) || 0),
      attempts: Math.max(0, Number(parsed.attempts) || 0),
      seenIds: Array.isArray(parsed.seenIds) ? parsed.seenIds.filter((id): id is string => typeof id === 'string') : [],
    }
  } catch {
    return fallback
  }
}

function moveInput(uci: string) {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    ...(uci.length > 4 ? { promotion: uci[4] as 'q' | 'r' | 'b' | 'n' } : {}),
  }
}

function getIndex() {
  if (!indexCache) {
    indexCache = fetch(import.meta.env.BASE_URL + 'puzzles/index.json')
      .then((response) => {
        if (!response.ok) throw new Error('Bulmaca listesi yüklenemedi.')
        return response.json() as Promise<PuzzleIndex>
      })
      .catch((error) => { indexCache = null; throw error })
  }
  return indexCache
}

function getShard(bucket: number) {
  let shard = shardCache.get(bucket)
  if (!shard) {
    shard = fetch(import.meta.env.BASE_URL + 'puzzles/rating-' + bucket + '.json')
      .then((response) => {
        if (!response.ok) throw new Error('Bu seviyede bulmaca bulunamadı.')
        return response.json() as Promise<PuzzleRecord[]>
      })
      .catch((error) => { shardCache.delete(bucket); throw error })
    shardCache.set(bucket, shard)
  }
  return shard
}

function themeLabel(theme: string) {
  const labels: Record<string, string> = {
    advantage: 'Avantaj', endgame: 'Oyun sonu', fork: 'Çatal', pin: 'Açmaz',
    mate: 'Mat', mateIn1: 'Tek hamlede mat', mateIn2: 'İki hamlede mat',
    mateIn3: 'Üç hamlede mat', middlegame: 'Oyun ortası', short: 'Kısa',
    long: 'Uzun', sacrifice: 'Fedakârlık', hangingPiece: 'Savunmasız taş',
    discoveredAttack: 'Açmazdan saldırı', defensiveMove: 'Savunma', promotion: 'Terfi',
    skewer: 'Şiş', trappedPiece: 'Sıkışmış taş', doubleCheck: 'Çifte şah',
  }
  return labels[theme] ?? theme.replace(/[A-Z]/g, (letter) => ' ' + letter).toLocaleLowerCase('tr-TR')
}

type Props = {
  boardTheme: BoardTheme
  pieceSet: PieceSet
  onBack: () => void
}

export default function PuzzleRoom({ boardTheme, pieceSet, onBack }: Props) {
  const [session, setSession] = useState<PuzzleSession>(readSession)
  const [puzzle, setPuzzle] = useState<PuzzleRecord | null>(null)
  const [poolSize, setPoolSize] = useState(0)
  const [positionFen, setPositionFen] = useState(() => new Chess().fen())
  const [solutionPly, setSolutionPly] = useState(0)
  const [status, setStatus] = useState<PuzzleStatus>('loading')
  const [feedback, setFeedback] = useState('Seviyene uygun ilk bulmaca hazırlanıyor.')
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null)
  const [legalTargets, setLegalTargets] = useState<Square[]>([])
  const [blackBottom, setBlackBottom] = useState(false)
  const [responsePending, setResponsePending] = useState(false)
  const responseTimer = useRef<number | null>(null)

  const game = useMemo(() => new Chess(positionFen), [positionFen])
  const puzzleLine = puzzle?.moves.slice(1) ?? []
  const inputReady = status === 'ready' && !responsePending && Boolean(puzzle)
  const currentThemes = puzzle?.themes.slice(0, 3).map(themeLabel) ?? []

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(session)) } catch { /* Browser storage can be disabled. */ }
  }, [session])

  useEffect(() => {
    void loadNextPuzzle()
    return () => {
      if (responseTimer.current !== null) window.clearTimeout(responseTimer.current)
    }
    // Load one puzzle when this screen opens; later loads happen from the next button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadNextPuzzle() {
    setStatus('loading')
    setFeedback('Seviyene uygun bir bulmaca hazırlanıyor.')
    setSelectedSquare(null)
    setLegalTargets([])
    setResponsePending(false)
    try {
      const index = await getIndex()
      setPoolSize(index.accepted)
      const rankedShards = [...index.ratings].sort((a, b) =>
        Math.abs(a.bucket + 50 - session.rating) - Math.abs(b.bucket + 50 - session.rating))
      const loaded: PuzzleRecord[] = []
      for (const shard of rankedShards.slice(0, 7)) {
        try { loaded.push(...await getShard(shard.bucket)) } catch { /* Keep searching nearby ratings. */ }
        const unseen = loaded.filter((item) => !session.seenIds.includes(item.id))
        if (unseen.some((item) => Math.abs(item.rating - session.rating) <= 140)) break
      }

      let unseen = loaded.filter((item) => !session.seenIds.includes(item.id))
      if (!unseen.length) {
        setSession((current) => ({ ...current, seenIds: [] }))
        unseen = loaded
        setFeedback('Bu seviyedeki sorular yenilendi.')
      }
      if (!unseen.length) throw new Error('Bulmaca havuzu şu anda açılamıyor.')

      unseen.sort((a, b) => Math.abs(a.rating - session.rating) - Math.abs(b.rating - session.rating))
      const nearestDistance = Math.abs(unseen[0].rating - session.rating)
      const options = unseen.filter((item) => Math.abs(item.rating - session.rating) <= Math.max(140, nearestDistance + 70))
      const chosen = options[Math.floor(Math.random() * Math.min(options.length, 350))]
      const start = new Chess(chosen.fen)
      start.move(moveInput(chosen.moves[0]))
      setPuzzle(chosen)
      setPositionFen(start.fen())
      setBlackBottom(start.turn() === 'b')
      setSolutionPly(0)
      setSession((current) => ({ ...current, seenIds: [...current.seenIds, chosen.id] }))
      setStatus('ready')
      setFeedback('Sıra sende. Rakibin son hamlesinden sonra en güçlü devamı bul.')
    } catch {
      setStatus('error')
      setFeedback('Bulmaca havuzu yüklenemedi. Bağlantını kontrol edip yeniden deneyebilirsin.')
    }
  }

  function markSolved() {
    if (!puzzle) return
    const gain = puzzle.rating > session.rating + 100 ? 18 : puzzle.rating < session.rating - 100 ? 9 : 14
    setStatus('solved')
    setFeedback('Doğru çözüm. Bu seviyedeki bulmacalar için +'+gain+' puan kazandın.')
    setSession((current) => ({
      ...current,
      rating: Math.max(500, Math.min(2800, current.rating + gain)),
      solved: current.solved + 1,
      attempts: current.attempts + 1,
    }))
  }

  function finishWithSolution() {
    if (!puzzle || status !== 'ready') return
    const reveal = new Chess(positionFen)
    for (const uci of puzzleLine.slice(solutionPly)) reveal.move(moveInput(uci))
    setPositionFen(reveal.fen())
    setSelectedSquare(null)
    setLegalTargets([])
    setResponsePending(false)
    setStatus('missed')
    setFeedback('Çözüm gösterildi. Bir sonraki bulmaca seviyene göre seçilecek.')
    setSession((current) => ({
      ...current,
      rating: Math.max(500, current.rating - 10),
      attempts: current.attempts + 1,
    }))
  }

  function submitMove(from: Square, to: Square) {
    if (!inputReady || !puzzle) return
    const expected = puzzleLine[solutionPly]
    if (!expected || expected.slice(0, 2) !== from || expected.slice(2, 4) !== to) {
      setFeedback('Bu hamle çözümü getirmiyor. Rakibin tehdidine ve korumasız taşlara tekrar bak.')
      setSelectedSquare(null)
      setLegalTargets([])
      return
    }

    const next = new Chess(positionFen)
    try { next.move(moveInput(expected)) } catch {
      setFeedback('Bu bulmacanın devamı yüklenemedi. Sonraki bulmacaya geçebilirsin.')
      return
    }
    setPositionFen(next.fen())
    setSelectedSquare(null)
    setLegalTargets([])
    const opponentIndex = solutionPly + 1
    if (opponentIndex >= puzzleLine.length) {
      markSolved()
      return
    }

    setResponsePending(true)
    setFeedback('Güzel hamle. Rakibin zorunlu cevabı oynanıyor…')
    responseTimer.current = window.setTimeout(() => {
      const afterReply = new Chess(next.fen())
      try { afterReply.move(moveInput(puzzleLine[opponentIndex])) } catch {
        setResponsePending(false)
        setStatus('error')
        setFeedback('Bulmacanın devamı okunamadı. Sonraki bulmacaya geçebilirsin.')
        return
      }
      setPositionFen(afterReply.fen())
      setResponsePending(false)
      const nextPlayerIndex = opponentIndex + 1
      if (nextPlayerIndex >= puzzleLine.length) {
        markSolved()
      } else {
        setSolutionPly(nextPlayerIndex)
        setResponsePending(false)
        setFeedback('Şimdi sıradaki taktik hamleyi bul.')
      }
    }, 450)
  }

  function handleSquareClick(square: Square) {
    if (!inputReady) return
    const piece = game.get(square)
    if (selectedSquare && legalTargets.includes(square)) {
      submitMove(selectedSquare, square)
      return
    }
    if (piece?.color === game.turn()) {
      setSelectedSquare(square)
      setLegalTargets(game.moves({ square, verbose: true }).map((move) => move.to))
      return
    }
    setSelectedSquare(null)
    setLegalTargets([])
  }

  function handleDragStart(event: DragEvent<HTMLButtonElement>, square: Square) {
    if (!inputReady || game.get(square)?.color !== game.turn()) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', square)
    setSelectedSquare(square)
    setLegalTargets(game.moves({ square, verbose: true }).map((move) => move.to))
  }

  const displayedRanks = blackBottom ? [...RANKS].reverse() : RANKS
  const displayedFiles = blackBottom ? [...FILES].reverse() : FILES

  return (
    <main className="puzzle-page">
      <div className="puzzle-heading">
        <div>
          <p className="eyebrow">HAMLE · GÜNLÜK ANTRENMAN</p>
          <h1>Taktiklerini <span>keskinleştir.</span></h1>
          <p className="puzzle-intro">Her cevap seviyeni etkiler. Başardıkça daha zor, zorlandıkça daha erişilebilir bulmacalar seçilir.</p>
        </div>
        <button className="back-home" type="button" onClick={onBack}>← Ana menü</button>
      </div>

      <section className="puzzle-layout" aria-label="Satranç bulmacası">
        <div className="puzzle-board-column">
          <div className="puzzle-player-strip">
            <span><i /> {responsePending ? 'Rakip cevap veriyor' : inputReady ? 'Senin sıran' : status === 'solved' ? 'Bulmaca çözüldü' : status === 'missed' ? 'Çözüm incelendi' : 'Hazırlanıyor'}</span>
            <strong>{puzzle ? puzzle.rating : '—'} <small>bulmaca seviyesi</small></strong>
          </div>

          <div className={'board-frame theme-' + boardTheme + ' puzzle-board-frame'}>
            <div className="chess-board puzzle-board" role="grid" aria-label="Bulmaca satranç tahtası">
              {displayedRanks.flatMap((rank, row) => displayedFiles.map((file, col) => {
                const square = (file + rank) as Square
                const piece = game.get(square)
                const isSelected = selectedSquare === square
                const isTarget = legalTargets.includes(square)
                const isLight = (FILES.indexOf(file) + rank) % 2 === 0
                const isFileLabel = blackBottom ? row === 7 : row === 7
                const isRankLabel = blackBottom ? col === 7 : col === 0
                const isDraggable = inputReady && piece?.color === game.turn()
                return (
                  <button
                    type="button"
                    role="gridcell"
                    key={square}
                    aria-label={square + (piece ? ' ' + piece.color + ' ' + piece.type : '')}
                    className={['square', isLight ? 'light-square' : 'dark-square', isSelected && 'selected-square', isTarget && 'legal-target', isTarget && piece && 'capture-target'].filter(Boolean).join(' ')}
                    onClick={() => handleSquareClick(square)}
                    draggable={Boolean(isDraggable)}
                    onDragStart={(event) => handleDragStart(event, square)}
                    onDragOver={(event) => { if (isTarget) event.preventDefault() }}
                    onDrop={(event) => {
                      event.preventDefault()
                      const from = event.dataTransfer.getData('text/plain') as Square
                      if (from && isTarget) submitMove(from, square)
                    }}
                  >
                    {isFileLabel && <span className="coordinate coordinate-file">{file}</span>}
                    {isRankLabel && <span className="coordinate coordinate-rank">{rank}</span>}
                    {piece && <img className={'piece piece-svg ' + (piece.color === 'w' ? 'white-piece' : 'black-piece')} src={import.meta.env.BASE_URL + 'pieces/' + pieceSet + '/' + piece.color + piece.type + '.svg'} alt="" draggable="false" />}
                    {isTarget && <span className={piece ? 'move-ring' : 'move-dot'} />}
                  </button>
                )
              }))}
            </div>
          </div>

          <div className="puzzle-board-foot">
            <span>Taşa dokunup kareyi seç veya sürükleyerek bırak.</span>
            <span>♞ {session.solved} çözülen</span>
          </div>
        </div>

        <aside className="puzzle-panel">
          <div className="puzzle-level-card">
            <span>KİŞİSEL BULMACA SEVİYEN</span>
            <strong>{session.rating}</strong>
            <div className="puzzle-level-track"><i style={{ width: Math.max(8, Math.min(100, (session.rating - 500) / 23)) + '%' }} /></div>
            <small>Her doğru cevap seviyeni yükseltir.</small>
          </div>

          <div className={'puzzle-feedback ' + (status === 'solved' ? 'puzzle-feedback-success' : status === 'error' ? 'puzzle-feedback-error' : '')} role="status">
            <span>{status === 'solved' ? '✓' : status === 'missed' ? '↗' : '✳'}</span>
            <p>{feedback}</p>
          </div>

          <div className="puzzle-tags">
            <span>{puzzle ? puzzle.rating + ' seviye' : 'Açık bulmaca arşivi'}</span>
            {currentThemes.map((theme) => <span key={theme}>{theme}</span>)}
          </div>

          {status === 'ready' && (
            <div className="puzzle-actions">
              <button className="primary-button" type="button" onClick={finishWithSolution}>Çözümü göster</button>
            </div>
          )}
          {(status === 'solved' || status === 'missed' || status === 'error') && (
            <div className="puzzle-actions">
              <button className="primary-button" type="button" onClick={() => void loadNextPuzzle()}>Sıradaki bulmaca <span>↗</span></button>
            </div>
          )}
          {status === 'loading' && <div className="puzzle-loading"><i /> Yakın seviyeden bulmaca seçiliyor</div>}

          <div className="puzzle-stats">
            <div><span>Çözülen</span><strong>{session.solved}</strong></div>
            <div><span>Deneme</span><strong>{session.attempts}</strong></div>
            <div><span>Doğruluk</span><strong>{session.attempts ? Math.round(session.solved / session.attempts * 100) : 0}%</strong></div>
          </div>

          <div className="puzzle-coach-note">
            <strong>Koç ipucu</strong>
            <p>Önce rakibin son hamlesinin açtığı hattı bul. Şah çekme, taş alma ve doğrudan tehditleri sırayla kontrol et.</p>
          </div>
        </aside>
      </section>

      <footer className="puzzle-source"><a href="https://database.lichess.org/" target="_blank" rel="noreferrer">Lichess açık bulmaca veritabanı</a> · {poolSize.toLocaleString('tr-TR')} bulmaca · CC0 · {session.seenIds.length.toLocaleString('tr-TR')} farklı bulmaca görüldü</footer>
    </main>
  )
}
