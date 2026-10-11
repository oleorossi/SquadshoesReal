# Grupo de material nasce com cor — porta única de criação

> Decidido em 11/10/2026 com o dono (grill sobre "cadastrei a NAPA ROOTS e ela não
> aparece em Cabedal"). Complementa `estoque-cores-e-editores.md` e a regra
> canônica "A janela do grupo é a PORTA ÚNICA de edição" do `CLAUDE.md`.

## O problema medido

- `GroupMaterialSelect` (`sheetSelectors.tsx`) só oferece grupo-folha com **≥ 1 item
  ativo** (filtro de 18/08, de propósito: sem SKU o PV não tem o que debitar e o
  custo/par sai R$ 0). A NAPA ROOTS foi criada às 12:23 com **0 itens** → invisível.
- Havia **duas portas de criação**: "Novo grupo / linha vazio" (`GroupCreateDialog`,
  também o "Novo grupo" de Estoque → Grupos) cria grupo SEM cor e como "Coleção de
  itens"; "Cadastro rápido: grupo + cores" (`QuickFamilyDialog`) já exigia cor +
  unidade e compensava o grupo se o lote falhasse.
- O grupo vazio **não tinha saída pelas abas**:
  1. aba **Cores** recusa grupo "Coleção de itens" (`shared_specs = false`);
  2. mesmo em "Linha com variantes", a 1ª cor falhava em
     `createGroupColorProduct` com "O grupo ainda não tem item-modelo" — a rota de
     "unidade de estoque da primeira cor" (18/08) ficou **depois** de uma trava de
     16/08 e era código morto. `cabedalDublagem.contract.test.ts` só checava o
     TEXTO, então passava verde;
  3. o cadastro rápido da aba **Itens** também exige item-modelo.
- Grupos-folha vazios hoje: NAPA ROOTS (destravada nesta sessão), NAPA SANTORINE,
  NAPA SOFT COM PU 600 + 3 (2 Componente, 1 Palmilha).

## Decisões do dono

| # | Decisão |
|---|---|
| D1 | **Uma janela só** de criar grupo: o `GroupCreateDialog`. Somem "Cadastro rápido: grupo + cores" e "Novo grupo / linha vazio"; fica **"Novo grupo"**. `QuickFamilyDialog` é apagado. |
| D2 | Cor **obrigatória pelo setor**: Cabedal, Forração da Palmilha e Solado sempre. Componente pergunta **"Varia por cor?"** sem resposta pré-marcada — o Criar só libera depois de responder. Palmilha, Químicos, Ferramentas e Fôrma não pedem cor. Material Base / tira acabada seguem pelo Hub de Tiras (fora deste spec). Família técnica nunca recebe item. |
| D3 | O bloco de cor pede **cores (várias) + unidade de estoque (obrigatória) + preço (opcional)**. Largura vem do grupo. Fornecedor, estoque mín./máx. etc. ficam para a aba Em massa. Unidade sugerida só em setor de área (Cabedal/Forração → `m`); nos outros, escolha explícita. |
| D4 | Se as cores falharem, **o grupo recém-criado é desfeito** (`delete_empty_material_group`, que trava e revalida o vazio na mesma transação) e o formulário continua preenchido. Nunca sobra grupo vazio. |
| D5 | Depois de criar (grupo não-família), **abre a janela do grupo** — aba **Cores** quando o grupo tem cor, aba **Itens** quando não tem. |
| D6 | Aba **Cores** passa a cadastrar a **1ª cor** de grupo vazio (pede a unidade). Grupo vazio em "Coleção de itens" vira **"Linha com variantes" sozinho** (com `consumption_unit` = unidade escolhida — exigido por `chk_shared_group_has_consumption_unit`). Grupo com itens continua recusando como hoje. |
| D7 | No `GroupMaterialSelect`, grupo-folha **sem item ativo aparece desabilitado**, numa seção própria, com atalho "Cadastrar cores" que abre a janela do grupo na aba Cores. O seletor da aba Variantes (`MaterialVariantsTab`) fica para depois (arquivo com trabalho não commitado de outra sessão). |

## Requisitos

### R1 — Criação (`GroupCreateDialog`)
- R1.1 `colorRequirement(sector, isFamily, isStrap)` → `'required' | 'ask' | 'none'` em lib pura (testável).
- R1.2 `required` ou (`ask` + "Sim"): bloco Cores obrigatório (≥ 1 cor, unidade). Grupo nasce `shared_specs = true`, `consumption_unit = unidade`, itens `GRUPO - COR` com SKU `PREFIXO-COR` único, saldo 0, via `createProductsWithStock` (fronteira de estoque).
- R1.3 Setor de área: unidade só `m`/`cm`/`dm²`.
- R1.4 Cor suspeita de duplicata (`findDuplicate`) precisa ser resolvida antes do submit (paridade com o cadastro rápido).
- R1.5 `ask` sem resposta → botão Criar desabilitado + texto explicando.
- R1.6 Falha no lote → compensação D4; erro na janela/toast; nada fechado.
- R1.7 Sucesso → `onCreated(grupo, aba)`; os pais (`GroupDialog`, `GroupOrganizationPanel`) abrem a janela do grupo (D5).

### R2 — Primeira cor pela aba Cores (`createGroupColorProduct`)
- R2.1 Sem item-modelo **e** com `stockUnit` → cria a cor com essa unidade.
- R2.2 Sem item-modelo e sem `stockUnit` → erro "Informe a unidade de estoque da primeira cor…".
- R2.3 Grupo não-variante **sem nenhum produto** (ativo ou não) + `stockUnit` → converte para Linha com variantes antes de criar; o resultado informa `convertedToVariantLine`.
- R2.4 Grupo não-variante **com** produto → recusa como hoje.
- R2.5 A janela do grupo atualiza o estado local (`shared_specs`/unidade técnica) quando houve conversão — senão o próximo "Salvar" da aba Geral desfaria a conversão.
- R2.6 O aviso "Cadastro em lote indisponível" não aparece para grupo vazio.

### R3 — Seletor da ficha (`GroupMaterialSelect`)
- R3.1 Grupos-folha do setor sem item ativo listados numa seção "Sem itens ativos", não selecionáveis, com "Cadastrar cores →" (abre `GroupEditDialog` na aba Cores).
- R3.2 Seleção continua restrita a grupos com item ativo (débito/custo).

### R4 — Limpeza
- R4.1 Apagar `QuickFamilyDialog.tsx` e o item de menu; contratos que liam o arquivo passam a ler a lib nova.
- R4.2 Teste de **comportamento** (supabase mockado) para R2.1–R2.4 e para a compensação D4.

## Fora de escopo
- Renomear itens existentes (o banco tem 4 padrões de nome; o novo fluxo usa `GRUPO - COR`).
- Grupos vazios legados além da NAPA ROOTS: aparecem desabilitados (D7) e são completados pela aba Cores (D6).
- Tiras (Material Base / tira acabada) — redesenho em andamento ("tira = material de estoque", 11/10/2026).
- `MaterialVariantsTab` (D7).

## Pronto quando
- Criar grupo de Cabedal sem cor é impossível pela UI; com cor, o grupo aparece no seletor de Cabedal da ficha sem passo extra.
- Grupo vazio legado ganha a 1ª cor pela aba Cores.
- `bunx tsc -p tsconfig.app.json --noEmit`, `bun run lint`, `bun run test`, `bun run check:tokens` limpos.
- Conferido no site de produção (regra 7 do `CLAUDE.md`).
