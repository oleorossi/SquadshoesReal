/**
 * Guarda de ALINHAMENTO da tira (`tg_validate_sale_order_item_strap_color_alignment`)
 * × writer do PV — histórico 40200 (aceitar SKU sem variante).
 *
 * Bug (13/10/2026): trocar a ORIGEM de uma tira `reference_base` para "Comprar
 * pronto" abortava o PV INTEIRO com
 *   "O pedido NÃO foi salvo. Tira sem cor/variante canonica congelada no PV"
 *
 * A 40200 aceitou finished_product_id SEM variante. Superada na pré-checagem
 * pela 46800 (so-registra): Comprar pronto de napa congela só color_id, sem
 * SKU nem variante — ver strapAlignmentComprarProntoSoRegistraPrecheck.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');
const FILE = '20270101040200_alinhamento-strap-aceita-sku-acabado.sql';
const MARKER = 'strap_alinhamento_sku_acabado_sem_variante_20270101040200';
const SO_PRECHECK = '20270101046800_alinhamento-comprar-pronto-so-registra-precheck.sql';
const SO_PRECHECK_MARKER =
  'strap_alinhamento_comprar_pronto_so_registra_precheck_20270101046800';
const migration = readFileSync(resolve(MIGRATIONS, FILE), 'utf8');

function latestMigrationMentioning(needle: string): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  let hit = '';
  for (const file of files) {
    if (readFileSync(resolve(MIGRATIONS, file), 'utf8').includes(needle)) hit = file;
  }
  if (!hit) throw new Error(`nenhuma migration menciona ${needle}`);
  return hit;
}

describe('Alinhamento da tira — buy_ready do PV identifica por SKU acabado', () => {
  it('arquivo 40200 patcha o corpo VIVO (histórico; pré-checagem viva = 46800)', () => {
    expect(migration).toContain(MARKER);
    expect(migration).toContain('pg_get_functiondef');
    expect(migration).toContain(
      "'public.tg_validate_sale_order_item_strap_color_alignment()'",
    );
    // A 46800 cita o marcador 40200 no v_old que substitui — autoridade viva
    // da pré-checagem é a 46800.
    expect(latestMigrationMentioning(MARKER)).toBe(SO_PRECHECK);
    expect(latestMigrationMentioning(SO_PRECHECK_MARKER)).toBe(SO_PRECHECK);
  });

  it('casa com o texto exato da pré-checagem antes de substituir', () => {
    // Se o corpo vivo mudar, a migration tem que FALHAR na aplicação em vez de
    // substituir nada — por isso ela confere hits=1.
    expect(migration).toContain(
      '    IF v_line_color_id IS NULL\n'
      + '       OR v_source_color_id IS DISTINCT FROM v_line_color_id\n'
      + '       OR v_source_variant_id IS NULL THEN\n'
      + "      RAISE EXCEPTION 'Tira sem cor/variante canonica congelada no PV';",
    );
    expect(migration).toContain('hits=%); corpo mudou, revise 40200');
  });

  it('identidade congelada = strap_variant_id OU finished_product_id', () => {
    expect(migration).toContain(
      '       OR (v_source_variant_id IS NULL\n'
      + "           AND nullif(v_source ->> 'finished_product_id', '') IS NULL) THEN",
    );
  });

  it('exige que o ramo sku_acabado da 31900 já exista no corpo vivo', () => {
    // Sem o ramo que revalida o SKU acabado, relaxar a pré-checagem deixaria a
    // linha sem NENHUMA validação de identidade.
    // Conferido pelo RAISE do próprio ramo, NÃO pelo marcador literal da 31900:
    // o contrato pvSkuAcabadoBuyReadySemVariante trata o último arquivo que cita
    // um marcador como quem define aquele corpo.
    expect(migration).not.toContain('strap_pv_sku_acabado_sem_variante_20270101031900');
    expect(migration).toContain(
      "IF position($r31900$RAISE EXCEPTION 'Tira pronta exige origem buy_ready"
      + " com SKU acabado e Cor Principal';$r31900$ IN v_def) = 0 THEN",
    );
    expect(migration).toContain('aplique a 31900 antes da 40200');
  });

  it('confere que os TRÊS ramos de identidade sobreviveram ao replace', () => {
    // A pré-checagem só pode afrouxar porque cada ramo revalida o campo que lhe
    // cabe — e os três são exaustivos.
    expect(migration).toContain(
      "RAISE EXCEPTION 'Tira pronta exige origem buy_ready com SKU acabado e Cor Principal';",
    );
    expect(migration).toContain(
      "RAISE EXCEPTION 'Tira interna deve usar a cor exigida pela ficha, origem internal e napa exata';",
    );
    expect(migration).toContain(
      "RAISE EXCEPTION 'Tira de grupo acabado exige origem fixa buy_ready';",
    );
    expect(migration).toContain('Guarda perdeu um dos ramos de identidade; revise 40200');
  });

  it('NÃO afrouxa o ramo sku_acabado: variante continua tendo que ser NULA', () => {
    expect(migration).toContain("OR v_source_variant_id IS NOT NULL THEN");
    expect(migration).toContain(
      'Ramo sku_acabado deixou de exigir variante nula; revise 40200',
    );
  });

  it('valida o UUID do SKU acabado aqui, porque no UPDATE esta guarda vem antes da 39600', () => {
    // 'trg_validate...' < 'trg_version...' na ordem alfabética dos triggers: sem
    // este cast guardado, um finished_product_id malformado estouraria com
    // "invalid input syntax for type uuid" cru no EXISTS do ramo sku_acabado.
    expect(migration).toContain(
      "      PERFORM nullif(v_source ->> 'finished_product_id', '')::uuid;",
    );
    expect(migration).toContain(
      "RAISE EXCEPTION 'Snapshot de identidade/origem da tira possui UUID invalido';",
    );
  });

  it('a pré-checagem continua exigindo a cor canônica congelada', () => {
    expect(migration).toContain('    IF v_line_color_id IS NULL\n');
    expect(migration).toContain(
      '       OR v_source_color_id IS DISTINCT FROM v_line_color_id\n',
    );
  });
});
