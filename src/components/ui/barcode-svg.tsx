import { useRef, useEffect } from 'react';
import JsBarcode from 'jsbarcode';

interface BarcodeSVGProps {
  value: string;
  height?: number;
  width?: number;
  displayValue?: boolean;
  fontSize?: number;
  margin?: number;
  format?: 'CODE128' | 'EAN13' | 'UPC';
}

/**
 * Shared Barcode component using JsBarcode
 */
export function BarcodeSVG({ 
  value, 
  height = 30, 
  width = 1.2,
  displayValue = true,
  fontSize = 10,
  margin = 0,
  format = 'CODE128'
}: BarcodeSVGProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (svgRef.current && value) {
      try {
        JsBarcode(svgRef.current, value, {
          format,
          width,
          height,
          displayValue,
          fontSize,
          margin,
          background: 'transparent',
        });
      } catch (err) {
        // Fallback for EAN13 if value doesn't match format
        if (format === 'EAN13') {
           try {
             JsBarcode(svgRef.current, value, {
               format: 'CODE128',
               width, height, displayValue, fontSize, margin, background: 'transparent'
             });
           } catch {
             console.error('Erro ao gerar código de barras CODE128 (fallback):', value);
           }
        } else {
           console.error('Erro ao gerar código de barras:', value);
        }
      }
    }
  }, [value, height, width, displayValue, fontSize, margin, format]);

  if (!value) return null;

  return <svg ref={svgRef} className="max-w-full h-auto" />;
}

export default BarcodeSVG;
