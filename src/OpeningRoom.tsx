import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Chess, type Square } from 'chess.js'
import { OPENINGS, type OpeningLine } from './openings'
import type { BoardTheme, PieceSet } from './types'
import './openings.css'
import { useBoardTouch } from './useBoardTouch'

type Props = { boardTheme: BoardTheme; pieceSet: PieceSet; onBack: () => void }
type Side = 'w' | 'b'
const FILES = 'abcdefgh'.split('')
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1]
const STORE_KEY = 'hamle-openings-completed-v1'

function readCompleted(): string[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]')
    return Array.isArray(data) ? data.filter((value): value is string => typeof value === 'string') : []
  } catch { return [] }
}

function moveIdea(san: string) {
  if (san.startsWith('O-O')) return 'Rok şahı merkezin dışına taşır ve kaleyi oyuna yaklaştırır.'
  if (san.includes('x')) return 'Bu alış piyon yapısını veya açık hatları değiştirir. Hamleden sonra hangi taşın daha etkin olduğuna bak.'
  if (san.startsWith('N')) return 'At gelişirken merkez karelerine baskı yapar. Yeni kareden hangi piyona ya da taşa saldırdığını kontrol et.'
  if (san.startsWith('B')) return 'Filin yeni çaprazına bak. Bu hamle gelişim, baskı veya şah güvenliği için bir hazırlık olabilir.'
  if (san.startsWith('Q')) return 'Vezir yeni bir baskı noktası arar. Rakibin vezire tempo kazanarak saldırıp saldıramayacağını da kontrol et.'
  if (san.startsWith('R')) return 'Kale açık veya açılması beklenen bir hatta yerleşir. Önündeki merkez piyonlarının hareketini takip et.'
  return 'Piyon hamlesi merkezde alan veya bir kontrol karesi kazanır. Geride bıraktığı kareleri ve açtığı taş yollarını birlikte değerlendir.'
}

export default function OpeningRoom({ boardTheme, pieceSet, onBack }: Props) {
  const [opening, setOpening] = useState<OpeningLine>(OPENINGS[0])
  const [query, setQuery] = useState('')
  const [family, setFamily] = useState('Tümü')
  const [mode, setMode] = useState<'learn' | 'practice'>('learn')
  const [side, setSide] = useState<Side>('w')
  const [ply, setPly] = useState(0)
  const [selected, setSelected] = useState<Square | null>(null)
  const [feedback, setFeedback] = useState('')
  const [showHint, setShowHint] = useState(false)
  const [mistakes, setMistakes] = useState(0)
  const inputLock = useRef(false)
  const [completed, setCompleted] = useState<string[]>(readCompleted)

  const game = useMemo(() => {
    const position = new Chess()
    for (const san of opening.moves.slice(0, ply)) position.move(san)
    return position
  }, [opening, ply])
  const lastMove = game.history({ verbose: true }).at(-1)
  const complete = ply >= opening.moves.length
  const inputReady = mode === 'practice' && !complete && game.turn() === side
  const targets = useMemo(() => selected && inputReady
    ? game.moves({ square: selected, verbose: true }).map((move) => move.to) : [], [selected, game, inputReady])
  const expected = useMemo(() => complete ? null : new Chess(game.fen()).move(opening.moves[ply]), [complete, game, opening, ply])
  const families = ['Tümü', ...new Set(OPENINGS.map((item) => item.family))]
  const filtered = OPENINGS.filter((item) => (family === 'Tümü' || item.family === family) &&
    (item.name + ' ' + item.eco + ' ' + item.family).toLocaleLowerCase('tr-TR').includes(query.toLocaleLowerCase('tr-TR')))
  const learnedCount = OPENINGS.filter((item) => completed.includes(item.id + ':w') || completed.includes(item.id + ':b')).length

  useEffect(() => {
    inputLock.current = false
    setSelected(null)
    setShowHint(false)
  }, [ply, opening, mode, side])

  useEffect(() => {
    if (mode !== 'practice' || complete || game.turn() === side) return
    const timer = window.setTimeout(() => setPly((current) => Math.min(opening.moves.length, current + 1)), 650)
    return () => window.clearTimeout(timer)
  }, [mode, complete, game, side, opening])

  useEffect(() => {
    if (mode !== 'practice' || !complete) return
    const key = opening.id + ':' + side
    setCompleted((current) => current.includes(key) ? current : [...current, key])
  }, [complete, mode, opening.id, side])

  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(completed)) } catch { /* Training remains usable without storage. */ }
  }, [completed])

  useEffect(() => {
    if (mode !== 'learn') return
    const keydown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault()
        setPly((current) => Math.max(0, Math.min(opening.moves.length, current + (event.key === 'ArrowRight' ? 1 : -1))))
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [mode, opening.moves.length])

  function reset() { setPly(0); setSelected(null); setFeedback(''); setShowHint(false); setMistakes(0) }
  function selectOpening(item: OpeningLine) { setOpening(item); reset() }
  function changeMode(value: 'learn' | 'practice') { setMode(value); reset() }
  function changeSide(value: Side) { setSide(value); reset() }
  function nextOpening() {
    const index = OPENINGS.findIndex((item) => item.id === opening.id)
    selectOpening(OPENINGS[(index + 1) % OPENINGS.length])
  }

  function tryMove(from: Square, to: Square) {
    if (!inputReady || !expected || inputLock.current) return
    const legalMove = game.moves({ square: from, verbose: true }).find((move) => move.to === to)
    if (!legalMove) return
    setSelected(null)
    if (from === expected.from && to === expected.to) {
      inputLock.current = true
      setPly(ply + 1)
      setFeedback('Doğru. ' + moveIdea(expected.san))
    } else {
      setMistakes((current) => current + 1)
      setFeedback('Bu hamle yasal, fakat çalıştığımız hattın devamı farklı. Başka bir hamle dene veya ipucunu aç.')
    }
  }

  function clickSquare(square: Square) {
    if (!inputReady) return
    if (selected && targets.includes(square)) { tryMove(selected, square); return }
    setSelected(game.get(square)?.color === side ? square : null)
  }

  function startDrag(event: DragEvent<HTMLButtonElement>, square: Square) {
    if (!inputReady || game.get(square)?.color !== side) { event.preventDefault(); return }
    setSelected(square)
    event.dataTransfer.setData('text/plain', square)
    event.dataTransfer.effectAllowed = 'move'
  }

  const touchHandlers = useBoardTouch(game, inputReady, tryMove)
  const visualFiles = side === 'b' ? [...FILES].reverse() : FILES
  const visualRanks = side === 'b' ? [...RANKS].reverse() : RANKS

  return (
    <main className="opening-page">
      <div className="opening-heading">
        <div><p className="eyebrow">HAMLE · AÇILIŞ ATÖLYESİ</p><h1>İlk hamlelerinden <span>bir plan çıkar.</span></h1>
          <p>Hattı adım adım incele, ardından seçtiğin renkle tahtada uygula. Bunlar örnek devam yolları; rakip farklı oynadığında planını yeniden değerlendir.</p></div>
        <button className="back-home" type="button" onClick={onBack}>← Ana menü</button>
      </div>

      <div className="opening-workspace">
        <aside className="opening-library">
          <div className="opening-library-title"><strong>Açılış kütüphanesi</strong><span>{learnedCount} / {OPENINGS.length} çalışıldı</span></div>
          <label className="opening-search-label" htmlFor="opening-search">Açılış ara</label>
          <input id="opening-search" className="opening-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="İtalyan, Sicilya, Londra…" />
          <label className="opening-search-label" htmlFor="opening-family">Açılış ailesi</label>
          <select id="opening-family" className="opening-search" value={family} onChange={(event) => setFamily(event.target.value)}>
            {families.map((name) => <option key={name}>{name}</option>)}
          </select>
          <div className="opening-catalogue" aria-label="Açılış listesi">
            {filtered.map((item) => (
              <button key={item.id} className={'opening-choice ' + (opening.id === item.id ? 'opening-choice-active' : '')} type="button" aria-pressed={opening.id === item.id} onClick={() => selectOpening(item)}>
                <span><strong>{item.name}</strong><small>{item.level} · {Math.ceil(item.moves.length / 2)} hamle</small></span>
                <i>{completed.includes(item.id + ':w') || completed.includes(item.id + ':b') ? '✓' : '↗'}</i>
              </button>
            ))}
            {!filtered.length && <p className="opening-empty">Aramana uygun açılış bulunamadı.</p>}
          </div>
          <small className="opening-storage-note">Tamamlanan çalışmalar bu tarayıcıda saklanır.</small>
        </aside>

        <section className="opening-training" aria-label="Açılış çalışması">
          <label className="opening-mobile-picker">Çalışılacak açılış<select className="opening-search" value={opening.id} onChange={(event) => { const next = OPENINGS.find((item) => item.id === event.target.value); if (next) selectOpening(next) }}>{families.filter((name) => name !== "Tümü").map((name) => <optgroup label={name} key={name}>{OPENINGS.filter((item) => item.family === name).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>)}</select></label>
          <div className="opening-training-top"><div><span>{opening.family} · {opening.eco}</span><h2>{opening.name}</h2></div><span className="opening-level">{opening.level}</span></div>
          <div className="opening-controls">
            <div className="opening-segments" role="group" aria-label="Çalışma modu">
              <button type="button" aria-pressed={mode === 'learn'} onClick={() => changeMode('learn')}>Öğren</button>
              <button type="button" aria-pressed={mode === 'practice'} onClick={() => changeMode('practice')}>Kendini dene</button>
            </div>
            <div className="opening-segments" role="group" aria-label="Oynayacağın renk">
              <button type="button" aria-pressed={side === 'w'} onClick={() => changeSide('w')}>Beyaz</button>
              <button type="button" aria-pressed={side === 'b'} onClick={() => changeSide('b')}>Siyah</button>
            </div>
          </div>

          <div className="opening-practice-grid">
            <div className="opening-board-column">
              <div className="opening-turn" role="status"><span>{complete ? 'Hat tamamlandı' : mode === 'learn' ? 'Hamleleri adım adım incele' : inputReady ? 'Sıra sende · ' + (side === 'w' ? 'Beyaz' : 'Siyah') : 'Rakibin devamı oynanıyor…'}</span><strong>{ply} / {opening.moves.length}</strong></div>
              <div className={'board-frame opening-board-frame theme-' + boardTheme}>
                <div className="chess-board" {...touchHandlers} role="grid" aria-label="Açılış çalışma tahtası">
                  {visualRanks.flatMap((rank, row) => visualFiles.map((file, col) => {
                    const square = (file + rank) as Square
                    const piece = game.get(square)
                    const target = targets.includes(square)
                    const isLast = lastMove?.from === square || lastMove?.to === square
                    const hinted = showHint && expected?.from === square
                    return <button type="button" key={square} data-square={square} role="gridcell"
                      className={['square', (FILES.indexOf(file) + rank) % 2 === 0 ? 'light-square' : 'dark-square', selected === square && 'selected-square', isLast && 'last-move-square', target && piece && 'capture-target', hinted && 'opening-hint-square'].filter(Boolean).join(' ')}
                      aria-label={square + (piece ? ' ' + (piece.color === 'w' ? 'beyaz' : 'siyah') + ' ' + piece.type : '')} aria-disabled={!inputReady}
                      onClick={() => clickSquare(square)} draggable={Boolean(inputReady && piece?.color === side)}
                      onDragStart={(event) => startDrag(event, square)}
                      onDragOver={(event) => { if (inputReady) event.preventDefault() }}
                      onDrop={(event) => { event.preventDefault(); const from = event.dataTransfer.getData('text/plain'); if (/^[a-h][1-8]$/.test(from)) tryMove(from as Square, square) }}>
                      {row === 7 && <span className="coordinate coordinate-file">{file}</span>}
                      {col === 0 && <span className="coordinate coordinate-rank">{rank}</span>}
                      {piece && <img className="piece piece-svg" src={import.meta.env.BASE_URL + 'pieces/' + pieceSet + '/' + piece.color + piece.type + '.svg'} alt="" draggable={false} />}
                      {target && !piece && <span className="move-dot" />}
                    </button>
                  }))}
                </div>
              </div>
              <div className="opening-progress" aria-label="Hat ilerlemesi"><i style={{ width: (ply / opening.moves.length * 100) + '%' }} /></div>
              {mode === 'learn' ? <div className="opening-step-buttons">
                <button type="button" onClick={() => setPly(0)} disabled={!ply} aria-label="Başlangıca dön">|←</button>
                <button type="button" onClick={() => setPly((value) => Math.max(0, value - 1))} disabled={!ply}>← Önceki</button>
                <button type="button" onClick={() => setPly((value) => Math.min(opening.moves.length, value + 1))} disabled={complete}>Sonraki →</button>
              </div> : <div className="opening-step-buttons">
                <button type="button" onClick={reset}>Yeniden başla</button>
                <button type="button" disabled={!inputReady} onClick={() => setShowHint(true)}>İpucu</button>
                {complete && <button type="button" onClick={nextOpening}>Sıradaki açılış →</button>}
              </div>}
              <small className="opening-board-help">{mode === 'learn' ? 'Klavyede ← ve → tuşlarıyla da gezinebilirsin.' : 'Taşı ve hedef kareyi seç veya sürükleyip bırak.'}</small>
            </div>

            <div className="opening-notes">
              <article className="opening-plan"><span>BU HATTIN FİKRİ</span><h3>Hamleden önce plan.</h3><p>{opening.plan}</p></article>
              <div className={'opening-current-note ' + (complete && mode === 'practice' ? 'opening-complete' : '')} role="status">
                <strong>{complete ? mode === 'practice' ? '✓ Çalışma tamamlandı' : 'Artık senin sıran' : mode === 'learn' ? lastMove ? lastMove.san + ' · hamlenin fikri' : 'Başlangıç konumu' : 'Tahtada uygula'}</strong>
                <p>{complete ? mode === 'practice' ? 'Bu hattı ' + (side === 'w' ? 'beyaz' : 'siyah') + ' taşlarla tamamladın. ' + (mistakes ? mistakes + ' denemede farklı hamle seçtin; hattı bir kez daha çalışabilirsin.' : 'Doğru sırayı korudun. Diğer renkle de deneyebilirsin.') : 'Kendini dene moduna geç ve öğrendiğin devam yolunu tahtada uygula.' : mode === 'learn' ? lastMove ? moveIdea(lastMove.san) : 'İlk hamleyle başla. Her hamlede hangi merkez karelerinin kontrol edildiğine bak.' : feedback || 'Çalıştığımız hattın sıradaki hamlesini bul. Farklı bir yasal hamle seçersen yeniden deneyebilirsin.'}</p>
                {showHint && expected && <p className="opening-visible-hint">İpucu: {expected.from} karesindeki taşı {expected.to} karesine götür · {expected.san}</p>}
              </div>
              <article className="opening-tip"><strong>Tahtada hatırla</strong><p>{opening.tip}</p></article>
              <div className="opening-line">
                <strong>{mode === 'learn' ? 'ÖRNEK DEVAM YOLU' : 'OYNADIĞIN HAMLELER'}</strong>
                <div>{opening.moves.slice(0, mode === 'learn' ? opening.moves.length : ply).map((san, index) => (
                  <button type="button" key={index} className={ply === index + 1 ? 'opening-ply-active' : ''} disabled={mode === 'practice'} onClick={() => setPly(index + 1)}>
                    {index % 2 === 0 && <span>{Math.floor(index / 2) + 1}. </span>}{san}
                  </button>
                ))}{mode === 'practice' && !ply && <p>İlk hamleden sonra burada görünecek.</p>}</div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
