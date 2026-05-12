import { Stack as Layers } from '@phosphor-icons/react';
import { SilkGlobalPanel } from '@/components/technical-sheets/SilkGlobalPanel';

export default function SilkRegistrations() {
  return (
    <div className="space-y-6 page-enter">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Layers className="h-6 w-6 text-primary" />
          Cadastro de Silk por Solado
        </h1>
        <p className="text-sm text-muted-foreground">
          Gerencie qual silk deve ser utilizada para cada tipo de solado e cliente.
        </p>
      </div>
      <SilkGlobalPanel />
    </div>
  );
}
