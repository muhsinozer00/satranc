import { phaseSummary } from './opponentScan'
import type { EngineFinding } from './opponentAnalysis'
import { explainFinding, opponentInsights } from './opponentInsights'

export default function OpponentSummary({ findings, partial, onSelect }: { findings: EngineFinding[]; partial: boolean; onSelect: (finding: EngineFinding) => void }) {
  const { errors, categories, openings } = opponentInsights(findings)
  const games = new Set(findings.map(f=>f.game.id)).size
  return <section className="opponent-summary" aria-label="Rakibin anlaşılır özeti">
    <span className="opponent-step">RAKİBE KARŞI HAZIRLIK NOTUN</span>
    <h2>Bu oyunlar bize ne söylüyor?</h2>
    <p>{partial ? 'Tarama henüz tamamlanmadı. ' : ''}{games} oyunda incelenen {findings.length} hamlenin {errors.length} tanesinde belirgin hata görüldü. Burada “belirgin hata”, en güçlü seçeneğe göre en az 1 piyonluk motor farkıdır; tahtada mutlaka bir piyon kaybedildiği anlamına gelmez.</p>
    {categories.length ? <p><strong>En sık görülen konu: {categories[0].category.toLocaleLowerCase('tr-TR')}.</strong> Bu başlık {categories[0].games} farklı oyunda, {categories[0].examples.length} hamlede görüldü. {categories[0].games < 3 ? 'Bunu kalıcı bir zayıflık saymak için daha fazla oyun gerekli.' : 'Yüklenen örneklemde tekrar eden bir hazırlık konusu; diğer oyunlarda da kontrol et.'}</p> : <p>Bu örneklemde belirgin bir hata grubu bulunmadı. Daha küçük farkları aşağıdaki karar listesinden inceleyebilirsin; bu sonuç rakibin hatasız olduğunu göstermez.</p>}
    <div className="opponent-insight-grid">{categories.map(group=><article key={group.category}><h3>{group.category}</h3><strong>{group.examples.length} karar · {group.games} farklı oyun</strong><p>{group.advice}</p>{group.examples.slice(0,3).map(f=><button key={f.game.id+'-'+f.ply} type="button" onClick={()=>onSelect(f)}>Oyun #{f.game.id} · {f.move.before.split(' ')[5]}{f.move.color==='b'?'...':'.'} {f.move.san} — tahtada incele →</button>)}<details><summary>Bu çıkarımın dayanağı</summary><p>{explainFinding(group.examples[0]).explanation}</p></details></article>)}</div>
<h3>Maçın hangi bölümünde zorlanıyor?</h3><div className="opponent-opening-evidence">{phaseSummary(findings).map(row=><article key={row.name}><strong>{row.name}</strong><p>{row.total ? row.errors + " / " + row.total + " hamlede belirgin hata (%" + row.rate + ")" : "Henüz bu bölümden hamle incelenmedi."}</p></article>)}</div><p className="opponent-subcopy">Bölümler yaklaşık sınıflandırılır: taşlar azaldığında oyun sonu, diğer konumlarda ilk 12 tam hamle açılış kabul edilir. Açılış adıyla gruplanan aşağıdaki oranlar o açılışla başlayan oyunların taranan tüm bölümlerini kapsar.</p>
    <h3>Hangi açılışlarda daha çok hata görüldü?</h3>
    <p>Hamle sayılarını da karşılaştır: daha fazla oynanan bir açılışta toplam hata sayısının fazla olması doğal olabilir. Yüzdeler yalnızca taranan hamleler içindir.</p>
    <div className="opponent-opening-evidence">{openings.map(row=><article key={row.name+row.color}><strong>{row.name} · {row.color==='w'?'Beyaz':'Siyah'}</strong><p>{row.games} oyun · {row.total} incelenen hamle · {row.mistakes} belirgin hata (%{row.rate})</p><small>{row.games<3?'Az örnek: bu açılışta zayıf olduğu sonucuna varma.':'Bu açılıştaki hata örneklerini hazırlık listene al.'}</small></article>)}</div>
    <p className="opponent-subcopy">Hazırlık önerisi: önce sık oynadığı açılışları çalış; sonra yukarıdaki somut hata konumlarında rakibin en güçlü savunmasını da hesapla. Aynı hatayı tekrar yapacağına güvenerek oynama.</p>
  </section>
}

