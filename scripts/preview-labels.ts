/**
 * Gera previews HTML dos builders de etiqueta usando dados de exemplo.
 * Saída: /Users/leonardomonnerat/Documents/Claude/Projects/Squadshoes/preview-*.html
 *
 * Uso: bun run scripts/preview-labels.ts
 *   (ou) npx tsx scripts/preview-labels.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildBoxIdentificationHtml,
  buildThermalLabelsHtml,
  buildHangtagHtml,
  buildIndividualLabelsHtml,
  DEFAULT_THERMAL_CONFIG,
  type BoxIdentificationData,
} from '../src/lib/printLabels';

const OUT = process.env.PREVIEW_OUT || '/Users/leonardomonnerat/Documents/Claude/Projects/Squadshoes';
try { mkdirSync(OUT, { recursive: true }); } catch {}

// ───────────────────────────────────────────────────────────────
// 1) CAIXA EXTERNA — 198×132mm (EtqCxExt)
// ───────────────────────────────────────────────────────────────
const boxItems: BoxIdentificationData[] = [
  {
    nfe: '012345',
    orderNumber: 'PV-2026-0481',
    ficha: '0094',
    clientOrderNumber: 'OC-77821',
    recipientRazaoSocial: 'CALÇADOS BELLA LTDA',
    recipientCnpj: '12.345.678/0001-99',
    recipientAddress: 'Rua das Palmeiras, 1820',
    recipientNeighborhood: 'Centro',
    recipientCity: 'BELO HORIZONTE',
    recipientUf: 'MG',
    recipientCep: '30130-100',
    recipientBranchCode: '02',
    recipientBranchName: 'Filial Savassi',
    refCode: 'I901',
    color: 'CARAMELO',
    solado: 'TR-04',
    imageUrl: null,
    grade: [
      { size: 34, qty: 2 },
      { size: 35, qty: 3 },
      { size: 36, qty: 4 },
      { size: 37, qty: 4 },
      { size: 38, qty: 3 },
      { size: 39, qty: 2 },
    ],
    boxNumber: 1,
    totalBoxes: 3,
  },
  {
    nfe: '012345',
    orderNumber: 'PV-2026-0481',
    ficha: '0094',
    clientOrderNumber: 'OC-77821',
    recipientRazaoSocial: 'CALÇADOS BELLA LTDA',
    recipientCnpj: '12.345.678/0001-99',
    recipientAddress: 'Rua das Palmeiras, 1820',
    recipientNeighborhood: 'Centro',
    recipientCity: 'BELO HORIZONTE',
    recipientUf: 'MG',
    recipientCep: '30130-100',
    recipientBranchCode: '02',
    recipientBranchName: 'Filial Savassi',
    refCode: 'I905',
    color: 'PRETO',
    solado: 'TR-12',
    imageUrl: null,
    grade: [
      { size: 34, qty: 1 },
      { size: 35, qty: 2 },
      { size: 36, qty: 4 },
      { size: 37, qty: 5 },
      { size: 38, qty: 3 },
      { size: 39, qty: 1 },
    ],
    boxNumber: 2,
    totalBoxes: 3,
  },
];
writeFileSync(resolve(OUT, 'preview-1-caixa-externa.html'), buildBoxIdentificationHtml(boxItems));
console.log('✓ preview-1-caixa-externa.html');

// ───────────────────────────────────────────────────────────────
// 2) CAIXA INDIVIDUAL — 100×60mm térmica (EtqCxInd)
// ───────────────────────────────────────────────────────────────
const thermalItems = [
  {
    refCode: 'I901',
    refName: 'SANDÁLIA AURORA',
    color: 'CARAMELO',
    size: '36',
    barcode: '7891234567890',
    pairNumber: 1,
    totalPairs: 18,
    boxNumber: '1/3',
    saleOrderNumber: 'PV-2026-0481',
    productionOrderNumber: 'OP-1029',
    imageUrl: null,
    solado: 'TR-04',
    composition: 'CABEDAL: COURO · SOLA: BORRACHA · FORRO: TÊXTIL',
  },
  {
    refCode: 'I901',
    refName: 'SANDÁLIA AURORA',
    color: 'CARAMELO',
    size: '37',
    barcode: '7891234567891',
    pairNumber: 2,
    totalPairs: 18,
    boxNumber: '1/3',
    saleOrderNumber: 'PV-2026-0481',
    productionOrderNumber: 'OP-1029',
    imageUrl: null,
    solado: 'TR-04',
    composition: 'CABEDAL: COURO · SOLA: BORRACHA · FORRO: TÊXTIL',
  },
];
writeFileSync(
  resolve(OUT, 'preview-2-caixa-individual-termica.html'),
  buildThermalLabelsHtml(thermalItems, DEFAULT_THERMAL_CONFIG),
);
console.log('✓ preview-2-caixa-individual-termica.html');

// ───────────────────────────────────────────────────────────────
// 3) HANGTAG — 50×80mm (EtqPar)
// ───────────────────────────────────────────────────────────────
const hangtags = [
  {
    refCode: 'I901',
    refName: 'SANDÁLIA AURORA',
    color: 'CARAMELO',
    size: '36',
    barcode: '7891234567890',
    composition: 'SINT. / TÊXTIL / BORRACHA',
    brandName: 'SQUAD',
  },
  {
    refCode: 'I905',
    refName: 'SANDÁLIA LEILA',
    color: 'PRETO',
    size: '37',
    barcode: '7891234567893',
    composition: 'COURO / TÊXTIL / BORRACHA',
    brandName: 'SQUAD',
  },
];
writeFileSync(resolve(OUT, 'preview-3-hangtag.html'), buildHangtagHtml(hangtags));
console.log('✓ preview-3-hangtag.html');

// ───────────────────────────────────────────────────────────────
// 4) ETIQUETA INDIVIDUAL HTML (CartaoOP / 100×100mm)
// ───────────────────────────────────────────────────────────────
const individuals = [
  {
    refCode: 'I901',
    refName: 'SANDÁLIA AURORA',
    color: 'CARAMELO',
    category: 'SANDÁLIAS',
    salePrice: 189.9,
    imageUrl: null,
    sizes: [
      { size: '35', qty: 2 },
      { size: '36', qty: 4 },
      { size: '37', qty: 4 },
      { size: '38', qty: 3 },
    ],
  },
  {
    refCode: 'I905',
    refName: 'SANDÁLIA LEILA',
    color: 'PRETO',
    category: 'SANDÁLIAS',
    salePrice: 199.9,
    imageUrl: null,
    sizes: [
      { size: '36', qty: 3 },
      { size: '37', qty: 5 },
    ],
  },
];
writeFileSync(resolve(OUT, 'preview-4-individual-cartao.html'), buildIndividualLabelsHtml(individuals as any));
console.log('✓ preview-4-individual-cartao.html');

console.log('\nPreviews em ' + OUT);
