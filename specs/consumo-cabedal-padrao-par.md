# Padrão de consumo de cabedal: canônico por PAR + ficha de Aviamento por pé

## Goal
Eliminar a ambiguidade "por pé × por par" no consumo de cabedal da ficha técnica,
fixando **par** como a unidade canônica em todo o sistema, e fazer a **ficha de
Aviamento** exibir a medida das **tiras** por **pé** (÷2) para o operário. Serve ao
PCP/engenharia (padronização do custeio/compras) e ao chão de fábrica (medida por
peça na ponta).

## Background / Problem
Hoje o consumo de cabedal é gravado em `technical_sheets.upper_consumption` (escalar)
e `technical_sheets.upper_consumption_per_size` (JSONB por numeração), e **todo o
motor** (modal "Consumo de Material" do PV, `calculate_order_cost`, MRP, compras) o
interpreta como **por par**. Mas o editor não deixa claro que é por par, então algumas
referências foram preenchidas com o valor **por pé** (a medida de 1 cabedal) e outras
com o valor **por par** (2 peças). As fichas preenchidas por pé estão gravando
**metade** do consumo real → subcusteiam ~2×.

Auditoria dos dados reais (47 fichas, 20 com material de cabedal) confirmou que o
problema é misto e sujo: valores em unidades diferentes por material (dm²/par ≈ 22 vs
m/par ≈ 0,5), placeholders copiados (`2,1746` em 4 fichas, `22,83` em 2), lixo
(`ELÁSTICO SARJA` = `2000`), e vazios. Não há coluna de molde/DXF/área em
`technical_sheets` para servir de verdade absoluta — então **não dá para separar por
regra numérica cega** um preenchimento por pé de um por par. Como são poucas fichas
(~16 preenchidas), a normalização é feita em massa **assistida** (usuário marca, sistema
aplica).

Separadamente, a **ficha de Aviamento** (`SilkMontageWorkSheet.tsx`, setor `'Aviamento'`)
mostra as **tiras** em `cm/par` (pedido do dono em 2026-06-23). O usuário agora quer que
essa ficha específica mostre por **pé** (÷2), porque o operário do Aviamento trabalha
peça a peça.

## Scope

### In scope
1. **Canônico = por par** em todo o sistema (armazenamento, modal de consumo do PV,
   custeio, MRP, compras). Nenhum motor muda — eles já leem por par.
2. **Editor da ficha técnica (Cabedal) permanece por par**, com rótulo inconfundível
   ("POR PAR") e um auxílio ao vivo "= X por pé" ao lado da média/inputs, para impedir
   nova deriva. *(Isto revoga a escolha inicial "por pé igual Tiras": o editor NÃO passa
   a ser por pé.)*
3. **Correção dos dados existentes** via relatório **bulk assistido** em
   `/system-diagnostics` (aba **Consumo**): lista as fichas com material de cabedal,
   mostra a leitura por par e por pé (÷2), a unidade e uma **suspeita** de "por pé"
   (dica, não automática). O usuário **marca** as que devem dobrar e **aplica ×2** (dobra
   o escalar e **cada chave** do JSONB por numeração das fichas selecionadas).
4. **Ficha de Aviamento por pé (÷2)**: as linhas de **TIRA** na ficha de Aviamento
   passam a exibir `cm/pé` (÷2 do valor gravado por par). Ajustar a legenda de "cm do
   par" para "cm do pé". Reverte o pedido de 2026-06-23 **apenas nessa ficha**.

### Out of scope (explicitly not now)
- **Não** adicionar consumo de cabedal (napa) à ficha de Aviamento — modelos de cabedal
  continuam sem consumo de material nessa ficha (só o checklist Frente/Traseira).
- **Não** mexer nas fichas de **Corte Cabedal** e **Corte Forração** — continuam por par.
- **Não** aplicar por pé em **Forração / Palmilha / Fachete** — continuam dm²/par por
  numeração, vindas do solado.
- **Não** resolver o problema separado de **dm²↔metro (~100×)** por largura de ficha
  faltando — é outro assunto (avisos `widthMissing` já existentes). O relatório pode
  mostrar a unidade, mas não converte dm²↔m.
- **Não** limpar automaticamente lixo/placeholder (ex.: `2000`, `2,1746` repetido). O
  relatório os **sinaliza**; a correção desses casos é manual, ficha a ficha.

## Requirements
Numeradas, testáveis, cada uma é um "must".

1. O armazenamento canônico do consumo de cabedal é **por par**: `upper_consumption` e
   todas as chaves de `upper_consumption_per_size` representam o consumo do **par**.
   Nenhuma função SQL de motor (`calculate_order_cost`, `calculate_order_consumption*`,
   MRP, compras) é alterada.
2. O editor de Cabedal em `TechnicalSheets.tsx` (seção "Especificações por Componente →
   Cabedal", grid "CONSUMO DE CABEDAL POR NUMERAÇÃO") mantém entrada/exibição **por
   par**, com:
   - rótulo explícito de que é **por PAR** (não por pé);
   - um readout ao vivo "= `<valor/2>` por pé" junto da média (e, idealmente, uma dica
     por célula), como referência anti-erro.
3. Existe um relatório em `/system-diagnostics` → aba **Consumo** listando **toda**
   ficha com material de cabedal (`has_straps = false` e `upper_material` preenchido, ou
   `upper_consumption > 0`), exibindo por ficha: nome, material, unidade, valor
   armazenado (**por par**), equivalente **por pé** (÷2) e um selo de **suspeita**
   (heurística, ver Data model). Nada é aplicado automaticamente; nada vem pré-marcado.
4. No relatório, o usuário seleciona linhas e aciona **"Aplicar ×2"**. A ação **dobra**
   o `upper_consumption` **e cada chave** de `upper_consumption_per_size` (inclusive
   numerações conjugadas como `"33/34"`) das fichas selecionadas, de forma atômica por
   ficha, com confirmação antes de aplicar e `toast` de sucesso/erro. Após aplicar, a
   lista recarrega (invalida a query de `technical_sheets`).
5. A ficha de **Aviamento** (`SilkMontageWorkSheet.tsx`, `sector === 'Aviamento'`) exibe
   as linhas de **TIRA** por **pé**: o valor mostrado em cada numeração/faixa é
   `valor_armazenado_por_par ÷ 2`, arredondado a 1 casa. A legenda muda de
   `... cm "do par" ...` para `... cm "do pé" ...`.
6. A mudança de exibição da ficha de Aviamento é **somente visual** — não altera
   `strap_colors[].consumption_per_size` (que continua gravado por par).
7. O typecheck canônico passa: `bunx tsc -p tsconfig.app.json --noEmit`.

## Data model / Domain

**Tabela `technical_sheets`** (consumo de cabedal — por par):
- `upper_consumption numeric` — média/escalar por par.
- `upper_consumption_per_size jsonb` — `{ "<numeração>": <valor por par> }`; chaves
  podem ser conjugadas (`"33/34"`, `"39/40"`).
- `upper_material text` — nome do grupo de material do cabedal.
- `has_straps boolean` — quando `true`, o modelo é de tiras e **não** tem cabedal
  (mutex; o editor limpa `upper_*`). Fichas com `has_straps = true` **saem** do relatório.

**Tiras (ficha de Aviamento)**:
- `technical_sheets.strap_colors` (JSONB array); cada tira tem `consumption_per_size`
  (JSONB, **por par**) e um `consumption` médio. O editor de tiras já digita por pé e
  grava por par (×2). A ficha de Aviamento hoje **mostra por par**; passa a **÷2**.

**Heurística de "suspeita de por pé" (dica do relatório, não autoritativa):**
- Agrupar as fichas por `upper_material`. Dentro do grupo, marcar como *suspeita* a ficha
  cujo valor por par seja **≈ 50%** (com tolerância, ex.: 40–60%) do **maior/mediano**
  valor por par dos pares do mesmo material.
- Sinalizar à parte (badge neutro) os casos **não-decidíveis por regra**: valor `0`
  (vazio), valor absurdo (ex.: `≥ 100`, tipicamente lixo/placeholder), e materiais que
  não são de cabedal (nome casa `/tira|elast|strass/i`).
- A dica **nunca** pré-marca a linha; só orienta o olho do usuário. A decisão é manual.

**Migração implicada:** recomendado um RPC `double_upper_consumption(p_sheet_ids uuid[])`
(em `supabase/migrations/`) que, por ficha, faz `upper_consumption := upper_consumption *
2` e reescreve o JSONB com cada valor `* 2` (preservando as chaves). Aplicar via
Supabase MCP. Alternativa aceitável: UPDATE client-side por ficha (RLS de admin), desde
que dobre escalar **e** todas as chaves do JSONB atomicamente por ficha.

## User flows

### Happy path A — padronizar fichas existentes
1. Gestor abre `/system-diagnostics` → aba **Consumo** → painel "Padrão de consumo de
   cabedal (par × pé)".
2. Vê a lista das ~16 fichas com material de cabedal: material, unidade, valor por par,
   equivalente por pé, selo de suspeita.
3. Marca as fichas que foram preenchidas por pé (usando as dicas + conhecimento do
   produto).
4. Clica **"Aplicar ×2"** → confirma no diálogo → os valores dobram (escalar + por
   numeração) → `toast` de sucesso → lista recarrega; as linhas corrigidas deixam de
   aparecer como suspeitas.
5. (Consequência esperada) o custo dessas fichas sobe ~2× — agora correto. PVs antigos
   com custo **congelado** (snapshot) precisam ser recalculados/reabertos para refletir.

### Happy path B — cadastrar/editar ficha nova
1. Gestor abre a ficha técnica → seção Cabedal → grid "CONSUMO DE CABEDAL POR NUMERAÇÃO
   (POR PAR)".
2. Vê o rótulo inequívoco "POR PAR" e o readout "= X por pé" ao lado da média.
3. Digita o consumo **do par** por numeração → grava por par → sem deriva.

### Happy path C — imprimir ficha de Aviamento
1. Gestor imprime a ficha de Aviamento de um modelo de tira.
2. As linhas TIRA aparecem em `cm/pé` (metade do valor por par), com a legenda "cm do
   pé".

## Edge cases & failure modes
- **Aplicar ×2 duas vezes** na mesma ficha → dobra de novo (a ação não é
  auto-idempotente; é seleção manual). Mitigação: nada vem pré-marcado; após aplicar, o
  valor novo aparece e a dica de "suspeita" some (deixa de ser ~metade dos pares). O
  diálogo de confirmação avisa que a ação dobra os selecionados.
- **JSONB vazio + escalar > 0** → dobra só o escalar.
- **Numerações conjugadas** (`"33/34"`) no JSONB → dobrar essas chaves também.
- **Unidades misturadas** (dm²/par vs m/par) → o ×2 é **independente de unidade** (um
  preenchimento por pé em dm² também é metade do por par em dm²). O relatório mostra a
  unidade só para contexto; não converte.
- **Lixo/placeholder** (`2000`, `2,1746` repetido, `0`) → sinalizados, **não** entram no
  ×2 automático; correção manual na ficha.
- **Modelo de tiras** (`has_straps = true`) → excluído do relatório de cabedal.
- **Ficha de Aviamento — arredondamento** do ÷2 → 1 casa decimal, consistente com o
  formato atual (`fmtConsumoQty`). Vale para os três caminhos de origem do valor da tira:
  `cmBySize[s]`, `cmBands[].cm` e `cm` (média).
- **Assimetria entre fichas de operador** (Corte Cabedal/Forração por par vs Aviamento
  por pé) → **aceita e intencional**; documentar na legenda de cada ficha para não
  confundir.

## Constraints & assumptions
- **Stack/convenções:** React Query + Supabase; mutação = `useMutation` + invalidar
  `['technical-sheets']` (ou a key usada em `useTechnicalSheets`) + `toast` (`sonner`).
  Ícones `@phosphor-icons/react`. Componentes shadcn nas telas de app.
- **`SilkMontageWorkSheet.tsx` é ficha de impressão (isenta de design tokens):** manter
  o padrão de **inline styles com cores hardcoded** (`#000`, `#C00000`) — **não**
  introduzir tokens/primitives shadcn nessa ficha.
- **Design tokens** valem para o painel novo de diagnóstico (sem `bg-white`/`text-gray-*`
  hardcoded); rodar `npm run check:tokens` após edits visuais.
- **Typecheck real:** `bunx tsc -p tsconfig.app.json --noEmit` (a raiz não checa nada).
- **Migração** (se via RPC) em `supabase/migrations/`, aplicada via Supabase MCP no
  projeto `ssvxfoybzmjlypnipqzn`.
- **Assumções registradas (usuário deixou em aberto → default escolhido):**
  - Relatório mora na aba **Consumo** de `/system-diagnostics` (junto dos demais
    `*_consistency_report`).
  - Heurística de suspeita = comparação relativa aos pares do mesmo material (50% ±
    tolerância) + flags de vazio/lixo; sempre sobrescrevível manualmente.
  - Guard anti-deriva = rótulo "POR PAR" + readout "= X/pé"; um aviso âmbar por célula
    (valor < 50% dos pares) é desejável mas opcional (nice-to-have).
  - A correção usa RPC `double_upper_consumption`; client-side é alternativa aceitável.

## Open questions
- Nenhuma bloqueante. (Opcional: se o dono quiser, o aviso âmbar por célula no editor
  pode virar requisito duro numa v2.)

## Definition of Done
- [ ] **R1** — Motores inalterados: `git diff` não toca `calculate_order_cost` /
  `calculate_order_consumption*` / MRP / compras; consumo por par continua igual no
  modal "Consumo de Material" de um PV de controle.
- [ ] **R2** — Abrir a ficha técnica de um modelo de cabedal: o grid de consumo mostra
  "POR PAR" e um readout "= X por pé"; digitar por par grava por par (conferir via
  `upper_consumption_per_size` no banco).
- [ ] **R3** — Em `/system-diagnostics` → Consumo, o painel lista as fichas com material
  de cabedal com valor por par, equivalente por pé, unidade e selo de suspeita; nada
  pré-marcado.
- [ ] **R4** — Selecionar 1 ficha sabidamente por pé e clicar "Aplicar ×2": no banco,
  `upper_consumption` e cada chave de `upper_consumption_per_size` ficam com o dobro;
  `toast` de sucesso; a linha deixa de ser suspeita ao recarregar.
- [ ] **R5** — Imprimir a ficha de Aviamento de um modelo de tira: as linhas TIRA
  mostram `cm/pé` (= metade do valor por par) e a legenda diz "cm do pé".
- [ ] **R6** — Conferir que `strap_colors[].consumption_per_size` no banco **não** mudou
  após a impressão/edição da ficha de Aviamento (mudança é só de exibição).
- [ ] **R7** — `bunx tsc -p tsconfig.app.json --noEmit` passa limpo; `npm run
  check:tokens` sem violação nova no painel de diagnóstico.
