import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
 import { History, Scissors } from 'lucide-react';
 import AuditLogTab from './tabs/AuditLogTab';
import StrapStockLogTab from './tabs/StrapStockLogTab';

export default function UnifiedAuditLog() {
  const [sub, setSub] = useState('manual');

  return (
    <Tabs value={sub} onValueChange={setSub} className="w-full">
      <TabsList className="mb-4">
        <TabsTrigger value="manual" className="gap-1.5 text-xs">
          <History className="h-3.5 w-3.5" /> Lançamentos Manuais
        </TabsTrigger>
        <TabsTrigger value="straps" className="gap-1.5 text-xs">
          <Scissors className="h-3.5 w-3.5" /> Tiras
        </TabsTrigger>
      </TabsList>

      <TabsContent value="manual"><AuditLogTab /></TabsContent>
      <TabsContent value="straps"><StrapStockLogTab /></TabsContent>
    </Tabs>
  );
}
