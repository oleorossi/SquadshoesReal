# Base da tira segue a napa da ficha técnica (roteamento por referência)

> **Status: IMPLEMENTADO em 22/07/2026** (commits 7e8695d TS + b18323f SQL). O
> ROTEAMENTO por família está vivo em todas as superfícies (§5). O que continua
> bloqueado é só o CADASTRO pra NAPA MADRID de fato converter (§4): sem largura de
> rolo + receita `(tira, NAPA MADRID)`, as linhas NAPA MADRID aparecem como
> `needed 0 + conversion_warning` / "a cadastrar" (por design — não compra a napa
> errada). Confirmado pelo usuário a partir da auditoria do PV-00148.

## 1. Problema

Hoje o motor de consumo escolhe a **base da napa** de uma tira artesanal "às cegas":
lê a receita (`artisanal_recipes`) pelo **nome da tira** e usa `base_product_name`.
Como todas as receitas de tira têm base `NAPA SOFT`, **toda tira aparece como cortada
de NAPA SOFT**, independentemente da referência.

Regra real da fábrica (usuário): **o material da tira é o material do CABEDAL da ficha
técnica da referência**. Ex.: a referência NL04 é cadastrada como `NAPA MADRID` → as
tiras dela são cortadas de NAPA MADRID. **Não há mistura de materiais dentro de uma
referência** — uma referência tem uma napa só, e as tiras seguem essa napa.

Consequência: para referências de NAPA MADRID (cores CAPUCCINO / OFF WHITE / PRETO /
ROCHA), o modal de Consumo e a faixa "MATERIAL BASE" mostram NAPA SOFT quando deveriam
mostrar NAPA MADRID → total de compra de napa fica no material errado.

## 2. Objetivo

O motor deve derivar a base da tira **da napa da ficha técnica da referência do item**,
não da receita. A receita passa a fornecer só a **geometria de corte** (largura +
rendimento por base); a **escolha da base** vem do item.

## 3. Regra de resolução (definição de "pronto")

Para cada linha de tira (`componentType === 'Tiras'`) de um item do PV:

1. Descobrir a napa-base da referência do item = material de cabedal da ficha técnica
   (`technical_sheets` → grupo de napa do cabedal; ex.: `NAPA MADRID` / `NAPA SOFT`).
2. Base da tira := essa napa. `baseQty := metros_de_tira ÷ rendimento(tira, base)`.
3. Rendimento é **por base** (varia com a largura do rolo): NAPA SOFT (rolo 1000 mm)
   rende diferente de NAPA MADRID. Precisa existir uma receita `(tira, base)` com o
   `yield_per_meter` medido daquela base.
4. Se não houver receita para `(tira, base_da_referência)` → **não converter às cegas
   para NAPA SOFT**; marcar aviso ("rendimento de {tira} em {base} não cadastrado") e
   deixar a linha neutra, igual ao tratamento de `widthMissing`.
5. Uma tira de mesmo grupo+cor usada por referências de napas diferentes no mesmo PV
   deve **quebrar por base** (não colapsar) — espelha a quebra do Corte Forração por
   napa (ver [[project_corte_forracao_split_by_material]]).

## 4. Bloqueios de cadastro (pré-requisitos)

- **Largura do rolo NAPA MADRID**: hoje `product_groups.dimensions_width = 0` → sem
  como calcular rendimento. Cadastrar a largura real.
- **Rendimentos NAPA MADRID por tira**: criar `artisanal_recipes` `(tira, NAPA MADRID)`
  com `yield_per_meter` medido, para cada tira que sai de NAPA MADRID.
- Confirmar a lista de referências NAPA MADRID (fonte: material de cabedal da ficha).

## 5. Superfícies a alinhar (não esquecer nenhuma)

- **Modal de Consumo** (`MaterialConsumptionDialog.tsx`) — resolução da base + faixa
  "MATERIAL BASE" (`baseMaterialTotal.ts`) + bloco de corte do rolo.
- **Ficha de operador** — mesmo motor canônico (`orderConsumption.ts`); a base da tira
  precisa nascer no motor, não só no modal, senão modal ≠ ficha.
- **Picker da OS artesanal** (`Contractors.tsx`) — sugerir a receita da base correta
  pela referência; o débito (`tg_debit_service_order_base`) já resolve a base por
  `base_product_name` + cor da OS, então basta a OS nascer com a base certa.
- **Custeio / MRP (SQL)** — caminho separado (`calculate_order_consumption*`); verificar
  se também precisa rotear a base da tira pela ficha (hoje diverge).

## 6. Fora de escopo / já feito nesta auditoria (22/07/2026)

- **Feito (dado):** receita mislabelada `("NAPA MADRID" ← NAPA SOFT, 44, 11mm)` renomeada
  para `artisanal_product_name = "TIRA CHATA COSTURADA 11MM"` (base NAPA SOFT mantida —
  as 10 OS pendentes que a usam cortam 11mm de NAPA SOFT em cores que NAPA MADRID nem tem).
- **Feito (código):** o motor do modal só aplica a conversão artesanal em linha de
  `componentType === 'Tiras'` — parou de casar "às cegas" o nome do grupo contra
  qualquer receita (era o que fazia a NAPA MADRID da forração virar "tira de NAPA SOFT").
- Este spec cobre **só** o roteamento positivo da base pela ficha técnica.
