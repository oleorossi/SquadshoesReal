# Cartão físico por corrugado

## Goal

Dar à fábrica um **cartão físico por corrugado cheio** que acompanha a peça/palmilha/fardo na saída dos setores emissores, com identidade operacional legível na bancada — separado da ficha A4 do posto.

## Background / Problem

Hoje existem três papéis confusos:

1. **Ficha de operador (A4)** — instrução do posto (maço por setor). Continua.
2. **Cartão de lote (`CartaoLote`)** — modo “Cartões” em `/imprimir-fichas`: descreve o **lote do posto**, não o pacote que viaja. O lote muda de forma a cada etapa (medido no PV-00148).
3. **`CartaoOP`** — desenhado para viajar com a OP entre postos, mas **órfão** (nenhuma tela o usa).

Na indústria calçadista, o papel que **viaja grudado no material** é outro: sai com o fardo físico. Sem ele, palmilha/peça cortada e semi-acabado se perdem ou se misturam entre OPs.

## Scope

### In scope

- Novo modo de impressão **“Cartão físico”** em `/imprimir-fichas` (substitui o modo “Cartões” / `CartaoLote` nesses setores).
- Emissão de **1 cartão por corrugado cheio (12 / 15 / 18 pares)** por **OP**.
- Setores **emissores**: Corte Fibra (Corte Palmilha), Corte Forração, Corte Cabedal, Costura Cabedal, Aviamento, Montagem.
- Conteúdo mínimo: setor de **origem** · OP · PV · identidade do item (ref/cor/material conforme o setor) · grade do corrugado · total de pares · nº do corrugado (`k/N` dentro da OP naquele setor).
- Formato físico reaproveitando o envelope do cartão atual (~99×51 mm, A4 paisagem, vários por folha), só texto/grade — sem QR/barcode nesta v1.
- Na seleção do modo Cartão físico, **só aparecem os 6 emissores**.

### Out of scope (explicitly not now)

- Destino impresso no cartão (fica implícito no chão).
- QR, barcode ou apontamento por scan.
- Impressão disparada pelo apontamento do setor.
- Setores **não emissores**: Costura Palmilha, Silk, Colagem, Solagem, Acabamento, Expedição, Relatório Gerencial.
- Religar ou redesenhar o `CartaoOP` A5.
- Manter o `CartaoLote` de posto em paralelo (é **substituído** pelo Cartão físico).
- Rodada estética das fichas A4 / redesign tipográfico além do necessário para o cartão.
- Decisão E1/E2/E3 da Expedição.
- Persistência de “cartão emitido” no banco / rastreio digital do handoff.

## Requirements

1. No fluxo `/imprimir-fichas`, o toggle/atalho de cartões chama-se **“Cartão físico”** (não “Cartões” / “Cartões de lote”).
2. Com Cartão físico ativo, a UI de setores lista **apenas** os emissores: Corte Fibra, Corte Forração, Corte Cabedal, Costura Cabedal, Aviamento, Montagem.
3. Para cada OP selecionável e cada setor emissor marcado, o sistema resolve o corrugado via a mesma regra canônica de ficha (`resolveFicha` / 12·15·18).
4. Emite **somente corrugados cheios**. Sobra (ex.: 26 pares → 2×12 + 2) **não** gera cartão; a sobra continua visível só na ficha A4.
5. **1 cartão = 1 corrugado de 1 OP.** OPs distintas nunca compartilham o mesmo cartão, mesmo com a mesma ref+cor.
6. Modelos/materiais distintos **não** se misturam no mesmo cartão (o cartão espelha o item físico, não o agrupamento da ficha A4 de Forração).
7. Cada cartão imprime: origem · OP · PV · identidade (ref/cor/napa/solado conforme o setor) · grade daquele corrugado · total de pares · `k/N` (N = nº de corrugados cheios daquela OP naquele setor).
8. **Não** imprime setor de destino.
9. **Não** imprime QR nem código de barras nesta v1.
10. Corte Fibra (placa) usa a **mesma** unidade: 1 cartão por corrugado de pares cheio.
11. O modo ficha A4 permanece independente; Cartão físico é o outro modo de visualização/impressão.
12. O modo antigo baseado em `CartaoLote` (lote de posto) deixa de ser a saída do botão de cartões — substituído por esta regra.

## Data model / Domain

Sem migration obrigatória nesta v1 (documento de impressão derivado de dados já existentes).

| Conceito | Fonte |
|---|---|
| OP | `orders` (+ vínculo `sale_order_item_id`) |
| PV | `sale_orders` via item |
| Grade / quantidade | grade da OP / item; total = pares da OP |
| Corrugado (12/15/18) + curva base | `resolveFicha(totalPairs, grid)` (`worksheet/fichaSize`) |
| Setor de origem | setor marcado na impressão (nome canônico de ficha) |
| Identidade por setor | mesma cascata já usada nas fichas (ex.: napa no Forração, solado no Corte Fibra, ref+cor na Montagem) |
| Roteiro da OP | `technical_sheets.production_sectors` / stages — **não** usado para imprimir destino nesta v1 |

Estados: nenhum estado novo de “cartão emitido”. Reimpressão = gerar de novo a partir dos mesmos inputs.

## User flows

### Happy path

1. Usuário abre a seleção de impressão de fichas e escolhe OPs/PVs.
2. Clica **“Cartão físico”** (atalho ou toggle na tela de impressão).
3. Vê só os 6 setores emissores; marca os desejados (ex.: Corte Forração + Montagem).
4. A prévia mostra N cartões pequenos: um por corrugado cheio de cada OP×setor.
5. Imprime (mesmas regras de saída invertida / PDF já usadas nas fichas).
6. No chão, cada corrugado físico leva o seu cartão na saída do setor emissor até o próximo posto (até Solagem no fluxo global; destino não escrito no papel).

### Alternate / edge flows

- OP com menos de 1 corrugado cheio no setor → **0 cartões** para essa OP; não bloqueia as demais.
- Usuário no modo ficha A4 → comportamento atual das fichas; setores não emissores continuam disponíveis.
- OP sem o setor no roteiro → não entra no maço daquele setor (mesma regra `orderInRoteiro` / elegibilidade já usada nas fichas).
- Reimpressão → mesmo fluxo; sem controle de “já emitido”.

## Edge cases & failure modes

| Caso | Comportamento |
|---|---|
| Sobra de pares após corrugados cheios | Sem cartão para a sobra; ficha A4 mostra o total completo |
| Duas OPs mesma ref+cor | Cartões separados por OP; numeração `k/N` **por OP** |
| Forração A4 agrupa várias refs na mesma napa | Cartão físico **não** herda essa fusão: um cartão por OP (e portanto por item físico) |
| Corte Fibra (placa) | Ainda assim 1 cartão / corrugado de pares cheio |
| Costura Palmilha / Silk / Colagem | Não aparecem no modo Cartão físico; não emitem |
| Solagem | Não emite (é o fim útil da cadeia viajante); não aparece no modo |
| Grades mistas / `exact=false` em `resolveFicha` | Só conta `floor` de corrugados cheios do tamanho resolvido; sem cartão parcial |
| Dados de PV/OP incompletos | Mesmo gate das fichas (não imprimir maço estruturalmente errado); cartão sem OP/PV inválido não deve sair |

## Constraints & assumptions

- Stack e print: inline styles + cores hardcoded nas peças de print; A4 paisagem para o maço de cartões; sem shadcn nos cartões; fontes Fira/Anton do app.
- Unidade canônica de corrugado: a de `resolveFicha` / ficha de operador (12/15/18) — não inventar outro tamanho.
- **Assunção (default):** formato físico ≈ cartão atual (~99 mm de largura, vários por folha A4 paisagem), trocando a regra de conteúdo/agrupamento.
- **Assunção:** numeração `k/N` é por (OP × setor de origem), ordem estável pela grade/resolveFicha.
- **Assunção:** “até Solagem” descreve o alcance útil no chão; o papel **não** traz destino; Montagem é o último emissor.
- Não tocar motores de consumo, débito, Kanban ou etiquetas térmicas nesta spec.
- Previews de decisão (opção 1 vs 2) ficaram em artefato de sessão; não são requisito de produto.

## Open questions

- Nenhum bloqueante para v1. Pendências conscientes deixadas fora: se Costura Palmilha deve **reutilizar** o cartão do Corte Fibra no fardo (só processo de chão) e se uma v2 liga QR/apontamento.

## Definition of Done

- [ ] Requirement 1 — na UI de `/imprimir-fichas` o controle chama-se **“Cartão físico”** (atalho de entrada e/ou toggle).
- [ ] Requirement 2 — com o modo ativo, chips/lista de setores mostram só os 6 emissores (verificar que Silk/Colagem/Costura Palmilha/Solagem/Acabamento/Expedição **não** aparecem).
- [ ] Requirement 3–4 — OP de 26 pares / corrugado 12 gera **2** cartões (não 3); conferir na prévia e no print.
- [ ] Requirement 5–6 — duas OPs mesma ref+cor geram cartões com OP distinta em cada papel; nenhum cartão lista duas OPs.
- [ ] Requirement 7–9 — cartão impresso traz origem, OP, PV, identidade, grade, total, `k/N`; **sem** destino; **sem** QR/barcode.
- [ ] Requirement 10 — setor Corte Fibra (rótulo Corte de Placa de Fibra) emite cartões por corrugado de pares, não por “lote de solado” agregado.
- [ ] Requirement 11 — toggle de volta para fichas A4 restaura o comportamento atual (setores completos + worksheets).
- [ ] Requirement 12 — saída do modo cartão **não** usa mais o agrupamento de lote de posto do `CartaoLote` (várias refs fundidas no Forração); usa a regra por OP×corrugado.
- [ ] Teste unitário (ou contract) cobre: contagem de cartões = `floor(pares / corrugado)` por OP; sobra ignorada; emissores allow-list.
- [ ] `bunx tsc -p tsconfig.app.json --noEmit` limpo no diff da implementação.
