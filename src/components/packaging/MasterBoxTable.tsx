import { useBoxTypes } from '@/hooks/useTransport';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Box } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

export default function MasterBoxTable() {
  const { data: boxes, isLoading } = useBoxTypes();
  const masterBoxes = boxes?.filter(b => !b.interno) ?? [];

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Box className="h-5 w-5 text-primary" />
          Caixas Master
        </CardTitle>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" /> Nova Caixa Master
        </Button>
      </CardHeader>
      <CardContent>
        {masterBoxes.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-8">
            Nenhuma caixa master cadastrada.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Dimensões (cm)</TableHead>
                <TableHead>Peso (g)</TableHead>
                <TableHead>Empilhamento Máx.</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {masterBoxes.map(box => (
                <TableRow key={box.id}>
                  <TableCell className="font-medium">{box.nome}</TableCell>
                  <TableCell className="font-mono text-sm">
                    {box.comprimento_cm} × {box.largura_cm} × {box.altura_cm}
                  </TableCell>
                  <TableCell>{box.peso_kg ?? '—'}</TableCell>
                  <TableCell>{box.empilhamento_maximo ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={box.active ? 'default' : 'secondary'}>
                      {box.active ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
