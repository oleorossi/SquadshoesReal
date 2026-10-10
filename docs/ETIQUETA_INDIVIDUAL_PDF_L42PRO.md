# Etiqueta individual — imprimir PDF na L42PRO (100×30 mm)

A prévia na tela já está em 100 × 30 mm. O papel só sai certo se a mídia da Elgin e o diálogo do Windows usarem o mesmo tamanho, com escala 100%.

## Fluxo recomendado

1. No app: **Central de Etiquetagem → Produção → Etiqueta Individual**.
2. Confirme o checklist do modal (obrigatório).
3. O navegador abre o PDF (Mac ou Windows).
4. No **Windows** com a L42PRO: imprima com o preset abaixo.

## Checklist

### 1. Mídia na L42PRO

No Gerenciador Elgin / propriedades da impressora, use etiqueta 100 mm (largura) × 30 mm (altura/avanço), 1 coluna, sensor de gap do rolo adesivo.

### 2. Não misture com o rolo de cliente

O Gerador padrão / etiquetagem cliente usa 2 × 50 × 30 mm (página 106 × 30). Esse perfil na L42PRO encolhe ou desloca a arte da caixa individual Squad.

### 3. Diálogo de impressão (Windows)

Papel personalizado 100 × 30 mm · margens 0 · escala 100% · desmarque “Ajustar à página” / Fit to page · sem cabeçalhos e rodapés.

### 4. Mac só gera o PDF

No Mac, abra ou baixe o PDF. A impressão física fica no Windows ligado à L42PRO Full, com o preset acima.

## Conferência rápida

| Item | Valor certo |
|---|---|
| Rolo físico | 100 × 30 mm, 1 etiqueta por avanço |
| Perfil L42PRO | 100 × 30 mm (não 106×30) |
| Escala no Windows | 100% (nunca “ajustar à página”) |
| Prévia no app | Deve parecer preenchida; se a tela está ok e o papel não, o driver/mídia está errado |

## Sintoma → causa

- **Faixa estreita + muito branco no adesivo:** mídia/driver ≠ 100×30, ou escala ≠ 100%.
- **Arte “em pé” / rotacionada:** largura e altura trocadas no perfil da Elgin, ou papel do Windows em orientação errada.
- **.zpl não abre no Mac/Windows:** normal — use o botão **Etiqueta Individual (PDF)** ou **Abrir PDF** na prévia ZPL. O `.zpl` só serve no Gerenciador/DirectPrint da Elgin.

## ZPL (avançado)

O botão **ZPL + Prévia** continua disponível só para envio direto à Elgin. Para abrir e ajustar no Windows/Mac, use sempre o PDF.

## Passo a passo no Windows (detalhe)

1. Abra o PDF gerado pelo app (Chrome/Edge/Acrobat).
2. **Arquivo → Imprimir** (ou Ctrl+P).
3. Impressora: **Elgin L42PRO Full** (ou o nome do driver instalado).
4. Em **Mais configurações** / Preferências:
   - Tamanho do papel: **Personalizado 100 × 30 mm** (cadastre se ainda não existir).
   - Orientação: paisagem (largura 100, altura 30).
   - Escala / Zoom: **100%**.
   - Desmarque qualquer “Ajustar”, “Fit”, “Encolher para caber”.
   - Margens: nenhuma.
5. Imprima **1 página de teste** e confira se a arte preenche o adesivo.
6. Se ainda sobrar branco: volte ao Gerenciador Elgin e confira se a mídia ativa é 100×30 — não o perfil 106×30 do Gerador padrão.
