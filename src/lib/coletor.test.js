import { describe, expect, it } from 'vitest'
import { lerArquivoColetor } from '../pages/Estoque.jsx'

describe('arquivo do coletor', () => {
  it('aceita separadores comuns, quantidade decimal e linhas só com o código', () => {
    const txt = 'codigo;quantidade\r\n7891234567890;12\n7890000000011,3,5\n7890000000028\t2\n7890000000035 4\n7890000000042\n\n'
    expect(lerArquivoColetor(txt)).toEqual([
      { codigo: '7891234567890', quantidade: 12 },
      { codigo: '7890000000011', quantidade: 3.5 },
      { codigo: '7890000000028', quantidade: 2 },
      { codigo: '7890000000035', quantidade: 4 },
      { codigo: '7890000000042', quantidade: 1 },
    ])
  })
})
