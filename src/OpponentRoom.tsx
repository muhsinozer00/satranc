import { useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import { StockfishEngine, type EngineResult } from './engine'
import {
  MAX_PGN_BYTES, formattedLine, openingGroups, parsePgnCollection, playerNames,
  repeatedFindings, selectedGames, variationGroups,
  type ColorFilter, type EngineFinding, type ImportedGame,
} from './opponentAnalysis'
import './opponent.css'
import { scanTasks, phaseSummary, type ScanMode } from './opponentScan'
import OpponentSummary from './OpponentSummary'
import { explainFinding, opponentInsights } from './opponentInsights'

const EXAMPLE_PGN = '[Event "Örnek çalışma oyunu 1"]\n[White "Çalışma Rakibi"]\n[Black "Örnek Oyuncu"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. d3 Nf6 5. Nc3 d6 6. O-O O-O 7. Bg5 h6 8. Bh4 Be6 *\n\n[Event "Örnek çalışma oyunu 2"]\n[White "Çalışma Rakibi"]\n[Black "Örnek Oyuncu"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. d3 Nf6 5. Nc3 d6 6. Bg5 h6 7. Bh4 g5 8. Bg3 h5 *\n\n[Event "Örnek çalışma oyunu 3"]\n[White "Örnek Oyuncu"]\n[Black "Çalışma Rakibi"]\n[Result "*"]\n\n1. d4 Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6 5. Nf3 O-O 6. Be2 e5 7. O-O Nc6 *'
const SEARCH_DEPTH = 10
type ScanStatus = 'idle' | 'running' | 'done' | 'cancelled' | 'error'

function uciInput(uci: string) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci.length > 4 ? { promotion: uci[4] } : {}) }
}
function lossLabel(cp: number) {
  return cp >= 8000 ? 'Mat içeren değerlendirme' : (cp / 100).toFixed(1) + ' piyon'
}
function findingKey(finding: EngineFinding) {
  return finding.game.id + '-' + finding.ply
}
function ReadonlyBoard({ fen }: { fen: string }) {
  const board = new Chess(fen).board()
  return (
    <div className="opponent-diagram" role="img" aria-label="Seçilen hamlenin konumu. Beyaz taşlar altta.">
      {board.flatMap((row, rank) => row.map((piece, file) => (
        <div className={'opponent-square ' + ((rank + file) % 2 ? 'opponent-dark' : 'opponent-light')} key={rank + '-' + file}>
          {file === 0 && <small className="opponent-rank">{8 - rank}</small>}
          {rank === 7 && <small className="opponent-file">{'abcdefgh'[file]}</small>}
          {piece && <img src={import.meta.env.BASE_URL + 'pieces/livius/' + piece.color + piece.type + '.svg'} alt="" draggable="false" />}
        </div>
      )))}
    </div>
  )
}

export default function OpponentRoom({ onBack }: { onBack: () => void }) {
  const [pgn, setPgn] = useState('')
  const [games, setGames] = useState<ImportedGame[]>([])
  const [player, setPlayer] = useState('')
  const [color, setColor] = useState<ColorFilter>('all')
  const [importNote, setImportNote] = useState('')
  const [importError, setImportError] = useState('')
  const [loadingFile, setLoadingFile] = useState(false)
  const [scanMode, setScanMode] = useState<ScanMode>('quick')
  const completed = useRef<EngineFinding[]>([])
  const searchCache = useRef(new Map<string, EngineResult>())
  const [status, setStatus] = useState<ScanStatus>('idle')
  const [scanMessage, setScanMessage] = useState('')
  const [findings, setFindings] = useState<EngineFinding[]>([])
  const [progress, setProgress] = useState({ done: 0, total: 0, games: 0 })
  const [activeKey, setActiveKey] = useState('')
  const [showAfter, setShowAfter] = useState(false)
  const generation = useRef(0)
  const importGeneration = useRef(0)
  const engineRef = useRef<StockfishEngine | null>(null)

  const players = useMemo(() => playerNames(games), [games])
  const filteredGames = useMemo(() => selectedGames(games, player, color), [games, player, color])
  const groups = useMemo(() => openingGroups(filteredGames, player), [filteredGames, player])
  const variations = useMemo(() => variationGroups(filteredGames, player), [filteredGames, player])
  const repeats = useMemo(() => repeatedFindings(findings), [findings])
  const noteworthy = useMemo(() => [...findings].filter((finding) => finding.lossCp >= 50).sort((a, b) => b.lossCp - a.lossCp), [findings])
  const displayedFindings = noteworthy.slice(0, 60)
  const activeFinding = findings.find((finding) => findingKey(finding) === activeKey) ?? displayedFindings[0]
  const running = status === 'running'
  const significant = findings.filter((finding) => finding.lossCp >= 100).length

  useEffect(() => () => {
    generation.current += 1
    importGeneration.current += 1
    engineRef.current?.terminate()
  }, [])

  function resetAnalysis() {
    generation.current += 1
    engineRef.current?.terminate()
    engineRef.current = null
    completed.current = []
    searchCache.current.clear()
    setStatus('idle')
    setScanMessage('')
    setFindings([])
    setProgress({ done: 0, total: 0, games: 0 })
    setActiveKey('')
    setShowAfter(false)
  }

  function importText(text: string, fileRequest?: number) {
    if (running || (fileRequest !== undefined && fileRequest !== importGeneration.current)) return
    if (fileRequest === undefined) importGeneration.current += 1
    setImportError('')
    try {
      const result = parsePgnCollection(text)
      if (!result.games.length) throw new Error('Geçerli oyun bulunamadı. PGN içindeki hamleleri ve oyun başlıklarını kontrol et.')
      const names = playerNames(result.games)
      if (!names.length) throw new Error('Oyuncuyu seçebilmek için PGN dosyasında White ve Black oyuncu adları bulunmalı.')
      resetAnalysis()
      setPgn(text)
      setGames(result.games)
      setPlayer(names[0].name)
      setColor('all')
      const notes = [result.games.length + ' oyun yüklendi.']
      if (result.rejected) notes.push(result.rejected + ' geçersiz/çok uzun oyun atlandı.')
      if (result.duplicates) notes.push(result.duplicates + ' yinelenen oyun sayılmadı.')
      if (result.skipped) notes.push('İlk 200 oyun sınırı nedeniyle ' + result.skipped + ' oyun alınmadı.')
      setImportNote(notes.join(' '))
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'PGN okunamadı.')
    }
  }

  async function importFiles(files: FileList | null) {
    if (!files?.length || running) return
    const request = ++importGeneration.current
    setLoadingFile(true)
    setImportError('')
    try {
      const chosen = Array.from(files)
      if (chosen.reduce((total, file) => total + file.size, 0) > MAX_PGN_BYTES) throw new Error('Dosyaların toplamı en fazla 2 MB olabilir.')
      const texts = await Promise.all(chosen.map((file) => file.text()))
      if (request !== importGeneration.current) return
      importText(texts.join('\n\n'), request)
    } catch (error) {
      if (request !== importGeneration.current) return
      setImportError(error instanceof Error ? error.message : 'Dosya okunamadı.')
    } finally { if (request === importGeneration.current) setLoadingFile(false) }
  }

  function cancelScan() {
    generation.current += 1
    engineRef.current?.terminate()
    engineRef.current = null
    setStatus('cancelled')
    setScanMessage('Tarama duraklatıldı. Tamamlanan hamleler korundu; kaldığın yerden devam edebilirsin.')
  }

  async function analyzeGames(resume = false) {
    if (running || !filteredGames.length) return
    const tasks = scanTasks(filteredGames, player, scanMode)
    const gameCount = new Set(tasks.map(task => task.game.id)).size
    if (!tasks.length) return
    const run = ++generation.current
    const engine = new StockfishEngine(() => {})
    engineRef.current = engine
    setStatus('running')
    if (!resume) { completed.current = []; searchCache.current.clear(); setFindings([]); setActiveKey('') }
    setProgress({ done: completed.current.length, total: tasks.length, games: gameCount })
    setScanMessage('Stockfish hazırlanıyor. Oyunlar bu tarayıcıda inceleniyor.')
    const cache = searchCache.current
    const search = async (fen: string) => {
      const cached = cache.get(fen)
      if (cached) return cached
      const result = await engine.search(fen, SEARCH_DEPTH, 1)
      cache.set(fen, result)
      return result
    }

    try {
      await engine.initialize()
      if (run !== generation.current) return
      for (let index = completed.current.length; index < tasks.length; index += 1) {
        if (run !== generation.current) return
        const task = tasks[index]
        setScanMessage('Oyun ' + task.game.id + ' · ' + task.move.before.split(' ')[5] + '. hamle inceleniyor.')
        const before = await search(task.move.before)
        if (run !== generation.current) return
        const playedUci = task.move.from + task.move.to + (task.move.promotion ?? '')
        let replyUci: string | undefined
        let lossCp = 0
        if (playedUci !== before.bestMove) {
          const after = new Chess(task.game.history[0].before)
          for (const previous of task.game.history.slice(0, task.ply)) after.move(previous.san)
          if (after.isCheckmate()) lossCp = 0
          else if (after.isDraw()) lossCp = Math.max(0, before.scoreCp)
          else {
            const afterResult = await search(task.move.after)
            if (run !== generation.current) return
            replyUci = afterResult.bestMove
            lossCp = Math.max(0, before.scoreCp + afterResult.scoreCp)
          }
        }
        let bestSan = before.bestMove
        try { bestSan = new Chess(task.move.before).move(uciInput(before.bestMove)).san } catch { /* Keep the engine's UCI move if no SAN can be produced. */ }
        completed.current.push({ ...task, replyUci, lossCp, bestSan, bestUci: before.bestMove })
        setFindings([...completed.current])
        setProgress({ done: index + 1, total: tasks.length, games: gameCount })
      }
      if (run === generation.current) {
        setStatus('done')
        setScanMessage(scanMode === 'full' ? 'Tam maç analizi tamamlandı. Seçili oyunlarda oyuncunun tüm hamleleri incelendi.' : 'Hızlı tarama tamamlandı. İlk 5 oyundaki ilk 12 oyuncu hamlesi incelendi.')
      }
    } catch {
      if (run === generation.current) {
        setStatus('error')
        setScanMessage('Motor taramayı tamamlayamadı. Tamamlanan hamleler aşağıda korunuyor; yeniden deneyebilirsin.')
      }
    } finally {
      engine.terminate()
      if (engineRef.current === engine) engineRef.current = null
    }
  }

  function downloadReport() {
    const lines = [
      'HAMLE · RAKİP HAZIRLIK RAPORU',
      'Oyuncu: ' + player,
      'Renk: ' + (color === 'all' ? 'İki renk' : color === 'w' ? 'Beyaz' : 'Siyah'),
      'Yüklenen seçili oyun: ' + filteredGames.length,
      'Açılış tanıma: hamle sırasına göre yerel sözlük; transpozisyonlar ve tüm ECO varyasyonları kapsanmaz.',
      '',
      'AÇILIŞ TERCİHLERİ',
      ...groups.map((group) => (group.color === 'w' ? 'Beyaz' : 'Siyah') + ' · ' + group.name + ': ' + group.games.length + ' oyun, ' + group.wins + ' galibiyet, ' + group.draws + ' beraberlik, ' + group.losses + ' mağlubiyet, ' + group.unfinished + ' sonuçsuz'),
      '',
      'GÖRÜLEN HAMLЕ DİZİLERİ',
      ...variations.map((variation) => variation.count + ' oyun: ' + variation.line),
      '',
      'ANLAŞILIR HAZIRLIK ÖZETİ',
      ...opponentInsights(findings).categories.map(group => group.category + ': ' + group.examples.length + ' karar, ' + group.games + ' oyun. ' + group.advice),
      ...opponentInsights(findings).openings.map(row => row.name + ' (' + row.color + '): ' + row.mistakes + '/' + row.total + ' belirgin hata, %' + row.rate),
      ...noteworthy.map(finding => 'Oyun #' + finding.game.id + ': ' + explainFinding(finding).explanation),
      '',
      'MOTOR TARAMASI',
      'Durum: ' + status + ' · ' + progress.done + '/' + progress.total + ' hamle · derinlik ' + SEARCH_DEPTH,
      scanMode === 'full' ? 'Tam maç analizi: seçili oyunlarda oyuncunun tüm hamleleri.' : 'Hızlı tarama: ilk 5 oyun, ilk 12 oyuncu hamlesi.',
      ...phaseSummary(findings).map(row => row.name + ': ' + row.errors + '/' + row.total + ' belirgin hata'),
      ...noteworthy.map((finding) => 'Oyun ' + finding.game.id + ' · ' + finding.game.white + ' - ' + finding.game.black + ' · ' + finding.move.before.split(' ')[5] + '. ' + finding.move.san + ' · yaklaşık kayıp: ' + lossLabel(finding.lossCp) + ' · motor önerisi: ' + finding.bestSan),
      '',
      'Bu gözlemler yalnızca yüklenen örneklemi kapsar. Motor farkları sınırlı derinlikte tahmindir.',
    ]
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'hamle-rakip-raporu.txt'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <main className="opponent-page">
      <header className="opponent-heading">
        <div><p className="eyebrow">HAMLE · RAKİP HAZIRLIĞI</p><h1>Rakibini <span>tanı.</span></h1><p>Oyunlarını yükle, sık tercih ettiği açılışları bul. Aynı konumlarda tekrar eden kararları inceleyip hazırlığını somut oyunlara dayandır.</p></div>
        <button className="back-home" type="button" onClick={onBack}>← Ana menü</button>
      </header>

      <section className="opponent-upload" aria-labelledby="opponent-upload-title">
        <div className="opponent-upload-copy">
          <span className="opponent-step">01 / OYUNLARI EKLE</span>
          <h2 id="opponent-upload-title">Bir rakip, bir oyun arşivi.</h2>
          <p>Bir veya birkaç PGN dosyası yükle ya da oyun metnini yapıştır. Oyuncuyu bir sonraki adımda seçeceksin.</p>
          <label className={'opponent-file-button' + (running ? ' opponent-disabled' : '')}>
            {loadingFile ? 'Dosyalar okunuyor…' : 'PGN dosyalarını seç'}
            <input type="file" accept=".pgn,.txt" multiple disabled={running || loadingFile} onChange={(event) => { void importFiles(event.target.files); event.target.value = '' }} />
          </label>
          <button className="opponent-text-button" type="button" disabled={running || loadingFile} onClick={() => importText(EXAMPLE_PGN)}>Örnek oyunlarla keşfet →</button>
          <small>En fazla 2 MB ve 200 oyun. Dosyalar bu tarayıcıda işlenir; sunucuya gönderilmez. Örnek oyunlar eğitim amaçlıdır.</small>
        </div>
        <div className="opponent-paste">
          <label htmlFor="opponent-pgn">PGN metni</label>
          <textarea id="opponent-pgn" value={pgn} onChange={(event) => setPgn(event.target.value)} disabled={running || loadingFile} spellCheck={false} maxLength={MAX_PGN_BYTES} placeholder={'[White "Oyuncu adı"]\n[Black "Rakip adı"]\n\n1. e4 e5 2. Nf3 Nc6 ...'} />
          <button type="button" className="primary-button" disabled={running || loadingFile || !pgn.trim()} onClick={() => importText(pgn)}>Oyunları incele <span>↗</span></button>
        </div>
      </section>
      {importError && <p className="opponent-error" role="alert">{importError}</p>}
      {importNote && <p className="opponent-import-note" role="status">{importNote}</p>}

      {games.length > 0 && (
        <>
          <section className="opponent-filters" aria-label="İncelenecek oyuncu">
            <label>Rakip oyuncu<select value={player} disabled={running} onChange={(event) => { resetAnalysis(); setPlayer(event.target.value) }}>{players.map((entry) => <option key={entry.name} value={entry.name}>{entry.name} · {entry.count} oyun</option>)}</select></label>
            <label>Oynadığı renk<select value={color} disabled={running} onChange={(event) => { resetAnalysis(); setColor(event.target.value as ColorFilter) }}><option value="all">İki renk</option><option value="w">Beyaz</option><option value="b">Siyah</option></select></label>
            <div className="opponent-sample"><strong>{filteredGames.length}</strong><span>seçili oyun</span></div>
            <button className="secondary-button" type="button" disabled={running || !filteredGames.length} onClick={downloadReport}>Raporu indir</button>
          </section>
          <p className="opponent-confidence">{filteredGames.length < 10 ? 'Örneklem küçük: bu tercihler oyuncunun genel stilini temsil etmeyebilir.' : 'Tercihler yalnızca yüklenen oyunları temsil eder; farklı tarihler ve oyun süreleri sonucu değiştirebilir.'} Açılışlar hamle sırasına göre tanınır; tüm varyasyonlar ve transpozisyonlar kapsanmaz.</p>

          <section className="opponent-overview">
            <article className="opponent-card">
              <span className="opponent-step">02 / AÇILIŞ HARİTASI</span><h2>Hangi yollara dönüyor?</h2>
              {groups.length === 0 ? <p>Bu renkte oyun bulunamadı.</p> : <div className="opponent-opening-list">{groups.map((group) => (
                <div className="opponent-opening-row" key={group.color + group.name}>
                  <div><span className={'opponent-color opponent-color-' + group.color}>{group.color === 'w' ? 'Beyaz' : 'Siyah'}</span><strong>{group.name}</strong><small>{group.eco && group.eco + ' · '}{group.games.length} oyun · %{Math.round(group.games.length / filteredGames.length * 100)}</small></div>
                  <div className="opponent-opening-bar"><i style={{ width: group.games.length / filteredGames.length * 100 + '%' }} /></div>
                  <span className="opponent-results"><b>{group.wins} G</b> · {group.draws} B · {group.losses} M{group.unfinished > 0 && ' · ' + group.unfinished + ' sonuçsuz'}</span>
                </div>
              ))}</div>}
            </article>
            <article className="opponent-card">
              <span className="opponent-step">HAMLЕ DİZİLERİ</span><h2>Varyasyonlara yakından bak.</h2>
              <p className="opponent-subcopy">İlk 6 tam hamlenin aynı sıralandığı oyunlar birlikte gösterilir. Diziyi rakibin cevaplarıyla birlikte çalış.</p>
              <div className="opponent-variations">{variations.map((variation) => (
                <details key={variation.color + variation.line}>
                  <summary><span>{variation.color === 'w' ? 'Beyaz' : 'Siyah'} · {variation.count} oyun</span><strong>{variation.line}</strong></summary>
                  {variation.games.slice(0, 8).map((game) => <p key={game.id}><b>#{game.id} · {game.white} — {game.black}</b><span>{game.date} · {game.result} · {game.event}</span>{formattedLine(game.history, 24)}</p>)}
                </details>
              ))}</div>
            </article>
          </section>

          <section className="opponent-card opponent-engine-section">
            <label className="opponent-mode">Analiz kapsamı<select value={scanMode} disabled={running} onChange={(event) => { resetAnalysis(); setScanMode(event.target.value as ScanMode) }}><option value="quick">Hızlı tarama</option><option value="full">Tam maç analizi</option></select></label>
            <div className="opponent-scan-heading">
              <div><span className="opponent-step">03 / MOTORLA İNCELE</span><h2>Tekrar eden hataları ara.</h2><p className="opponent-subcopy">{scanMode === 'full' ? 'Yüklenen ve seçili filtreye uyan tüm oyunlarda, seçtiğin oyuncunun bütün hamleleri incelenir. Uzun arşivler daha uzun sürer; bu ekran açıkken duraklatıp devam edebilirsin.' : 'İlk 5 oyunda oyuncunun ilk 12 hamlesi incelenir.'} Mod, oyuncu veya renk değişirse analiz sıfırlanır. Sayfayı kapatmak ilerlemeyi siler.</p></div>
              {running ? <button key="cancel-scan" className="secondary-button" type="button" onClick={cancelScan}>Duraklat</button> : <button key="start-scan" className="primary-button" type="button" disabled={!filteredGames.length} onClick={() => void analyzeGames(status === 'cancelled' || status === 'error')}>{status === 'cancelled' || status === 'error' ? 'Kaldığın yerden devam et' : findings.length ? 'Yeniden tara' : 'Motor taramasını başlat'} <span>↗</span></button>}
            </div>
            {status !== 'idle' && <div className="opponent-progress" role="status"><progress value={progress.done} max={Math.max(1, progress.total)} /><p>{scanMessage}</p><small>{progress.done} / {progress.total} hamle · {progress.games} oyun · derinlik {SEARCH_DEPTH}{status !== 'done' ? ' · kısmi sonuç' : ''}</small></div>}
            {findings.length > 0 && (
              <>
                <OpponentSummary findings={findings} partial={status !== "done"} onSelect={(finding) => { setActiveKey(findingKey(finding)); setShowAfter(false); window.setTimeout(() => document.querySelector(".opponent-position")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0) }} />
                <div className="opponent-scan-stats"><div><strong>{findings.length}</strong><span>incelenen hamle</span></div><div><strong>{significant}</strong><span>en az 1 piyon kayıp</span></div><div><strong>{repeats.length}</strong><span>tekrar eden konum/hamle</span></div></div>
                <div className="opponent-repeats">
                  <h3>Tekrar gözlemleri</h3>
                  {repeats.length ? repeats.map((repeat) => <p key={findingKey(repeat[0])}><b>{repeat.length} farklı oyunda {repeat[0].move.san}</b> aynı konumda en az 1 piyonluk motor farkı oluşturdu. Motor önerisi: <b>{repeat[0].bestSan}</b>. Oyunlar: {repeat.map((finding) => '#' + finding.game.id).join(', ')}.</p>) : <p>İncelenen hamlelerde aynı konumda ve aynı hamlede tekrar eden, en az 1 piyonluk kayıp henüz bulunmadı. Bu, oyuncunun başka oyunlarda hata yapmadığı anlamına gelmez.</p>}
                </div>
                {activeFinding ? <div className="opponent-findings">
                  <div className="opponent-finding-list">
                    <h3>İncelenecek kararlar</h3>
                    <p className="opponent-subcopy">En az 0,5 piyon fark gösteren en büyük {displayedFindings.length} karar. Sınırlı derinlikteki motor farkları yaklaşık değerlerdir.</p>
                    {displayedFindings.map((finding) => <button type="button" className={findingKey(activeFinding) === findingKey(finding) ? 'opponent-finding active' : 'opponent-finding'} key={findingKey(finding)} onClick={() => { setActiveKey(findingKey(finding)); setShowAfter(false) }}><span>#{finding.game.id} · {finding.move.before.split(' ')[5]}{finding.move.color === 'b' ? '... ' : '. '}{finding.move.san}</span><strong>{lossLabel(finding.lossCp)}</strong><small>{finding.game.opening}</small></button>)}
                  </div>
                  <div className="opponent-position">
                    <ReadonlyBoard fen={showAfter ? activeFinding.move.after : activeFinding.move.before} />
                    <div className="opponent-position-controls"><button type="button" aria-pressed={!showAfter} onClick={() => setShowAfter(false)}>Hamle öncesi</button><button type="button" aria-pressed={showAfter} onClick={() => setShowAfter(true)}>Hamle sonrası</button></div>
                    <h3>{explainFinding(activeFinding).category}</h3><p>{explainFinding(activeFinding).explanation}</p><p><strong>Hazırlığında ne yapmalısın?</strong> {explainFinding(activeFinding).advice}</p><p><b>Oynanan: {activeFinding.move.san}</b><br />Motor önerisi: <b>{activeFinding.bestSan}</b><br />Yaklaşık değerlendirme kaybı: {lossLabel(activeFinding.lossCp)}.</p>
                    <small>#{activeFinding.game.id} · {activeFinding.game.white} — {activeFinding.game.black} · {activeFinding.game.date}</small>
                  </div>
                </div> : <p className="opponent-import-note">Bu tarama örneğinde 0,5 piyon veya üstü değerlendirme farkı bulunmadı.</p>}
              </>
            )}
          </section>
        </>
      )}
    </main>
  )
}
