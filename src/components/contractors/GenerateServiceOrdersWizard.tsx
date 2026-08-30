import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, CaretDown, CheckCircle, CurrencyDollar, Handshake,
  Needle, Package, PaperPlaneTilt, Path, Scissors, Storefront, Warning,
} from '@phosphor-icons/react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Checkbox } from '@/components/ui/checkbox';
import { SearchableSelect, type SearchableOption } from '@/components/ui/searchable-select';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from 'sonner';
import { formatCurrency, cn } from '@/lib/utils';
import {
  CONTRACTOR_SERVICE_FOCUS_META,
  contractorServicePriority,
  getContractorServiceFocus,
} from '@/lib/contractorServiceFocus';
import { useContractors } from '@/hooks/useContractors';
import { useSaleOrders } from '@/hooks/useSaleOrders';
import {
  usePvOutsourceableLines, useGenerateOpServiceOrders,
  type OutsourceableLine,
} from '@/hooks/useGenerateOpServiceOrders';
import { OsQueuePullChip } from '@/components/contractors/OsQueuePullChip';
