import type { ImportedGame, EngineFinding } from './opponentAnalysis'
import { playerColor } from './opponentAnalysis'
import { Chess } from 'chess.js'
export type ScanMode = 'quick' | 'full'
export function scanTasks(games: ImportedGame[], player: string, mode: ScanMode) {
  return (mode === 'quick' ? games.slice(0,5) : games).flatMap(game => {
    const moves = game.history.map((move,index)=>({game,move,ply:index+1})).filter(task=>task.move.color===playerColor(game,player))
    return mode === 'quick' ? moves.slice(0,12) : moves
  })
}
export function phaseSummary(findings: EngineFinding[]) {
  return ['Açılış','Oyun ortası','Oyun sonu'].map(name=>{
    const sample=findings.filter(f=>{
      const pieces=new Chess(f.move.before).board().flat().filter(p=>p && p.type!=='k' && p.type!=='p')
      const value=pieces.reduce((sum,p)=>sum+({q:9,r:5,b:3,n:3,p:0,k:0}[p!.type]),0)
      const phase=value<=20?'Oyun sonu':Number(f.move.before.split(' ')[5])<=12?'Açılış':'Oyun ortası'
      return phase===name
    })
    const errors=sample.filter(f=>f.lossCp>=100)
    return {name,total:sample.length,errors:errors.length,rate:sample.length?Math.round(errors.length/sample.length*100):null}
  })
}

