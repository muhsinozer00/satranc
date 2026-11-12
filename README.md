# Hamle · Satranç Atölyesi

React ve TypeScript ile hazırlanmış, tek oyunculu satranç MVP'si. Beyaz taşlarla Stockfish destekli, oyuncu performansına göre oyun gücünü ayarlayan yerel bir rakibe karşı oynanır. Oyun sonunda hamle kalitesi ve antrenör notları gösterilir. Tahta üç renk temasına ve iki yönlendirmeye sahiptir.

## Çalıştırma

Node.js 20.19+ veya 22.12+ gerekir.

```bash
npm install
npm run dev
```

Bağımlılıklar kurulurken Stockfish'in lite, tek iş parçacıklı WebAssembly dosyaları `public/engine` klasörüne kopyalanır. Motor tarayıcıda açılmazsa oyun yerel rakiple devam eder; bu durumda motor tabanlı hamle değerlendirmesi devre dışı kalır.

Üretim paketi için `npm run build`, yerel önizleme için `npm run preview` komutlarını kullanın.

## Lisans notu

Satranç kuralları `chess.js` tarafından yönetilir. Stockfish.js ayrı bir tarayıcı işçisi olarak çalışır ve GNU GPL-3.0 lisanslıdır. Kurulum betiği motor dosyalarıyla birlikte lisans bilgisini de kopyalar. Uygulamayı dağıtırken Stockfish lisansının ve ilgili kaynak kodu yükümlülüklerinin karşılandığından emin olun. Uygulama kodu bu MVP için ayrıca lisanslanmamıştır.
