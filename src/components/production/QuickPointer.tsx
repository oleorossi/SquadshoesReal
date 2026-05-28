import { useState } from 'react';
import { Play, CheckSquare, Warning as AlertTriangle } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

interface QuickPointerProps {
  currentStage: string;
  employeeId?: string;
}

export function QuickPointer({ currentStage, employeeId }: QuickPointerProps) {
  const [orderNumber, setOrderNumber] = useState('');
  const [loading, setLoading] = useState(false);

  const handlePonto = async (action: 'start' | 'finish') => {
    if (!orderNumber.trim()) return toast.error('Bipe ou digite o número da OP');
    setLoading(true);

    try {
      const { data: order, error: lookupErr } = await supabase
        .from('orders')
        .select('id')
        .eq('order_number', orderNumber.trim())
        .maybeSingle();
      if (lookupErr) throw lookupErr;
      if (!order) throw new Error('Ordem não encontrada');

      // Predecessor-status guard: only allow valid transitions.
      const requiredStatus = action === 'start' ? 'pendente' : 'em_andamento';
      const updateData = action === 'start'
        ? { started_at: new Date().toISOString(), status: 'em_andamento' as const }
        : { completed_at: new Date().toISOString(), status: 'concluido' as const, completed_by: employeeId || null };

      const { data: claimed, error } = await supabase
        .from('order_stages')
        .update(updateData)
        .eq('order_id', order.id)
        .eq('stage_name', currentStage)
        .eq('status', requiredStatus)
        .select('id');
      if (error) throw error;
      if (!claimed || claimed.length === 0) {
        throw new Error(`Etapa "${currentStage}" não está em status "${requiredStatus}" — outro operador pode ter apontado.`);
      }

      if (action === 'finish') {
        const { error: finErr } = await supabase.rpc('finalize_production_sector', {
          p_order_id: order.id,
          p_current_sector: currentStage,
        });
        if (finErr) {
          // Roll back the stage claim so the operator can retry.
          await supabase.from('order_stages')
            .update({ completed_at: null, status: 'em_andamento', completed_by: null })
            .eq('order_id', order.id)
            .eq('stage_name', currentStage);
          throw new Error(`Falha ao finalizar setor: ${finErr.message}`);
        }
      }

      toast.success(`OP ${orderNumber} apontada com sucesso!`);
      setOrderNumber('');
    } catch (err: any) {
      // Trigger de Montagem rejeita com 23514 quando há OS terceirizada
      // pendente. Operador de chão não tem UI pra override — orienta a
      // procurar PCP em /producao em vez de só mostrar erro críptico.
      const msg = String(err?.message || '');
      if (err?.code === '23514' && /OS terceirizada\(s\) em andamento/i.test(msg)) {
        toast.error(
          'Material da OS terceirizada ainda não voltou. Peça ao PCP pra liberar em /producao (botão "Liberar OS").',
          { duration: 8000 }
        );
      } else {
        toast.error(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-card border rounded-2xl p-6 max-w-sm w-full mx-auto shadow-lg space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-black text-primary uppercase">{currentStage}</h2>
        <p className="text-muted-foreground text-sm">Apontamento de Produção</p>
      </div>

      <Input
        value={orderNumber}
        onChange={(e) => setOrderNumber(e.target.value.toUpperCase())}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handlePonto('finish');
        }}
        placeholder="Bipe o Código da OP..."
        className="h-14 text-center display text-xl tabular-nums"
        autoFocus
      />

      <div className="grid grid-cols-2 gap-4">
        <Button
          disabled={loading || !orderNumber.trim()}
          onClick={() => handlePonto('start')}
          className="h-16 font-bold text-lg"
          variant="default"
        >
          <Play className="mr-2 h-5 w-5" /> Iniciar
        </Button>
        <Button
          disabled={loading || !orderNumber.trim()}
          onClick={() => handlePonto('finish')}
          className="h-16 font-bold text-lg bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <CheckSquare className="mr-2 h-5 w-5" /> Finalizar
        </Button>
      </div>

      <Button variant="ghost" className="w-full text-amber-500 hover:bg-amber-500/10 hover:text-amber-400">
        <AlertTriangle className="mr-2 h-4 w-4" /> Reportar Problema
      </Button>
    </div>
  );
}
