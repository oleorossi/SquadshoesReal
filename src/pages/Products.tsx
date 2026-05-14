import AppLayout from "@/components/layout/AppLayout";
import { useState } from 'react';
import { FileText, Stack as Layers } from '@phosphor-icons/react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import TechnicalSheetsContent from '@/pages/TechnicalSheets';
import ComponentSheetsContent from '@/pages/ComponentSheets';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

export default function Products() {
  const [tab, setTab] = useState('sheets');

  return (
    
      <div className="space-y-5 page-enter">
        <EditorialPageHeader
          sectionLabel="ENGENHARIA · Produtos"
          title="Produtos"
          description="Fichas técnicas (referências) e fichas de componentes"
        />
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="sheets" className="gap-1"><FileText className="h-3.5 w-3.5" /> Fichas Técnicas</TabsTrigger>
            <TabsTrigger value="components" className="gap-1"><Layers className="h-3.5 w-3.5" /> Fichas de Componentes</TabsTrigger>
          </TabsList>
          <TabsContent value="sheets"><TechnicalSheetsContent embedded /></TabsContent>
          <TabsContent value="components"><ComponentSheetsContent embedded /></TabsContent>
        </Tabs>
      </div>
    
  );
}
