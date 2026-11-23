import { useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import type { EngineFinding, ImportedGame } from './opponentAnalysis'
import { explainFinding } from './opponentInsights'

function notation(move: ImportedGame['history'][number]) {
  return move.before.split(' ')[5] + (move.color === 'w' ? '. ' : '... ') + move.san
}

export default function OpponentReplay({ games, findings, target }: {
  games: ImportedGame[]; findings: EngineFinding[]; target: { gameId: number; ply: number } | null
}) {
  const [gameId, setGameId] = useState<number | null>(null)
  const [ply, setPly] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [alternative, setAlternative] = useState(false)
  const viewer = useRef<HTMLElement>(null)
  const activeMove = useRef<HTMLButtonElement>(null)
  const game = games.find(g => g.id === gameId) ?? games[0]
  const cursor = Math.min(ply, game?.history.length ?? 0)
  const move = game?.history[cursor - 1]
  const finding = findings.find(f => f.game.id === game?.id && f.ply === cursor)
  const notes = useMemo(() => findings.filter(f => f.lossCp >= 50).sort((a,b) => b.lossCp - a.lossCp), [findings])
  const gameNotes = findings.filter(f => f.game.id === game?.id)
  const fen = move?.after ?? game?.history[0]?.before ?? new Chess().fen()
  let shownFen = fen
  if (alternative && finding) {
    try {
      const position = new Chess(finding.move.before)
      position.move({ from: finding.bestUci.slice(0,2), to: finding.bestUci.slice(2,4), promotion: finding.bestUci[4] })
      shownFen = position.fen()
    } catch { /* A malformed engine line must not break the game viewer. */ }
  }
  const board = new Chess(shownFen).board().flat()
  const squares = flipped ? [...board].reverse() : board
  function jump(next: number) { setPly(Math.max(0, Math.min(game?.history.length ?? 0, next))); setAlternative(false) }
  function showNote(note: EngineFinding) {
    setGameId(note.game.id); setPly(note.ply); setAlternative(false)
    viewer.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  function linkedExplanation(note: EngineFinding) {
    const next = note.game.history[note.ply]
    const tokens = [...new Set([note.move.san, note.bestSan, next?.san].filter(Boolean))].sort((a,b) => b.length - a.length)
    const escaped = tokens.map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    return explainFinding(note).explanation.split(new RegExp('(' + escaped.join('|') + ')', 'g')).map((part,index) => tokens.includes(part)
      ? <button className="replay-inline-move" key={index} onClick={() => {
          showNote(note)
          if (part !== note.move.san && part === note.bestSan) setAlternative(true)
          else if (part !== note.move.san && part === next?.san) setPly(note.ply + 1)
        }}>{part}</button> : part)
  }
  useEffect(() => { setPly(0); setAlternative(false) }, [games])
  useEffect(() => {
    if (!target || !games.some(g => g.id === target.gameId)) return
    setGameId(target.gameId); setPly(target.ply); setAlternative(false)
    viewer.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [target, games])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement | null
      if (event.altKey || event.ctrlKey || event.metaKey || element?.closest('input,textarea,select,[contenteditable="true"]')) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      setAlternative(false)
      setPly(current => Math.max(0, Math.min(game?.history.length ?? 0, current + (event.key === 'ArrowRight' ? 1 : -1))))
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [game])
  useEffect(() => {
    // Scroll only the notation pane; keyboard stepping should not move the page.
    const button = activeMove.current
    const pane = button?.parentElement
    if (button && pane) {
      const top = button.offsetTop - pane.offsetTop
      if (top < pane.scrollTop || top + button.offsetHeight > pane.scrollTop + pane.clientHeight) pane.scrollTop = Math.max(0, top - pane.clientHeight / 2)
    }
  }, [cursor, game?.id])
  if (!game) return <p className="opponent-import-note">Bu filtreye uygun oyun bulunamadı.</p>
  return <section className="opponent-replay" aria-label="Notlar ve maç incelemesi">
    <header><span className="opponent-step">04 / NOTTAN TAHTAYA</span><h2>Bir notu seç, oyunun içinde incele.</h2><p>Hamle bağlantıları alttaki tahtayı o ana götürür. İki oyuncunun bütün hamlelerinde ilerleyebilir, öncesini ve sonrasını karşılaştırabilirsin.</p></header>
    <div className="replay-notes" aria-label="Tıklanabilir analiz notları">
      {notes.length ? notes.map(note => <article key={note.game.id + '-' + note.ply}>
        <small>Oyun #{note.game.id} · {note.game.opening}</small>
        <h3>{explainFinding(note).category}</h3>
        <button className="replay-note-link" onClick={() => showNote(note)}>{notation(note.move)} · tahtada aç ↗</button>
        <p>{linkedExplanation(note)}</p><p><strong>Çalışma notu:</strong> {explainFinding(note).advice}</p>
      </article>) : <p>{findings.length ? 'İncelenen hamlelerde henüz en az 0,5 piyon fark içeren bir karar bulunmadı. Aşağıda tüm maçı ve tamamlanan hamle değerlendirmelerini inceleyebilirsin.' : 'Motor taraması notları burada oluşturacak. Beklemeden aşağıda bütün maçları inceleyebilirsin.'}</p>}
    </div>
    <section className="replay-viewer" ref={viewer} aria-label="Bütün maç tahtası">
      <label className="replay-game-picker">İncelenen maç<select value={game.id} onChange={event => { setGameId(Number(event.target.value)); setPly(0); setAlternative(false) }}>{games.map(g => <option key={g.id} value={g.id}>#{g.id} · {g.white} — {g.black} · {g.result}</option>)}</select></label>
      <div className="replay-workspace">
        <div className="replay-board-column">
          <div className="replay-player">{flipped ? game.white : game.black}<span>{flipped ? 'Beyaz' : 'Siyah'}</span></div>
          <div className="opponent-diagram" role="img" aria-label={'Maç konumu: ' + (alternative ? 'Motor önerisi ' + finding?.bestSan : move ? notation(move) : 'Başlangıç')}>
            {squares.map((piece, index) => {
              const file = flipped ? 7 - index % 8 : index % 8
              const rank = flipped ? Math.floor(index / 8) + 1 : 8 - Math.floor(index / 8)
              const square = 'abcdefgh'[file] + rank
              return <div key={square} className={'opponent-square ' + ((file + rank) % 2 ? 'opponent-dark' : 'opponent-light') + (!alternative && move && (move.from === square || move.to === square) ? ' replay-last-move' : '')}>
                {index % 8 === 0 && <small className="opponent-rank">{rank}</small>}{index >= 56 && <small className="opponent-file">{'abcdefgh'[file]}</small>}
                {piece && <img src={import.meta.env.BASE_URL + 'pieces/livius/' + piece.color + piece.type + '.svg'} alt="" draggable={false} />}
              </div>
            })}
          </div>
          <div className="replay-player">{flipped ? game.black : game.white}<span>{flipped ? 'Siyah' : 'Beyaz'}</span></div>
          <div className="replay-controls" aria-label="Maç hamlelerinde gezin">
            <button aria-label="Maç başlangıcı" disabled={cursor === 0 && !alternative} onClick={() => jump(0)}>Ⅰ←</button>
            <button aria-label="Önceki hamle" disabled={cursor === 0 && !alternative} onClick={() => jump(cursor - 1)}>←</button>
            <span>{cursor} / {game.history.length}</span>
            <button aria-label="Sonraki hamle" disabled={cursor === game.history.length && !alternative} onClick={() => jump(cursor + 1)}>→</button>
            <button aria-label="Maç sonu" disabled={cursor === game.history.length && !alternative} onClick={() => jump(game.history.length)}>→Ⅰ</button>
          </div>
          <button className="secondary-button" onClick={() => setFlipped(value => !value)}>Tahtayı çevir ⟳</button>
          <small className="replay-key-hint">← / → tuşlarıyla veya düğmelerle ilerle.</small>
        </div>
        <aside className="replay-commentary">
          <div className="replay-current-note" aria-live="polite">
            <span className="opponent-step">{alternative ? 'ALTERNATİF · MAÇTA OYNANMADI' : 'BU KONUMUN NOTU'}</span>
            <h3>{alternative ? 'Motor önerisi: ' + finding?.bestSan : move ? notation(move) : 'Başlangıç konumu'}</h3>
            {finding ? <><p>{explainFinding(finding).explanation}</p><p>{explainFinding(finding).advice}</p>
              {finding.bestSan !== finding.move.san && <button className="replay-note-link" onClick={() => setAlternative(value => !value)}>{alternative ? 'Oynanan hamleye dön: ' + finding.move.san : 'Motor önerisini tahtada gör: ' + finding.bestSan}</button>}</> : <p>{cursor === 0 ? game.opening + ' · İlk hamleden başlayarak oyunun planını takip et.' : 'Bu hamle için motor değerlendirmesi yok. Taranmamış hamleler ve diğer oyuncunun hamleleri için kalite notu verilmez.'}</p>}
          </div>
          <h3>Maçın bütün hamleleri</h3>
          <div className="replay-moves" aria-label="Tıklanabilir maç notasyonu">
            {game.history.map((m,index) => { const evaluated = gameNotes.find(f => f.ply === index + 1); return <button key={index} ref={cursor === index + 1 ? activeMove : undefined} aria-current={cursor === index + 1 ? 'step' : undefined} onClick={() => jump(index + 1)}><span>{notation(m)}</span>{evaluated && <small>{evaluated.lossCp >= 100 ? 'Hata' : evaluated.lossCp >= 50 ? 'Sapma' : 'İyi'}</small>}</button> })}
          </div>
          <p className="opponent-subcopy">{game.date} · {game.event} · Sonuç: {game.result}<br />Motor notları sınırlı derinlikte tahminlerdir. Sarı kareler oynanan son hamleyi gösterir.</p>
        </aside>
      </div>
    </section>
  </section>
}

