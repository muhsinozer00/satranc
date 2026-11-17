import { Chess } from 'chess.js'
import type { EngineFinding } from './opponentAnalysis'

export function explainFinding(finding: EngineFinding) {
  const { move, lossCp, bestUci, bestSan } = finding
  const before = new Chess(move.before)
  const best = before.moves({ verbose: true }).find(m => m.from + m.to + (m.promotion ?? '') === bestUci)
  const after = new Chess(move.after)
  const reply = after.moves({ verbose: true }).find(m => m.from + m.to + (m.promotion ?? '') === finding.replyUci)
  const names: Record<string,string> = { p:'piyon', n:'at', b:'fil', r:'kale', q:'vezir', k:'şah' }
  if (reply?.san.includes('#')) return { category:'Mat tehdidini kaçırma', explanation:move.san + ' sonrasında ' + reply.san + ' ile mat var. Rakip bu hamlede şahına yönelik doğrudan tehdidi karşılamadı.', advice:'Bu tür konumlarda önce şah çekişlerini ve zorunlu mat yollarını hesapla.' }
  if (best?.san.includes('#')) return { category:'Mat fırsatını kaçırma', explanation:bestSan + ' hemen mat ediyordu; rakip ' + move.san + ' seçerek bu fırsatı kaçırdı.', advice:'Şahın etrafındaki kaçış karelerini ve zorunlu şah çekişlerini çalış.' }
  if (reply?.captured) return { category:'Taş alışına izin verme', explanation:move.san + ' sonrasında motor ' + reply.san + ' öneriyor; bu cevap ' + names[reply.captured] + ' alıyor. Motor farkı da bu kararın daha zayıf olduğunu gösteriyor. Alış tek başına net taş kaybı anlamına gelmez.', advice:'Bu hamleden sonra açıkta kalan taşları ve karşı alışları incele; fedakârlık varsa telafisini hesapla.' }
  if (best?.captured) return { category:'Alış fırsatını kaçırma', explanation:'Motorun önerdiği ' + bestSan + ' bir ' + names[best.captured] + ' alışı içeriyor. Rakip ' + move.san + ' ile daha zayıf bir devam seçti.', advice:'Benzer yapılarda alışları, ara hamleleri ve karşı alışları sırayla hesapla.' }
  if (reply?.san.includes('+') || before.isCheck()) return { category:'Şah tehdidine karşı kararlar', explanation:before.isCheck() ? 'Rakip şah altındayken ' + move.san + ' seçti. ' + bestSan + ' motorun daha güçlü savunmasıydı.' : move.san + ' sonrasında motorun ' + reply?.san + ' cevabı şah çekiyor. Bu zorlayıcı cevabı hazırlığında incele.', advice:'Zorunlu cevapları ve şah güvenliğini önceliklendir.' }
  return { category:'Daha güçlü devamı kaçırma', explanation:move.san + ' yerine ' + bestSan + ' daha güçlü görünüyor. ' + (lossCp >= 8000 ? 'Değerlendirmede mat olasılığı var.' : 'Aradaki motor farkı yaklaşık ' + (lossCp / 100).toFixed(1) + ' piyon.') + ' Bu fark tek başına belirli bir stratejik hatayı kanıtlamaz.', advice:'İki hamleyi tahtada karşılaştır; rakibin cevabını, taş etkinliğini ve merkezdeki değişimi incele.' }
}

export function opponentInsights(findings: EngineFinding[]) {
  const errors = findings.filter(f => f.lossCp >= 100)
  const categories = [...new Set(errors.map(f => explainFinding(f).category))].map(category => {
    const examples = errors.filter(f => explainFinding(f).category === category)
    return { category, examples, games: new Set(examples.map(f => f.game.id)).size, advice: explainFinding(examples[0]).advice }
  }).sort((a,b) => b.examples.length-a.examples.length)
  const openings = [...new Set(findings.map(f => f.game.opening + '|' + f.move.color))].map(key => {
    const sample = findings.filter(f => f.game.opening + '|' + f.move.color === key)
    const mistakes = sample.filter(f=>f.lossCp>=100)
    return { name:sample[0].game.opening, color:sample[0].move.color, total:sample.length, mistakes:mistakes.length, games:new Set(sample.map(f=>f.game.id)).size, rate:Math.round(mistakes.length/sample.length*100) }
  }).sort((a,b)=>b.rate-a.rate || b.total-a.total)
  return { errors, categories, openings }
}

