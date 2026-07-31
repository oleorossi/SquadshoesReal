# Tira artesanal: fonte única entre compra e reserva + débito da OS de cabedal

> Decidido em 31/07/2026, numa sessão de grill sobre os botões **Consumo de
> materiais**, **Gerar OCs** e **Gerar OS** do Pedido de Venda.
> **Ainda não implementado.**

---

## 1. O defeito (medido, não suposto)

`Consumo de materiais` e `Gerar OCs` rodam **motores diferentes**:

| Botão | Motor |
|---|---|
| Consumo de materiais | TS — `orderConsumption.ts` + `annotateConsumptionAvailability` |
| Gerar OCs | SQL — RPC `compute_materials_per_pv` |

No **PV-00148**, 8 de 24 materiais (33%) divergem entre a OC e o que a produção
realmente reservou (`material_reservations`):

| Material | OC compra | Reservado | |
|---|---|---|---|
| Meia Cana 10mm CAPUCCINO | — | 48,72 m | só reserva |
| Meia Cana 10mm OFF WHITE | — | 55,68 m | só reserva |
| Tira chata 8mm CAPUCCINO | — | 139,20 m | só reserva |
| Tira chata 8mm OFF WHITE | — | 146,16 m | só reserva |
| NAPA MADRID CAPUCCINO | 4,108 | 2,252 | +1,856 |
| NAPA MADRID OFF WHITE | 4,108 | 2,252 | +1,856 |
| NAPA SOFT OFF WHITE | 8,198 | 6,690 | +1,508 |
| NAPA SOFT CAPUCCINO | 6,907 | 5,631 | +1,276 |

### Causa raiz

`is_artisanal` aparece em **9 funções SQL** (compras, MRP, ondas, projeção) e em
**nenhuma** função de reserva/débito (`try_reserve_materials`,
`hybrid_debit_stock_for_order`, `reserve_missing_materials_for_order`).

Logo, para uma tira artesanal com receita resolvida:
- **compras** converte a tira em napa (`needed_qty / yield_per_meter`) e não
  compra a tira;
- **produção** reserva **a tira**, que tem estoque 0.

Resultado: **falta permanente que a compra nunca resolve.** Vivo em 3 PVs —
PV-00147 (3.185 m), PV-00148 (445 m), PV-2026-00097 (26 m).

### Agravante de cadastro

No mesmo grupo `Tira chata 8mm`, ROCHA e TAN estão `is_artisanal = false` e as
outras 6 cores `true`. Mesmo produto físico, comportamento diferente por cor —
é por isso que ROCHA e TAN batem entre os dois motores e as demais não.

E **18 das 25 tiras artesanais não têm napa na mesma cor**, então a resolução
"cega" por cor (hoje) falha calada e a tira vira "comprada pronta" sem ninguém
saber. Foi o que aconteceu com a Meia Cana TAN.

---

## 2. O modelo decidido

### 2.1 Onde vive a escolha

`faço a tira aqui` × `compro pronta` passa a ser **por linha de tira do PV**,
com **default vindo de `products.is_artisanal`**.

Motivo: um PV pode ter tira chata, meia cana e strass ao mesmo tempo, em
situações de estoque diferentes — "corto a chata mas compro a meia cana" precisa
ser possível. O flag do produto continua existindo, mas como default, não como
sentença.

### 2.2 O que sai do estoque

- **Faço aqui** → reserva e debita a **NAPA**, nunca a tira.
- **Compro pronta** → reserva e debita **a tira**, e a OC compra a tira.

Os dois motores (reserva e compra) passam a ler a **mesma** decisão. Fonte única.

### 2.3 Como achar a napa-base

Napa-base = **família + cor**.

- **Cor** = a cor da tira.
- **Família** = a da **ficha técnica do modelo** (a napa do cabedal).
  - ⚠ **Exceção:** modelo **sem cabedal cadastrado**, só de tiras, com a opção
    habilitada → a família sai da **forração**.

A família importa porque existe tira da mesma cor em material diferente — a cor
sozinha não identifica a napa.

### 2.4 Quando não existir napa naquela família+cor

**Bloqueia**, dizendo o que cadastrar. Nada silencioso.

> Tira chata 8mm BEGE está marcada como cortada aqui, mas não existe
> NAPA SOFT BEGE no estoque — cadastre a napa ou marque a tira como
> comprada pronta.

Hoje esse caso vira "comprada pronta" sem aviso, e é a origem da divergência.

### 2.5 Picking

**Uma linha só**, com a tira em destaque e a napa embaixo:

```
Tira chata 8mm CAPUCCINO — 139,2 m
  consome 2,32 m de NAPA SOFT CAPUCCINO (rend. 60 m/m)
```

Motivo de ser uma linha e não duas: o separador precisa ver a metragem do
**material pronto** (o que ele vai produzir), mas quem sai do estoque é a napa.
Em duas linhas o separador procuraria uma tira que não existe.

### 2.6 Correções de cadastro

- `Tira chata 8mm` ROCHA e TAN → `is_artisanal = true` (a família inteira é
  artesanal).

### 2.7 Retroatividade

**Só PVs novos.** PV-00147, PV-00148 e PV-2026-00097 o dono resolve à mão — não
mexer em reserva de PV que já está em produção.

---

## 3. Menu de criação de tiras artesanais

Os 4 problemas apontados pelo dono, todos a resolver:

1. **Não mostra de qual napa vai sair.** O diálogo deve exigir/mostrar a
   napa-base (família + cor) e o rendimento no momento da criação — é
   exatamente o vínculo cuja ausência gera o furo da seção 1.
2. **Não avisa quando falta receita/rendimento.** Sem receita em
   `artisanal_recipes`, o consumo vira 0 silenciosamente. Tem que acusar na
   criação.
3. **Duplica tira que já existe.** O cadastro atual já tem
   `Tira chata 8mm: OFF WHITE` e `TIRA STRASS 6MM: OFF WHITE` convivendo com
   grafias diferentes do mesmo conceito (a Tira Strass tem 4 grafias).
   Precisa de checagem de duplicata normalizada (sem acento, sem caixa), como
   o índice único de `product_groups.name`.
4. **Difícil de achar / muitos cliques.** Rever o fluxo de entrada.

Estado atual: `artisanal_recipes` casa **por nome** (`artisanal_product_name` ×
nome do grupo, `base_product_name` × família da napa) — string matching, frágil.
Há 12 receitas, sempre em par (NAPA SOFT + NAPA MADRID), com
`yield_per_meter` 22–61 e `cut_width_mm` 11–52.

---

## 4. Gerar OS (corte de cabedal)

Hoje o botão cria `service_orders` com `quantity = pares` e **não movimenta
material nenhum**.

### 4.1 Decidido

- Ficha **com cabedal preenchido** → a OS **debita a napa do cabedal**, na
  metragem do consumo daquele lote.
- Modelo **só de tiras** → **sem débito de cabedal** (o comportamento atual
  está certo nesse caso).

### 4.2 Defeito adicional: OS duplicada

Os dois índices únicos de `service_orders` não cobrem este caminho:

| Índice | Exige | Este fluxo preenche? |
|---|---|---|
| `uq_os_per_op_sector` | `order_id` | não (fica NULL) |
| `uq_service_order_per_pv_item_terceirizacao` | `source_terceirizacao_id` | não |

A única guarda é estado de UI (`existingOsByKey`) — **duas abas geram OS
duplicada**. Precisa de índice único cobrindo
(`sale_order_id`, `target_sector`, ref, cor).

---

## 5. Fora do escopo, mas achado no caminho

Defeitos de **dado** (os dois motores concordam entre si, então não é bug de
motor):

- `COLA ADESIVO HOTMELT` — 0,00528 kg para 528 pares = **10 mg/par**
- `COLA FORTE` — 0,132 kg = **0,25 g/par**
- (`COLA PVC` 12,3 kg = 23 g/par é plausível)
- `Elástico 6MM` cadastrado em **`cm`** (6.240 cm), fora da lista canônica de
  unidades, onde linear é `m`

Ver [[project_cola_consumption_inflated_bom]] — a cola já tinha histórico de
`quantity_per_unit` errado na BOM.

---

## 6. Definição de pronto

- [ ] Reserva e compra leem a MESMA decisão por linha de tira do PV
- [ ] `compute_materials_per_pv` e `try_reserve_materials` concordam em 100% das
      linhas do PV-00148 (hoje: 16/24)
- [ ] Napa-base resolvida por família+cor, com a exceção da forração
- [ ] Sem napa família+cor → bloqueio com mensagem acionável
- [ ] Picking em uma linha, tira em destaque + napa/rendimento embaixo
- [ ] ROCHA e TAN corrigidos para `is_artisanal = true`
- [ ] OS de cabedal debita a napa quando a ficha tem cabedal
- [ ] Índice único impedindo OS duplicada por PV+setor+ref+cor
- [ ] Diálogo de criação de tira exige napa-base e acusa receita faltando
- [ ] Checagem de duplicata normalizada na criação de tira
