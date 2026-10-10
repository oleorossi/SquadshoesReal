# Ateliê v2 — corte antecipado em lote, sem OP, motor único

> Spec fechada com o dono em 10/10/2026, a partir da auditoria do Ateliê
> (`atelie-cabedal-complexo.md` + `20270101031700`). **Supersede** naquela spec
> e em `sequencia-producao.md` tudo o que contradisser este documento —
> em especial a regra "corte interno na OP antes do Ateliê" da unificação de
> 06/10/2026.

## Goal

Referência complexa, cadastrada no Ateliê, é **preparada antes da OP**:
PV aprovado → kit por **referência × cor** (juntando vários PVs num lote, com
grade) → **corte na fábrica numa fila própria do Ateliê** → envio ao prestador
com **OS de verdade** → retorno → só então a OP nasce, com os setores feitos na
rua já concluídos e **sem debitar o mesmo material duas vezes**. Um único motor:
o que hoje duplica essa intenção é desligado.

## Problemas que esta spec fecha (auditoria 10/10/2026)

| # | Problema | Evidência |
|---|---|---|
| P1 | **Deadlock**: job só sai de `awaiting_cut` com OP + Corte Cabedal concluído; OP só nasce após `received_at_factory` | `atelier_cut_gate_released` (`31700`) × `sale_order_item_factory_gate_block_reason` (`31100`) |
| P2 | Gate de fábrica bloqueia qualquer ref no cadastro, mesmo quando o item não gera job → bloqueio eterno "sem job" | I704 cadastrada em Costura sem cabedal na ficha |
| P3 | Soft reserva **pares** como quantidade de qualquer material (metros, dm², tira) e, sem cor, até 5 SKUs do grupo | `atelier_soft_reserve_for_job` |
| P4 | Débito usa necessidade do **PV inteiro**, `LEAST` sem pendência, e o gatilho anti-2× impede a OP de completar o que faltou | `atelier_confirm_job_debit` + `tg_block_op_reserve_if_atelier_debited` |
| P5 | Cadastro após aprovação não gera nada; Reaplicar só olha `Aprovado`; falha do motor engolida (`EXCEPTION WHEN OTHERS → ok:false`) | `materialize_cabedal_prep_demands`, `process_cabedal_prep_purchase_shortages` |
| P6 | Sem grade, sem lote, sem cartão da rua; "Enviado" não cria OS (sem remessa, custódia, retorno, contas a pagar) | `atelier_mark_job_sent` |
| P7 | Motores duplicados ativos: tela de distribuição pós-aprovação (alocações que o Ateliê ignora), OS de corte no Consumo, OS por OP × setor, Hub de Tiras no aviamento, aba Terceirizados da ficha | auditoria de sobreposição |

## Decisões (dono, 10/10/2026)

| # | Decisão |
|---|---|
| D1 | Corte de referência do Ateliê é **na fábrica, numa fila própria do Ateliê, antes de gerar OP** |
| D2 | O kit/lote **junta a mesma referência × cor (× variante de material) de vários PVs** |
| D3 | I704 passa para **Aviamento** (sai de Costura) |
| D4 | BT01 e BT02 (`reference_terceirizacoes`) **migram para o Ateliê**; a aba Terceirizados da ficha deixa de ser porta de envio |
| D5 | OS de corte de cabedal no Consumo do PV fica **escondida só para referências do Ateliê** (demais refs mantêm) |
| D6 | **Sem prestador padrão** no cadastro: escolhe a cada envio. O cadastro guarda só o **valor por par de referência** (R$ 2,50 de BT01/BT02), que a OS herda e o usuário pode alterar |

## Modelo

```
atelier_complex_references          (existe) + value_per_pair numeric, material_components text[]
cabedal_prep_demands                (existe) 1 por item do PV — inalterado
atelier_lots                        (NOVA)  ref × cor × variante, grade somada, nº de lote
cabedal_prep_jobs                   (existe) 1 por item × setor de rua; + lot_id
cabedal_prep_stock_debits           (existe) ledger anti-2×; débito por ITEM, com pendência
service_orders                      (existe) OS por lote × setor × prestador
```

### Pipeline do job (substitui o de 31700 — hoje há 0 jobs, sem migração de dado)

```
awaiting_cut ──(corte do LOTE confirmado: débito do kit)──► cut
cut ──(envio: cria OS + remessa)──► sent_to_contractor
sent_to_contractor ──(retorno da OS)──► received_at_factory
qualquer aberto ──► cancelled
```

- Setor que não depende de corte (ex.: aviamento de ref sem cabedal, I704)
  nasce direto em `cut` (rótulo "Pronto p/ envio"), após o débito do kit do lote.
- `awaiting_debit` / `debited` deixam de existir (CHECK novo).

## Requisitos

### R1 — Cadastro (validação + D3/D4/D6)
1. Cadastro só aceita setor que a ficha **realmente** tem:
   Costura exige material de cabedal e não `corte a fio`; Aviamento exige
   `aviamento_steps` ou `has_straps`. Recusa com mensagem que diz o que falta
   na ficha. Função SQL única `atelier_sheet_supports_sector(ref, sector)`
   usada pelo writer **e** pela tela.
2. Colunas `value_per_pair` (opcional) e `material_components` (o que vai no
   kit; default Costura = `{Cabedal, Forração}`, Aviamento = `{Componente Direto, BOM}`).
3. Migração de dado: I704 → Aviamento (desativa Costura); BT01/BT02 → Costura
   com `value_per_pair = 2.50` e `material_components` herdados de
   `reference_terceirizacoes`; as linhas de `reference_terceirizacoes` ficam
   `active = false` (não apaga).

### R2 — Elegibilidade (P2, P5)
4. Uma função única decide "item exige rua": `atelier_item_street_sectors(item)`
   = setores do cadastro **∩** setores que a ficha suporta (R1.1). Usada pelo
   materializador, pelo gate de fábrica e pela tela.
5. Gate de fábrica (`sale_order_item_factory_gate_block_reason`) bloqueia só se
   `atelier_item_street_sectors(item)` não for vazio **e** algum job desses
   setores não estiver `received_at_factory`. Ref no cadastro sem setor
   aplicável → **não bloqueia**.
6. Materialização roda em PV `Aprovado` **e** em `Em Produção` para itens
   **sem OP**. Reaplicar cobre os dois status.
7. `process_cabedal_prep_purchase_shortages` deixa de engolir erro do
   materializador: a falha sobe para o outbox (que já registra e re-tenta).

### R3 — Lote (D1, D2)
8. Ao criar job, ele entra no lote **aberto** de mesma
   `(reference_id, color normalizada, material_variant_id)`; não existindo,
   cria. Lote cortado fecha; job novo abre lote novo.
9. Grade do lote = soma de `grade × fichas` dos itens membros (convenção de
   `sale_order_items.grade`: Σ = pares por ficha). Pares = Σ `quantity`.
10. Nº de lote sequencial legível (`LOTE-00001`).
11. Item removido/cancelado sai do lote se o lote ainda não foi cortado; se já
    foi, bloqueia com mensagem (estorno explícito, regra existente).

### R4 — Estoque (P3, P4)
12. Necessidade **por item** = `calculate_order_consumption_by_grade(ref, grade,
    cor, variante)` × `fichas`, filtrada pelos `component` em
    `material_components` do cadastro. Fonte única para soft, débito e telas.
    Tiras (`sale_order_strap_demands`) **não** entram — continuam no Hub de Tiras.
13. Soft na materialização com essa quantidade (adota `pv_commitment` como hoje).
14. Confirmar corte do lote debita, por item membro, `LEAST(disponível, necessidade)`,
    grava `stock_movements` + ledger; o que faltar vira linha de ledger
    `pending_qty > 0` (**pendência visível**, nunca silêncio).
15. Anti-2× passa a ser por **(item do PV, produto)**, não por (PV, produto):
    a OP de um item **fora** do Ateliê que usa o mesmo SKU reserva normalmente.
    Pendência do ledger é **reservada pela OP** quando ela nascer (a OP completa
    o que faltou).

### R5 — Envio, OS e retorno (P6, D6)
16. "Enviar" escolhe prestador e cria **uma OS por lote × setor × prestador**
    em `service_orders` (setor `Costura Cabedal`/`Aviamento`, pares, valor por
    par do cadastro editável, `selected_sale_order_item_ids` = itens do lote,
    `linked_sale_order_ids`). Jobs ganham `service_order_id`.
17. Remessa/retorno usam o fluxo existente de OS (`service_order_dispatches`
    / retorno). Retorno da OS marca os jobs `received_at_factory`.
18. Cartão da rua por lote: cliente(s), PVs, ref, cor, grade, nº lote, nº OS,
    `k/N`. Impressão explícita (regras de print: inline + Anton + `#000`/`#C00000`).

### R6 — Liberação da OP (P1)
19. Com todos os jobs do item `received_at_factory`, o item fica elegível na
    Sequência/Fila de Corte normal (gate R2.5).
20. Ao nascer a OP, as etapas dos setores feitos pelo Ateliê
    (`Corte Cabedal` quando houve corte no lote; `Costura Cabedal`/`Aviamento`
    conforme jobs) nascem **`concluido`** com `quantity_total`.
21. `atelier_cut_gate_released`, `atelier_unlock_jobs_after_cut` e o gatilho
    `trg_atelier_unlock_on_order_stage` são **removidos** (o corte não depende
    mais da OP).

### R7 — Desligar duplicados (P7)
22. `PostApprovalCabedalDistributeScreen` deixa de abrir na aprovação.
23. `UpperCutOutsourcingSection` não oferece OS de corte para item de ref do Ateliê (D5).
24. `generate_op_service_orders` / `tg_orders_generate_outsourcing_os` pulam
    setores já feitos pelo Ateliê para aquele item.
25. `sector_settings.start_offset_days` com CHECK = 0 para `Costura Cabedal` e
    `Aviamento` (Antecipação não volta por dado).
26. Código morto removido: `CabedalPrepPanel`, `ProducaoAntecipacao`,
    `earlyReleaseBoard/Export`, `PvGeneratedServiceOrdersCard`,
    `generate_cabedal_prep_service_orders` (DROP), hooks de alocação sem uso.

### R8 — Tela `/atelie`
27. Fila = **lotes**, colunas: Aguardando corte · Pronto p/ envio · No prestador · Recebido.
    Card do lote: ref, cor, grade somada, pares, PVs/clientes, menor prazo de
    billing, materiais com falta (vermelho/verde), ação da coluna.
28. Cadastro mostra o motivo de recusa (R1.1) e o valor por par.

## Fases

| Fase | Conteúdo | Sai quando |
|---|---|---|
| **1 — Destravar e estoque seguro** | R1, R2, R3, R4, R6, R7.25 (backend) + fila mínima por lote com "Confirmar corte" | Ref do Ateliê vai de PV aprovado até OP liberada sem deadlock, com débito por item e pendência |
| **2 — OS, retorno e cartão** | R5, R8 completos | Envio cria OS, retorno libera, cartão imprime |
| **3 — Limpeza** | R7.22–24, R7.26 | Nenhum outro caminho manda ref do Ateliê pra rua |

## Fora do escopo
- Inventar dm² / mudar regras de consumo; perda de corte (não existe).
- Redesenho do Hub de Tiras ou do fluxo geral de OS.
- Reconciliar histórico.

## Definition of Done
- [ ] Contratos (vitest) nos pontos load-bearing: sem deadlock (gate × pipeline),
      gate não bloqueia ref sem setor aplicável, débito por item com pendência,
      anti-2× por item, OS criada no envio, etapas da OP nascem concluídas.
- [ ] `bunx tsc -p tsconfig.app.json --noEmit`, `bun run lint`, `bun run test`, `bun run check:tokens`.
- [ ] Teste de ponta a ponta no banco (transação com ROLLBACK): PV com I704 + BT01
      aprovado → lote → corte → envio/OS → retorno → promote cria OP com etapas concluídas.
- [ ] Verificação em produção (regra 7 do CLAUDE.md).
