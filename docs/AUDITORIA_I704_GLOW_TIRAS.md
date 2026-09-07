# I704 / Glow Metallic — conversão de tiras

Auditoria de 07/09/2026. Complementa a regra canônica de variante + tiras
(`resolve_strap_base_group_id`, writer `ensure_sale_order_internal_strap_*`).

## Veredito (código)

**Nem toda tira “vira Glow” automaticamente.** Só as posições
`identity_basis=reference_base` + `material_mode=follow_reference` herdam a
napa-base da variante. Tira pronta (`finished_product_group`), `fixed_group` e
`select_on_order` ficam de fora — regra de produto, não bug.

Na I704 o card de produção mostra:

| Sinal no card | Significado |
|---|---|
| Publicada · INFANTIL | Ficha viva |
| Cabedal não definido | `upper_material` vazio → caminho **tiras seguem a forração** |
| 1 material alternativo | 1 linha em `reference_material_variants` (Glow) |
| Pendências: Grupo da palmilha, MOD | Não bloqueiam conversão de tira |

## Como a I704 deve converter

Com cabedal vazio e `has_straps`:

```
resolve_strap_base_group_id(I704, glow)
  → lining pin/grupo da variante
  → main SE variant_drives_lining
  → lining / strap_base da ficha
```

Para consumo e débito na napa Glow + cor do PV:

1. Variante Glow com **Forração = GLOW METALIC** (pin) **ou** checkbox
   “Forração segue o material principal” ligado na ficha.
2. Cada tira artesanal em `follow_reference` (default).
3. Receita aprovada medida × GLOW METALIC + SKU ativo na cor.

Sem (1), o PV mostra “Glow” e as tiras `follow_reference` cortam a napa da
ficha — o no-op silencioso já visto na SR02.

## Entregas desta rodada

| Artefato | Papel |
|---|---|
| [`supabase/tests/i704_glow_straps_audit.sql`](../supabase/tests/i704_glow_straps_audit.sql) | Script READ ONLY: resolve, posições, receitas, SKUs, lista gaps |
| `variantLeavesStrapBaseOnSheet` em [`materialVariantColorGroup.ts`](../src/lib/materialVariantColorGroup.ts) | Detecta no-op principal≠base da tira |
| Aviso âmbar em [`MaterialVariantsTab.tsx`](../src/components/technical-sheets/MaterialVariantsTab.tsx) | Impede gravar Glow sem perceber que tiras ficam na ficha |
| Testes | `materialVariantColorGroup.test.ts` + `variantCascadePersistence.contract.test.ts` |

## Como rodar a prova viva

No SQL Editor do projeto `ssvxfoybzmjlypnipqzn`, cole o conteúdo de
`supabase/tests/i704_glow_straps_audit.sql` e execute. Leia os `NOTICE`:

- `ok_resolve_glow=true` → resolver aponta GLOW METALIC
- `inherits_glow=true` por posição `follow_reference`
- `VEREDITO: OK` ou lista de `GAPS`

Sem credencial de banco neste ambiente cloud, a prova viva fica para o dono
rodar o script (ou abrir a aba Variantes da I704 e conferir o aviso da Base da
tira).

## O que NÃO foi alterado

- Regra de produto (tira pronta / fixa / select_on_order continuam independentes).
- Furo de solado com variante (já tratado em main recente; fora deste escopo de tiras).
- Cadastro de receita/SKU — gaps de dado o script lista; migration não inventa.
