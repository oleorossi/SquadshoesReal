import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Cube as Box, User, Hash, Palette, Image as ImageIcon, Pulse as Activity, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface OrderDetailsModalProps {
  order: any;
  isOpen: boolean;
  onClose: () => void;
}

const SECTOR_ICONS: Record<string, string> = {
  // New sector names
  'Corte Palmilha': '✂️', 'Corte Forração': '🧵', 'Mesa': '🪑',
  'Silk': '🖨️', 'Colagem': '💨', 'Montagem': '🏗️',
  'Solagem': '👟', 'Acabamento': '✨', 'Expedição': '🚚',
  // Legacy
  'Corte': '✂️', 'Forração': '🧵', 'Aviamento': '🧷',
  'Costura': '🪡', 'Embalagem': '📦', 'Inspeção': '🔍',
};

const SECTOR_COLORS: Record<string, string> = {
  // New sector names
  'Corte Palmilha': 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30',
  'Corte Forração': 'bg-teal-500/15 text-teal-700 dark:text-teal-400 border-teal-500/30',
  'Mesa':           'bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30',
  'Silk':           'bg-pink-500/15 text-pink-700 dark:text-pink-400 border-pink-500/30',
  'Colagem':        'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
  'Montagem':       'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30',
  'Solagem':        'bg-lime-500/15 text-lime-700 dark:text-lime-400 border-lime-500/30',
  'Acabamento':     'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  'Expedição':      'bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 border-indigo-500/30',
  // Legacy
  'Corte':    'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30',
  'Forração': 'bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30',
  'Aviamento':'bg-pink-500/15 text-pink-700 dark:text-pink-400 border-pink-500/30',
  'Costura':  'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30',
};

export function OrderDetailsModal({ order, isOpen, onClose }: OrderDetailsModalProps) {
  const { data: stages = [], isLoading: stagesLoading } = useQuery({
    queryKey: ['order-stages-modal', order?.id],
    queryFn: async () => {
      if (!order?.id) return [];
      const { data, error } = await supabase
        .from('order_stages')
        .select('stage_name, stage_order, status, quantity_processed, quantity_total, started_at, completed_at, actual_time_minutes')
        .eq('order_id', order.id)
        .order('stage_order', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: isOpen && !!order?.id,
    staleTime: 30_000,
  });

  if (!order) return null;

  const activeStages = stages.filter((s: any) => s.status === 'em_andamento');
  const completedStages = stages.filter((s: any) => s.status === 'concluido');
  const pendingStages = stages.filter((s: any) => s.status === 'pendente');
  const allDone = stages.length > 0 && stages.every((s: any) => s.status === 'concluido');

  // Determine "current status" — could be multiple sectors simultaneously
  const currentSectors: string[] = activeStages.length > 0
    ? activeStages.map((s: any) => s.stage_name)
    : allDone
      ? ['Finalizado']
      : pendingStages.length > 0
        ? [pendingStages[0].stage_name]
        : ['Pendente'];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Box className="w-5 h-5 text-primary" />
            {order.reference_name || order.reference}
            <Badge variant="outline" className="ml-2 font-mono text-xs">
              <Hash className="h-3 w-3 mr-0.5" />
              {order.order_number}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Foto do Modelo / Silk */}
          <div className="relative group overflow-hidden rounded-xl border-2 border-border bg-muted aspect-video flex items-center justify-center">
            {(() => {
              const colorVariant = order.technical_sheets?.reference_color_variants?.find(
                (v: any) => (v.color?.toLowerCase().trim() || "") === (order.color?.toLowerCase().trim() || "")
              );
              const imageUrl = order.image_url || order.photo_url || colorVariant?.image_url || order.technical_sheets?.image_url;
              
              return imageUrl ? (
                <img 
                  src={imageUrl} 
                  alt={order.reference_name || order.technical_sheets?.name} 
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <ImageIcon className="w-12 h-12 stroke-[1.5]" />
                  <span className="text-xs font-medium">Sem Foto Cadastrada</span>
                </div>
              );
            })()}
            
            <div className="absolute bottom-3 right-3">
              <Badge className="bg-background/90 backdrop-blur shadow-sm text-foreground border-none px-3 py-1 font-bold">
                {order.quantity} Pares
              </Badge>
            </div>
          </div>

          {/* Status Atual da OP — Setores em andamento (suporta múltiplos simultâneos) */}
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-4 h-4 text-primary" />
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Status da Produção
                {activeStages.length > 1 && (
                  <span className="ml-2 text-primary normal-case">
                    ({activeStages.length} setores simultâneos)
                  </span>
                )}
              </p>
            </div>
            {stagesLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Carregando setores...
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {currentSectors.map((sector) => {
                  const stageData = activeStages.find((s: any) => s.stage_name === sector);
                  const colorClass = SECTOR_COLORS[sector] || 'bg-muted text-muted-foreground border-border';
                  return (
                    <Badge
                      key={sector}
                      variant="outline"
                      className={`${colorClass} text-sm px-3 py-1.5 font-semibold gap-1.5`}
                    >
                      <span>{SECTOR_ICONS[sector] || '📋'}</span>
                      {sector}
                      {stageData && (
                        <span className="ml-1 text-xs opacity-80 font-mono">
                          {stageData.quantity_processed}/{stageData.quantity_total}
                        </span>
                      )}
                    </Badge>
                  );
                })}
              </div>
            )}

            {/* Mini-pipeline com todos os setores */}
            {stages.length > 0 && (
              <div className="mt-4 pt-3 border-t border-border/50">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                  Pipeline Completo
                </p>
                <div className="flex items-center gap-1 flex-wrap">
                  {stages.map((s: any) => {
                    const isDone = s.status === 'concluido';
                    const isRunning = s.status === 'em_andamento';
                    const actualMinutes = s.actual_time_minutes || (s.started_at && s.completed_at ? (new Date(s.completed_at).getTime() - new Date(s.started_at).getTime()) / (1000 * 60) : 0);
                    const actualTimeStr = actualMinutes > 0 ? (actualMinutes > 60 ? `${(actualMinutes / 60).toFixed(1)}h` : `${Math.round(actualMinutes)}m`) : '';

                    /* K10 (audit): em mobile só o emoji ficava visível, sem label.
                       Usuário não conseguia identificar qual setor estava em qual estado.
                       Agora abrevia (3 letras) em telas estreitas e mantém nome completo
                       em sm+. title= ainda dá nome completo no hover/long-press. */
                    const shortName = s.stage_name.slice(0, 3).toUpperCase();
                    return (
                      <Badge
                        key={s.stage_name}
                        variant="outline"
                        title={`${s.stage_name}${isDone ? ' — concluído' : isRunning ? ' — em andamento' : ' — pendente'}${actualTimeStr ? ` (${actualTimeStr})` : ''}`}
                        className={`text-xs py-0.5 px-1.5 gap-1 ${
                          isDone
                            ? 'bg-success/15 text-success border-success/30'
                            : isRunning
                              ? 'bg-warning/15 text-warning border-warning/30 animate-pulse'
                              : 'bg-muted/50 text-muted-foreground border-border'
                        }`}
                      >
                        <span>{SECTOR_ICONS[s.stage_name] || '📋'}</span>
                        <span className="sm:hidden font-mono uppercase">{shortName}</span>
                        <span className="hidden sm:inline">{s.stage_name}</span>
                        {actualTimeStr && <span className="opacity-60">({actualTimeStr})</span>}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Informações Principais */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <User className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground leading-none mb-1">Cliente</p>
                <p className="text-sm font-semibold text-foreground">{order.client_name || '—'}</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Palette className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground leading-none mb-1">Cor / Material</p>
                <p className="text-sm font-semibold text-foreground">{order.color || order.color_description || 'Padrão'}</p>
              </div>
            </div>
          </div>

          <Separator />

          {/* Status de Material */}
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Estoque de Material:</span>
            <Badge 
              variant={order.material_status === 'Completo' ? 'default' : 'secondary'}
              className={order.material_status === 'Completo' ? 'bg-success text-success-foreground hover:bg-success/90' : ''}
            >
              {order.material_status || 'Pendente'}
            </Badge>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
