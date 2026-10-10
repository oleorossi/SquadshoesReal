/**
 * Checklist canônico pra imprimir a etiqueta individual térmica via PDF
 * na Elgin L42PRO Full (100 × 30 mm).
 *
 * A arte no PDF já sai correta; o erro típico (faixa estreita + branco no
 * adesivo) vem do perfil de mídia / escala do driver — não do gerador.
 * Fonte única: modal da Produção + docs/ETIQUETA_INDIVIDUAL_PDF_L42PRO.md.
 */

import {
  THERMAL_LABEL_HEIGHT_MM,
  THERMAL_LABEL_WIDTH_MM,
} from '@/lib/printLabels';

export interface ThermalPdfPrintGuideStep {
  title: string;
  body: string;
}

export const THERMAL_PDF_PRINT_GUIDE_TITLE =
  'Antes de imprimir o PDF na L42PRO';

export const THERMAL_PDF_PRINT_GUIDE_INTRO =
  `A prévia na tela já está em ${THERMAL_LABEL_WIDTH_MM} × ${THERMAL_LABEL_HEIGHT_MM} mm. ` +
  'O papel só sai certo se a mídia da Elgin e o diálogo do Windows usarem o mesmo tamanho, com escala 100%.';

/** Passos mostrados no modal (sempre, sem “não mostrar de novo”). */
export const THERMAL_PDF_PRINT_GUIDE_STEPS: readonly ThermalPdfPrintGuideStep[] = [
  {
    title: 'Mídia na L42PRO',
    body:
      `No Gerenciador Elgin / propriedades da impressora, use etiqueta ` +
      `${THERMAL_LABEL_WIDTH_MM} mm (largura) × ${THERMAL_LABEL_HEIGHT_MM} mm (altura/avanço), ` +
      '1 coluna, sensor de gap do rolo adesivo.',
  },
  {
    title: 'Não misture com o rolo de cliente',
    body:
      'O Gerador padrão / etiquetagem cliente usa 2 × 50 × 30 mm (página 106 × 30). ' +
      'Esse perfil na L42PRO encolhe ou desloca a arte da caixa individual Squad.',
  },
  {
    title: 'Diálogo de impressão (Windows)',
    body:
      `Papel personalizado ${THERMAL_LABEL_WIDTH_MM} × ${THERMAL_LABEL_HEIGHT_MM} mm · ` +
      'margens 0 · escala 100% · desmarque “Ajustar à página” / Fit to page · sem cabeçalhos e rodapés.',
  },
  {
    title: 'Mac só gera o PDF',
    body:
      'No Mac, abra ou baixe o PDF. A impressão física fica no Windows ligado à L42PRO Full, com o preset acima.',
  },
] as const;

export const THERMAL_PDF_PRINT_GUIDE_CONFIRM_LABEL = 'Entendi — abrir PDF';

/** Texto longo do guia (mesmo conteúdo do modal + ordem operacional). */
export function buildThermalPdfPrintGuideMarkdown(): string {
  const steps = THERMAL_PDF_PRINT_GUIDE_STEPS.map(
    (step, i) => `### ${i + 1}. ${step.title}\n\n${step.body}\n`,
  ).join('\n');

  return `# Etiqueta individual — imprimir PDF na L42PRO (${THERMAL_LABEL_WIDTH_MM}×${THERMAL_LABEL_HEIGHT_MM} mm)

${THERMAL_PDF_PRINT_GUIDE_INTRO}

## Fluxo recomendado

1. No app: **Central de Etiquetagem → Produção → Etiqueta Individual**.
2. Confirme o checklist do modal (obrigatório).
3. O navegador abre o PDF (Mac ou Windows).
4. No **Windows** com a L42PRO: imprima com o preset abaixo.

## Checklist

${steps}
## Conferência rápida

| Item | Valor certo |
|---|---|
| Rolo físico | ${THERMAL_LABEL_WIDTH_MM} × ${THERMAL_LABEL_HEIGHT_MM} mm, 1 etiqueta por avanço |
| Perfil L42PRO | ${THERMAL_LABEL_WIDTH_MM} × ${THERMAL_LABEL_HEIGHT_MM} mm (não 106×30) |
| Escala no Windows | 100% (nunca “ajustar à página”) |
| Prévia no app | Deve parecer preenchida; se a tela está ok e o papel não, o driver/mídia está errado |

## Sintoma → causa

- **Faixa estreita + muito branco no adesivo:** mídia/driver ≠ ${THERMAL_LABEL_WIDTH_MM}×${THERMAL_LABEL_HEIGHT_MM}, ou escala ≠ 100%.
- **Arte “em pé” / rotacionada:** largura e altura trocadas no perfil da Elgin, ou papel do Windows em orientação errada.
- **.zpl não abre no Mac/Windows:** normal — use o botão **Etiqueta Individual (PDF)** ou **Abrir PDF** na prévia ZPL. O \`.zpl\` só serve no Gerenciador/DirectPrint da Elgin.

## ZPL (avançado)

O botão **ZPL + Prévia** continua disponível só para envio direto à Elgin. Para abrir e ajustar no Windows/Mac, use sempre o PDF.
`;
}
