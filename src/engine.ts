export type EngineLine = {
  uci: string
  scoreCp: number
  rank: number
}

export type EngineResult = {
  lines: EngineLine[]
  bestMove: string
  scoreCp: number
}

type InfoLine = {
  depth: number
  line: EngineLine
}

export class StockfishEngine {
  private worker: Worker | null = null
  private readyPromise: Promise<void>
  private resolveReady!: () => void
  private rejectReady!: (error: Error) => void
  private ready = false
  private info = new Map<number, InfoLine>()
  private resolveSearch: ((result: EngineResult) => void) | null = null
  private rejectSearch: ((error: Error) => void) | null = null
  private searchTimer: number | null = null

  constructor(private readonly onStatus: (status: 'loading' | 'ready' | 'failed') => void) {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
  }

  async initialize() {
    if (typeof Worker === 'undefined') throw new Error('Tarayıcı Web Worker desteği bulunamadı.')

    try {
      this.worker = new Worker('/engine/stockfish.js')
      this.worker.addEventListener('message', this.handleMessage)
      this.worker.addEventListener('error', this.handleError)
      this.worker.postMessage('uci')

      await Promise.race([
        this.readyPromise,
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('Motor zaman aşımına uğradı.')), 25_000)),
      ])
    } catch (error) {
      this.onStatus('failed')
      this.terminate()
      throw error
    }
  }

  async search(fen: string, depth = 10, multiPv = 4): Promise<EngineResult> {
    await this.readyPromise
    if (!this.worker || !this.ready) throw new Error('Satranç motoru hazır değil.')
    if (this.resolveSearch) throw new Error('Satranç motorunda arama sürüyor.')

    this.info.clear()
    this.worker.postMessage(`setoption name MultiPV value ${multiPv}`)
    this.worker.postMessage(`position fen ${fen}`)

    return new Promise<EngineResult>((resolve, reject) => {
      this.resolveSearch = resolve
      this.rejectSearch = reject
      this.searchTimer = window.setTimeout(() => {
        this.rejectSearch?.(new Error('Motor yanıt vermedi.'))
        this.clearSearch()
      }, 20_000)
      this.worker?.postMessage(`go depth ${depth}`)
    })
  }

  terminate() {
    if (this.searchTimer !== null) window.clearTimeout(this.searchTimer)
    this.worker?.terminate()
    this.worker = null
    this.ready = false
    this.clearSearch()
  }

  private handleMessage = (event: MessageEvent<string>) => {
    const message = String(event.data).trim()

    if (message === 'uciok') {
      this.worker?.postMessage('isready')
      return
    }
    if (message === 'readyok' && !this.ready) {
      this.ready = true
      this.onStatus('ready')
      this.resolveReady()
      return
    }

    const infoMatch = message.match(/^info depth (\d+)(?: seldepth \d+)?(?: multipv (\d+))?.*? score (cp|mate) (-?\d+).*?\bpv ([a-h][1-8][a-h][1-8][qrbn]?)/)
    if (infoMatch) {
      const depth = Number(infoMatch[1])
      const rank = Number(infoMatch[2] ?? '1')
      const kind = infoMatch[3]
      const score = Number(infoMatch[4])
      const scoreCp = kind === 'mate' ? Math.sign(score || 1) * (10_000 - Math.abs(score)) : score
      const previous = this.info.get(rank)
      if (!previous || depth >= previous.depth) {
        this.info.set(rank, { depth, line: { uci: infoMatch[5], scoreCp, rank } })
      }
      return
    }

    const bestMoveMatch = message.match(/^bestmove ([a-h][1-8][a-h][1-8][qrbn]?|0000)/)
    if (bestMoveMatch && this.resolveSearch) {
      const bestMove = bestMoveMatch[1]
      const lines = [...this.info.values()]
        .map(({ line }) => line)
        .sort((left, right) => right.scoreCp - left.scoreCp)
      const bestLine = lines.find((line) => line.rank === 1)
      const fallback = bestMove !== '0000' ? { uci: bestMove, scoreCp: 0, rank: 1 } : undefined

      if (bestLine || fallback) {
        this.resolveSearch({
          lines: lines.length ? lines : [fallback!],
          bestMove,
          scoreCp: bestLine?.scoreCp ?? 0,
        })
      } else {
        this.rejectSearch?.(new Error('Motor geçerli bir hamle bulamadı.'))
      }
      this.clearSearch()
    }
  }

  private handleError = () => {
    const error = new Error('Stockfish dosyaları yüklenemedi.')
    this.onStatus('failed')
    this.rejectReady(error)
    this.rejectSearch?.(error)
    this.terminate()
  }

  private clearSearch() {
    if (this.searchTimer !== null) window.clearTimeout(this.searchTimer)
    this.searchTimer = null
    this.resolveSearch = null
    this.rejectSearch = null
  }
}
