import React, { useState, useEffect } from 'react';
import { Gear as Settings2 } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';

export interface WorkSheetLayoutSettings {
  imageSize: 'small' | 'medium' | 'large';
  fontSize: 'small' | 'medium' | 'large';
  showChecklist: boolean;
  showImage: boolean;
  showStraps: boolean;
  showObservation: boolean;
  showSilk: boolean;
  showSignature: boolean;
  showSaleOrderInfo: boolean;
}

const STORAGE_KEY = 'worksheet-layout-settings';

const defaultSettings: WorkSheetLayoutSettings = {
  imageSize: 'medium',
  fontSize: 'medium',
  showChecklist: true,
  showImage: true,
  showStraps: true,
  showObservation: true,
  showSilk: true,
  showSignature: true,
  showSaleOrderInfo: true,
};

export function loadWorkSheetSettings(): WorkSheetLayoutSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...defaultSettings, ...JSON.parse(stored) };
  } catch { /* ignore */ }
  return { ...defaultSettings };
}

function saveSettings(settings: WorkSheetLayoutSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
}

interface Props {
  onSettingsChange?: (settings: WorkSheetLayoutSettings) => void;
}

export function WorkSheetSettingsButton({ onSettingsChange }: Props) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<WorkSheetLayoutSettings>(loadWorkSheetSettings);

  const update = (key: keyof WorkSheetLayoutSettings, value: any) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      saveSettings(next);
      onSettingsChange?.(next);
      return next;
    });
  };

  return (
    <>
      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setOpen(true)} title="Ajustes de Layout">
        <Settings2 className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-primary" />
              Ajustes de Layout — Ficha de Operador
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Size settings */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Dimensões</h4>

              <div className="flex items-center justify-between">
                <Label className="text-sm">Tamanho da Foto</Label>
                <Select value={settings.imageSize} onValueChange={v => update('imageSize', v)}>
                  <SelectTrigger className="w-[130px] h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="small">Pequena (30mm)</SelectItem>
                    <SelectItem value="medium">Média (40mm)</SelectItem>
                    <SelectItem value="large">Grande (55mm)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <Label className="text-sm">Tamanho da Fonte</Label>
                <Select value={settings.fontSize} onValueChange={v => update('fontSize', v)}>
                  <SelectTrigger className="w-[130px] h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="small">Pequena</SelectItem>
                    <SelectItem value="medium">Média</SelectItem>
                    <SelectItem value="large">Grande</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            {/* Toggle sections */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Seções Visíveis</h4>

              <ToggleRow label="Foto do Produto" checked={settings.showImage} onChange={v => update('showImage', v)} />
              <ToggleRow label="Checklist do Setor" checked={settings.showChecklist} onChange={v => update('showChecklist', v)} />
              <ToggleRow label="Informações de Tiras" checked={settings.showStraps} onChange={v => update('showStraps', v)} />
              <ToggleRow label="Observações do Item" checked={settings.showObservation} onChange={v => update('showObservation', v)} />
              <ToggleRow label="SILK do Cliente" checked={settings.showSilk} onChange={v => update('showSilk', v)} />
              <ToggleRow label="Dados do Pedido de Venda" checked={settings.showSaleOrderInfo} onChange={v => update('showSaleOrderInfo', v)} />
              <ToggleRow label="Assinatura do Operador" checked={settings.showSignature} onChange={v => update('showSignature', v)} />
            </div>

            <Separator />

            <div className="flex justify-between">
              <Button variant="ghost" size="sm" onClick={() => {
                const d = { ...defaultSettings };
                setSettings(d);
                saveSettings(d);
                onSettingsChange?.(d);
              }}>
                Restaurar Padrão
              </Button>
              <Button size="sm" onClick={() => setOpen(false)}>Fechar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <Label className="text-sm">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
