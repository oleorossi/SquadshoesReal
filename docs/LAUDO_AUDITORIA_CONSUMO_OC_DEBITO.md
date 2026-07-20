# Laudo — Consumo × Geração de OC × Débito de Estoque

> Fase 1 da spec [`specs/auditoria-consumo-oc-debito.md`](../specs/auditoria-consumo-oc-debito.md).
> Evidência colhida contra o banco vivo `ssvxfoybzmjlypnipqzn` em 20/07/2026.
> Âncora: PV-00146 + varredura de todos os PVs não cancelados.

## Resumo

Das três divergências que a leitura de código apontou como "bug provável", **duas eram
falso positivo** — o guard existia, só não estava no arquivo onde eu procurei. A terceira
é uma assimetria real mas latente. O bug que **de fato estava errando número em produção**
não estava na lista original: é uma heurística de classificação em
`get_material_conversion_info`.

## Vereditos

### #6 — "OC compra `color_mismatch`, débito pula" → FALSO POSITIVO

O débito pula linhas `matched_by='color_mismatch'` (`hybrid_debit_stock_for_order`, linhas
104 e 142 do source vivo) e o `compute_materials_per_pv` de fato **não** filtra por
`matched_by` no `needed_qty`. Mas o guard mora na UI:
`GeneratePurchaseOrdersDialog.tsx:395` **desabilita o botão Gerar OC** quando
`colorMismatchCount > 0`, exigindo override explícito, com destaque visual na linha
(`:317-321`) e cobertura em `perPvPurchasing.test.ts:48`.

**Conclusão:** a OC não compra cor não cadastrada em silêncio. Sem ação.

### #5 — "Dupla divisão por `dm2_per_unit`" → FALSO POSITIVO

`calculate_order_consumption_by_grade` emite `'unit', v_conv.target_unit` em toda linha que
converte (linhas 264/273, 290/300, 315/324, 344/352, 379/386, 494/505, 529/535). Os
agregadores dividem apenas `WHERE unit IS NULL` — ou seja, exatamente as linhas que **não**
passaram por conversão.

**Conclusão:** o guard funciona. É acoplado (depende de o `by_grade` sempre preencher
`unit` ao converter) e merece um teste que trave o contrato, mas não erra hoje. Sem ação.

### #9 — "Débito baixa dm² cru sem largura" → ASSIMETRIA REAL, LATENTE

Os agregadores de compra excluem linhas com `conversion_warning IS NOT NULL` do
`needed_qty` (`compute_materials_per_pv`, `get_wave_material_needs`, `fn_projected_demand`
— comentário "Achado (f)"). O `hybrid_debit_stock_for_order` **não tem essa checagem** em
lugar nenhum do corpo.

Varredura em todos os PVs não cancelados: **zero** linhas com `conversion_warning`. Os ~15
produtos que disparam o aviso são tiras/tranças, que seguem por `debit_strap_stock` e nunca
alcançam esse caminho.

**Conclusão:** assimetria real no código, exposição nula nos dados. Registrada; não
corrigida (a decisão de comportamento — pular, bloquear ou debitar — segue em aberto).

### #NOVO — Heurística "sem ficha = tira" silenciava material de área → CONFIRMADO E CORRIGIDO

`get_material_conversion_info` decidia o aviso assim:

```
material linear sem largura:
  tem ficha de componente (produto OU grupo)? -> AVISA
  não tem ficha nenhuma?                      -> CALA  ("é tira/elástico")
```

O segundo ramo é correto para tira e elástico, que são lineares diretos. Mas classifica
errado **qualquer napa sem ficha de componente** — o caso em que a conversão dm²→m mais
importa. Resultado: `dm2_per_unit = 1` e `conversion_warning = NULL`, o que faz a linha
entrar inteira na OC (os agregadores só excluem quando há warning) e o débito baixar cru.

**Evidência (PV-00146 / OP-2026-01158 / PORCELANA):**

| | Antes | Depois |
|---|---|---|
| `Cabedal · PALHA` | **1.248,000 m** (1,000 m/par) | **9,838 m** |
| `conversion_warning` | ausente | n/a (largura cadastrada) |
| `products.PALHA` | estoque 1 m, `reserved_stock` **1.248 m** | reserva marcada p/ reprocesso |

Nada havia sido debitado (`quantity_consumed = 0`), então a correção entrou antes do
prejuízo.

**Qual motor estava certo:** o **TS**. `isLinearWidthMissing`
(`src/lib/materialConsumption.ts:263`) marca qualquer material linear sem largura, sem a
escapatória do "sem ficha". O modal do PV **já avisava** sobre o PALHA enquanto o SQL
comprava e reservava calado. A correção converge o SQL para o TS.

**Alcance:** 8 produtos de área sem ficha, em 3 grupos — NAPA TITANIUM (3 produtos, 240 m
em estoque), NAPA MADRID (4, zerado), NAPA PALHA (1, 1 m). Nenhuma tira atingida.

## Correções aplicadas

Migration `20260720120000_fix-area-material-width-silence.sql`:

1. **Backfill** de `dimensions_width = 1370 mm` para os 8 produtos (largura dominante: 42
   de 50 fichas de napa já cadastradas). `ON CONFLICT` não sobrescreve largura existente.
2. **`get_material_conversion_info`**: material de área sem largura passa a avisar.
   "É área" = `sector IN ('Cabedal','Palmilha','Forração da Palmilha')` **ou** o grupo é
   referenciado como `upper/lining/insole_material` em alguma ficha (o vínculo é por texto,
   não FK). A matemática não mudou — só a visibilidade.
3. **Trigger `tg_require_width_for_area_material`** em `component_sheets`: ficha de material
   de área não salva sem largura. Testado: bloqueia com a mensagem correta.

Operações de dados pontuais:

4. `freeze_technical_sheet()` re-executado no item PORCELANA — o snapshot congelado ainda
   guardava 1.248 m, e **o débito lê o snapshot antes do motor** (`hybrid_debit`, linha 73).
5. `sale_orders.reservations_outdated_at = now()` no PV-00146, para o app reprocessar a
   reserva com usuário aprovado.

### Não-regressão verificada

| Material | `dm2_per_unit` | Avisa? |
|---|---|---|
| NAPA PALHA / TITANIUM / MADRID | 137 | não (largura ok) |
| Tira chata 8mm, ELÁSTICO 7MM, Meia Cana 10mm | 1 | não — inalterado |

## Limitações desta fase

- **"Bloquear a criação" não é implementável no INSERT do produto**:
  `component_sheets.product_id` é NOT NULL com FK, então o produto precisa existir antes da
  ficha. O bloqueio real é o trigger na ficha + o aviso que exclui o material da OC.
- **Snapshot órfão**: `de217de9` aponta para um `sale_order_item` que não existe mais e
  segue com 1.248 m. Dado morto (o débito resolve por `sale_order_item_id`), mas deve ser
  limpo — não removido aqui por ser deleção irreversível fora do escopo pedido.
- **`upper_consumption = 1` chapado** em todos os tamanhos na ficha PORCELANA
  (`per_size = {34:1 … 40:1}`). Consumo real de cabedal varia por numeração e fica em
  5-15 dm²/par. Esse `1` é placeholder, não medição: mesmo com a largura correta, os
  9,838 m derivam de um número que ninguém mediu. **Requer medição na ficha técnica.**
- As Fases 2-4 da spec (unificação do Wizard, teste de paridade no CI, painel em
  `/diagnostics`) seguem pendentes.
