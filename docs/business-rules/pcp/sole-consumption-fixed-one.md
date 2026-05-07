---
name: Consumo de solado fixo em 1 par
description: Toda ficha técnica com sole_material definido consome exatamente 1 par de solado por par produzido — regra industrial fixa, garantida por trigger no DB
type: feature
---

**Regra:** `sole_consumption = 1` sempre que `technical_sheets.sole_material` está definido. Não há variação por numeração nem por cor — todo par calçado consome 1 par de solado.

**Garantias:**
- DB: `DEFAULT 1` na coluna + trigger `enforce_sole_consumption_one()` (BEFORE INSERT/UPDATE) força o valor para 1 quando `sole_material` é informado.
- Frontend (`SummaryConsumptionPanel`, `OrderConsumptionDialog`, `MaterialConsumptionTab`): calcula `solePerPair = sheet.sole_material ? 1 : 0` em vez de ler `sole_consumption` do DB. Fallback robusto contra cache antigo.
- Backfill aplicado em fichas existentes via migration.

**Implicações:** O campo `sole_consumption` não deve mais ser editável pelo usuário; qualquer valor diferente de 1 é silenciosamente normalizado. UIs de edição podem ocultar/desabilitar esse campo.
