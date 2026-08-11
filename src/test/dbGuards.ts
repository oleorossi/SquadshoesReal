/**
 * Ponte para as suítes de guard que vivem DENTRO do banco.
 *
 * Três testes chamavam `psql` por `execSync`. Isso exigia binário de Postgres e
 * `PGHOST` na máquina — fricção que manteve os quatro testes de banco em skip
 * desde sempre. E skip não é verde: quando finalmente rodamos as funções em
 * 11/08/2026, `run_consumption_integration_tests()` estava com 3 casos
 * VERMELHOS havia tempo indeterminado (fixture gravando numa tabela que virou
 * espelho — migration 20261231121100).
 *
 * As três funções são `public` + SECURITY DEFINER com EXECUTE para `service_role`,
 * então rodam por RPC do supabase-js — que já era dependência do quarto teste.
 * Uma credencial destrava os quatro, e some a dependência de binário.
 *
 * ⚠ Estas suítes ESCREVEM no banco (a de integração cria fixture em `products`,
 * `technical_sheets`, `sole_group_standard_items` e `sole_technical_specs`, com
 * UUIDs fixos, e limpa no fim). Por isso NÃO estão no CI: rodam sob demanda, com
 * `bun run test:db`, quando se mexe em consumo, custeio ou débito. Decisão do
 * dono em 11/08/2026.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const DB_TESTS_ENABLED = process.env.RUN_DB_INTEGRATION === '1';

/** Uma linha do retorno padrão `(case_name, ok, message)` das funções de guard. */
export interface GuardCase {
  case_name: string;
  ok: boolean;
  message: string | null;
}

function requiredEnv(): { url: string; key: string } {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
  // A chave de serviço é a única que cobre as três funções: a de integração dá
  // EXECUTE só a `authenticated`/`service_role`, não a `anon`. A publishable
  // roda as outras duas — aceitamos como plano B para não exigir segredo à toa.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.VITE_SUPABASE_PUBLISHABLE_KEY
    || '';
  if (!url || !key) {
    throw new Error(
      'Faltam credenciais para os testes de banco. Exporte VITE_SUPABASE_URL e '
      + 'SUPABASE_SERVICE_ROLE_KEY (a publishable cobre só parte das funções).',
    );
  }
  return { url, key };
}

let cached: SupabaseClient | null = null;

export function dbTestClient(): SupabaseClient {
  if (!cached) {
    const { url, key } = requiredEnv();
    cached = createClient(url, key, { auth: { persistSession: false } });
  }
  return cached;
}

/**
 * Roda uma suíte de guard do banco e devolve os casos.
 *
 * Erro de permissão vira mensagem explícita em vez de "0 casos" — um retorno
 * vazio silencioso seria lido como suíte verde, que é justamente a armadilha
 * que este arquivo existe para fechar.
 */
export async function runGuardSuite(fnName: string): Promise<GuardCase[]> {
  const { data, error } = await dbTestClient().rpc(fnName);
  if (error) {
    throw new Error(`RPC ${fnName}() falhou: ${error.message} (code=${error.code ?? '—'})`);
  }
  const rows = (data ?? []) as GuardCase[];
  if (rows.length === 0) {
    throw new Error(
      `${fnName}() devolveu 0 casos. Isso não é suíte verde — é credencial sem `
      + 'permissão ou função ausente no banco.',
    );
  }
  return rows;
}

/** Formata as falhas de um jeito que diz O QUE quebrou, não só quantos. */
export function describeFailures(rows: GuardCase[]): string {
  return JSON.stringify(rows.filter((r) => !r.ok), null, 2);
}
