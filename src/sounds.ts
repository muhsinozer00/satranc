type SoundKind = 'move' | 'capture' | 'check'
let context: AudioContext | null = null
export function playSound(kind: SoundKind) {
  try {
    context ??= new AudioContext()
    if (context.state === 'suspended') void context.resume()
    const now = context.currentTime
    const notes = kind === 'capture' ? [420, 300] : kind === 'check' ? [660, 880] : [520]
    notes.forEach((frequency, index) => {
      const oscillator = context!.createOscillator()
      const gain = context!.createGain()
      oscillator.type = kind === 'capture' ? 'triangle' : 'sine'
      oscillator.frequency.setValueAtTime(frequency, now + index * 0.055)
      gain.gain.setValueAtTime(0.0001, now + index * 0.055)
      gain.gain.exponentialRampToValueAtTime(kind === 'move' ? 0.08 : 0.11, now + index * 0.055 + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.055 + 0.11)
      oscillator.connect(gain); gain.connect(context!.destination)
      oscillator.start(now + index * 0.055); oscillator.stop(now + index * 0.055 + 0.12)
    })
  } catch { /* Audio is optional; the game remains playable when unavailable. */ }
}
