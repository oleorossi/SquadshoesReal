import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SQL = readFileSync(resolve(__dirname, '../../supabase/migrations/20261231121600_harden-purchase-and-service-order-integrity.sql'), 'utf8');
const REMEDIATION_SQL = readFileSync(resolve(__dirname, '../../supabase/migrations/20261231121700_resolve-open-purchase-order-audit-alerts.sql'), 'utf8');

describe('hardening de OC e OS — contrato SQL', () => {
  it('bloqueia artesanal e unidade incompatível em qualquer writer de item', () => {
    expect(SQL).toMatch(/CREATE TRIGGER trg_validate_purchase_order_item/);
    expect(SQL).toMatch(/material artesanal: produza por OS/i);
    expect(SQL).toMatch(/Unidade .* inválida para a linha da OC/);
  });

  it('bloqueia recebimento de legado ambíguo em vez de converter por suposição', () => {
    expect(SQL).toMatch(/CREATE TRIGGER trg_block_invalid_purchase_order_receipt/);
    expect(SQL).toMatch(/corrija as linhas antes de iniciar o recebimento/i);
  });

  it('cria OC manual com cabeçalho e itens em uma única RPC normalizada', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.create_purchase_order_normalized/);
    expect(SQL).toMatch(/FROM public\.po_normalize_line/);
    expect(SQL).toMatch(/IF NOT public\.is_approved_user\(\)/);
  });

  it('mantém o legado diagnosticável e cancela apenas a OS órfã comprovada', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.purchase_order_integrity_report/);
    expect(SQL).toMatch(/duplicate_open_item/);
    expect(SQL).toMatch(/OS legado .* ganhou dependência; cancelamento automático abortado/);
    expect(SQL).toMatch(/status = 'Cancelado'/);
  });
});

describe('saneamento de alertas legados de compra', () => {
  it('não cria OS escolhendo uma receita/base sem vínculo comprovado', () => {
    expect(REMEDIATION_SQL).toMatch(/múltiplas receitas\/base possíveis/i);
    expect(REMEDIATION_SQL).not.toMatch(/INSERT INTO public\.service_orders/);
  });

  it('só remove artesanal sem recebimento e cancela a OC ambígua sem converter', () => {
    expect(REMEDIATION_SQL).toMatch(/COALESCE\(poi\.received_quantity, 0\) = 0/);
    expect(REMEDIATION_SQL).toMatch(/Há item artesanal com recebimento; saneamento automático abortado/);
    expect(REMEDIATION_SQL).toMatch(/OC-00012/);
    expect(REMEDIATION_SQL).toMatch(/Não alterar quantidades por adivinhação/);
  });
});
