import { useState, useMemo } from 'react';
import { Truck, WarningCircle as AlertCircle, CheckCircle as CheckCircle2 } from '@phosphor-icons/react';

interface Vehicle {
  id: string;
  nome: string;
  placa: string;
  cap_m3: number;
  h: number;
  w: number;
  l: number;
}

interface Order {
  category: string;
  totalPairs: number;
}

export function ShippingWizard({ order, vehicles }: { order: Order, vehicles: Vehicle[] }) {
  const [shippingType, setShippingType] = useState<'PROPRIO' | 'TERCEIRO' | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");

  const orderVolumeM3 = useMemo(() => {
    const isInfantil = order.category === 'INFANTIL';
    const multiplier = isInfantil ? 0.005 : 0.008;
    return order.totalPairs * multiplier;
  }, [order]);

  const selectedVehicle = vehicles.find(v => v.id === selectedVehicleId);
  const vehicleVolume = selectedVehicle ? (selectedVehicle.h * selectedVehicle.w * selectedVehicle.l || selectedVehicle.cap_m3) : 0;
  const occupancyPercentage = vehicleVolume > 0 ? (orderVolumeM3 / vehicleVolume) * 100 : 0;

  const hasSpace = occupancyPercentage <= 100;

  return (
    <div className="space-y-6 font-sans">
      {/* SELEÇÃO DE MODAL */}
      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={() => setShippingType('PROPRIO')}
          className={`p-6 rounded-3xl border-2 transition-all flex flex-col items-center ${
            shippingType === 'PROPRIO' ? 'border-primary bg-primary/10 shadow-lg' : 'bg-card border-border opacity-60'
          }`}
        >
          <Truck className={`h-8 w-8 mb-2 ${shippingType === 'PROPRIO' ? 'text-primary' : 'text-muted-foreground'}`} />
          <span className="text-xs font-black uppercase tracking-tighter text-foreground">Frota Própria</span>
        </button>
        <button
          onClick={() => setShippingType('TERCEIRO')}
          className={`p-6 rounded-3xl border-2 transition-all flex flex-col items-center ${
            shippingType === 'TERCEIRO' ? 'border-primary bg-primary/10 shadow-lg' : 'bg-card border-border opacity-60'
          }`}
        >
          <Truck className={`h-8 w-8 mb-2 ${shippingType === 'TERCEIRO' ? 'text-primary' : 'text-muted-foreground'}`} />
          <span className="text-xs font-black uppercase tracking-tighter text-foreground">Transportadora</span>
        </button>
      </div>

      {shippingType === 'PROPRIO' && (
        <div className="bg-primary rounded-3xl p-6 text-primary-foreground shadow-2xl animate-in zoom-in-95 duration-300">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h4 className="text-xs font-black uppercase text-primary-foreground/70">Configuração de Carga</h4>
              <p className="text-xs text-primary-foreground/40 uppercase font-bold tracking-widest">
                Carga: {order.category} | {order.totalPairs} PARES
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-black font-mono leading-none">{orderVolumeM3.toFixed(2)}m³</p>
              <p className="text-xs font-bold text-primary-foreground/40 uppercase">Volume Total do Pedido</p>
            </div>
          </div>

          <div className="space-y-4">
            <select
              className="w-full bg-primary-foreground/10 border-none rounded-2xl p-4 text-sm font-bold focus:ring-2 focus:ring-primary-foreground/30 outline-none text-primary-foreground"
              onChange={(e) => setSelectedVehicleId(e.target.value)}
              value={selectedVehicleId}
            >
              <option value="">Selecione o Veículo p/ Duque de Caxias...</option>
              {vehicles.map(v => (
                <option key={v.id} value={v.id}>{v.placa} - {v.nome} ({v.cap_m3}m³)</option>
              ))}
            </select>

            {selectedVehicle && (
              <div className="pt-4 space-y-3">
                <div className="flex justify-between text-xs font-black uppercase tracking-widest">
                  <span>Ocupação do Baú</span>
                  <span className={hasSpace ? 'text-lime-400' : 'text-red-400'}>
                    {occupancyPercentage.toFixed(1)}%
                  </span>
                </div>

                {/* BARRA DE OCUPAÇÃO VISUAL */}
                <div className="h-3 bg-primary-foreground/10 rounded-full overflow-hidden border border-primary-foreground/20">
                  <div
                    className={`h-full transition-all duration-500 ${hasSpace ? 'bg-lime-400' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(occupancyPercentage, 100)}%` }}
                  />
                </div>

                {!hasSpace ? (
                  <div className="bg-red-500/10 border border-red-500/50 p-3 rounded-xl flex gap-3 items-center mt-4">
                    <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
                    <p className="text-xs leading-tight font-bold uppercase text-red-200">
                      Excesso de Carga detectado. O pedido excede em {(orderVolumeM3 - vehicleVolume).toFixed(2)}m³ a capacidade do baú.
                    </p>
                  </div>
                ) : (
                  <div className="bg-emerald-500/10 border border-emerald-500/50 p-3 rounded-xl flex gap-3 items-center mt-4">
                    <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                    <p className="text-xs leading-tight font-bold uppercase text-emerald-200">
                      Carga aprovada. O veículo comporta o pedido com {(vehicleVolume - orderVolumeM3).toFixed(2)}m³ de sobra.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {shippingType === 'TERCEIRO' && (
        <div className="bg-muted/50 rounded-3xl p-6 border border-border animate-in zoom-in-95 duration-300">
          <div className="text-center py-8">
            <Truck className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">Módulo de Transportadora</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Em desenvolvimento</p>
          </div>
        </div>
      )}
    </div>
  );
}
