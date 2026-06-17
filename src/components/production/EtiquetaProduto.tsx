import { BarcodeSVG } from '@/components/ui/barcode-svg';
import { adaptiveFontSize } from '@/lib/adaptiveFontSize';

interface EtiquetaProdutoProps {
  produto: {
    nome: string;
    imagemPrincipalUrl?: string;
  };
  varianteSelecionada?: {
    cor?: string;
    tamanho?: string | number;
    imagemUrl?: string;
    barcode?: string;
  };
}

/**
 * Componente de Etiqueta Térmica (100x30mm)
 * 
 * Implementa a lógica de fallback de imagem:
 * 1. Imagem da variante (cor específica)
 * 2. Imagem principal do produto
 * 3. Placeholder padrão
 */
export const EtiquetaProduto = ({ produto, varianteSelecionada }: EtiquetaProdutoProps) => {
  const imagemParaExibir = 
    varianteSelecionada?.imagemUrl || 
    produto.imagemPrincipalUrl || 
    '/placeholder-sapato.png';

  // Sem barcode cadastrado NÃO inventamos um código (zeros geram um EAN
  // escaneável falso). A zona do barcode mostra um traço "—", como a térmica.
  const barcodeValue = varianteSelecionada?.barcode || '';

  return (
    // Safe-area lateral 3mm (left padding 3mm, right 3mm). Impressoras térmicas
    // 100mm normalmente cortam ~2-3mm das bordas — conteúdo útil = 94mm.
    // Auditoria mai/2026: SKU/barcode estavam saindo cortados em equipamentos
    // sem ajuste de offset. Padding faz o conteúdo "respirar" no centro
    // sem perder informação.
    <div
      className="etiqueta-100x30mm relative flex flex-row items-stretch bg-white text-black border-l-4 border-black rounded-none print:shadow-none overflow-hidden"
      style={{ width: '100mm', height: '30mm', boxSizing: 'border-box', paddingLeft: '3mm', paddingRight: '3mm' }}
    >
      {/* Esquerda: Imagem em moldura aguda */}
      <div className="w-[22mm] flex-shrink-0 flex items-center justify-center pr-1 py-2">
        <img
          src={imagemParaExibir}
          alt={produto.nome}
          className="w-full h-full object-contain grayscale"
          onError={(e) => {
            (e.target as HTMLImageElement).src = '/placeholder-sapato.png';
          }}
        />
      </div>

      {/* Centro: Tipografia dominante */}
      <div className="flex-1 px-3 py-2 flex flex-col justify-between min-w-0">
        <div className="min-w-0">
          <div className="section-label" style={{ color: '#555' }}>MODELO</div>
          <div
            className="font-display leading-none uppercase truncate -mt-0.5"
            style={{ fontSize: adaptiveFontSize(produto.nome || '', { maxWidthPx: 130, baseFontPx: 24, minFontPx: 11, charWidthRatio: 0.5 }) }}
            title={produto.nome}
          >
            {produto.nome}
          </div>
        </div>

        <div className="flex items-end justify-between gap-3 min-w-0">
          <div className="min-w-0 flex-1">
            <div className="section-label" style={{ color: '#555' }}>Cor</div>
            <div
              className="font-editorial font-semibold uppercase tracking-[0.2em] truncate leading-tight"
              style={{ fontSize: adaptiveFontSize(varianteSelecionada?.cor || 'Padrão', { maxWidthPx: 80, baseFontPx: 11, minFontPx: 7, charWidthRatio: 0.7 }) }}
              title={varianteSelecionada?.cor}
            >
              {varianteSelecionada?.cor || 'Padrão'}
            </div>
          </div>
          <div className="flex-shrink-0 text-right">
            <div className="section-label" style={{ color: '#555' }}>Tam</div>
            <div className="font-mono text-base font-bold leading-none tabular-nums">
              {varianteSelecionada?.tamanho ?? '--'}
            </div>
          </div>
        </div>
      </div>

      {/* Direita: EAN + Código de Barras (sem pr-2: safe-area já dá margem) */}
      <div className="w-[32mm] flex-shrink-0 flex flex-col items-stretch justify-center pl-1 py-2" style={{ borderLeft: '1px solid #000' }}>
        <div className="section-label mb-1" style={{ color: '#555' }}>EAN</div>
        <div className="flex-1 flex items-center justify-center overflow-hidden">
          {barcodeValue
            ? <BarcodeSVG value={barcodeValue} height={28} fontSize={8} />
            : <span className="font-mono text-base" style={{ color: '#555' }}>—</span>}
        </div>
      </div>
    </div>
  );
};

export default EtiquetaProduto;
