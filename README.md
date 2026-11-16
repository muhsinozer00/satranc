# Hamle · Satranç Atölyesi

React ve TypeScript ile çalışan, tarayıcı tabanlı satranç çalışma uygulaması. Oyun kuralları chess.js, motor değerlendirmeleri Stockfish ile yürütülür. Hesap veya sunucu tarafında oyun motoru gerekmez.

## Özellikler

- Beyaz taşlarla uyarlanabilir rakibe karşı oyun; rakip hamlesi için en az 3,5 saniye bekleme.
- Tıklama, fareyle sürükleme ve dokunmatik sürükleme; terfi seçimi; tahta çevirme ve boyut ayarı.
- Altı tahta teması, üç taş seti ve tarayıcıda üretilen sesler.
- Maç sonu tahmini doğruluk puanı, hamle bazında motor farkı ve öneri; ok tuşlarıyla geçmişte gezinme; PGN kopyalama.
- 40.578 Lichess bulmacası: seviyeye göre seçim, ilk denemede başarı istatistiği ve tarayıcıda ilerleme kaydı.
- 26 açılış hattı: plan açıklamaları, adım adım öğrenme, beyaz/siyah uygulama, ipucu ve tamamlanma takibi.
- Rakip hazırlığı: çoklu PGN dosyası veya metni, oyuncu ve renk seçimi, açılış/sonuç dağılımı, varyasyon grupları, motor taraması ve indirilebilir rapor.
- Telefon, tablet ve masaüstüne uyarlanan düzen.

## Çalıştırma

Node.js 20.19+ veya 22.12+ ve pnpm kullanın:

```sh
pnpm install
pnpm dev --host 0.0.0.0 --port 5173 --strictPort
```

Tarayıcıda http://localhost:5173 adresini açın. Yerel sunucu çalıştığı sürece sayfa erişilebilir.

Kurulum, Stockfish'in lite ve tek iş parçacıklı WebAssembly dosyalarını public/engine klasörüne kopyalar. Motor açılamazsa oyun basit yerel rakiple devam eder; güvenilir motor skoru olmayan hamleler değerlendirilmiş gibi gösterilmez.

```sh
pnpm test
pnpm build
pnpm preview
```

Üretim çıktısı dist klasöründedir; statik dosya sunabilen bir hosting hizmetinde çalışır. Alan adını bağlamak ve HTTPS'i etkinleştirmek hosting tarafında yapılır. GitHub'a kod göndermek tek başına internet sitesini yayımlamaz; otomatik yayın için ayrıca bir dağıtım bağlantısı gerekir.

## Analizin kapsamı

Rakip hazırlığı tek yüklemede toplam 2 MB ve ilk 200 PGN oyununu kabul eder. Bozuk ve yinelenen kayıtları ayırır. Oyun dosyaları sunucuya gönderilmez; bu ekrandan ayrılınca yüklenen arşiv temizlenir. Rapor indirilebilir.

Motor taraması seçilen listenin ilk 5 oyununda oyuncunun ilk 12 hamlesini derinlik 10 ile inceler; iptal edildiğinde tamamlanan sonuçları korur. Tekrar eden hata, farklı oyunlarda aynı konumda aynı hamlenin en az 1 piyon motor kaybı göstermesidir. Oyun sonları, bütün stratejik örüntüler ve rakibin gelecekteki tercihleri hakkında kesin sonuç üretmez.

Açılış adları yerel hamle sırası sözlüğünden bulunur. Tüm ECO varyasyonları ve farklı hamle sıralarıyla ulaşılan aynı konumlar henüz kapsanmaz. Maç doğruluğu ve oyuncu seviyesi uygulamanın tahminidir; resmi Elo veya Chess.com'un doğruluk formülü değildir.

## Kontroller

scripts/check-regressions.mjs; açılışların yasallığını, oyun geçmişi/üçlü tekrar/PGN dışa aktarmayı, PGN koleksiyonlarını, oyuncu-renk ayrımını ve motorun iptal/zaman aşımı/eksik skor durumlarını kontrol eder.

## Lisans notu

Stockfish ayrı bir tarayıcı işçisi olarak çalışır ve GNU GPL-3.0 lisanslıdır. Kurulum betiği motorla birlikte lisans bilgisini kopyalar. Dağıtımda motorun lisans ve ilgili kaynak kodu yükümlülükleri korunmalıdır. Lichess bulmaca verileri CC0 kaynağından gelir. Kullanılan varlıkların kaynak ve lisans bilgileri projedeki mevcut bildirimlerde tutulur. Uygulama kodu ayrıca lisanslanmamıştır.
