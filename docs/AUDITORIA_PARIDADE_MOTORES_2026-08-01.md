# Auditoria de paridade de motores — 01/08/2026

> **Régua desta auditoria:** só entra achado com divergência **demonstrável** —
> evidência medida no banco de produção ou casamento/não-casamento de hash
> verificável. Suspeita sem caminho de falha não entra.
>
> **Referência adotada:** o TS é o certo; divergência = SQL desalinhado.
> **Modo:** read-only. Nenhuma correção foi aplicada.

Banco auditado: `ssvxfoybzmjlypnipqzn` (produção, us-west-2).
Base de código: 1.051 arquivos TS/TSX (~317k linhas), 1.327 arquivos de migration.

---

## 0. O que ficou de fora (e por quê)

**A varredura do Codex não rodou.** O gateway `avellogateway.online` devolveu
`502 Bad Gateway` no upstream em **3/3 tentativas**, com 5 reconexões cada — o
mesmo modo de falha já registrado em sessões anteriores. O smoke test foi feito
*antes* de montar as fatias, então o custo da indisponibilidade foi ~zero.

Consequência: **a leitura fina TS↔SQL linha a linha dos motores não foi feita.**
Os insumos para ela estão prontos e persistidos (ver §5) — quando o gateway
voltar, o sweep roda sem refazer nada.

O que **foi** feito não dependia do Codex: a reconciliação arquivo-vs-banco
(§1–§3) e a verificação empírica de paridade (§4).

---

## 1. ACHADO PRINCIPAL — o repositório não descreve o banco

Método: extraí o corpo vivo (`pg_proc.prosrc`) das **501 assinaturas de função**
de `public` (**497 nomes distintos** — o resto é overload), extraí o corpo de
**1.378 definições** de função nas 1.327 migrations, e casei por **md5 exato do
corpo**. A categorização abaixo é por nome (497), tratando overloads como
"casa se qualquer assinatura viva casar".

| Categoria | Qtd | % | Significado |
|---|---:|---:|---|
| **A** — última migration == banco | 238 | 47,9% | arquivo é verdade |
| **B** — banco == migration **anterior** | 23 | 4,6% | **a última migration nunca surtiu efeito** |
| **C** — nenhuma migration bate | 204 | 41,0% | **corpo vivo não existe em arquivo nenhum** |
| **D** — sem migration que a defina | 32 | 6,4% | função só existe no banco |

Reproduzível: `python3 scripts/audit-function-drift.py <dump.json>` devolve
exatamente estes números e sai com código 1 (verificado).

**Por que isso é confiável e não artefato do parser:** as 238 da categoria A são
casamentos **md5 exatos**. Se a extração de corpo estivesse errada (delimitadores,
espaços em branco), nenhuma casaria. 238 casamentos exatos provam o método.

### 1.1 Registro de migrations vs arquivos

| mês | registradas no banco | arquivos no repo | órfãs |
|---|---:|---:|---:|
| 2026-05 | 779 | 354 | **+425** |
| 2026-07 | 339 | 125 | **+214** |
| 2026-06 | 344 | 175 | **+169** |
| demais | 678 | 673 | +5 |
| **total** | **2.140** | **1.327** | **+813** |

**813 versões constam como aplicadas no banco sem nenhum arquivo correspondente.**

**Consequência concreta:** o GitHub Action `supabase-migrate.yml` roda
`supabase db push`. Um banco construído a partir deste repositório seria
**materialmente diferente** de produção — 204 funções com corpo divergente e 32
inexistentes. O `CLAUDE.md` já documenta "4 migrations pendentes"; a medição
mostra que o problema é de outra ordem de grandeza.

---

## 2. Categoria B — migrations escritas que nunca surtiram efeito (23)

Estas são as mais acionáveis: **existe um arquivo de migration declarando uma
definição, o arquivo consta como aplicado em `schema_migrations`, e o banco roda
uma versão ANTERIOR.** Alguém escreveu a correção e ela não está no ar.

| Função | Migration que não pegou |
|---|---|
| `advance_wave_stage` | `20260522120003_tighten-wave-rpcs-and-resync-approved-user` |
| `auto_start_due_waves` | idem |
| `create_production_wave` | idem |
| `split_wave_to_finishing` | idem |
| `start_wave` | idem |
| `calculate_sale_order_weight` | `20260723200000_sale-order-weight-box-count-model` |
| `tg_create_ap_for_service_order` | `20260826120000_service-order-multi-contractor-split` |
| `tg_apply_service_order_dispatch` | `20260825120000_service-order-partial-dispatch-tranches` |
| `strap_base_family_for_sheet` | `20261027120000_variant-main-material-cascade` |
| `get_payroll_inputs_for_period` | `20260628150001_payroll-runs-complete-schema-and-advances-link` |
| `generate_op_number` | `20260531120001_numbering-sequential-and-os-automation` |
| `calc_required_for_grade` | `20260502231728_cf3058ca-…` |
| `get_sole_size_key` | `20260507140000_fix-sole-debit-metadata-pollution` |
| `stage_order` | `20260521120001_add-costura-sector` |
| `kanban_stage_to_wave_stage`, `wave_stage_to_kanban_stages` | `20260508120000_kanban-wave-mapping-after-sector-rename` |
| `check_sale_order_single_active_wave`, `get_in_production_stock`, `parse_iso_billing_week`, `wave_is_active` | `20260430132723_8bb0e741-…` |
| `fn_sync_wave_on_stage_complete` | `20260430133934_1063e260-…` |
| `set_companies_updated_at`, `trg_fn_block_rascunho_wave_assignment` | `20260502232315_9f2af3cd-…` |

### Os três que merecem decisão imediata

**(a) `20260522120003_tighten-wave-rpcs` — migration de SEGURANÇA que não pegou.**
Cinco RPCs de wave (`advance_wave_stage`, `start_wave`, `create_production_wave`,
`auto_start_due_waves`, `split_wave_to_finishing`) continuam na versão **anterior
ao endurecimento**. É exatamente a mecânica que produziu o P0 de auto-aprovação em
`profiles` (guarda escrita, guarda nunca efetivada). Verificar o que o "tighten"
adicionava antes de concluir se há exposição.

**(b) `20261027120000_variant-main-material-cascade` — a memória do projeto registra
esta migration como APLICADA.** `strap_base_family_for_sheet` prova que ao menos
parte dela não entrou. Contradição direta entre o registrado e o vivo.

**(c) `20260723200000_sale-order-weight-box-count-model`.** O modelo de peso por
contagem de caixas nunca entrou; produção calcula peso pelo modelo antigo
(`box_weight_kg` por par). Relevante para NF-e (peso/volumes), área que já está
com problema conhecido desde 18/06.

---

## 3. Impacto nos motores de consumo

Categoria de reconciliação das funções que formam os motores:

| Motor | Categoria C (nenhum arquivo reproduz) |
|---|---|
| **Consumo** | `calculate_order_consumption_by_grade` ⚠, `get_material_conversion_info`, `get_effective_bom`, `resolve_material_product`, `resolve_upper/lining/insole/fachete_material_for_variant`, `resolve_strap_base_napa`, `resolve_strap_sourcing`, `resolve_strap_stock_lines` |
| **Custeio / MRP** | `calculate_order_cost`, `compute_materials_per_pv`, `get_wave_material_needs_core`, `check_order_material_gate`, `compute_material_ready_date`, `recompute_sale_order_cmv_recognition`, `recompute_material_gate_for_sale_orders`, `process_dirty_order_costs` |
| **Reserva / débito** | `hybrid_debit_stock_for_order`, `consume_all_reservations_for_order`, `debit_strap_stock`, `debit_packaging_for_order`, `restore_sole_grade_for_order`, `resync_op_material_reservations` |

⚠ **`calculate_order_consumption_by_grade` é o núcleo do motor de consumo (47.622
caracteres) e está na categoria C.** Nenhuma das 1.327 migrations reproduz o que
roda em produção. Qualquer análise de consumo feita lendo os arquivos de migration
— humana ou automatizada — está lendo ficção.

Isto valida em retrospecto a regra do `CLAUDE.md` ("a verdade é o BANCO") e é a
razão pela qual o snapshot de §5 foi extraído do banco vivo, não dos arquivos.

---

## 4. Verificação empírica — o que está SAUDÁVEL

Nem tudo diverge. Medido no banco de produção, hoje:

| Verificação | Resultado |
|---|---|
| `run_consumption_parity_tests()` | **22/22 passam** |
| `run_debit_guard_tests()` | **22/22 passam** |
| vitest (`orderConsumption`, `rpc-parity`, `financialSyncShared.parity`) | **83 passam**, 1 skipado |
| `list_materials_missing_width()` | **0** |

Ou seja: **os invariantes que têm guarda automatizada estão íntegros.** O motor
escalar delega ao `by_grade`, a conversão dm²→unidade é aplicada, o legado
`insole_mode` sumiu, o Fachete entra, o forro alternativo é pick-one, a reserva
deriva do motor unificado. Isso é evidência positiva e não deve ser confundido
com ausência de auditoria.

> Nota: `consumptionService.parity.test.ts` fica skipado sem `RUN_DB_INTEGRATION=1`,
> mas ele apenas embrulha `run_consumption_parity_tests()` via `psql` — que foi
> executado direto contra produção. A cobertura não foi perdida. (`psql` não está
> instalado nesta máquina de qualquer forma.)

### 4.1 O que a medição acusou de errado

`consumption_consistency_report()` — checks de severidade **alta** do consumo
(`material_linear_sem_largura`, `persize_diverge_do_escalar`,
`consumo_implausivel_alto`, `cor_sem_mapeamento_componentes_por_cor`) estão todos
em **0**. Mas:

| Check | Qtd | Sev | Observação |
|---|---:|---|---|
| `direct_components_produto_inexistente` | **25** | alto | a migration `20261028120000` fechou o *mecanismo* (produto apagado deixando ficha órfã), mas **os 25 órfãos pré-existentes nunca foram limpos** |
| `material_base_artesanal_sem_cor` | 132 | médio | tiras/tranças sem cor na napa base |
| `forro_cabedal_duplicado_com_palmilha` | 27 | baixo | classe conhecida de duplicidade |
| `produto_artesanal_flag_inconsistente` | 4 | médio | TIRA OVERLOCK 5MM |
| `direct_components_nome_desatualizado` | 4 | médio | Ilhós 51, Rebite |
| `solado_fachetado_sem_specs_fachete` | 2 | médio | 180 SALTO BLOCO |

E `list_stock_debit_holes(90)` retorna **1.172 buracos de débito** nos últimos 90 dias.

---

## 5. Insumos prontos para o sweep do Codex

Persistidos e reutilizáveis quando o gateway voltar (284k de SQL vivo, extraído de
`pg_proc`, com a categoria de reconciliação anotada em cada função):

| Fatia | Funções | Tamanho | Contraparte TS |
|---|---:|---:|---|
| `A_consumo.sql` | 25 | 90.596 | `orderConsumption.ts`, `materialConsumption.ts`, `bomConsumption.ts` |
| `B_custeio_mrp.sql` | 12 | 50.235 | `costingService`, projeção de compras |
| `C_reserva_debito.sql` | 12 | 96.137 | `serviceOrderStock.ts`, caminhos de débito |
| `D_contrato_testes.sql` | 7 | 46.892 | contrato de paridade |

---

## 6. Melhoria que elimina a classe (não solta)

O problema de §1 não é um bug pontual — é **drift silencioso**: nada no projeto
detecta quando o banco vivo passa a divergir dos arquivos. Ele cresceu até 41% do
corpo de funções sem ninguém perceber, e a auditoria de 30/07 (que concluiu "4
pendentes") não o pegou porque verificava **existência** de objeto, não **corpo**.

O script `scripts/audit-function-drift.py` (adicionado por esta auditoria)
reproduz a medição de §1 de forma determinística. Rodado no CI, transforma o drift
de invisível em falha de build. É a única correção que impede a classe inteira de
voltar — as demais correções seriam pontuais e o drift as engoliria de novo.

---

## 7. Ordem sugerida de ataque

1. **Decidir sobre `20260522120003_tighten-wave-rpcs`** — é segurança e não está no ar.
2. **Limpar os 25 `direct_components` órfãos** — medido, escopo fechado, sem decisão de design.
3. **Reconciliar as 23 da categoria B** — cada uma é "alguém escreveu e não entrou".
4. **Ligar o guard de drift no CI** antes de qualquer tentativa de `db push`.
5. **Rodar o sweep do Codex** com os snapshots de §5 quando o gateway voltar.
