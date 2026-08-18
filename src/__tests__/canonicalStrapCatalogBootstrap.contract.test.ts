import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const MIGRATION = readFileSync(resolve(
  ROOT,
  'supabase/migrations/20270101004800_bootstrap_canonical_strap_catalog.sql',
), 'utf8');

describe('Catálogo canônico de tiras — bootstrap selecionável', () => {
  it('cadastra somente famílias e larguras finais explícitas', () => {
    [
      'TIRA CHATA',
      'TIRA CHATA COSTURADA',
      'TIRA OVERLOCK',
      'TIRA STRASS',
      'MEIA CANA',
    ].forEach((family) => expect(MIGRATION).toContain(family));

    [
      "'TIRA CHATA', '8 mm', 8::numeric",
      "'TIRA CHATA', '25 mm', 25::numeric",
      "'TIRA CHATA COSTURADA', '11 mm', 11::numeric",
      "'TIRA OVERLOCK', '5 mm', 5::numeric",
      "'TIRA STRASS', '6 mm', 6::numeric",
      "'TIRA STRASS', '15 mm', 15::numeric",
      "'MEIA CANA', '10 mm', 10::numeric",
    ].forEach((identity) => expect(MIGRATION).toContain(identity));
  });

  it('mantém a escolha humana e não remapeia fichas, receitas ou produtos legados', () => {
    expect(MIGRATION).not.toMatch(/(?:INSERT INTO|UPDATE)\s+public\.technical_sheets/i);
    expect(MIGRATION).not.toMatch(/(?:INSERT INTO|UPDATE)\s+public\.artisanal_strap_recipes/i);
    expect(MIGRATION).not.toMatch(/(?:INSERT INTO|UPDATE)\s+public\.products/i);
    expect(MIGRATION).not.toMatch(/(?:INSERT INTO|UPDATE)\s+public\.product_groups/i);
  });

  it('é idempotente e valida que as sete medidas ficaram ativas', () => {
    expect(MIGRATION).toContain('ON CONFLICT ON CONSTRAINT artisanal_strap_types_name_norm_uq');
    expect(MIGRATION).toContain('ON CONFLICT (id)');
    expect(MIGRATION).toContain('v_active_seed_count <> 7');
  });

  it('rejeita medida cuja família esteja inativa ou divergente sem romper linhas legadas', () => {
    expect(MIGRATION).toContain('CREATE OR REPLACE FUNCTION public.tg_validate_technical_strap_identity()');
    expect(MIGRATION).toContain('(v_measure_id IS NULL) <> (v_strap_type_id IS NULL)');
    expect(MIGRATION).toMatch(/measure\.active\s+AND strap_type\.active/);
    expect(MIGRATION).toContain('IF v_measure_id IS NOT NULL AND NOT EXISTS');
  });
});
