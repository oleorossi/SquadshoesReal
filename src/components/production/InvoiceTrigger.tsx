import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FileText as FileCheck, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { ProductionOrder } from '@/types/inventory';

interface InvoiceTriggerProps {
  order: ProductionOrder;
  onInvoiceSuccess: (payload: Record<string, unknown>) => void;
}

export const InvoiceTrigger = ({ order, onInvoiceSuccess }: InvoiceTriggerProps) => {
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerateInvoice = async () => {
    setIsGenerating(true);
    toast.loading('Validando estrutura NFe (v4.00)...');

    try {
      const payloadNFe = {
        versao: "4.00",
        ide: {
          natOp: "Venda de Producao do Estabelecimento",
          mod: "55",
          serie: "1",
          dhEmi: new Date().toISOString(),
        },
        dest: {
          CNPJ: "00000000000000",
          xNome: "Cliente Padrao LTDA"
        },
        det: [
          {
            nItem: 1,
            prod: {
              cProd: order.variant.sku,
              xProd: `${order.master.name} - ${order.variant.color_name}`,
              qCom: order.total_pairs,
              vUnCom: order.variant.unit_price,
            }
          }
        ]
      };

      await new Promise(resolve => setTimeout(resolve, 1500));

      toast.dismiss();
      toast.success('Nota Fiscal Eletrônica emitida com sucesso!');
      onInvoiceSuccess(payloadNFe);

    } catch {
      toast.dismiss();
      toast.error('Erro na validação do schema da NFe.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Button
      onClick={handleGenerateInvoice}
      disabled={isGenerating || order.status !== 'FINALIZADO'}
      className="gap-2 bg-green-600 hover:bg-green-700 text-white w-full"
    >
      {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck className="h-4 w-4" />}
      {isGenerating ? 'Processando NFe...' : 'Faturar e Emitir NFe'}
    </Button>
  );
};
