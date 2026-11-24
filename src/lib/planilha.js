// Leitura de planilhas sem biblioteca externa: XLSX (zip + XML, descompactado pelo próprio navegador) e CSV.
// Devolve as linhas como listas de textos.

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const desescapar = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTIDADES[e] ?? m)))

async function inflar(bytes) {
  const fluxo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(fluxo).arrayBuffer())
}

// Lê o diretório central do zip e devolve uma função que extrai um arquivo pelo nome
function abrirZip(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let fim = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { fim = i; break }
  if (fim < 0) throw new Error('Arquivo XLSX inválido.')
  const total = v.getUint16(fim + 10, true)
  let p = v.getUint32(fim + 16, true)
  const entradas = new Map()
  const dec = new TextDecoder()
  for (let k = 0; k < total; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) break
    const metodo = v.getUint16(p + 10, true)
    const tamanho = v.getUint32(p + 20, true)
    const nLen = v.getUint16(p + 28, true), xLen = v.getUint16(p + 30, true), cLen = v.getUint16(p + 32, true)
    const local = v.getUint32(p + 42, true)
    entradas.set(dec.decode(buf.subarray(p + 46, p + 46 + nLen)), { metodo, tamanho, local })
    p += 46 + nLen + xLen + cLen
  }
  return async (nome) => {
    const e = entradas.get(nome)
    if (!e) return null
    const ini = e.local + 30 + v.getUint16(e.local + 26, true) + v.getUint16(e.local + 28, true)
    const dados = buf.subarray(ini, ini + e.tamanho)
    const bytes = e.metodo === 8 ? await inflar(dados) : dados
    return new TextDecoder().decode(bytes)
  }
}

const colunaDe = (ref) => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1 }

export async function lerXlsx(buf) {
  const ler = abrirZip(buf)
  const compart = await ler('xl/sharedStrings.xml')
  const textos = []
  if (compart) {
    for (const m of compart.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      textos.push(desescapar([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')))
    }
  }
  // Primeira aba da pasta de trabalho
  const pasta = await ler('xl/workbook.xml')
  const rels = await ler('xl/_rels/workbook.xml.rels')
  let caminho = 'xl/worksheets/sheet1.xml'
  const rid = pasta?.match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1]
  const alvo = rid ? (rels?.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1]
    ?? rels?.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`))?.[1]) : null
  if (alvo) caminho = alvo.startsWith('/') ? alvo.slice(1) : `xl/${alvo.replace(/^\.\//, '')}`
  const folha = await ler(caminho)
  if (!folha) throw new Error('Planilha vazia ou em formato não suportado.')
  const linhas = []
  for (const r of folha.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const linha = []
    for (const c of (r[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1]
      const tipo = attrs.match(/\bt="(\w+)"/)?.[1]
      const corpo = c[2] ?? ''
      let val = ''
      if (tipo === 'inlineStr') val = desescapar([...corpo.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''))
      else {
        const v = corpo.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? ''
        val = tipo === 's' ? (textos[Number(v)] ?? '') : desescapar(v)
      }
      linha[ref ? colunaDe(ref) : linha.length] = val
    }
    linhas.push(Array.from(linha, (x) => x ?? ''))
  }
  return linhas
}

export function lerCsv(texto) {
  const primeira = texto.split(/\r?\n/).find((l) => l.trim()) ?? ''
  const sep = [';', '\t', ','].sort((a, b) => primeira.split(b).length - primeira.split(a).length)[0]
  const linhas = []
  let linha = [], campo = '', aspas = false
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]
    if (aspas) {
      if (ch === '"' && texto[i + 1] === '"') { campo += '"'; i++ } else if (ch === '"') aspas = false
      else campo += ch
    } else if (ch === '"') aspas = true
    else if (ch === sep) { linha.push(campo); campo = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++
      linha.push(campo); linhas.push(linha); linha = []; campo = ''
    } else campo += ch
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha) }
  return linhas
}

// Decide pelo conteúdo: XLSX começa com "PK"; o resto é texto (UTF-8 ou Windows-1252)
export async function lerPlanilha(arquivo) {
  const buf = new Uint8Array(await arquivo.arrayBuffer())
  if (buf[0] === 0x50 && buf[1] === 0x4b) return lerXlsx(buf)
  if (buf[0] === 0xd0 && buf[1] === 0xcf) throw new Error('Formato XLS antigo: abra no Excel ou LibreOffice e salve como XLSX ou CSV.')
  let texto = new TextDecoder('utf-8').decode(buf)
  if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(buf)
  return lerCsv(texto.replace(/^﻿/, ''))
}
