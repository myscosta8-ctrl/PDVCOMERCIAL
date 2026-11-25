import { useState } from 'react'
import { Botao, Campo, Lista, TelaSuspensa } from './ui.jsx'
import { dinheiro } from '../lib/formato.js'

// Bandeiras da tabela da NFC-e (tBand)
export const BANDEIRAS = [
  ['01', 'Visa'], ['02', 'Mastercard'], ['06', 'Elo'], ['07', 'Hipercard'], ['03', 'American Express'], ['05', 'Diners Club'],
  ['14', 'Discover'], ['18', 'JCB'], ['09', 'Cabal'], ['04', 'Sorocred'], ['08', 'Aura'], ['10', 'Alelo'], ['11', 'Banes Card'],
  ['12', 'CalCard'], ['13', 'Credz'], ['15', 'GoodCard'], ['16', 'GreenCard'], ['17', 'Hiper'], ['19', 'Mais'], ['20', 'MaxVan'],
  ['21', 'Policard'], ['22', 'RedeCompras'], ['23', 'Sodexo'], ['24', 'ValeCard'], ['25', 'Verocheque'], ['26', 'VR'], ['27', 'Ticket'],
  ['99', 'Outra'],
].map(([valor, texto]) => ({ valor, texto }))
export const nomeBandeira = (c) => BANDEIRAS.find((b) => b.valor === c)?.texto ?? ''

// Dados do comprovante da maquininha (pagamento não integrado): vão para a NFC-e
export function JanelaCartao({ forma, valor, credenciadora, onConfirmar, onFechar }) {
  const [bandeira, setBandeira] = useState('')
  const [autorizacao, setAutorizacao] = useState('')
  const [nsu, setNsu] = useState('')
  const limpar = (s, n) => s.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, n)
  const confirmar = (comDados) => onConfirmar(comDados
    ? { bandeira: bandeira || null, autorizacao: autorizacao || null, nsu: nsu || null, credenciadora_cnpj: credenciadora || null }
    : { credenciadora_cnpj: credenciadora || null })
  return (
    <TelaSuspensa aberta titulo={forma === 'credito' ? 'Cartão de crédito' : 'Cartão de débito'} subtitulo={`Passe ${dinheiro(valor)} na maquininha e copie os dados do comprovante`} onFechar={onFechar}
      rodape={<>
        <Botao variante="secundario" onClick={() => confirmar(false)}>Pular</Botao>
        <Botao variante="sucesso" icone="ok" onClick={() => confirmar(true)}>Confirmar pagamento</Botao>
      </>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo rotulo="Bandeira"><Lista valor={bandeira} opcoes={BANDEIRAS} onMudar={setBandeira} /></Campo>
        <Campo rotulo="Autorização" ajuda="Código AUT do comprovante"><input className="campo num" value={autorizacao} onChange={(e) => setAutorizacao(limpar(e.target.value, 20))} autoFocus /></Campo>
        <Campo rotulo="NSU" ajuda="Número da transação"><input className="campo num" inputMode="numeric" value={nsu} onChange={(e) => setNsu(limpar(e.target.value, 20))} /></Campo>
      </div>
      <p className="mt-3 text-sm text-tinta-400">Os dados ajudam a conferir as vendas com o extrato da credenciadora. Use Pular se o cliente já levou o comprovante.</p>
    </TelaSuspensa>
  )
}
