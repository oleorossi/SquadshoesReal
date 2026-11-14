# Diagnóstico pós-migração de projeto Supabase

O app atual (`src/`) espera o schema completo do repo (~1767 migrations em
`supabase/migrations/`). Se o destino foi provisionado com dump parcial,
`db pull` antigo ou só parte das migrations, a UI quebra com:

```
column X does not exist
```

Isso **não** é falha de rede. É schema do destino atrás do código.

## Erros já confirmados na tela de Pedidos

| Erro na UI | Coluna | Migration que cria | Telas afetadas |
|---|---|---|---|
| `sale_order_items.production_excluded_at does not exist` | `sale_order_items.production_excluded_at` | `20270101014500_admin_retire_technical_sheet_in_production.sql` | Pedidos (lista), terceirização, ondas, impressão de fichas, capacidade |
| `clients_1.client_number does not exist` | `clients.client_number` (`clients_1` = alias do embed PostgREST) | `20260331213143_…sql` | Pedidos (embed), busca global, seletor de cliente, acabamento |

Enquanto esses SELECTs explícitos falharem, **Pedidos / Clientes / Fichas / OPs
aparecem sem dados** — não porque o dado “sumiu” na query, e sim porque a
query aborta antes de retornar linhas.

## Como usar

1. Abra o **SQL Editor do projeto DESTINO** (o que a Vercel `VITE_SUPABASE_URL` aponta).
2. Rode `diagnostico_contagens_pos_migracao.sql` — valida colunas críticas + contagens + auth.users.
3. Rode `diagnostico_colunas_pos_migracao.sql` — lista **todas** as colunas que o frontend
   pede explicitamente e que faltam no destino (~910 colunas em ~134 tabelas).

## Interpretação

| Resultado | Significado |
|---|---|
| Contagens = 0 e colunas OK | Schema ok, **dados não migraram** (só estrutura). |
| Colunas faltando | Destino está com schema incompleto; app vai continuar gerando `column … does not exist`. |
| `auth.users` = 0 | Login/RLS vão falhar mesmo com tabelas cheias. |
| Projeto origem `INACTIVE` | Precisa **Restore** no dashboard antes de dump/comparar. |

## Correção recomendada (ordem)

1. **Não** tente “remendar” coluna a coluna na mão — o gap típico é de dezenas/centenas de objetos (colunas, RPCs, views, triggers).
2. Restaure o projeto origem se estiver pausado, ou use o backup completo (`pg_dump` / backup Supabase) **schema + data + auth**.
3. No destino, aplique **todas** as migrations do repo até a tipagem atual (`supabase db push` / pipeline / MCP), ou restaure um dump lógico do origem que já esteja no HEAD.
4. Migre `auth.users` + identities (senão RLS bloqueia tudo).
5. Reaponte `VITE_SUPABASE_URL` / keys na Vercel e valide com os dois SQLs acima (0 linhas em `missing`).

## Projeto canônico deste repo

- Produção histórica: `ssvxfoybzmjlypnipqzn` (`supabase/config.toml`)
- Referência Lovable antiga (docs/pending): `qrdvwoijghmgugejponz`
- Destino atual da Vercel (pós-transferência): `cknbzfqvqwqdhajspazn`

## Correções de app (schema-safe)

O schema canônico **não** tem `products.code` / `products.ean` nem
`orders.delivery_date` / `orders.reference`. O frontend foi alinhado:

- `src/pages/Picking.tsx` → usa `sku`
- `src/components/technical-sheets/OperationsTab.tsx` → `reference_id` + `due_date`

Para saber se o destino tem **dados** ou só schema, rode
`corrigir_dados_e_auth.sql` no SQL Editor (role postgres, bypass RLS).
