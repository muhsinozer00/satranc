export type EngineLine = { uci: string; scoreCp: number; rank: number }
export type EngineResult = { lines: EngineLine[]; bestMove: string; scoreCp: number }
type InfoLine = { depth: number; line: EngineLine }

export class StockfishEngine {
  private worker: Worker | null = null
  private readyPromise: Promise<void>
  private resolveReady!: () => void
  private rejectReady!: (error: Error) => void
  private ready = false
  private disposed = false
  private info = new Map<number, InfoLine>()
  private resolveSearch: ((result: EngineResult) => void) | null = null
  private rejectSearch: ((error: Error) => void) | null = null
  private searchTimer: number | null = null
  private initTimer: number | null = null

  constructor(private readonly onStatus: (status: 'loading' | 'ready' | 'failed') => void) {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    // Cancellation can precede initialize/search attaching its handler.
    void this.readyPromise.catch(() => {})
  }

  async initialize() {
    if (this.disposed) throw new Error('Motor kapatıldı.')
    if (this.worker) return this.readyPromise
    try {
      if (typeof Worker === 'undefined') throw new Error('Web Worker desteği bulunamadı.')
      this.worker = new Worker(import.meta.env.BASE_URL + 'engine/stockfish.js')
      this.worker.addEventListener('message', this.handleMessage)
      this.worker.addEventListener('error', this.handleError)
      this.initTimer = window.setTimeout(() => this.fail(new Error('Motor yükleme zaman aşımı.')), 25_000)
      this.worker.postMessage('uci')
      await this.readyPromise
    } catch (error) {
      if (!this.disposed) this.fail(error instanceof Error ? error : new Error(String(error)))
      throw error
    }
  }

  async search(fen: string, depth = 10, multiPv = 4): Promise<EngineResult> {
    await this.readyPromise
    if (!this.worker || !this.ready || this.disposed) throw new Error('Satranç motoru hazır değil.')
    if (this.resolveSearch) throw new Error('Satranç motorunda arama sürüyor.')
    this.info.clear()
    return new Promise<EngineResult>((resolve, reject) => {
      this.resolveSearch = resolve
      this.rejectSearch = reject
      this.searchTimer = window.setTimeout(() => this.fail(new Error('Motor yanıt vermedi.')), 20_000)
      try {
        this.worker!.postMessage('setoption name MultiPV value ' + multiPv)
        this.worker!.postMessage('position fen ' + fen)
        this.worker!.postMessage('go depth ' + depth)
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  terminate() {
    if (this.disposed) return
    this.disposed = true
    const error = new Error('Motor işlemi iptal edildi.')
    this.rejectReady(error)
    this.rejectSearch?.(error)
    if (this.initTimer !== null) window.clearTimeout(this.initTimer)
    this.initTimer = null
    this.clearSearch()
    this.worker?.terminate()
    this.worker = null
    this.ready = false
  }

  private fail(error: Error) {
    if (this.disposed) return
    this.onStatus('failed')
    this.rejectReady(error)
    this.rejectSearch?.(error)
    this.terminate()
  }

  private handleMessage = (event: MessageEvent<string>) => {
    if (this.disposed) return
    const message = String(event.data).trim()
    if (message === 'uciok') { this.worker?.postMessage('isready'); return }
    if (message === 'readyok' && !this.ready) {
      if (this.initTimer !== null) window.clearTimeout(this.initTimer)
      this.initTimer = null
      this.ready = true
      this.onStatus('ready')
      this.resolveReady()
      return
    }
    if (message.startsWith('info ') && this.resolveSearch) {
      const depth = Number(message.match(/\bdepth (\d+)/)?.[1])
      const rank = Number(message.match(/\bmultipv (\d+)/)?.[1] ?? 1)
      const score = message.match(/\bscore (cp|mate) (-?\d+)/)
      const pv = message.match(/\bpv ([a-h][1-8][a-h][1-8][qrbn]?)/)
      if (Number.isFinite(depth) && score && pv && !/\b(upperbound|lowerbound)\b/.test(message)) {
        const value = Number(score[2])
        const scoreCp = score[1] === 'mate' ? Math.sign(value || 1) * (10_000 - Math.abs(value)) : value
        const previous = this.info.get(rank)
        if (!previous || depth >= previous.depth) this.info.set(rank, { depth, line: { uci: pv[1], scoreCp, rank } })
      }
      return
    }
    const best = message.match(/^bestmove ([a-h][1-8][a-h][1-8][qrbn]?|0000|\(none\))/)
    if (best && this.resolveSearch) {
      const lines = [...this.info.values()].map((item) => item.line).sort((a, b) => a.rank - b.rank)
      const bestLine = lines.find((line) => line.uci === best[1])
      if (bestLine) this.resolveSearch({ lines, bestMove: best[1], scoreCp: bestLine.scoreCp })
      else this.rejectSearch?.(new Error('Motor güvenilir bir skor döndürmedi.'))
      this.clearSearch()
    }
  }

  private handleError = () => this.fail(new Error('Stockfish dosyaları yüklenemedi.'))
  private clearSearch() {
    if (this.searchTimer !== null) window.clearTimeout(this.searchTimer)
    this.searchTimer = null
    this.resolveSearch = null
    this.rejectSearch = null
  }
}
