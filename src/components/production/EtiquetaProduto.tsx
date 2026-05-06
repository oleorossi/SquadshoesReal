import { BarcodeSVG } from '@/components/ui/barcode-svg';

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

  const barcodeValue = varianteSelecionada?.barcode || '000000000000';

  return (
    <div 
      className="etiqueta-100x30mm flex flex-row items-center justify-between p-2 bg-white text-black border border-gray-100 shadow-sm print:shadow-none print:border-none overflow-hidden"
      style={{ width: '100mm', height: '30mm', boxSizing: 'border-box' }}
    >
      {/* Esquerda: Imagem */}
      <div className="w-16 h-16 flex-shrink-0 flex items-center justify-center">
        <img 
          src={imagemParaExibir} 
          alt={produto.nome} 
          className="w-16 h-16 object-contain grayscale"
          onError={(e) => {
            (e.target as HTMLImageElement).src = '/placeholder-sapato.png';
          }}
        />
      </div>

      {/* Centro: Info */}
      <div className="flex-1 px-4 flex flex-col justify-center min-w-0">
        <div className="text-xs font-bold truncate uppercase">{produto.nome}</div>
        <div className="text-[10px] text-gray-700 mt-1 truncate">
          {varianteSelecionada?.cor || 'PADRÃO'} - Tam: {varianteSelecionada?.tamanho || '--'}
        </div>
      </div>

      {/* Direita: Código de Barras */}
      <div className="w-[30mm] flex items-center justify-center overflow-hidden">
        <BarcodeSVG value={barcodeValue} height={25} fontSize={8} />
      </div>
    </div>
  );
};

export default EtiquetaProduto;
