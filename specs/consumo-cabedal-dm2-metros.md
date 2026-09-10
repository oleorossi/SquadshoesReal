# Avaliação: consumo de cabedal dm² → metros lineares

> Avaliação de 2026-09-10. Veredito: a fórmula canônica está correta no caminho
> de produção. Entrega: documentação do contrato + endurecimento do trap
> `yield_per_size` × override dm² no motor TS + testes de contrato.

## Goal

Confirmar que o valor digitado na ficha técnica em **dm²/par** vira **metros
lineares** corretos ao gerar o consumo do PV / ficha de Corte Cabedal — e travar
os modos de falha conhecidos (largura ausente, cadastro por pé, trap de yield).

## Veredito

**Sim — o cálculo está correto** no caminho que a tela de consumo usa hoje.

```
total_dm² = Σ (dm²/par × pares da grade × fichas)
metros    = total_dm² ÷ (largura_mm / 10)
```

Exemplo golden: `6 dm²/par × 24 pares = 144 dm²`; largura `1000 mm` →
`100 dm²/m` → **1,44 m**.

## Fluxo

| Etapa | Campo / função | Onde |
|---|---|---|
| Entrada | `upper_consumption` / `upper_consumption_per_size` (dm²/par) | `TechnicalSheets.tsx` |
| Largura | `component_sheets.dimensions_width` | Ficha de componente |
| Produção | `required_dm² / dm2_per_unit` via `get_material_conversion_info` | SQL `calculate_order_consumption_by_grade` |
| UI | unidade `metro` / `m` | `MaterialConsumptionView` em `/sales?view=consumo` |
| Oracle TS | `convertDm2ToLinearMeters` + ramo Cabedal | `materialConsumption.ts`, `orderConsumption.ts` |

A ficha técnica **não** mostra metros na digitação — só dm²/par. Os metros
aparecem ao gerar o consumo do PV.

## O que está certo

1. Unidade de entrada: dm² **por par** (ver `consumo-cabedal-padrao-par.md`).
2. Divisor: só a **largura** (`dimensions_width`), não `GREATEST(width, length)`.
3. Sem perda de corte: fator `× (1 + waste%)` removido de propósito.
4. Tela de consumo do PV lê o relatório SQL canônico (não recalcula no browser).
5. Golden travado em `orderConsumption.test.ts` e neste contrato.

## Riscos (e status)

| Sintoma | Causa | Status |
|---|---|---|
| Consumo ~100× maior | Sem `dimensions_width` → `dm2_per_unit = 1` | UI: `widthMissing` / `conversion_warning` |
| Consumo ~2× menor | Cadastro em dm²/pé | Auditoria em `/system-diagnostics` |
| Oracle TS ~100× com yield+override | `yield_per_size` linear + override dm² da ficha | **Endurecido** em `calculateConsumptionWithUnit`: override dm² ignora yield |

## Fora de escopo

- Não inventar dm² faltantes em ficha.
- Não reintroduzir perda de corte.
- Não mudar o editor da ficha para mostrar metros ao vivo (só dm²/par).

## Done when

1. Spec deste arquivo publicada no repo.
2. Contrato `cabedalDm2ToMeters.contract.test.ts` verde: fórmula, `widthMissing`,
   override dm² vence yield.
3. Typecheck / testes de unidade do motor de consumo passam.

## Neutralização dos riscos operacionais (2026-09-10)

### Risco ~100× (largura ausente)

**Como anular:** nunca rotular o total como `metro` quando falta largura.

| Camada | Mudança |
|---|---|
| Emissor TS | `linearUnitOrDm2(widthMissing)` em Cabedal/Forração (`orderConsumption`, `bomConsumption`) — espelha Fachete |
| Relatório canônico SQL | `canonicalConsumptionReport` relabela `metro`→`dm2` quando `conversion_warning` cita largura |
| Cadastro | Trigger + UI de ficha de componente já **bloqueiam** save sem `dimensions_width` |
| Compra/MRP | Já excluía linhas com `conversion_warning` |

Resultado: a UI mostra **dm²** (âmbar) em vez de “144 m” falsos; compra não age sobre a linha.

### Risco ~2× (cadastro por pé)

**Como anular:** confirmação explícita POR PAR no save + auditoria assistida ×2.

| Camada | Mudança |
|---|---|
| Save da ficha | `needsCabedalParConfirmation` + `window.confirm` em `TechnicalSheets` antes do mutate |
| Diagnósticos | `CabedalParPeAuditPanel` + RPC `double_upper_consumption` (legado) |
| Labels | Editor já diz “POR PAR (dm²/par, não por pé)” |

Não há auto-×2 cego (spec `consumo-cabedal-padrao-par.md`): o humano confirma.
