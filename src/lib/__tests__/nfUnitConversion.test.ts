import { describe, it, expect } from 'vitest';
import { convertNfToStockUnit } from '../nfUnitConversion';

/**
 * Contrato de ENTRADA DE NF (crítico — qtd errada corrompe o estoque).
 *
 * Regra-mestra: canônico-NF == canônico-produto ⇒ entra a qtd como está; se
 * difere ⇒ converte por uma regra SEGURA (conversion_rate / CONVERSOES /
 * package_weight_kg p/ massa); se não há regra segura ⇒ BLOQUEIA (needsConfig)
 * em vez de gravar qtd errada.
 *
 * ⚠ dm²/área NUNCA é convertida pra unidade linear via conversion_rate nem via
 * package_weight_kg — essa conversão mora na largura da ficha de componente
 * (ver CLAUDE.md). Aqui a entrada de NF só pode BLOQUEAR esses casos.
 */
describe('convertNfToStockUnit', () => {
  describe('1) idêntico / sinônimo passa direto (sem conversão)', () => {
    it('mesma string exata → não converte', () => {
      const r = convertNfToStockUnit(10, 'kg', 5, { unit: 'kg' });
      expect(r).toMatchObject({ qty: 10, unitPrice: 5, converted: false });
      expect(r.needsConfig).toBeUndefined();
    });

    it('napa faturada em "MT"/"METRO"/"MTS" vs produto em "m" → mesmo canônico, entra como está', () => {
      for (const u of ['MT', 'METRO', 'METROS', 'MTS', 'mt']) {
        const r = convertNfToStockUnit(30, u, 8, { unit: 'm' });
        expect(r.qty).toBe(30);
        expect(r.converted).toBe(false);
        expect(r.needsConfig).toBeUndefined();
      }
    });

    it('"MTL" (metro linear SEFAZ) vs produto "m" → entra como está (fator 1)', () => {
      const r = convertNfToStockUnit(30, 'MTL', 8, { unit: 'm' });
      expect(r.qty).toBe(30);
      expect(r.converted).toBe(true); // via CONVERSOES m linear → m fator 1
      expect(r.needsConfig).toBeUndefined();
    });

    it('"CHAPA" vs produto "placa" → mesmo canônico, sem conversão', () => {
      const r = convertNfToStockUnit(5, 'CHAPA', 100, { unit: 'placa' });
      expect(r.qty).toBe(5);
      expect(r.converted).toBe(false);
    });

    it('produto sem unidade configurada → passa direto', () => {
      const r = convertNfToStockUnit(7, 'KG', 3, { unit: null });
      expect(r).toMatchObject({ qty: 7, converted: false });
    });
  });

  describe('2) NF casa purchase_unit e estoque difere', () => {
    it('PLACA EVA: NF "CHAPA"/"PLACA" → produto dm², conversion_rate 150', () => {
      const r = convertNfToStockUnit(2, 'PLACA', 300, {
        unit: 'dm²',
        purchase_unit: 'placa',
        conversion_rate: 150,
      });
      expect(r.qty).toBe(300); // 2 placas × 150 dm²
      expect(r.unitPrice).toBeCloseTo(2); // 300 / 150
      expect(r.converted).toBe(true);
    });

    it('comprado em UN, estoque em g, com rate → converte', () => {
      const r = convertNfToStockUnit(3, 'UN', 30, {
        unit: 'g',
        purchase_unit: 'un',
        conversion_rate: 500,
      });
      expect(r.qty).toBe(1500); // 3 × 500
      expect(r.converted).toBe(true);
    });

    it('purchase_unit casa mas rate=1/ausente e estoque é medida → BLOQUEIA', () => {
      const r = convertNfToStockUnit(3, 'UN', 30, {
        unit: 'g',
        purchase_unit: 'un',
        conversion_rate: 1,
      });
      expect(r.needsConfig).toBe(true);
      expect(r.qty).toBe(3); // não grava convertido
      expect(r.reason).toMatch(/Taxa de conversão/i);
    });

    it('rate=0 é inválido → NÃO zera a qtd, BLOQUEIA', () => {
      const r = convertNfToStockUnit(3, 'UN', 30, {
        unit: 'g',
        purchase_unit: 'un',
        conversion_rate: 0,
      });
      expect(r.needsConfig).toBe(true);
      expect(r.qty).toBe(3);
    });

    it('fallback pra purchase_order_unit quando purchase_unit ausente', () => {
      const r = convertNfToStockUnit(2, 'CX', 100, {
        unit: 'g',
        purchase_order_unit: 'cx',
        conversion_rate: 250,
      });
      expect(r.qty).toBe(500);
      expect(r.converted).toBe(true);
    });
  });

  describe('3) pacote com conversion_rate (sem purchase_unit casando)', () => {
    it('NF em RL com rate configurado → aplica', () => {
      const r = convertNfToStockUnit(2, 'RL', 200, {
        unit: 'g',
        conversion_rate: 1000,
      });
      expect(r.qty).toBe(2000);
      expect(r.converted).toBe(true);
    });
  });

  describe('4) conversão métrica via CONVERSOES', () => {
    it('g → kg', () => {
      const r = convertNfToStockUnit(1000, 'G', 0.01, { unit: 'kg' });
      expect(r.qty).toBe(1); // 1000 g × 0.001
      expect(r.converted).toBe(true);
    });

    it('kg → g', () => {
      const r = convertNfToStockUnit(2, 'KG', 50, { unit: 'g' });
      expect(r.qty).toBe(2000);
    });

    it('área m² → dm² (1 m² = 100 dm²) é segura', () => {
      const r = convertNfToStockUnit(1, 'M2', 1000, { unit: 'dm²' });
      expect(r.qty).toBe(100);
      expect(r.unitPrice).toBeCloseTo(10);
      expect(r.converted).toBe(true);
    });

    it('cm → m', () => {
      const r = convertNfToStockUnit(250, 'CM', 0.5, { unit: 'm' });
      expect(r.qty).toBeCloseTo(2.5);
    });
  });

  describe('5) pacote → MASSA via package_weight_kg', () => {
    it('NF em SC (saco→pc) → produto kg, com peso por embalagem', () => {
      const r = convertNfToStockUnit(4, 'SC', 100, {
        unit: 'kg',
        package_weight_kg: 25,
      });
      expect(r.qty).toBe(100); // 4 sacos × 25 kg
      expect(r.converted).toBe(true);
    });

    it('pacote → kg sem package_weight_kg → BLOQUEIA', () => {
      const r = convertNfToStockUnit(4, 'SC', 100, { unit: 'kg' });
      expect(r.needsConfig).toBe(true);
      expect(r.reason).toMatch(/Peso por embalagem/i);
    });
  });

  describe('⚠ ÁREA/LINEAR nunca infla na entrada de NF', () => {
    it('napa: NF área "M2" vs produto LINEAR "m" → BLOQUEIA (dm²→linear não é da entrada)', () => {
      const r = convertNfToStockUnit(50, 'M2', 12, { unit: 'm' });
      expect(r.needsConfig).toBe(true);
      expect(r.qty).toBe(50); // não grava convertido errado
    });

    it('napa: NF área "DM2" vs produto LINEAR "m" → BLOQUEIA', () => {
      const r = convertNfToStockUnit(500, 'DM2', 1, { unit: 'm' });
      expect(r.needsConfig).toBe(true);
    });

    it('REGRESSÃO: pacote (RL) → produto LINEAR "m" com package_weight_kg NÃO infla com o peso', () => {
      // package_weight_kg é PESO (kg). Antes, Priority 5 multiplicava 2 rolos ×
      // 12 "kg" = 24 "m" — número de kg fingindo metro. Agora BLOQUEIA.
      const r = convertNfToStockUnit(2, 'RL', 500, {
        unit: 'm',
        package_weight_kg: 12,
      });
      expect(r.needsConfig).toBe(true);
      expect(r.qty).toBe(2);
      expect(r.reason).toMatch(/Taxa de conversão/i);
    });

    it('REGRESSÃO: pacote (PLACA) → produto ÁREA "dm²" com package_weight_kg NÃO infla com o peso', () => {
      const r = convertNfToStockUnit(3, 'PLACA', 200, {
        unit: 'dm²',
        package_weight_kg: 5,
      });
      expect(r.needsConfig).toBe(true);
      expect(r.qty).toBe(3);
    });
  });

  describe('6/7) diferença desconhecida sempre BLOQUEIA (nunca grava qtd errada)', () => {
    it('NF "L" (volume) vs produto "un" (contagem) sem regra → BLOQUEIA', () => {
      const r = convertNfToStockUnit(10, 'L', 3, { unit: 'un' });
      expect(r.needsConfig).toBe(true);
      expect(r.qty).toBe(10);
      expect(r.reason).toMatch(/não pôde ser convertida|Configure/i);
    });

    it('unidades totalmente incompatíveis sem rate → BLOQUEIA', () => {
      const r = convertNfToStockUnit(10, 'KG', 3, { unit: 'par' });
      expect(r.needsConfig).toBe(true);
    });
  });
});
