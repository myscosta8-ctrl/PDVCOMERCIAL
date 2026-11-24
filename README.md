# PDV Comercial

Sistema de frente de caixa multiempresa, para qualquer segmento (varejo, farmácia, mercado, restaurante, vestuário, materiais de construção, serviços).

**Tecnologia:** React 18 + Vite + Tailwind (PWA) · Supabase (PostgreSQL, Auth, Edge Functions) · GitHub Pages.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `src/pages` | Telas: Frente de caixa, Caixa, Produtos, Vendas |
| `src/components/ui.jsx` | Padrão visual (botões, tela suspensa, lista de escolha, avisos) |
| `src/lib` | Conexão, carrinho, formatação e caixa |
| `supabase/migrations` | Estrutura do banco |
| `supabase/functions/nfce` | Emissão de NFC-e (Edge Function) |
| `supabase/tests` | Testes de banco e da assinatura da NFC-e (rodam só localmente) |

## Regras de segurança do banco

- Toda tabela tem `empresa_id`; cada empresa enxerga apenas os próprios dados (RLS).
- `empresa_id` é preenchido pelo banco a partir do usuário logado e não pode ser trocado.
- Vendas, caixa e estoque só são gravados por funções (`finalizar_venda`, `abrir_caixa`, `fechar_caixa`, `movimentar_caixa`, `cancelar_venda`, `lancar_estoque`), que validam tudo numa única transação.
- Não existe exclusão: cancelamento muda a situação e estorna o estoque, com registro na auditoria.
- Perfis: **administrador**, **gerente** e **operador**. Operador não altera preço, não cancela venda e não mexe em cadastro.

## Roteiro

- [x] Fase 1A — Banco multiempresa, frente de caixa, caixa (abertura, sangria, suprimento, fechamento), produtos, estoque e vendas
- [x] Fase 1B — Emissão de NFC-e: certificado A1 e CSC no cofre (Vault), XML 4.00 assinado, envio à SEFAZ (SVRS) pela Edge Function `nfce`, QR Code e DANFE NFC-e 80 mm
- [ ] Fase 1B.2 — Cancelamento de NFC-e (evento), inutilização de numeração e contingência off-line
- [x] Itens 1 a 4 — Devolução e troca (vale-troca), orçamento e pedido, clientes, convênios, crediário com aviso de atraso e recebimento de contas no caixa
- [x] Grupo A — Entrada de mercadoria pelo XML da NF-e, lote e validade na venda (FEFO), kits, etiquetas e formação de preço
- [x] Grupo B — Tabelas de preço, promoções (preço, percentual por produto ou categoria, atacado por quantidade) e grade de tamanho e cor
- [x] Grupo C — Financeiro: contas a pagar e a receber (parcelas, recorrência, leitura de boleto, baixa parcial com juros e desconto), contas geradas pelas notas de compra, fluxo de caixa realizado e previsto, plano de contas, centros de custo e DRE mensal
- [x] Grupo D — Inventário com coletor (leitor, arquivo do coletor, contagem cega para o operador, ajuste por lote) e transferência entre filiais com conferência no recebimento
- [x] Financeiro complementar — visão geral com saldo por conta, caixa livre, projeção do mês, teto de gastos, meta de retirada, despesas em 6 meses, lançamento "já pago", alerta de duplicidade e sugestão pelo histórico
- [x] Fiscal independente de terceiros — regras de tributação por NCM (ICMS, PIS e COFINS, com campos do IBS e da CBS guardados), fotografia fiscal da venda, NFC-e com CST 00/20 e PIS/COFINS, SPED Fiscal (EFD ICMS/IPI leiaute 020) e tabela CMED com conferência do PMC
- [x] Controlados (controle interno) — lista da Portaria 344 por produto, receita obrigatória na venda com validade e dados do comprador e do prescritor, livro de registro e balanço; PIX com QR Code fixo e leitura de etiqueta de balança
- [x] Impressão em bobina 58/80 mm (comprovante não fiscal, crediário com assinatura, sangria, suprimento, fechamento e recebimento), leitura de boleto pela câmera e alertas de vencimento (contas, lotes e certificado)
- [ ] Fase 2 — Módulos por segmento, impressão térmica, PIX integrado, relatórios e painel do revendedor

## Testes

```
npm test
```
