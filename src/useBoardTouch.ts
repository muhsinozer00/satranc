import { useRef, type PointerEvent, type MouseEvent } from 'react'
import { Chess, type Square } from 'chess.js'

/** Touch dragging shares legal move validation with click moves. Mouse keeps native drag. */
export function useBoardTouch(game: Chess, enabled: boolean, onMove: (from: Square, to: Square) => void) {
  const gesture = useRef<{ id: number; from: Square; x: number; y: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  return {
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      suppressClick.current = false
      if (event.pointerType === 'mouse' || !enabled) return
      const square = (event.target as HTMLElement).closest<HTMLElement>('[data-square]')?.dataset.square as Square | undefined
      if (!square || game.get(square)?.color !== game.turn()) return
      gesture.current = { id: event.pointerId, from: square, x: event.clientX, y: event.clientY, moved: false }

    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const active = gesture.current
      if (active?.id === event.pointerId && Math.hypot(event.clientX - active.x, event.clientY - active.y) > 10) { active.moved = true; if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId) }
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      const active = gesture.current
      gesture.current = null
      if (!active || active.id !== event.pointerId) return
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      if (!active.moved) return
      suppressClick.current = true
      const target = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-square]')].find((element) => {
        const box = element.getBoundingClientRect()
        return event.clientX >= box.left && event.clientX < box.right && event.clientY >= box.top && event.clientY < box.bottom
      })?.dataset.square as Square | undefined
      if (enabled && target && game.moves({ square: active.from, verbose: true }).some((move) => move.to === target)) onMove(active.from, target)
    },
    onPointerCancel() { gesture.current = null },
    onClickCapture(event: MouseEvent<HTMLDivElement>) {
      if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation() }
    },
  }
}
