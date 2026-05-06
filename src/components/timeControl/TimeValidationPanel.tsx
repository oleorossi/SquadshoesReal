import { useState, useMemo } from 'react';
import {
  Shield, Loader2, CheckCircle2, AlertTriangle, XCircle, ListChecks, Search
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  useTimeRecords, useImportBatches,
} from '@/hooks/useTimesheet';
import { runValidation, validationRules, type ValidationResult as RuleResult } from '@/lib/timeValidationRules';
import { getBatchDateRange, resolveTimeControlFilters } from '@/lib/timeControlFilters';

interface EmployeeValidation {
  employee: string;
  totalRecords: number;
  completeRecords: number;
  incompleteRecords: number;
  duplicateRecords: number;
  qualityScore: number;
  issues: string[];
}

const SEVERITY_BADGE: Record<string, 'destructive' | 'default' | 'secondary' | 'outline'> = {
  critical: 'destructive',
  high: 'destructive',
  medium: 'default',
  low: 'outline',
};

export default function TimeValidationPanel() {
  const { data: batches = [] } = useImportBatches();
  const [selectedBatch, setSelectedBatch] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [searchEmployee, setSearchEmployee] = useState('');
  const resolvedFilters = useMemo(() => resolveTimeControlFilters({
    selectedBatch,
    filterStartDate,
    filterEndDate,
  }), [selectedBatch, filterStartDate, filterEndDate]);
  const { data: records = [], isLoading } = useTimeRecords(
    resolvedFilters.queryBatch,
    resolvedFilters.queryStartDate,
    resolvedFilters.queryEndDate,
  );

  // Per-employee quality table
  const employeeResults = useMemo<EmployeeValidation[]>(() => {
    if (records.length === 0) return [];
    const map = new Map<string, typeof records>();
    records.forEach(r => {
      if (!map.has(r.employee_name)) map.set(r.employee_name, []);
      map.get(r.employee_name)!.push(r);
    });

    const results: EmployeeValidation[] = [];
    map.forEach((empRecords, name) => {
      let complete = 0, incomplete = 0, duplicates = 0;
      const issues: string[] = [];

      empRecords.forEach(rec => {
        const punches = rec.punches as string[];
        if (punches.length % 2 !== 0) {
          incomplete++;
          issues.push(`${rec.record_date}: ${punches.length} marcações (ímpar)`);
        } else {
          complete++;
        }
        const unique = new Set(punches);
        if (unique.size < punches.length) {
          duplicates++;
          issues.push(`${rec.record_date}: marcação duplicada`);
        }
      });

      const totalRecords = empRecords.length;
      const qualityScore = totalRecords > 0 ? (complete / totalRecords) * 100 : 0;
      results.push({ employee: name, totalRecords, completeRecords: complete, incompleteRecords: incomplete, duplicateRecords: duplicates, qualityScore, issues: issues.slice(0, 10) });
    });
    let sorted = results.sort((a, b) => a.qualityScore - b.qualityScore);
    if (searchEmployee.trim()) {
      const term = searchEmployee.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      sorted = sorted.filter(e => e.employee.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(term));
    }
    return sorted;
  }, [records, searchEmployee]);

  // Rule-based validation
  const ruleResults = useMemo<RuleResult[]>(() => {
    if (records.length === 0) return [];
    return runValidation(records);
  }, [records]);

  const rulesSummary = useMemo(() => {
    const byRule = new Map<string, number>();
    ruleResults.forEach(r => byRule.set(r.rule_id, (byRule.get(r.rule_id) || 0) + 1));
    return validationRules.filter(r => r.active).map(rule => ({
      ...rule,
      violations: byRule.get(rule.id) || 0,
    }));
  }, [ruleResults]);

  const overallQuality = useMemo(() => {
    if (employeeResults.length === 0) return 0;
    return employeeResults.reduce((s, r) => s + r.qualityScore, 0) / employeeResults.length;
  }, [employeeResults]);

  if (isLoading) return <Loader2 className="h-6 w-6 animate-spin mx-auto my-8" />;

  return (
    <div className="space-y-4">
      {/* Header + Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Shield className="h-5 w-5" /> Validação de Dados
          </h3>
          <p className="text-xs text-muted-foreground">Análise de qualidade e integridade dos registros de ponto</p>
        </div>
        <div className="w-56">
          <Label className="text-xs font-medium">Importação</Label>
          <Select value={selectedBatch} onValueChange={(value) => {
            setSelectedBatch(value);
            const range = getBatchDateRange(value);
            if (range) {
              setFilterStartDate(range.startDate);
              setFilterEndDate(range.endDate);
            }
          }}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
            <SelectContent>
              {batches.map(b => <SelectItem key={b} value={b}>{b.replace(/_\d+$/, '')}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Label className="text-xs font-medium">Data Início</Label>
          <Input type="date" value={filterStartDate} onChange={e => setFilterStartDate(e.target.value)} className="mt-1" />
        </div>
        <div className="w-40">
          <Label className="text-xs font-medium">Data Fim</Label>
          <Input type="date" value={filterEndDate} onChange={e => setFilterEndDate(e.target.value)} className="mt-1" />
        </div>
        <div className="w-56">
          <Label className="text-xs font-medium">Buscar Funcionário</Label>
          <div className="relative mt-1">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Digitar nome..."
              value={searchEmployee}
              onChange={e => setSearchEmployee(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>
      </div>

      {employeeResults.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Shield className="h-12 w-12 mb-4 opacity-40" />
            <p className="font-medium">Selecione um período para validar</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Overall Quality */}
          <Card className={overallQuality >= 95 ? 'border-green-500/20 bg-green-500/5' : overallQuality >= 80 ? 'border-amber-500/20 bg-amber-500/5' : 'border-destructive/20 bg-destructive/5'}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className={`p-3 rounded-lg ${overallQuality >= 95 ? 'bg-green-500/10' : overallQuality >= 80 ? 'bg-amber-500/10' : 'bg-destructive/10'}`}>
                {overallQuality >= 95 ? <CheckCircle2 className="h-6 w-6 text-green-600" /> :
                 overallQuality >= 80 ? <AlertTriangle className="h-6 w-6 text-amber-600" /> :
                 <XCircle className="h-6 w-6 text-destructive" />}
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">Qualidade Geral dos Dados</p>
                <Progress value={overallQuality} className="mt-1 h-2" />
              </div>
              <p className={`text-2xl font-black font-mono ${overallQuality >= 95 ? 'text-green-600' : overallQuality >= 80 ? 'text-amber-600' : 'text-destructive'}`}>
                {overallQuality.toFixed(1)}%
              </p>
            </CardContent>
          </Card>

          {/* Rule-based Validation Summary */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ListChecks className="h-4 w-4" /> Regras de Validação
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {rulesSummary.map(rule => (
                <div key={rule.id} className="flex items-center justify-between py-1.5 border-b last:border-0">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{rule.name}</span>
                      <Badge variant={SEVERITY_BADGE[rule.severity] || 'outline'} className="text-[10px]">
                        {rule.severity}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{rule.description}</p>
                  </div>
                  <div className="text-right ml-4">
                    {rule.violations === 0 ? (
                      <span className="text-green-600 text-xs font-medium flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" /> OK
                      </span>
                    ) : (
                      <Badge variant="destructive" className="text-xs">
                        {rule.violations} violação{rule.violations > 1 ? 'ões' : ''}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Detailed Violations */}
          {ruleResults.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" /> Violações Detectadas ({ruleResults.length})
                </CardTitle>
              </CardHeader>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Regra</TableHead>
                      <TableHead>Funcionário</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>Mensagem</TableHead>
                      <TableHead>Sugestão</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ruleResults.slice(0, 100).map((v, i) => (
                      <TableRow key={`${v.record_id}-${v.rule_id}-${i}`}>
                        <TableCell>
                          <Badge variant={SEVERITY_BADGE[v.severity] || 'outline'} className="text-[10px]">
                            {v.rule_id.replace(/_/g, ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium text-sm">{v.employee_name}</TableCell>
                        <TableCell className="font-mono text-sm">
                          {new Date(v.record_date + 'T12:00:00').toLocaleDateString('pt-BR')}
                        </TableCell>
                        <TableCell className="text-xs max-w-[250px]">{v.message}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[200px]">{v.suggested_fix || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {ruleResults.length > 100 && (
                <div className="p-3 text-center text-xs text-muted-foreground border-t">
                  Exibindo 100 de {ruleResults.length} violações
                </div>
              )}
            </Card>
          )}

          {/* Per-Employee Table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Qualidade por Funcionário</CardTitle>
            </CardHeader>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Funcionário</TableHead>
                    <TableHead className="text-right">Registros</TableHead>
                    <TableHead className="text-right">Completos</TableHead>
                    <TableHead className="text-right">Incompletos</TableHead>
                    <TableHead className="text-right">Duplicados</TableHead>
                    <TableHead className="text-right">Qualidade</TableHead>
                    <TableHead>Problemas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employeeResults.map(r => (
                    <TableRow key={r.employee}>
                      <TableCell className="font-medium text-sm">{r.employee}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{r.totalRecords}</TableCell>
                      <TableCell className="text-right font-mono text-sm text-green-600">{r.completeRecords}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {r.incompleteRecords > 0 ? <span className="text-destructive font-medium">{r.incompleteRecords}</span> : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {r.duplicateRecords > 0 ? <span className="text-amber-600 font-medium">{r.duplicateRecords}</span> : '—'}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        <div className="flex items-center gap-2 justify-end">
                          <Progress value={r.qualityScore} className="w-16 h-1.5" />
                          <span className={`font-mono text-xs font-medium ${r.qualityScore >= 95 ? 'text-green-600' : r.qualityScore >= 80 ? 'text-amber-600' : 'text-destructive'}`}>
                            {r.qualityScore.toFixed(0)}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs max-w-[200px]">
                        {r.issues.length > 0 ? (
                          <span className="text-muted-foreground">{r.issues[0]}{r.issues.length > 1 ? ` (+${r.issues.length - 1})` : ''}</span>
                        ) : <span className="text-green-600">✓ OK</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
