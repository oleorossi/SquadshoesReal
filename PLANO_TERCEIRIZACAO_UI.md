# Plano — terceirização por SETOR × ITEM na tela do pedido

> **Quem executou:** o plano foi escrito pro Codex, mas as duas runs de
> `codex exec` (01/08/2026) morreram com `502 Bad Gateway` no upstream do
> `avellogateway.online`, sem produzir nenhum arquivo — e retornando exit code 0
> nas duas. A implementação foi feita direto, contra esta especificação, por
> decisão do dono. O documento fica versionado pra a comparação
> especificado × executado continuar auditável.

Implemente EXATAMENTE o que está aqui. Não refatore nada fora do escopo, não
crie arquivo novo além dos listados, não mexa em impressão/OS existente.

## Contexto (já pronto, NÃO refazer)

A migration `20261030120000` **já está aplicada em produção**. O contrato de
banco existe e funciona:

- `sale_order_items.outsourced_sectors jsonb NOT NULL DEFAULT '{}'` —
  mapa `{ "<setor>": "<contractor_id uuid>" }`. Mapa vazio = item 100% interno.
- Trigger `tg_orders_generate_outsourcing_os` (AFTER INSERT em `orders`): quando
  a OP nasce, gera 1 OS por setor marcado no item de origem. **Nada a fazer no
  front pra isso acontecer.**
- RPC `send_item_sector_os(p_order_id uuid, p_sector text, p_contractor_id uuid)`
  → `jsonb` com `{action: 'created'|'exists'|'reactivated'|'skipped', os_id}`.
- RPC `get_pv_op_sector_os_status(p_sale_order_id uuid)` → linhas
  `{order_id, op_number, ref_code, color, quantity, sector, os_id, os_number,
    os_status, contractor_id, contractor_name}`.
- Um trigger valida a forma: chave de setor tem que estar na lista canônica e o
  valor tem que ser uuid, senão o save do item ESTOURA com exceção. Respeite.

Setores canônicos (exatamente estas chaves):
`corte_cabedal, corte_forracao, corte_palmilha, silk, costura, mesa, colagem,
montagem, solagem, acabamento`

Rótulos em pt-BR: Corte Cabedal, Corte Forração, Corte Palmilha, Silk, Costura,
Aviamento (`mesa`), Colagem, Montagem, Solagem, Acabamento.

## Escopo — 4 arquivos

### 1. `src/hooks/useSaleOrders.ts`

**a)** Em `SaleOrderItemFormData` (linha ~482) adicione, com comentário no mesmo
tom dos vizinhos:

```ts
/** Terceirização por SETOR deste item: { setor: contractor_id }. Mapa vazio =
 *  tudo interno. É só INTENÇÃO — a OS nasce quando a OP é criada
 *  (tg_orders_generate_outsourcing_os). ⚠ Nenhum dos 2 RPCs atômicos lista
 *  esta coluna: gravada por UPDATE direcionado pós-RPC, igual strap_sourcing. */
outsourced_sectors?: Record<string, string> | null;
```

**b)** `useCreateSaleOrder`: o `itemPayload` (linha ~637) faz destructuring pra
TIRAR os campos que o RPC não aceita. Tire `outsourced_sectors` junto:
`items.map(({ selected_terceirizacao_ids: _sel, terceirizacao_quantities: _tq, outsourced_sectors: _os, ...item }) => ...)`.
Se não tirar, o `create_sale_order_atomic` recebe coluna que não conhece.

**c)** `useCreateSaleOrder`: no MESMO bloco guardado que grava
`selected_terceirizacao_ids` (linha ~666-689), grave também
`outsourced_sectors` quando o mapa não estiver vazio. Pode ser no mesmo laço:
monte o objeto de update condicionalmente e só chame o `.update()` se tiver algo
pra gravar. Mantenha o `try/catch` que apenas avisa no console — falha aqui não
pode quebrar a criação do PV.

**d)** `useUpdateSaleOrder`: mesma coisa no bloco equivalente (linha ~2060).
Atenção: ali os itens são apagados e reinseridos, então re-grava por índice.
**Importante:** na edição, mapa VAZIO também tem que ser gravado (o usuário pode
ter desmarcado todos os setores) — diferente do create, onde vazio é o default.

### 2. `src/pages/SaleOrderForm.tsx`

- `INITIAL_ITEM` (linha ~64): adicione `outsourced_sectors: {}`.
- No mapeamento que carrega os itens do PV pra editar (linha ~110): adicione
  `outsourced_sectors: ((i as any).outsourced_sectors as Record<string,string>) ?? {}`.

### 3. `src/components/sale-orders/SaleOrderItemForm.tsx`

Seção nova no card do item, **no fim**, depois do que já existe. Título no mesmo
padrão das outras seções do arquivo.

Comportamento:
- Uma linha de chips, um por setor canônico, ordem da lista acima.
- Chip apagado = interno. Chip aceso = sai pra fora.
- Clicar num chip apagado ACENDE e revela um seletor de prestador pra aquele
  setor. Enquanto não escolher prestador, o chip fica em estado "pendente"
  (visualmente distinto de aceso-com-prestador) e o setor **não** entra no mapa.
- Só entra em `outsourced_sectors` o par setor→prestador COMPLETO. Nunca grave
  chave com valor vazio: o trigger do banco rejeita e o save do PV estoura.
- Clicar num chip aceso apaga e remove a chave do mapa.
- Grava via `onUpdate(index, 'outsourced_sectors', novoMapa)`.
- Prestadores: hook `useContractors` (`@/hooks/useContractors`), só ativos
  (campo é `active`, **não** `is_active`). Mostre `trade_name || name`.
- Se não houver prestador cadastrado, mostre um aviso curto em vez de um seletor
  vazio, e não deixe acender o chip.
- Resumo curto embaixo: "2 setores pra fora · Costura → PATRÍCIA, Solagem → SEU NEGO".

### 4. `src/pages/SaleOrderForm.tsx` — botão "Enviar pra prestador"

Só quando `isEdit && id`. Abre um dialog que:
- lê `get_pv_op_sector_os_status(id)` via `supabase.rpc`;
- agrupa por OP (`op_number`, `ref_code`, `color`, `quantity`);
- por linha OP × setor mostra: já tem OS (nº + status, sem botão) ou não tem
  (seletor de prestador + botão "Enviar");
- "Enviar" chama `send_item_sector_os(order_id, sector, contractor_id)`,
  `toast.success` no `created`/`reactivated`, `toast.info` no `exists`,
  e invalida `['service_orders']` + a query da própria lista;
- estado vazio quando o PV ainda não tem OP: explique que a OS nasce quando o
  pedido entra em produção, e que basta marcar os setores nos itens.

Este dialog pode ser componente novo em
`src/components/sale-orders/SendSectorToContractorDialog.tsx`.

## Regras do projeto — NÃO violar

1. **Ícones:** `@phosphor-icons/react`. **Nunca** `lucide-react` (não é
   dependência — vira ReferenceError em produção).
2. **Cores:** só design tokens (`bg-card`, `text-muted-foreground`,
   `border-border`, `bg-primary`…). **Nada** de `bg-white`, `text-gray-*`,
   `bg-slate-*`. Status color pode `bg-verde-500/10 text-verde-600`.
   Rode `bun run check:tokens` no fim — não pode ter violação NOVA.
3. **Idioma:** domínio e UI em pt-BR; nome de hook e React Query key em inglês.
4. **Forms:** `useState` controlado (padrão do arquivo), NÃO react-hook-form.
5. **Toast:** `sonner` (`import { toast } from 'sonner'`).
6. **Altura:** `h-7` em ações densas de linha, `h-9` em toolbar de página.
7. **Mobile:** tem que funcionar em 360px — chips quebram linha, não estouram.
8. **Toque:** alvo mínimo confortável; chip com altura ~28px e padding lateral.
9. Sem Prettier no projeto — siga o estilo do arquivo vizinho.

## Verificação obrigatória antes de terminar

```
bunx tsc -p tsconfig.app.json --noEmit     # tem que sair 0 erros
bun run check:tokens                        # sem violação NOVA
```

⚠ `bunx tsc --noEmit` na raiz NÃO checa nada (solution file). Use `-p tsconfig.app.json`.

Não commite. Deixe as mudanças na árvore de trabalho.

## Fora de escopo — não toque

- Qualquer coisa de impressão (`printServiceOrderReceipt.ts` e chamadores).
- A migration / SQL (já aplicada).
- Remover o picker de setor do PV, o `GenerateServiceOrdersWizard` ou a
  maquinaria de envio parcial — a limpeza é um passo separado, revisado à parte.
