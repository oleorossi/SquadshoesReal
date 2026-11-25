# Motor de produção: ordem única, Prazos do motor e compras automáticas

Data: 25/11/2026. Aprovado pelo Leonardo em 25/11, 17:46 BRT.

Migrations:

| Migration | O que faz |
|---|---|
| `20270101054700_motor_prazos_config.sql` | Cria os prazos configuráveis, o prazo efetivo do prestador, a data de chegada do material, as datas previstas do prestador (com capacidade), a ligação kit ↔ reserva e as RPCs `get_motor_config` / `update_motor_settings`. |
| `20270101054800_motor_ordem_unica_agenda.sql` | Cria a ordem única do motor (fila = agenda), reescreve a agenda (com previsão do item complexo enquanto está no prestador), refaz `list_production_sequence` e a view `v_production_motor_plan`, e corrige o `queue_position` do Kanban. |
| `20270101054900_motor_compras.sql` | Ajusta as datas da OC do kit para o envio ao prestador, cria a tabela de prioridade das OCs em rascunho, corrige o snapshot de compra para usar os materiais de cada item e faz o gatilho de despacho preservar as datas do kit. |

## O que muda

1. **Uma ordem só para a fila e para a agenda.** A ordem é:
   1. fixados, congelados e urgentes;
   2. semana de faturamento (a caixa);
   3. dentro da semana, cabedal complexo e simples alternados por pares acumulados;
   4. cor e referência.

   O antigo "fecha PV" agora mede os pares já produzidos do PV.
2. **O item complexo só entra na agenda depois que o cabedal volta.** Ele entra na Montagem (o setor que espera o cabedal, configurável) e nos setores seguintes a partir da volta prevista do prestador. Os simples preenchem os dias antes disso. Enquanto o item não tem OP, a previsão fica em `production_motor_forecast`.
3. **Falta de material empurra o início.** Uma OP que ainda não começou e tem material faltando só é agendada a partir da chegada prevista da OC. A conta é:
   - OC já colocada: data prometida;
   - OC em rascunho: hoje + lead;
   - sem OC: hoje + lead padrão.

   O solado só segura o setor de Solagem.
4. **Setor feito pelo prestador não é agendado na fábrica.** Para referências complexas, Corte Cabedal, e Costura Cabedal / Aviamento quando vão para a rua, saem da agenda interna.
5. **A sugestão de compra usa os materiais de cada item.** `list_cabedal_motor_purchase_snapshot` lê a ficha × grade do item, e não mais as reservas do PV inteiro repetidas a cada item.
6. **A capacidade do prestador empurra as datas.** O envio e a volta previstos respeitam os pares/dia do prestador padrão. Uma referência sem prazo próprio usa o prazo padrão; vazio cai em Costura/Aviamento.

### Ao aprovar um PV com cabedal complexo (sem clique)

- **Material em estoque.** A aprovação já empenha o estoque livre no PV. Agora as reservas dos materiais do kit do Ateliê são marcadas como `atelier_prep` e ligadas ao item e aos jobs. Essas reservas não são encolhidas pela realocação, então outro pedido não consome esse material. A entrada de estoque continua realocando pela semana de faturamento.
- **Material em falta.** O outbox cria a OC do kit em **rascunho/sugerida**, com:
  - chegar = envio ao prestador;
  - comprar até = envio − lead;
  - `expedite` se o PV é urgente ou se o comprar-até cai dentro da janela de urgência.

  A tabela `purchase_order_motor_priority` coloca essa OC no topo da lista de OCs com o selo Atrasada/Urgente e o motivo.
- **OC real continua só pelo clique em "Gerar OC".**

## Prazos do motor (Terceirizados › Modelos)

Cada campo da tela mostra onde o motor usa o valor. Os padrões repetem o comportamento de antes desta mudança.

| Campo | Padrão | Faixa | Onde o motor usa |
|---|---|---|---|
| Prazo padrão do prestador | vazio (usa Costura/Aviamento = 5) | 1–60 dias úteis | Envio ao prestador = pronto − prazo, para referência complexa sem prazo próprio |
| Costura / Aviamento | 5 / 5 | 0–60 dias úteis | Último recurso do prazo do prestador |
| Pronto antes do faturamento | 7 | 0–60 dias | Cabedal pronto e material das OCs do PV na fábrica até a semana de faturamento − N |
| Setor que espera o cabedal | Montagem | setores ativos | A partir de qual setor o item complexo espera a volta |
| Lead padrão de OC | 10 | 1–120 dias | Fornecedor/produto sem lead cadastrado |
| Janela de urgência da OC | 2 | 0–30 dias úteis | OC em rascunho com comprar-até dentro da janela vira "Urgente" |
| Teto semanal de compra | vazio (sem teto) | > 0 | Selo "Passa do teto" na lista de OCs |
| Horizonte / Folga de material | 10 / 2 | — | Sugestão de compra do motor (sem mudança) |

- O prazo por referência continua na lista de Modelos e é validado entre 1 e 60 (vazio = padrão).
- A capacidade do prestador fica em "Prestadores de costura/aviamento".
- As chaves `auto_motor_enabled` e `urgent_release_without_material` aparecem só para leitura. `update_motor_settings` recusa essas chaves.

## Campos novos para Fila / Gestão

- `list_production_sequence()` ganhou as colunas: `item_class`, `billing_anchor`, `is_urgent`, `earliest_start`, `wait_reason`, `projected_completion`.
  - `sequence_position` é a ordem do motor.
  - `close_score` é a fração produzida do PV.
  - `block_reason` traz "Aguardando prestador · volta DD/MM" ou "Aguardando material · chega DD/MM".
- `v_production_motor_plan` (security_invoker) traz uma linha por OP ou por item complexo ainda sem OP, com estas colunas:
  - `motor_position`, `item_class`;
  - `is_virtual` (item ainda sem OP), `billing_anchor`, `is_urgent`;
  - `wait_reason` (aguardando_prestador | aguardando_material | aguardando_solado);
  - `cabedal_expected_return`, `material_eta`;
  - `projected_completion`, `days_vs_billing`.
- `v_production_queue_detail.queue_position` agora ordena primeiro por `production_motor_state.motor_position`. **Quem recriar essa view precisa manter esse critério.**
- `atelier_jobs_expected_dates()` traz o envio e a volta previstos de cada job, a chegada do kit e se a capacidade empurrou a data.

## Ensaio

Script: `scripts/teste-motor-complexo-simples.sql`, seção `veredito`.

- Roda com rollback.
- Injeta as migrations no marcador `@MIGRATIONS@` antes de elas estarem aplicadas.
- Critérios:
  - (a) prestador com tempo;
  - (b) mescla complexo×simples na Montagem;
  - (c) caixa / ordem por semana;
  - (d) realismo (contadores devem dar 0);
  - (e) fim previsto vs semana.
