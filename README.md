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
- [ ] Fase 2 — Módulos por segmento, impressão térmica, PIX integrado, relatórios e painel do revendedor

## Testes

```
npm test
```
