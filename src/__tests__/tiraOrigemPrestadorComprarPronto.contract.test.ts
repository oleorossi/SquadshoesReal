import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIG_DIR = resolve(__dirname, '../../supabase/migrations');
const MIG_NAME = '20270101032300_tira-origem-prestador-comprar-pronto.sql';
const read = (name: string) => readFileSync(resolve(MIG_DIR, name), 'utf8');

/** Conteúdo entre `$tag$ … $tag$` (dollar-quoted) do arquivo. */
function dollarQuoted(sql: string, tag: string): string {
  const open = `$${tag}$`;
  const start = sql.indexOf(open);
  if (start < 0) throw new Error(`tag ${tag} ausente`);
  const end = sql.indexOf(open, start + open.length);
  if (end < 0) throw new Error(`tag ${tag} sem fechamento`);
  return sql.slice(start + open.length, end);
}

describe('Fatia 1 tiras — padrão do catálogo no writer, PV vence (20270101032300)', () => {
  const sql = read(MIG_NAME);
  const oldGate = dollarQuoted(sql, 'old_gate');
  const newGate = dollarQuoted(sql, 'new_gate');
  const oldMsg = dollarQuoted(sql, 'old_msg');
  const newMsg = dollarQuoted(sql, 'new_msg');

  it('o trecho procurado é exatamente o que a 28600 gravou no corpo vivo', () => {
    // A 28600 injetou o gate por replace; o texto vivo é o $new$ dela.
    const mig28600 = read('20270101028600_pv-tira-pronta-sku-sem-group-id-vira-fabrica.sql');
    expect(mig28600).toContain(oldGate);
    expect(oldGate).toContain('strap_pv_sku_sem_group_id_vira_fabrica_20270101028600');
  });

  it('a mensagem procurada é a que a 31900 manteve no ramo Comprar pronto', () => {
    const mig31900 = read('20270101031900_pv-sku-acabado-buy-ready-sem-variante.sql');
    expect(mig31900).toContain(oldMsg);
    expect(oldMsg).toContain('Fazer (fábrica)');
    expect(newMsg).toContain('use Prestador');
    expect(newMsg).not.toMatch(/Fazer|fábrica/);
  });

  it('padrão entra ANTES da coerção 28600 e preserva o gate original intacto', () => {
    expect(newGate.endsWith(oldGate)).toBe(true);
    const defaultAt = newGate.indexOf('strap_pv_origem_padrao_catalogo_20270101032300');
    const coerceAt = newGate.indexOf('strap_pv_sku_sem_group_id_vira_fabrica_20270101028600');
    expect(defaultAt).toBeGreaterThanOrEqual(0);
    expect(defaultAt).toBeLessThan(coerceAt);
  });

  it('só preenche pv_origem AUSENTE — escolha explícita do PV vence o catálogo', () => {
    const fill = newGate.slice(0, newGate.indexOf('-- strap_pv_sku_acabado_fornecedor_20270101024000'));
    expect(fill).toContain("nullif(v_line ->> 'pv_origem', '') IS NULL");
    expect(fill).toContain("v_sheet_basis = 'reference_base'");
    expect(fill).toContain("measure.origem_padrao = 'sempre_sku_acabado'");
    expect(fill).toMatch(/THEN 'sku_acabado'\s+ELSE 'fabrica'/);
  });

  it('falha alto quando o corpo vivo divergiu e é idempotente pelo marcador', () => {
    expect(sql).toContain("pg_get_functiondef(v_fn)");
    expect(sql).toMatch(/IF v_hits IS DISTINCT FROM 1 THEN\s+RAISE EXCEPTION/);
    expect(sql).toContain("position('strap_pv_origem_padrao_catalogo_20270101032300' IN v_def) > 0");
    expect(sql).toContain('prepare_sale_order_item_internal_straps(jsonb)');
  });

  it('não renomeia enum nem converte dado: PVs abertos internal já são Prestador', () => {
    const code = sql.replace(/--[^\n]*/g, '');
    expect(code).not.toMatch(/\bUPDATE\s+public\./i);
    expect(code).not.toMatch(/ALTER\s+TABLE/i);
    expect(code).not.toMatch(/DROP\s+CONSTRAINT/i);
  });

  it('o carimbo não colide com outra migration', () => {
    const stamps = readdirSync(MIG_DIR)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => name.slice(0, 14));
    expect(stamps.filter((stamp) => stamp === MIG_NAME.slice(0, 14))).toHaveLength(1);
  });
});
