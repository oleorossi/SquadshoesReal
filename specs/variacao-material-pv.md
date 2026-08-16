# Variação de Material no Pedido de Venda (PV) — material antes da cor, ponta a ponta

> Complemento posterior: `identidade-variantes-e-tiras-compradas.md` define a
> unicidade do SKU, o snapshot comercial e o código de cor do fornecedor.

> Preview visual aprovado das 4 telas: https://claude.ai/code/artifact/b41a90c5-4dd1-4f42-847b-d0c830dda5cb
> Complementa (não substitui) o spec `variante-material-por-grupo.md` — o motor
> variant-aware (consumo/gate/débito, commit `0404ea5`) JÁ ESTÁ EM MAIN. Este
> spec cobre o que falta: adoção (dados), etiquetas/rótulos e migração das
> alternativas legadas.

## Goal
O vendedor escolhe o **tipo de material** (grupo de estoque: NAPA SOFT, NAPA
SUDANI, GLOW METALIC…) **antes da cor** ao criar o item do PV; cada material
tem SKU/EAN/NCM e custo próprios, **consumo idêntico** (herdado da ficha),
débito de estoque no grupo certo, e o nome do material impresso em **todas**
as etiquetas e rótulos.

## Background / Problema
- O mecanismo de variantes (`reference_material_variants`) já existe e funciona
  no PV (seletor "Material *" antes da cor, cor travada até escolher, cores
  filtradas pelo grupo, SKU fiscal próprio) — mas **só 2 fichas o usam** (EC23,
  ST15). A DS22 (caso motivador: NAPA SOFT × NAPA SUDANI) tem zero variantes.
- 26 fichas modelam "mesmo modelo, napa diferente" por um atalho legado:
  `lining_accessories` (forração alternativa pick-one por cor) — sem SKU
  próprio, sem preço próprio, invisível na etiqueta. É um sistema de variação
  improvisado que deve convergir pras variantes explícitas.
- Etiqueta térmica e rótulo de caixa externa **não imprimem material nenhum**.
- Forração multi-grupo (`lining_materials`) foi INVALIDADA pelo dono
  (2026-07-11): 1 ficha = 1 grupo de forração. A meia-feature foi removida
  (frontend + colunas + função aditiva órfã) na mig `20260911170000`.

## Scope
### In scope
1. Etiqueta térmica 100×30 mm: campo **MATERIAL** em linha própria (sempre).
2. Rótulo caixa externa 198×132 mm: linha **MATERIAL** na tabela da grade +
   **NF, nº do pedido e nome do cliente em vermelho** (`#D9264E`).
3. Etiqueta individual de caixa: passa a receber o mesmo material resolvido.
4. Cascata única de resolução do nome do material (ver Regras).
5. Cadastro das variações da DS22 (NAPA SOFT `903928-NS`, NAPA SUDANI
   `903928-SD`) como dados de produção.
6. Migração assistida das 26 fichas com `lining_accessories` → variantes
   explícitas em `reference_material_variants` (uma variante por alternativa,
   com SKU gerado; `lining_material_group_id` apontando o grupo), mantendo o
   `lining_accessories` até o fim da transição (o motor pick-one continua
   correto — paridade case 20 trava).
### Out of scope (explicitamente agora não)
- Mudanças no motor de consumo/débito variant-aware (já vivo em main).
- Preço de venda por variação além do `unit_price_override` existente.
- Remover `lining_accessories` do motor SQL (só depois da migração completa).
- NF-e/XML além do que o SKU/NCM/EAN por variante já cobre hoje.

## Regras / Cascata de resolução do MATERIAL impresso (CANÔNICA)
Mesma fonte pra etiqueta térmica, rótulo master e etiqueta individual:
1. **Item com variação** (`sale_order_items.material_variant_id`) → nome da
   variação (`material_name`, ex.: NAPA SOFT).
2. **Sem variação, ficha com grupo de cabedal** → nome do grupo de cabedal.
3. **Sem variação e cabedal de tiras** (`has_straps=true`, sem grupo de
   cabedal) → grupo de **forração** resolvido pick-one pra cor do item
   (escalar `lining_material` se cobre a cor; senão a alternativa de
   `lining_accessories` que cobre — mesma resolução do débito, nunca diverge).
4. **Nada disso** → linha MATERIAL não sai (ficha incompleta; não inventar).

## Data model / Domain
- `reference_material_variants` (existente): material_name, sku, barcode, ncm,
  `upper_material_group_id` / `lining_material_group_id` (variante por grupo),
  `unit_price_override`, `available_colors`, active, display_order.
- `technical_sheets`: `has_straps`, `lining_material` (escalar, 1 grupo),
  `lining_accessories` (legado pick-one, em extinção via item 6).
- `BoxIdentificationData.mainMaterial` (printLabels.ts): campo JÁ EXISTE na
  interface do rótulo — nunca foi renderizado; passa a receber a cascata.
- Sem migration de schema nova além da `20260911170000` (já escrita).

## User flows
### Happy path (DS22)
1. Ficha DS22 → aba Variações → cadastra NAPA SOFT (SKU 903928-NS) e NAPA
   SUDANI (SKU 903928-SD), grupo de forração apontado por variante (ficha de
   tiras), consumo herdado (sem campo de dm² na variante).
2. PV → novo item → escolhe 903928·DS22 → seletor **Material \*** aparece
   (borda âmbar) e a cor fica travada ("Escolha o material primeiro").
3. Escolhe NAPA SUDANI → cores do grupo NAPA SUDANI aparecem com metragem;
   escolhe OFF WHITE; badge "NAPA SUDANI · 903928-SD" no cabeçalho do item.
4. OP debita NAPA SUDANI OFF WHITE; custeio usa preço do produto desse grupo.
5. Etiqueta térmica sai MODELO/MATERIAL/COR/TAM; rótulo master ganha a linha
   MATERIAL e NF/pedido/cliente em vermelho.
### Alternate
- Item sem variação (ficha sem variantes): material da ficha (cascata 2/3).
- Ficha de tiras sem variação: forração pick-one (cascata 3).
- Impressora P&B: campos vermelhos saem cinza-escuro, legíveis.

## Edge cases & failure modes
- Variação desativada depois do PV salvo → badge destrutivo "Material inativo
  — NF-e será bloqueada" (comportamento existente, manter).
- Nome de material longo (NAPA SANTORINE…) → fonte adaptativa encolhe
  (`adaptiveFontSize`), nunca corta nem estoura os 30 mm.
- Ficha sem grupo nenhum (cascata 4) → linha MATERIAL omitida; nunca imprimir
  texto livre sujo.
- Alternativa com casing legado ("Napa Sudani") → matching case/accent-
  insensitive (como `group_covers_color` já faz).
- Migração (item 6) NÃO pode alterar consumo/custo de PVs abertos: variantes
  criadas nascem `active=true` mas o pick-one legado continua valendo pra
  itens sem `material_variant_id`.

## Constraints & assumptions
- Etiquetas/rótulos são print: inline styles, cores hardcoded, fontes do
  contexto de print (Inter Tight/JetBrains Mono/Anton via printLabels.ts;
  EtiquetaProduto usa as do index.css) — NUNCA tokens com alpha em print.
- Vermelho de conferência no rótulo: `#D9264E` fixo (squad red), só nos 3
  campos aprovados (NF, pedido, cliente).
- Migrations aplicadas via MCP (Action de migrate quebrada).
- Typecheck canônico `bunx tsc -p tsconfig.app.json --noEmit` antes de commit.
- Decisões do dono registradas: cadastro de variações continua NA FICHA (não
  no PV); campo MATERIAL em linha própria na etiqueta; material SEMPRE
  presente (fallback ficha/tiras); forração multi-grupo é inválida.

## Open questions
- SKU das variações da migração (item 6): gerar `<code>-<iniciais>` como no
  gerador existente do dialog, confirmar padrão com o dono na primeira leva.

## Definition of Done
- [ ] Etiqueta térmica imprime MATERIAL em linha própria pra item COM variação
      — verificar imprimindo etiqueta de um item DS22/NAPA SOFT.
- [ ] Etiqueta térmica imprime MATERIAL pra item SEM variação usando o grupo
      da ficha (cascata 2) e, em ficha de tiras, a forração pick-one (cascata
      3) — verificar com S-039 e uma sandália de tiras.
- [ ] Item na cascata 4 imprime etiqueta SEM a linha MATERIAL (não "—").
- [ ] Rótulo caixa externa tem linha MATERIAL entre REFERENCIA e TAMANHO, com
      a mesma cascata — verificar no print A4 (2 por folha, layout íntegro).
- [ ] NF, pedido e cliente saem em `#D9264E` no rótulo externo (e cinza
      legível em P&B).
- [ ] Etiqueta individual de caixa mostra o mesmo material resolvido.
- [ ] DS22 tem 2 variações ativas com SKUs distintos; PV da DS22 exige
      material antes da cor; débito da OP sai do grupo escolhido — conferir
      stock_movements de uma OP de teste.
- [ ] 26 fichas de lining_accessories migradas pra variantes explícitas (ou
      lista de pendências justificada); relatório de consistência sem novos
      avisos.
- [ ] `run_consumption_parity_tests()` 20/20 ok (inclui pick-one) e
      `bunx tsc -p tsconfig.app.json --noEmit` limpo.
