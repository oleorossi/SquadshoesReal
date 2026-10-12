import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Contrato da migration `20270101037800_falta_de_material_por_setor`.
 *
 * Pedido do dono (11/10/2026): a confirmação de apontamento só pergunta nos
 * setores que CONSOMEM o material em falta. O que este arquivo trava é o que
 * não pode se perder numa reescrita: o mapa por componente, a AUSÊNCIA do
 * `ELSE 'Aviamento'`, o fail-safe do setor desconhecido, a expansão do rótulo
 * AGREGADO do empenho do PV, a comparação por `canonical_stage_name`, a guarda
 * de acesso e os REVOKE/GRANT.
 */
const path = 'supabase/migrations/20270101037800_falta_de_material_por_setor.sql';
const sql = readFileSync(join(process.cwd(), path), 'utf8');

function fnBody(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `função ${name} ausente`).toBeGreaterThanOrEqual(0);
  const end = sql.slice(start).search(/\n\$(function)?\$;/);
  expect(end, `fim da função ${name} ausente`).toBeGreaterThan(0);
  return sql.slice(start, start + end);
}

const body = fnBody('list_order_sector_material_shortages');

/** Corpo sem os comentários `--` — eles CITAM o `ELSE 'Aviamento'` que proíbem. */
const code = body.replace(/--[^\n]*/g, '');

describe('falta de material por setor — assinatura e permissão', () => {
  it('recebe OP + setor e devolve as colunas que a tela consome', () => {
    expect(body).toMatch(/\(\s*p_order_id uuid,\s*p_stage_name text\s*\)/);
    for (const col of [
      'product_id uuid', 'product_name text', 'color text', 'unit text',
      'quantity_short numeric', 'shortage_grade jsonb',
      'consumption_sector text', 'sector_source text',
    ]) {
      expect(body, `coluna ${col} ausente`).toContain(col);
    }
  });

  it('padrão de permissão da feature: definer + search_path + is_approved_user + revoke/grant', () => {
    expect(body).toMatch(/LANGUAGE sql\s+STABLE\s+SECURITY DEFINER\s+SET search_path = public/);
    expect(body).toMatch(/AND public\.is_approved_user\(\)/);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.list_order_sector_material_shortages\(uuid, text\)\s*\n?\s*FROM PUBLIC, anon;/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.list_order_sector_material_shortages\(uuid, text\)\s*\n?\s*TO authenticated, service_role;/,
    );
  });

  it('a guarda não pode ser contornada pelo ramo do order_id', () => {
    // `is_approved_user()` mora no CTE `ctx`; sem o EXISTS, `mr.order_id =
    // p_order_id` casaria sozinho e vazaria a OP inteira para não aprovado.
    expect(body).toMatch(/AND EXISTS \(SELECT 1 FROM ctx\)/);
  });

  it('não muda a RPC por PV nem debita nada (setor é apresentação — mig 15500)', () => {
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.list_sale_order_material_shortages/);
    expect(sql).not.toMatch(/CREATE TRIGGER/);
    expect(sql).not.toMatch(/\b(UPDATE|INSERT INTO|DELETE FROM) public\.material_reservations/);
    expect(sql).toMatch(/20270101015500/);
    expect(sql).toMatch(/apresenta[çc][ãa]o\/rastreabilidade/i);
  });
});

describe('falta de material por setor — origem das linhas', () => {
  it('soma a reserva da OP e o empenho do PV (pv_commitment tem order_id NULL)', () => {
    expect(body).toMatch(/FROM public\.orders o\s*\n\s*WHERE o\.id = p_order_id/);
    expect(body).toMatch(/mr\.order_id = p_order_id/);
    expect(body).toMatch(/mr\.sale_order_id = \(SELECT c\.so_id FROM ctx c\)/);
  });

  it('só linha em falta e gerenciada pelo motor de empenho', () => {
    expect(body).toMatch(/WHERE mr\.quantity_short > 0/);
    expect(body).toMatch(/AND public\.material_reservation_is_pv_managed\(mr\)/);
  });

  it('agrega por material: soma a falta e a grade balde a balde', () => {
    expect(body).toMatch(/sum\(k\.quantity_short\) AS quantity_short/);
    expect(body).toMatch(/jsonb_object_agg\(gc\.key, gc\.qty ORDER BY gc\.key\)/);
    expect(body).toMatch(/GROUP BY k\.product_id/);
  });
});

describe('falta de material por setor — resolução do setor', () => {
  const mapBlock = () => {
    const start = body.indexOf('component_sector_map (component, sector) AS (');
    expect(start, 'mapa por componente ausente').toBeGreaterThanOrEqual(0);
    const end = body.indexOf('demand AS (', start);
    expect(end, 'fim do mapa por componente ausente').toBeGreaterThan(start);
    return body.slice(start, end);
  };

  /** `('cabedal', 'Corte Cabedal')` tolerando `::text` e espaçamento. */
  const pair = (component: string, sector: string) =>
    new RegExp(
      `\\(\\s*'${component.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'(?:::text)?\\s*,`
      + `\\s*'${sector}'(?:::text)?\\s*\\)`,
    );

  it('metadata explícito vence e passa por canonical_stage_name', () => {
    expect(body).toMatch(/metadata ->> 'consumption_sector'/);
    expect(body).toMatch(
      /public\.canonical_stage_name\(b\.explicit_sector\) AS sector,\s*\n?\s*'explicito'::text AS source/,
    );
    expect(body).toMatch(/WHERE b\.explicit_sector IS NOT NULL/);
    expect(body).toMatch(/WHEN pr\.has_explicit\s+THEN 'explicito'/);
  });

  it('mapa por componente = fallback canônico, com e sem acento', () => {
    const map = mapBlock();
    const pairs: Array<[string, string]> = [
      ['solado', 'Solagem'],
      ['palmilha', 'Corte Fibra'],
      ['forração palmilha', 'Corte Forração'],
      ['forracao palmilha', 'Corte Forração'],
      ['cabedal', 'Corte Cabedal'],
      ['fachete', 'Aviamento'],
      ['tiras', 'Aviamento'],
      ['químicos', 'Colagem'],
      ['quimicos', 'Colagem'],
      ['embalagem', 'Acabamento'],
    ];
    for (const [component, sector] of pairs) {
      expect(map, `${component} → ${sector} ausente`).toMatch(pair(component, sector));
    }
    // o componente é comparado em minúsculas e sem espaço nas pontas
    expect(body).toMatch(/lower\(pg_catalog\.btrim\(COALESCE\(mr\.metadata ->> 'component', ''\)\)\)/);
    expect(body).toMatch(/WHEN pr\.matched_want\s+THEN 'componente'/);
  });

  it('forro de CABEDAL avisa nos DOIS setores enquanto o dono não decidir', () => {
    // `resolve_consumption_sector` manda 'forração' pro Corte Cabedal, mas
    // corteLookahead.ts liga 'Corte Forração' ao kind `lining` (que é o forro do
    // CABEDAL) e buyList.ts põe Forração/Forração Palmilha no MESMO bucket.
    // Chutar um dos dois esconde o aviso justamente de quem corta.
    const map = mapBlock();
    for (const component of ['forração', 'forracao']) {
      expect(map, `${component} → Corte Cabedal ausente`)
        .toMatch(pair(component, 'Corte Cabedal'));
      expect(map, `${component} → Corte Forração ausente`)
        .toMatch(pair(component, 'Corte Forração'));
    }
    // e a divergência fica registrada como pendência, não como decisão tomada
    expect(sql).toMatch(/PEND[ÊE]NCIA DE CADASTRO\/PRODUTO/i);
    expect(sql).toMatch(/corteLookahead/);
    expect(sql).toMatch(/buyList/);
  });

  it('o mapa NÃO tem o ELSE Aviamento do resolve_consumption_sector', () => {
    // Chutar 'Aviamento' para 'Componente Direto' / 'Item padrão (solado)'
    // calaria o aviso em Colagem e Solagem. Componente fora do mapa fica NULL.
    expect(mapBlock().replace(/--[^\n]*/g, '')).not.toMatch(/ELSE\s+'Aviamento'/);
    expect(code).not.toMatch(/ELSE\s+'Aviamento'/);
    // sem linha no mapa → LEFT JOIN devolve NULL, e NULL é preservado (não ''):
    // `canonical_stage_name(NULL)` devolve '', que não casaria com setor nenhum
    // e calaria o fail-safe.
    expect(body).toMatch(/LEFT JOIN component_sector_map m ON m\.component = lc\.component/);
    expect(body).toMatch(/CASE WHEN m\.sector IS NULL THEN NULL/);
    expect(body).toMatch(/CASE WHEN m\.sector IS NULL THEN 'desconhecido' ELSE 'componente' END/);
    expect(body).toMatch(/ELSE 'desconhecido' END AS sector_source/);
  });

  it('o setor mapeado passa por canonical_stage_name (renome Corte Fibra → Palmilha · Fibra)', () => {
    expect(body).toMatch(/ELSE public\.canonical_stage_name\(m\.sector\) END/);
    expect(body).toMatch(/SELECT public\.canonical_stage_name\(p_stage_name\) AS want/);
  });

  it('FAIL-SAFE: setor desconhecido (NULL) avisa em QUALQUER setor', () => {
    expect(body).toMatch(/COALESCE\(bool_or\(ls\.sector IS NULL\), false\) AS has_unknown/);
    expect(body).toMatch(/WHERE pr\.matched_want OR pr\.has_unknown/);
    expect(sql).toMatch(/FAIL-SAFE/);
  });

  it('o setor agregado não inventa dono: max() sobre {NULL, setor pedido}', () => {
    expect(body).toMatch(/max\(k\.consumption_sector\) AS consumption_sector/);
    expect(body).toMatch(/bool_or\(k\.sector_source = 'explicito'\)/);
    expect(body).toMatch(/bool_or\(k\.sector_source = 'componente'\)/);
  });
});

describe('falta de material por setor — rótulo AGREGADO do empenho do PV', () => {
  it('reserva de empenho é marcada como rótulo agregado (min(component))', () => {
    // `commit_sale_order_material_demand` grava min(component) sobre TODOS os
    // componentes que consomem o SKU, inclusive ao ADOTAR uma reserva de OP.
    expect(body).toMatch(
      /COALESCE\(mr\.metadata ->> 'kind', ''\) IN \('pv_commitment', 'atelier_prep'\)\s*\n?\s*AS label_is_aggregated/,
    );
    expect(sql).toMatch(/min\(d\.component\)/);
  });

  it('o CONJUNTO de componentes vem da função de demanda do PV', () => {
    expect(body).toMatch(/CROSS JOIN LATERAL public\.sale_order_material_demand_lines\(s\.so_id\) d/);
    expect(body).toMatch(/SELECT b\.rid, d\.component\s*\n\s*FROM base b\s*\n\s*JOIN demand d ON d\.product_id = b\.product_id/);
    expect(body).toMatch(/AND b\.label_is_aggregated/);
    // chamada só quando existe reserva de rótulo agregado em falta
    expect(body).toMatch(/WHERE EXISTS \(\s*\n?\s*SELECT 1 FROM base b\s*\n\s*WHERE b\.label_is_aggregated/);
    // e o preflight recusa aplicar sem a função de demanda
    expect(sql).toMatch(/'public\.sale_order_material_demand_lines\(uuid\)'\) IS NULL/);
  });

  it('rótulo fino (reserva de OP) continua valendo como um componente só', () => {
    expect(body).toMatch(/SELECT b\.rid, b\.component\s*\n\s*FROM base b\s*\n\s*WHERE b\.explicit_sector IS NULL\s*\n\s*AND NOT b\.label_is_aggregated/);
  });

  it('agregado sem linha de demanda (ex.: solado) mantém o rótulo gravado', () => {
    expect(body).toMatch(/AND NOT EXISTS \(SELECT 1 FROM demand d WHERE d\.product_id = b\.product_id\)/);
  });

  it('uma linha vale para TODOS os setores do conjunto (não só o primeiro)', () => {
    // bool_or sobre os setores da reserva: casar em qualquer um mantém a linha.
    expect(body).toMatch(
      /COALESCE\(bool_or\(ls\.sector = \(SELECT s\.want FROM stage s\)\), false\) AS matched_want/,
    );
    expect(body).toMatch(/GROUP BY ls\.rid/);
  });
});
