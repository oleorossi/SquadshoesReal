import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (file: string) => readFileSync(resolve(ROOT, 'supabase/migrations', file), 'utf8');

const ORDER = read('20270101026000_strap_netting_takes_allocation_lock_first.sql');
const RETIRE = read('20270101026100_admin_retire_sheet_takes_allocation_lock_first.sql');

/** As três — e só elas — pegam `strap-base-netting` no banco (medido 18/09/2026). */
const NETTING_FUNCTIONS = [
  'reconcile_strap_variant',
  'lock_strap_physical_operation_scope',
  'neutralize_strap_source_override_promises',
] as const;

describe('netting de tira pega a alocação antes do base-netting (20270101026000)', () => {
  it('cobre TODAS as funções de base-netting — corrigir só uma cria nova inversão', () => {
    // `cancel/resume/suspend_strap_operation` e `register_strap_production_receipt`
    // chamam `lock_strap_physical_operation_scope` (base-netting) e DEPOIS a
    // `reconcile_strap_variant`. Se a alocação entrasse só na reconcile, nessas
    // rotas a ordem viraria base-netting -> alocação: a mesma inversão, criada
    // por nós.
    for (const fn of NETTING_FUNCTIONS) {
      expect(ORDER).toContain(`'${fn}'`);
    }
    const listed = ORDER.match(/'reconcile_strap_variant',\s*\n\s*'lock_strap_physical_operation_scope',\s*\n\s*'neutralize_strap_source_override_promises'/g);
    // Uma lista para reescrever, outra para verificar.
    expect(listed).toHaveLength(2);
  });

  it('a ordem canônica é a do save: alocação antes de qualquer lock de tira', () => {
    expect(ORDER).toContain('PERFORM public.lock_sale_order_purchase_allocation();');
    expect(ORDER).toContain(
      "position('lock_sale_order_purchase_allocation' in v_new)\n       >= position('strap-base-netting' in v_new)",
    );
    // E trava o lado que DEFINE a ordem: se o save parar de pegar a alocação
    // antes do strap, a ordem global deixa de existir e o ciclo volta sem
    // quebrar nenhum teste de tira.
    expect(ORDER).toContain("p.proname = 'execute_sale_order_command'");
    expect(ORDER).toContain("position('strap-pv-auto-intent' in v_def)");
  });

  it('a reescrita é provadamente mínima — nenhuma conta de tira muda', () => {
    // O corpo vem de `pg_get_functiondef` e sofre UM `replace`; remover a linha
    // inserida tem que devolver o original byte a byte. Sem isso, um ancora que
    // casasse errado reescreveria silenciosamente o motor de tira.
    expect(ORDER).toContain("IF replace(v_new, v_insert, '') <> v_old THEN");
    expect(ORDER).toContain('alterou mais que a linha do lock');
    // Ancora ambíguo aborta em vez de aplicar no lugar errado.
    expect(ORDER).toContain('IF v_hits <> 1 THEN');
    expect(ORDER).toContain('casou % vezes (esperado 1)');
  });

  it('é idempotente: reaplicar não empilha o lock', () => {
    expect(ORDER).toContain('CONTINUE;');
    expect(ORDER).toMatch(/position\('lock_sale_order_purchase_allocation' in v_old\) > 0/);
  });

  it('NÃO antecipa a alocação no worker de compras — desfaria a mig 24700', () => {
    // Em `process_sale_order_purchase_shortages` a alocação vem depois do
    // cálculo de propósito ("compute before row locks"): antecipá-la faria o
    // worker segurar a linha global durante os ~25s de cálculo (medido:
    // duration 25352.700 ms). E ela não participa do ciclo — o save nunca pede
    // 'sale-order-purchase-shortages:<pv>'.
    const rewriteBlock = ORDER.slice(ORDER.indexOf('DO $fix$'), ORDER.indexOf('DO $verify$'));
    expect(rewriteBlock).not.toContain('process_sale_order_purchase_shortages');
  });

  it('registra que timeout não resolve deadlock — e que subir deadlock_timeout é negado', () => {
    // Medido: set_config('deadlock_timeout','5s',true) como postgres devolve
    // 42501 permission denied (contexto do GUC = superuser, e o `postgres` do
    // Supabase tem rolsuper=false). Sem controlar quem detecta o ciclo, ordem
    // consistente é a única correção — não é preferência de estilo.
    expect(ORDER).toContain('40P01');
    expect(ORDER).toContain('deadlock_timeout');
    expect(ORDER).toContain('42501');
    // A correção não pode depender de baixar timeout do worker.
    expect(ORDER).not.toMatch(/SET\s+lock_timeout\s*=\s*'\d+ms'/i);
  });

  it('aponta o gatilho de DELETE de item como caminho do save', () => {
    // Era o que ligava o sintoma ao ciclo: remover item de PV Aprovado dispara
    // `tg_release_strap_demands_before_item_delete` -> `reconcile_strap_variant`,
    // já com a linha global de alocação na mão.
    expect(ORDER).toContain('tg_release_strap_demands_before_item_delete');
  });
});

describe('aposentar ficha entra na mesma ordem global (20270101026100)', () => {
  // Auditoria do PRÓPRIO fix 26000: pôr a alocação DENTRO do netting fez toda
  // rota que chega ao netting passar a querer a alocação. Das 19 rotas, 18 não
  // tocam lock de PV antes; `admin_retire_technical_sheet` toca
  // ('sale-order-command:<pv>' + sale_orders FOR UPDATE) e só depois chama
  // `reconcile_strap_variant` — inversão criada por nós, não regressão de
  // terceiro.
  it('corrige a inversão que a 26000 criou nessa rota', () => {
    expect(RETIRE).toContain('admin_retire_technical_sheet');
    expect(RETIRE).toContain('PERFORM public.lock_sale_order_purchase_allocation();');
    // Alocação antes do lock por PV — a ordem dos outros 16 comandos.
    expect(RETIRE).toContain(
      "position('lock_sale_order_purchase_allocation' in v_new)\n     >= position('sale-order-command:' in v_new)",
    );
  });

  it('a alocação vem DEPOIS do advisory de idempotência do recibo, não antes', () => {
    // `operational-command-request:<client_request_id>` é por REQUISIÇÃO (duas
    // requisições distintas nunca disputam a mesma chave) e o bloco seguinte dá
    // RETURN quando o recibo já existe. Pegar a linha global antes disso faria
    // todo replay idempotente serializar na alocação sem precisar.
    expect(RETIRE).toContain('operational-command-request');
    expect(RETIRE).toContain('replay idempotente');
    // O ancora é o comentário do advisory de agenda, que vem depois do recibo.
    expect(RETIRE).toContain("v_anchor constant text := '  -- Serializa com o motor de antecipacao.'");
  });

  it('trava o invariante para a base INTEIRA, não só para esta função', () => {
    // Sem isto, o próximo caller novo de netting que segure lock de PV reabre o
    // ciclo em silêncio — foi exatamente assim que a 26000 criou este caso.
    const verify = RETIRE.slice(RETIRE.indexOf('DO $verify$'));
    expect(verify).toContain('reconcile_strap_variant');
    expect(verify).toContain('lock_strap_physical_operation_scope');
    expect(verify).toContain('neutralize_strap_source_override_promises');
    expect(verify).toContain('rotas de netting segurando lock de PV antes da alocacao');
  });

  it('a reescrita é provadamente mínima e idempotente', () => {
    expect(RETIRE).toContain("IF replace(v_new, v_insert, '') <> v_old THEN");
    expect(RETIRE).toContain('IF v_hits <> 1 THEN');
    expect(RETIRE).toContain('ja esta na ordem canonica');
  });

  it('registra que os dois advisories globais que sobram não formam par invertido', () => {
    // Medido: 'recompute_production_schedule' e 'outsource_service_order_generation'
    // têm ZERO funções que os peguem depois da alocação, então podem ficar antes
    // dela nesta rota sem criar ciclo. Sem essa medição, mover a alocação para o
    // topo absoluto pareceria obrigatório.
    expect(RETIRE).toContain('recompute_production_schedule');
    expect(RETIRE).toContain('outsource_service_order_generation');
  });
});
