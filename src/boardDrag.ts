import type { DragEvent } from 'react'
import type { Square } from 'chess.js'

/** Use only the piece as the drag preview, never the square and its coordinates. */
export function startPieceDrag(event: DragEvent<HTMLButtonElement>, square: Square) {
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', square)
  const piece = event.currentTarget.querySelector('img')
  if (piece) {
    const bounds = piece.getBoundingClientRect()
    event.dataTransfer.setDragImage(piece, bounds.width / 2, bounds.height / 2)
  }
}

