import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { lerCsv, lerXlsx } from './planilha.js'
import { interpretarCmed, lerValor } from './cmed.js'

describe('tabela CMED', () => {
  it('lê o XLSX, acha o cabeçalho e as colunas de PMC', async () => {
    const buf = new Uint8Array(readFileSync(new URL('./__fixtures__/cmed_ficticia.xlsx', import.meta.url)))
    const linhas = await lerXlsx(buf)
    const t = interpretarCmed(linhas)
    expect(t.colunas).toEqual(['PMC 0%', 'PMC 19%'])
    const r = t.registros('PMC 19%')
    expect(r).toHaveLength(3)
    expect(r[0]).toMatchObject({ ean: '7896000000011', produto: 'LOSARTANA & CIA', pmc: 17.92, pf: 12.96, registro: '1234567890123', tarja: 'Tarja Vermelha' })
    expect(r.find((x) => x.ean === '7896000000035')).toMatchObject({ pmc: 8.73, pf: 6.3 })
  })
  it('lê o CSV com ponto e vírgula e aspas', () => {
    const linhas = lerCsv('EAN 1;PRODUTO;PMC 18 %\r\n"7896000000011";"A; B";"1.234,50"\r\n')
    expect(linhas[1]).toEqual(['7896000000011', 'A; B', '1.234,50'])
    expect(interpretarCmed(linhas).registros('PMC 18 %')[0].pmc).toBe(1234.5)
  })
  it('converte valores', () => {
    expect(lerValor('-')).toBeNull()
    expect(lerValor('12,3')).toBe(12.3)
    expect(lerValor(7)).toBe(7)
  })
})
