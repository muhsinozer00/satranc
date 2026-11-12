import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const engineFolder = join(projectRoot, 'node_modules', 'stockfish', 'bin')
const destination = join(projectRoot, 'public', 'engine')

if (!existsSync(engineFolder)) {
  throw new Error('Stockfish kurulamadı. Bağımlılıkları yeniden yükleyip tekrar deneyin.')
}

const javascriptFile = readdirSync(engineFolder).find((file) => /^stockfish-\d+-lite-single\.js$/.test(file))
if (!javascriptFile) {
  throw new Error('Stockfish lite single-thread dosyası bulunamadı.')
}

const wasmFile = javascriptFile.replace(/\.js$/, '.wasm')
if (!existsSync(join(engineFolder, wasmFile))) {
  throw new Error(`Stockfish WebAssembly dosyası bulunamadı: ${wasmFile}`)
}

mkdirSync(destination, { recursive: true })
copyFileSync(join(engineFolder, javascriptFile), join(destination, 'stockfish.js'))
copyFileSync(join(engineFolder, wasmFile), join(destination, 'stockfish.wasm'))
const packageFolder = join(projectRoot, 'node_modules', 'stockfish')
const licenseSource = ['Copying.txt', 'LICENSE', 'LICENSE.txt']
  .map((file) => join(packageFolder, file))
  .find(existsSync)
if (licenseSource) {
  copyFileSync(licenseSource, join(destination, 'LICENSE.txt'))
} else {
  writeFileSync(join(destination, 'LICENSE.txt'), 'Stockfish.js is distributed under GNU GPL version 3.0. License text: https://www.gnu.org/licenses/gpl-3.0.txt\n')
}
console.log('Stockfish tarayıcı motoru public/engine klasörüne kopyalandı.')
