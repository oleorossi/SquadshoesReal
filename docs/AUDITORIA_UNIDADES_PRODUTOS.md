# Auditoria de Unidades por Produto — para validação

> Gerado em 2026-05-30 a partir dos dados reais do banco. Objetivo: normalizar as
> unidades para a **lista canônica** (uma unidade-base por produto, conforme padrão
> de ERP industrial). **Você valida; eu aplico migration só do que aprovar.**
>
> Unidades canônicas: `m` (linear) · `dm²`/`m²` (área) · `un`/`par` (contagem) ·
> `kg`/`g` (massa) · `L`/`ml` (volume) · `placa` (chapa/placa).

---

## BLOCO 1 — Normalização de grafia (SEGURA, aplicar em lote)

A grande maioria dos produtos só tem **sinônimo de grafia** com `conversion_rate = 1`:

| Campo | Hoje | Vira |
|---|---|---|
| `purchase_unit` | `metro`, `mt` | `m` |
| `production_unit` | `metros` | `m` |
| `unit` / `consumption_unit` | já `m` | (mantém) |

**Por que é seguro:** com `conversion_rate=1`, a conversão compra→estoque já resulta em
fator 1 hoje (o `effectiveConversionFactor` cai no fallback `?? 1`); normalizar para
`m`/`m` mantém o fator 1. Nenhum número de custo/MRP muda. Só padroniza a grafia e faz
os conversores (incl. SQL) **reconhecerem** a unidade (hoje `metros` não é reconhecido).

**Abrange:** todos os produtos com `purchase_unit ∈ {metro, mt}` E/OU
`production_unit = metros` E `conversion_rate ∈ {1, NULL}` — exceto os do Bloco 2.
(Tiras, tranças, elásticos, GLOW, velvet, dublado, cristais, e as napas com rate=1.)

> **APROVAR Bloco 1 em lote?** ☐ SIM ☐ NÃO

---

## BLOCO 2 — Decisão por produto (rate ≠ 1 ou categorias misturadas)

Estes precisam da sua decisão porque o `conversion_rate`/unidade estão fora do padrão.
**Recomendado** = a correção que eu sugiro; marque `APROVAR` ou escreva o valor correto.

### 2.1 Napas com `conversion_rate = 137` (deveria ser 1)

| Produto | Hoje | Diagnóstico | Recomendado | APROVAR? |
|---|---|---|---|---|
| NAPA SOFT (cor c/ rate 137) | unit `m`, purchase `metro`, **rate 137**, larg. ficha 1370 | É material de **área** vendido em metro linear. A conversão dm²→metro JÁ é feita pela **largura da ficha de componente** (1370mm) — o `137` no produto é **redundante e inflaria o estoque na compra** (1 m comprado → 137 "m"). | `unit=m`, `purchase_unit=m`, `production_unit=m`, **`conversion_rate=1`** (a largura cuida da área na ficha) | ☐ |
| NAPA SUDANI - NUDE | idem rate 137 | idem | **`conversion_rate=1`** + grafias→`m` | ☐ |
| NAPA SUDANI - OFF WHITE | idem rate 137 | idem | **`conversion_rate=1`** + grafias→`m` | ☐ |
| Tira Overlock 5mm: COBRE | unit `m`, **rate 137** | ⚠ **Todas as outras** "Tira Overlock 5mm" têm `rate=1` — esta está com 137 por **erro de digitação**. | **`conversion_rate=1`** + grafias→`m` | ☐ |

### 2.2 Napa com `conversion_rate = 0` (zera consumo/compra)

| Produto | Hoje | Diagnóstico | Recomendado | APROVAR? |
|---|---|---|---|---|
| Napa Soft com Cacharrel/EVA | unit `m`, **rate 0** | `rate=0` faz a conversão multiplicar por zero (consumo/estoque viram 0). | **`conversion_rate=1`** + grafias→`m` | ☐ |

### 2.3 Placa de EVA — 3 categorias misturadas

| Produto | Hoje | Diagnóstico | Recomendado | APROVAR? |
|---|---|---|---|---|
| PLACA 1.0 EVA 3.0 | unit **`m`**, purchase **`chapa`**, production **`dm²`**, rate **150**, larg. 1000 | Mistura linear/chapa/área. Como placa de EVA é consumida por **área**: 1 chapa ≈ 1,0×1,5 m = **150 dm²** → o `rate=150` é coerente como *chapa→dm²*. Falta a unidade-base ser área. | `unit=`**`dm²`**, `purchase_unit=`**`placa`**, `production_unit=`**`dm²`**, `conversion_rate=150` | ☐ |

### 2.4 Colas / linha — `conversion_rate` sem sentido físico

> Aqui preciso que você confirme o significado do `rate` (provavelmente **tamanho do
> balde/embalagem** guardado no lugar errado). Proposta padrão: estoque/consumo em `kg`,
> e o tamanho do balde vira `purchase_unit='balde'` com o `rate` como kg/balde.

| Produto | Hoje | Diagnóstico | Recomendado (confirmar) | APROVAR? |
|---|---|---|---|---|
| COLA ADESIVO HOTMELT | unit `kg`, purchase `kg`, **rate 25** | `kg→kg` com rate 25 não faz sentido. 25 = kg por balde? | Se balde de 25kg: `purchase_unit=balde`, `rate=25`. Senão **`rate=1`**. | ☐ |
| COLA FORTE | unit `kg`, purchase `un`, production **`gr`**, **rate 14** | `gr` órfão (→`g`); `un` de compra = balde de 14kg? | `production_unit=`**`g`** ou `kg`; `purchase_unit=balde`, `rate=14` (kg/balde) | ☐ |
| COLA PVC | unit `kg`, purchase `kg`, production **`un`**, **rate 14** | `production_unit='un'` errado p/ cola; rate 14 = balde? | `production_unit=`**`kg`**; `purchase_unit=balde`, `rate=14` | ☐ |
| LINHANYL | unit `kg`, purchase `kg`, prod `kg`, **rate 0.08** | `kg→kg` com 0.08 não faz sentido (cone de 80g = 0,08 kg?). | Se cone de 80g: `purchase_unit=cone`, `rate=0.08`. Senão **`rate=1`**. | ☐ |

---

## Como aplicar depois da sua validação

1. Você marca os ☐ (ou escreve o valor certo onde discordar).
2. Eu gero **uma migration** com os UPDATEs aprovados (idempotente, via MCP), e
   normalizo a grafia do Bloco 1 em lote.
3. Valido no banco que nenhum consumo/custo/MRP quebrou (ex.: PV-00116 napas seguem
   ~30 m) e documento a lista canônica como regra no CLAUDE.md.

> ⚠ **Atenção (impacto positivo esperado):** corrigir os napas com `rate=137→1` deve
> **parar de inflar o estoque na entrada de compra** (hoje 1 m comprado credita 137).
> Confirme se a entrada de napa hoje parece inflada — isso valida a correção.
