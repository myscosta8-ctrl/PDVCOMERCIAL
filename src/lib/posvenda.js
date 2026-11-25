import { supabase } from './supabase.js'
import { chamarNfce, imprimirDanfe } from './nfce.js'
import { configImpressao, imprimirComprovanteVenda } from './impressao.js'

// Depois de concluir uma venda fora da frente de caixa (ex.: fechamento de comanda): emite a NFC-e quando a
// configuração fiscal está pronta e imprime o que a configuração de impressão pede. Mesmas regras da frente de caixa.
export async function emitirEImprimir(vendaId, avisar) {
  const { data: emp } = await supabase.from('empresas').select('certificado_titular, nfce_csc_id, impressao').single()
  const imp = configImpressao(emp)
  const crediario = imp.automatica && (await supabase.from('contas_receber').select('id').eq('venda_id', vendaId).eq('origem', 'crediario').limit(1)).data?.length > 0
  const comprovante = async () => { const x = await imprimirComprovanteVenda(vendaId); if (x.erro) avisar(x.erro, 'erro') }
  if (!emp?.certificado_titular || !emp?.nfce_csc_id) {
    if (crediario || (imp.automatica && imp.comprovante)) await comprovante()
    return { nfce: null }
  }
  const n = await chamarNfce({ acao: 'emitir', venda_id: vendaId })
  if (n.erro) {
    avisar(n.erro, 'erro')
    if (crediario || (imp.automatica && imp.comprovante)) await comprovante()
    return { nfce: 'erro' }
  }
  if (n.dados.status === 'contingencia') avisar(`SEFAZ sem resposta: NFC-e nº ${n.dados.numero} emitida em contingência. Entregue a via do consumidor; a nota é transmitida sozinha depois.`, 'erro')
  window.dispatchEvent(new Event('nfce:atualizar'))
  if (imp.automatica) { const x = await imprimirDanfe(vendaId); if (x.erro) avisar(x.erro, 'erro') }
  if (crediario) await comprovante()
  return { nfce: n.dados.status, numero: n.dados.numero }
}
