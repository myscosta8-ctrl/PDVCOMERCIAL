import JsBarcode from 'jsbarcode'
import { dinheiro } from './formato.js'

export const MODELOS_ETIQUETA = [
  { valor: 'gondola', texto: 'Etiqueta de gôndola (folha A4, 3 × 8)' },
  { valor: 'adesiva40x25', texto: 'Adesiva térmica 40 × 25 mm' },
  { valor: 'adesiva60x40', texto: 'Adesiva térmica 60 × 40 mm' },
]

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function codigoDeBarras(codigo, altura) {
  if (!codigo) return ''
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const formato = /^\d{13}$/.test(codigo) ? 'EAN13' : /^\d{8}$/.test(codigo) ? 'EAN8' : 'CODE128'
  try {
    JsBarcode(svg, codigo, { format: formato, height: altura, width: 1.4, fontSize: 11, margin: 0, displayValue: true })
  } catch {
    JsBarcode(svg, codigo, { format: 'CODE128', height: altura, width: 1.4, fontSize: 11, margin: 0 })
  }
  return svg.outerHTML
}

// itens: [{ descricao, preco, ean, codigo, unidade, quantidade }]
export function imprimirEtiquetas(itens, modelo, empresa) {
  const etiquetas = itens.flatMap((i) => Array.from({ length: Math.max(0, Number(i.quantidade) || 0) }, () => i))
  if (!etiquetas.length) return { erro: 'Informe a quantidade de etiquetas.' }
  const termica = modelo !== 'gondola'
  const [larg, alt] = modelo === 'adesiva40x25' ? [40, 25] : modelo === 'adesiva60x40' ? [60, 40] : [63.5, 33.9]
  const corpo = etiquetas.map((i) => `
    <div class="et">
      <div class="desc">${esc(i.descricao)}</div>
      <div class="preco">${dinheiro(i.preco)}${i.unidade && i.unidade !== 'UN' ? `<span class="un">/${esc(i.unidade)}</span>` : ''}</div>
      <div class="cb">${codigoDeBarras(i.ean || i.codigo, modelo === 'adesiva40x25' ? 22 : 30)}</div>
    </div>`).join('')
  const css = termica
    ? `@page { size: ${larg}mm ${alt}mm; margin: 0 } body { margin: 0 } .et { width: ${larg}mm; height: ${alt}mm; page-break-after: always; padding: 1.5mm; }`
    : `@page { size: A4; margin: 10mm 7mm } body { margin: 0 } .folha { display: grid; grid-template-columns: repeat(3, ${larg}mm); grid-auto-rows: ${alt}mm; gap: 0 2.5mm }
       .et { border: 0.2mm dashed #bbb; padding: 2mm; }`
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiquetas</title><style>
    * { box-sizing: border-box } body { font-family: Arial, sans-serif; color: #000 }
    ${css}
    .et { display: flex; flex-direction: column; overflow: hidden }
    .desc { font-size: ${modelo === 'adesiva40x25' ? 7 : 9}pt; line-height: 1.15; max-height: 2.4em; overflow: hidden }
    .preco { font-size: ${modelo === 'adesiva40x25' ? 13 : 18}pt; font-weight: bold; margin: 0.5mm 0 }
    .un { font-size: 8pt; font-weight: normal }
    .cb { margin-top: auto } .cb svg { max-width: 100%; height: auto }
    .loja { font-size: 6pt }
  </style></head><body>${termica ? corpo : `<div class="folha">${corpo}</div>`}
  <script>window.onload = () => window.print()</script></body></html>`
  const j = window.open('', '_blank', 'width=900,height=900')
  if (!j) return { erro: 'O navegador bloqueou a janela de impressão. Permita janelas para este site.' }
  j.document.write(html)
  j.document.close()
  return { quantidade: etiquetas.length, empresa: empresa?.nome_fantasia }
}
