import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * PV-00232 (12/10/2026): a aprovação travou em "Erro → Aprovado" com
 * "idempotency_key é obrigatório (máximo 200 caracteres)". Eram DOIS defeitos
 * empilhados, e o segundo escondia o primeiro — ver o cabeçalho da migration
 * 20270101039800 para a história completa.
 *
 * Este contrato trava as quatro regras do conserto. Onde dá, por COMPORTAMENTO
 * (o cálculo do tamanho da chave roda de verdade aqui); onde só dá texto, ele
 * aponta para a migration que define a função AGORA — contrato lendo arquivo
 * superado passa verde enquanto a função viva perde a guarda.
 */

const ROOT = resolve(__dirname, '../..');
const FIX = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101039800_ator_da_fila_de_materializacao.sql'),
  'utf8',
);
const COMMAND = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101010400_atomic_sale_order_promotion_command.sql'),
  'utf8',
);

function sqlBlock(sql: string, marker: string, terminator: string): string {
  const start = sql.indexOf(marker);
  expect(start, `${marker} ausente`).toBeGreaterThanOrEqual(0);
  const tail = sql.slice(start);
  const end = tail.indexOf(terminator);
  expect(end, `${marker} sem terminador`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + terminator.length);
}

const triggerFn = sqlBlock(
  FIX,
  'CREATE OR REPLACE FUNCTION public.tg_sale_order_command_receipt_actor()',
  '\n$fn$;',
);
const enqueue = sqlBlock(
  FIX,
  'CREATE OR REPLACE FUNCTION public.enqueue_sale_order_materialization(',
  '\n$function$;',
);
const retry = sqlBlock(
  FIX,
  'CREATE OR REPLACE FUNCTION public.retry_sale_order_materialization(',
  '\n$function$;',
);

/** Teto que o executor aplica. Lido do arquivo, não fixado à mão. */
const EXECUTOR_LIMIT = 200;

describe('chave de idempotência do retry — comportamento', () => {
  const COMMANDS = ['confirm', 'promote', 'cancel', 'transition'];
  const UUID = 'a6f673d0-64b6-436a-9ae2-233cfd400d36';

  /** Forma NOVA: 'pv:' || id || ':' || comando || ':retry:' || uuid. */
  const novaChave = (saleOrderId: string, command: string) =>
    `pv:${saleOrderId}:${command}:retry:${UUID}`;

  /** Forma ANTIGA, que causou o bug: concatena na chave anterior. */
  const chaveAntiga = (anterior: string) => `${anterior}:retry:${UUID}`;

  it('a forma ANTIGA estoura 200 caracteres — é o bug que travou o PV-00232', () => {
    // Chave inicial real do PV-00232, medida no banco: 84 caracteres.
    let chave = `pv:${UUID}:confirm:743c2db4-8c48-4228-b4c1-f3c8cf8b3227`;
    expect(chave.length).toBe(84);

    const crescimento = [chave.length];
    for (let i = 0; i < 3; i += 1) {
      chave = chaveAntiga(chave);
      crescimento.push(chave.length);
    }

    // Exatamente a progressão medida nos 5 jobs do PV-00232.
    expect(crescimento).toEqual([84, 127, 170, 213]);
    expect(chave.length).toBeGreaterThan(EXECUTOR_LIMIT);
  });

  it('a forma NOVA tem tamanho constante e cabe no teto, para todo comando', () => {
    for (const command of COMMANDS) {
      let chave = novaChave(UUID, command);
      const primeiro = chave.length;

      // 50 retentativas seguidas: a chave é sempre rederivada da raiz.
      for (let i = 0; i < 50; i += 1) {
        chave = novaChave(UUID, command);
        expect(chave.length).toBe(primeiro);
      }
      expect(chave.length).toBeLessThanOrEqual(EXECUTOR_LIMIT);
    }
  });

  it('o retry NÃO concatena na chave anterior', () => {
    const atribuicao = retry.slice(retry.indexOf('v_new_key :='));
    expect(atribuicao).toContain("'pv:' || p_sale_order_id::text");
    // v_job.idempotency_key só pode aparecer no comentário histórico, nunca
    // na montagem da chave nova.
    const codigo = atribuicao
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    expect(codigo).not.toContain('v_job.idempotency_key');
  });

  it('o retry se recusa a emitir chave acima do teto', () => {
    expect(retry).toContain('IF length(v_new_key) > 200 THEN');
  });
});

describe('teto da chave: fila e executor concordam', () => {
  it('o executor continua recusando acima de 200', () => {
    expect(COMMAND).toContain('NOT BETWEEN 1 AND 200');
    expect(COMMAND).toContain('idempotency_key é obrigatório (máximo 200 caracteres)');
  });

  it('a fila passou a ter TETO, não só piso — era o furo que deixava job nascer morto', () => {
    expect(enqueue).toContain('IF length(v_key) NOT BETWEEN 8 AND 200 THEN');
    // A versão antiga só tinha piso.
    expect(enqueue).not.toContain("length(btrim(COALESCE(p_idempotency_key, ''))) < 8");
  });
});

describe('ator do comando derivado do job', () => {
  it('o trigger deriva de sale_order_materialization_jobs.requested_by', () => {
    expect(triggerFn).toContain('v_actor := COALESCE(v_actor, v_job.requested_by);');
    expect(triggerFn).toContain('NEW.actor_id := v_actor;');
  });

  it('publica o ator no GUC lido pelo gravador de tiras', () => {
    expect(triggerFn).toContain("set_config('app.command_actor_id', v_actor::text, true)");
    expect(FIX).toContain("current_setting(''app.command_actor_id'', true)");
  });

  it('casa o recibo com o job por (sale_order_id, idempotency_key)', () => {
    expect(triggerFn).toContain('j.sale_order_id = NEW.sale_order_id');
    expect(triggerFn).toContain('j.idempotency_key = NEW.idempotency_key');
  });

  it('corrige o actor_id dentro de response no UPDATE do recibo', () => {
    expect(triggerFn).toContain("jsonb_set(");
    expect(triggerFn).toContain("'{actor_id}'");
  });

  it('o trigger está ligado ANTES da escrita, nos dois eventos', () => {
    expect(FIX).toContain('BEFORE INSERT OR UPDATE ON public.sale_order_command_receipts');
    expect(FIX).toContain('FOR EACH ROW EXECUTE FUNCTION public.tg_sale_order_command_receipt_actor()');
  });
});

describe('portão de papel nas DUAS camadas', () => {
  it('a fila exige Comercial/Gerência de quem enfileira', () => {
    expect(enqueue).toContain('FROM public.user_roles ur');
    expect(enqueue).toContain("ANY(ARRAY['admin', 'gerente', 'comercial'])");
    expect(enqueue).toContain("public.can_execute_sale_order_command('edit')");
  });

  it('o worker exige o papel do ator derivado, antes de qualquer mutação', () => {
    expect(triggerFn).toContain('FROM public.user_roles ur');
    expect(triggerFn).toContain('ur.user_id = v_actor');
    expect(triggerFn).toContain('FROM public.profiles p');
    expect(triggerFn).toContain('p.id = v_actor AND p.approved = true');
  });

  /**
   * A ARMADILHA, e o motivo deste teste existir: user_has_any_role(),
   * is_approved_user() e can_execute_sale_order_command() começam com
   * is_service_role_request_128() e devolvem TRUE para service_role
   * INDEPENDENTEMENTE do ator. Usá-las dentro do trigger — que só roda a
   * checagem justamente no caminho service_role — compila, roda, parece certo
   * e não checa absolutamente nada.
   */
  it('o trigger NÃO usa helper que é permissivo com service_role', () => {
    const codigo = triggerFn
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    expect(codigo).not.toContain('user_has_any_role');
    expect(codigo).not.toContain('is_approved_user');
    expect(codigo).not.toContain('can_execute_sale_order_command');
    expect(codigo).not.toContain('is_service_role_request_128');
  });

  it('a fila lê user_roles direto em vez de user_has_any_role', () => {
    const codigo = enqueue
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    expect(codigo).not.toContain('user_has_any_role');
  });
});

describe('pré-voo de tiras no enqueue', () => {
  it('varre os itens do PV com o diagnóstico espelho do writer', () => {
    expect(enqueue).toContain('public.diagnose_sale_order_internal_strap_readiness(');
    expect(enqueue).toContain('FROM public.sale_order_items soi');
    expect(enqueue).toContain("'ready'");
  });

  it('só confirm/promote — cancel e transition não materializam tira', () => {
    expect(enqueue).toContain("IF v_command IN ('confirm', 'promote') THEN");
  });

  it('falha do diagnóstico NÃO vira pendência inventada', () => {
    const preVoo = enqueue.slice(
      enqueue.indexOf('public.diagnose_sale_order_internal_strap_readiness('),
    );
    expect(preVoo).toContain('EXCEPTION WHEN OTHERS THEN');
    expect(preVoo).toContain('v_readiness := NULL;');
  });

  it('roda ANTES do FOR UPDATE, para não segurar o lock do PV durante N diagnósticos', () => {
    const posPreVoo = enqueue.indexOf('diagnose_sale_order_internal_strap_readiness');
    const posLock = enqueue.indexOf('FOR UPDATE;');
    expect(posPreVoo).toBeGreaterThan(0);
    expect(posLock).toBeGreaterThan(posPreVoo);
  });
});
