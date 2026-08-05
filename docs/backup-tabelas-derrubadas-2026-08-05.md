# Salvaguarda — Lote 2.1 / 2.2 (tabelas expostas pela chave anon) — 2026-08-05

Projeto: `ssvxfoybzmjlypnipqzn` (produção).
Migration correspondente: `supabase/migrations/20261120120000_fecha-exposicao-anon-tabelas-backup-e-rls-sem-policy.sql`

> **Leia antes de derrubar qualquer coisa daqui.** A auditoria mudou o plano
> original (que era "DROP em tudo"). O achado está na seção
> [Por que a maioria NÃO foi derrubada](#por-que-a-maioria-não-foi-derrubada).

---

## Veredito por tabela

| Tabela | Linhas | Estado antes | Ação | Motivo |
|---|---|---|---|---|
| `_backup_bom_sole_rows_20261102` | 56 | RLS **off** (ERROR) | **RLS ligada** | Rede de rollback ATIVA de 02/08/2026 — única cópia de 56 linhas de BOM deletadas |
| `_backup_standard_sole_flag_20261102` | 7 | RLS **off** (ERROR) | **RLS ligada** | Idem — única cópia da flag desarmada em 7 solados |
| `_backup_sole_technical_specs_20261102` | 77 | RLS **off** (ERROR) | **RLS ligada** | Snapshot de 02/08/2026 de `sole_technical_specs` |
| `_backup_fn_by_grade_20261102` | 1 | RLS **off** (ERROR) | **RLS ligada** | Fonte da função `calculate_order_consumption_by_grade` antes da troca (47 KB) |
| `_parity_before_20261102` | 36 | RLS **off** (ERROR) | **RLS ligada** | Baseline de paridade de consumo antes da mudança de 02/08 |
| `sole_technical_specs_backup_20260630` | 63 | RLS on, 0 policy (INFO) | **mantida** | Contém 7 IDs que **não existem mais** na tabela viva + 54 linhas com valores divergentes |
| `punch_device_map` | 7 | RLS on, 0 policy (INFO) | **mantida, sem policy** | EM USO via RPCs `SECURITY DEFINER`. Criar policy só **aumentaria** a exposição |
| `wa_messages` | **0** | RLS on, 0 policy (INFO) | **DROP** | Vazia, sem código, sem edge function, sem migration no repo |
| `wa_pending_actions` | **0** | RLS on, 0 policy (INFO) | **DROP** | Idem |

**Só duas tabelas foram derrubadas, e ambas estavam vazias.** Nenhuma linha de
dado foi destruída por esta migration.

---

## Por que a maioria NÃO foi derrubada

O briefing tratava as 5 tabelas `_backup_*_20261102` como entulho antigo. **Não são.**

`backed_up_at` de todas as cinco é **2026-08-02** — três dias antes desta ação.
Elas são a rede de rollback da migration
`20261102120000_purge-sole-rows-from-bom-and-fix-standard-flag.sql`, que diz no
cabeçalho, textualmente:

> `-- Reversível: as linhas removidas ficam em '_backup_bom_sole_rows_20261102'.`

Essa migration rodou `delete from public.sheet_materials` em 56 linhas de solado
espalhadas por **8 fichas técnicas** (DS21, DS22, NL01..NL04, S-039, SP201), e
desarmou `is_standard_sole_item` em 7 produtos. Verificação feita em 05/08/2026:

```
no_backup = 56   ainda_vivas = 0   flags_ainda_ativas = 0   fichas_afetadas = 8
```

`ainda_vivas = 0` significa: **as 56 linhas existem só dentro do backup.** Como
custeio e MRP leem `sheet_materials`, derrubar essas tabelas destruiria a única
forma de reverter uma mudança de custo com 3 dias de vida e ainda não validada
em produção.

O problema de segurança apontado é real — as 5 estavam legíveis pela chave anon.
Mas o problema é **"legível por anon"**, não **"a tabela existe"**.
`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` sem policy fecha o acesso via
PostgREST por completo (anon e authenticated), zera os 5 ERROR do advisor e
**preserva o rollback**. É o mesmo remédio que a migration
`20260903110000_rls-backup-table.sql` já aplicou em
`sole_technical_specs_backup_20260630`, com esta justificativa:

> `-- Habilitar RLS sem policy bloqueia todo acesso via API (leitura segue`
> `-- possível no SQL Editor/service_role, que é o único uso legítimo de um backup).`

---

## Por que `punch_device_map` fica sem policy

A tabela é lida por três funções: `punch_map_resolve` e `get_punch_reconciliation`
(ambas `SECURITY DEFINER`, dono `postgres`) e o gatilho
`trg_resolve_tr_employee` → `resolve_time_record_employee` (`SECURITY INVOKER`).

O gatilho ser INVOKER levantou a suspeita de que a RLS o estivesse cegando
(`select ... into new.employee_id` sem linha visível grava **NULL** em silêncio).
Verificação empírica descartou:

```sql
set local role authenticated;
select count(*) from public.punch_device_map;   -- 0  (RLS nega, como esperado)
```

Mas o caminho real de importação é a RPC `import_time_records_safe`, que é
`SECURITY DEFINER` com dono `postgres` — e dono de tabela ignora RLS. Logo o
gatilho enxerga o mapa. Confirmado no dado: das linhas de `time_records` criadas
**depois** do último backfill (`punch_map_resolve`), **131 de 131** têm
`employee_id` resolvido, e zero ficaram nulas nos 7 dispositivos vinculados.

Conclusão: nenhum caminho do app precisa de policy. Criar uma
`using (is_approved_user())` só exporia o vínculo `device_id ↔ employee_id` (PII
de RH) via PostgREST sem ganho funcional. A tabela ganhou um `COMMENT` explicando
isso, para a próxima auditoria não "consertar" o que está certo.

---

## DDL das duas tabelas derrubadas (recriação completa)

Ambas estavam **vazias** — não há dado a restaurar, só a estrutura.

```sql
CREATE TABLE public.wa_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_message_id text NOT NULL UNIQUE,
  from_number   text NOT NULL,
  kind          text NOT NULL,
  raw           jsonb NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wa_messages ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.wa_pending_actions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_number  text NOT NULL,
  intent       text NOT NULL,
  extracted    jsonb NOT NULL,
  supplier_id  uuid REFERENCES public.suppliers(id),
  status       text NOT NULL DEFAULT 'pending',
  summary_sent text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);
CREATE INDEX wa_pending_actions_from_status_created_idx
  ON public.wa_pending_actions (from_number, status, created_at DESC);
ALTER TABLE public.wa_pending_actions ENABLE ROW LEVEL SECURITY;
```

Eram o esqueleto de uma ingestão de WhatsApp (mensagem crua + ação pendente com
`intent`/`extracted` para confirmação por fornecedor). Nunca receberam uma linha,
não têm migration no repo (foram criadas ad-hoc via MCP/SQL Editor) e não
aparecem em nenhum código fora do `types.ts` gerado. Se a feature voltar, o DDL
acima recria tudo.

---

## Conteúdo de `_backup_standard_sole_flag_20261102` (7 linhas)

Os 7 solados que tinham `is_standard_sole_item = true` e foram desarmados:

```sql
INSERT INTO public._backup_standard_sole_flag_20261102 (product_id, name, category, backed_up_at) VALUES ('7056af4c-fa67-40d6-9394-0f29c7b37c0a', '01', 'Solado', '2026-08-02T10:21:51.493769-03:00');
INSERT INTO public._backup_standard_sole_flag_20261102 (product_id, name, category, backed_up_at) VALUES ('206eced8-8eb0-44bc-b376-148670f32419', 'INFANTIL [fundido em INFANTIL / CARAMELO]', 'Solado', '2026-08-02T10:21:51.493769-03:00');
INSERT INTO public._backup_standard_sole_flag_20261102 (product_id, name, category, backed_up_at) VALUES ('5e6717d5-c658-4c73-9eee-3492ddb25f1e', '180 SALTO BLOCO', 'Solado', '2026-08-02T10:21:51.493769-03:00');
INSERT INTO public._backup_standard_sole_flag_20261102 (product_id, name, category, backed_up_at) VALUES ('14b96bf7-a96b-4b4f-8b37-217eb4d7cfd3', 'INFANTIL', 'Solado', '2026-08-02T10:21:51.493769-03:00');
INSERT INTO public._backup_standard_sole_flag_20261102 (product_id, name, category, backed_up_at) VALUES ('ed44dd78-46b0-4a68-9d80-03d75f4b4ba7', '238', 'Solado', '2026-08-02T10:21:51.493769-03:00');
INSERT INTO public._backup_standard_sole_flag_20261102 (product_id, name, category, backed_up_at) VALUES ('3825976c-e6bb-4f37-997d-be91accbe061', '204', 'Solado', '2026-08-02T10:21:51.493769-03:00');
INSERT INTO public._backup_standard_sole_flag_20261102 (product_id, name, category, backed_up_at) VALUES ('07d82225-5f2e-48a9-afcc-9a61f6e1c10f', '01', 'Solado', '2026-08-02T10:21:51.493769-03:00');
```

As 8 fichas atingidas pelo delete de BOM (`_backup_bom_sole_rows_20261102`):

```
afe01930-4369-4f62-b233-b8ba914513ad   2dd9959f-bb71-47be-8aa1-a922534df419
03c31427-5bca-4a9c-b01b-2f7c62aa5219   517c060c-25ef-459e-8edd-524a5088e4a1
dee92bd6-643d-4651-818e-f2a75cfabf13   789be398-3cef-4f79-b6dd-01cec20931e1
fa439e2f-66c0-418b-be59-c685abd9b212   01918677-7c7f-4aef-8d8f-e8d864b363db
```

---

## Como exportar qualquer uma delas (elas continuam no banco)

Gera os `INSERT`s de qualquer tabela, na ordem correta de colunas:

```sql
select string_agg(stmt, E'\n') from (
  select format('INSERT INTO public.%I (%s) VALUES (%s);', '<TABELA>',
    (select string_agg(quote_ident(key), ', ')     from json_each_text(row_to_json(t))),
    (select string_agg(quote_nullable(value), ', ') from json_each_text(row_to_json(t)))) stmt
  from public.<TABELA> t
) s;
```

Tamanhos, para dimensionar: `_backup_fn_by_grade_20261102` 47 KB (fonte de função),
`_parity_before_20261102` 89 KB (jsonb), `_backup_sole_technical_specs_20261102` 23 KB,
`_backup_bom_sole_rows_20261102` 15 KB, `sole_technical_specs_backup_20260630` 12 KB.

---

## Rollback da migration `20261102120000` (se algum dia for preciso)

```sql
-- 1) devolve as 56 linhas de solado ao BOM
insert into public.sheet_materials
select id, sheet_id, product_id, quantity_per_unit, color, width, weight, supplier,
       notes, sizes, created_at, group_id, consumption_per_size, sector,
       consumption_type, wastage_percentage, part_name, color_id, material_variant_id
from public._backup_bom_sole_rows_20261102;

-- 2) rearma a flag nos 7 solados
update public.products p set is_standard_sole_item = true
from public._backup_standard_sole_flag_20261102 b where p.id = b.product_id;
```

## Quando derrubar de vez

Depois que custeio e MRP das 8 fichas forem conferidos em produção e o épico
"Consumo padrão por modelo de solado" fechar. Aí sim `DROP TABLE` nas cinco
`_backup_*_20261102` / `_parity_before_20261102` — com este documento
regenerado com os dumps completos antes.
