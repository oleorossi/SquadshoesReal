# Ficha Palmilha unificada (Fibra + Forração)

## Goal

Unificar a experiência de corte de palmilha: um domínio **Palmilha** no lugar de “Corte de Placa de Fibra” + “Corte Forração”, com ficha A4 fundida (placa em cima, forração embaixo), coluna Kanban agregada com dois checks, e rename em todo o sistema — sem perder o rastreio separado fibra/forro nem a regra Soft≠Madrid.

## Background / Problem

Hoje são **dois maços** e **dois passos de fábrica**:

| Camada | Fibra (placa) | Forração (napa) |
|---|---|---|
| Print | `PalmilhaWorkSheet` — agrupa **só por solado** | `SilkMontageWorkSheet` — solado → cor cabedal + napa |
| Setor interno | `Corte Palmilha` / fluxo `Corte Fibra` | `Corte Forração` |
| Kanban | Coluna própria (paralela ao grupo `corte`) | Coluna própria |

O dono quer **agregar** a fibra na mesma ficha da forração, segmentada por cor como a forração, sob o nome **Palmilha**.

## Decisions (grill 26/09/2026 — confirmado)

| # | Decisão |
|---|---|
| Q1+Q18+Q19 | Três botões de impressão **mutuamente exclusivos**: Palmilha \| Só Fibra \| Só Forração |
| Q2+Q5 | Cor do card = **cor do cabedal** (a mesma vermelha da Forração hoje) |
| Q3 | Chave material da fibra = **grupo da placa** (não SKU fino) |
| Q4 | Rename **em tudo** (print, Kanban, roteiro, labels) |
| Q6+Q17 | **Uma coluna visual** “Palmilha”; por baixo dois passos `Palmilha · Fibra` e `Palmilha · Forração` |
| Q7 | Capa externa continua por **solado** |
| Q8+Q10 | **Mesmo card** fundido: barra PLACAS → grade → bloco FORRAÇÃO → tally |
| Q9+Q14 | Até **2 checks** no card Kanban; lado N/A **não aparece** |
| Q11+Q15 | Cards **completo** vs **Só Fibra** / **Só Forração** (título distinto) |
| Q12 | Capacidade: **duas linhas** no cadastro; Kanban só agrega |
| Q13 | Backfill **só etapas abertas**; finalizadas intactas |
| Q16 | Mesmo cabedal + napas diferentes (Soft vs Madrid) → **não funde** |
| Q20 | Só Fibra/Forração reutilizam o **mesmo** sistema de card (não layout legado) |
| Q21 | Dois chips: **placa** + **napa** |
| Q22 | Header dinâmico: `PALMILHA` / `PALMILHA · SÓ FIBRA` / `PALMILHA · SÓ FORRAÇÃO` |

## Scope

### In scope

1. Ficha A4 unificada + seletor de 3 modos exclusivos em `/imprimir-fichas`.
2. Agrupamento: solado → (cor cabedal + grupo placa + grupo napa).
3. Rename de display/canônico: `Corte Fibra` → `Palmilha · Fibra`, `Corte Forração` → `Palmilha · Forração` (aliases legados permanecem).
4. Kanban: coluna visual `Palmilha` agregando os dois passos; checks parciais.
5. Migration SQL: `canonical_stage_name` + backfill de `order_stages` / `production_sectors` **abertos**.
6. Roteiros canônicos em `ConstructionConfigPanel` + testes de contrato.

### Out of scope

- Inventar tempo/capacidade única (soma) — mantém duas linhas.
- Backfill de OPs `Finalizado`.
- Fundir Soft+Madrid no mesmo card.
- Redesign tipográfico fora do vernáculo Anton/Fira/preto+#C00000 das fichas.
- Mudar o motor de consumo (só a apresentação na ficha).

## Print model

### Modos (`printMode`)

```
'palmilha' | 'so_fibra' | 'so_forracao'   // mutuamente exclusivos
```

### Chave do card

```
soleKey :: colorCabedal(upper) :: plateMaterialGroup :: liningMaterialGroup :: lotPartition
```

- Soft ≠ Madrid ⇒ `liningMaterialGroup` diferente ⇒ cards distintos.
- Refs distintas com a mesma chave ⇒ fundem (fichas/grades somadas).

### Tipos de card

| Tipo | Quando | Título no card |
|---|---|---|
| Completo | Precisa placa **e** forro | (sem sufixo / “Completo” implícito no header do maço) |
| Só Fibra | Precisa placa, não forro | `Só Fibra` |
| Só Forração | Precisa forro, não placa | `Só Forração` |

Elegibilidade espelha a de hoje:

- Fibra: roteiro tem passo fibra **e** não é 100% palmilha pronta na cor.
- Forração: `requiresLiningCut` (insole_has_lining ∧ ¬readyMade) **e** roteiro tem passo forração.

### Layout do card (vertical)

1. Identidade: cor (Anton `#C00000`) · chip placa · chip napa · refs · pares  
2. Linha fina Pedido/OP/cliente do card (não TraceStrip no hero — PV/cliente
   do maço já estão no `HeaderIdentification`)  
3. Barra preta **Cortar placas** — só quando `qty > 0` ou área faltando; some
   se Só Forração ou zero placas  
4. Grade compartilhada (Ficha / Total / Cortado)  
5. Bloco **Forração** (metros) — some se Só Fibra  
6. Tally único  

Paginação A.3 (igual Corte Cabedal / Aviamento): cada cor emite **2
`SheetBlock`s** — trabalho (1–4) + fechamento (5–6) com `keepWithPrev` — pra
2 cores caberem na mesma A4 quando o maço permitir. Sem perder linha.

### Header do maço

- `PALMILHA` | `PALMILHA · SÓ FIBRA` | `PALMILHA · SÓ FORRAÇÃO`
- `flowSector` no trilho: passo agregado visual `Palmilha` (ou o subpasso no modo Só *).
- Contagem de OPs no Resumo mono; `GroupSubHeader` do solado leva as OPs.

## Kanban / roteiro

| Camada | Valor |
|---|---|
| Coluna visual | `Palmilha` |
| Etapas internas | `Palmilha · Fibra`, `Palmilha · Forração` |
| Aliases legados | `Corte Fibra`, `Corte Palmilha`, `Corte Forração` |
| Parallel group | Ambos no grupo `corte` (com Corte Cabedal) |
| Avanço da coluna | Todos os checks **visíveis** concluídos |
| Check N/A | Não renderiza |

## Migration

1. Estender `canonical_stage_name` / `canonical_stage_order` com os novos nomes + aliases.
2. `UPDATE order_stages` abertas: renomear grafias antigas → novas.
3. `UPDATE technical_sheets.production_sectors` (arrays) para as grafias novas.
4. `sector_settings` / capacidade: renomear labels, **manter duas linhas**.
5. **Não** tocar OPs com status terminal `Finalizado` (etapas históricas).

Carimbo: maior que `max(arquivo, schema_migrations)` no momento da aplicação.

## Files (principais)

| Área | Arquivos |
|---|---|
| Spec | `specs/ficha-palmilha-unificada.md` |
| Print build | `PrintWorkSheetsPage.tsx` (`mergePalmilhaWithinSole`, seletor) |
| Print render | Novo ou evolução de `PalmilhaWorkSheet.tsx` + trechos de `SilkMontageWorkSheet.tsx` |
| Fluxo | `src/lib/sectors.ts`, `stageFlow.ts`, `ConstructionConfigPanel.tsx` |
| Kanban | `kanbanDerive.ts`, `pointingPlan.ts`, UI da coluna |
| SQL | `supabase/migrations/*_palmilha_setor_unificado.sql` |
| Testes | merge Soft≠Madrid; modos exclusivos; card parcial; aliases |

## Definition of done

1. Em `/imprimir-fichas`, três botões exclusivos; maço Palmilha mostra placa acima e forro abaixo no mesmo card por cor+materiais.
2. OFF WHITE Soft e OFF WHITE Madrid no mesmo PV → **dois cards**.
3. Kanban mostra coluna Palmilha; checks só para o que se aplica; capacidade ainda em duas linhas.
4. Roteiros novos gravam `Palmilha · Fibra` / `Palmilha · Forração`; OPs abertas migradas; finalizadas intactas.
5. Typecheck `tsconfig.app.json` limpo; contratos vitest verdes.
6. Verificação em https://squadshoes-real.vercel.app após deploy em `main` (fluxo imprimir + kanban).

## Non-goals / traps

- Não reintroduzir agrupamento Fibra só-por-solado no modo Palmilha.
- Não usar `GREATEST(width,length)` nem perda de corte.
- Não fundir as duas capacidades numa só “por coerência”.
- Print: sem primitives shadcn; sem alpha tokens.
