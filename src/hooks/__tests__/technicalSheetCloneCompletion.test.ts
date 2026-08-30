import { describe, expect, it } from 'vitest';

import {
  isTechnicalSheetCloneCompletionConfirmed,
  prepareTechnicalStrapLinesForClone,
} from '../useTechnicalSheets';

describe('isTechnicalSheetCloneCompletionConfirmed', () => {
  const requestId = '7c9ad5b9-24ad-4ce3-b602-9010d83b89a0';

  it('reconcilia resposta ambigua quando o mesmo token concluiu e o cleanup foi limpo', () => {
    expect(isTechnicalSheetCloneCompletionConfirmed({
      clone_completed_request_id: requestId,
      clone_cleanup_request_id: null,
    }, requestId)).toBe(true);
  });

  it('nao aceita conclusao de outro token nem clone ainda elegivel a cleanup', () => {
    expect(isTechnicalSheetCloneCompletionConfirmed({
      clone_completed_request_id: 'outro-token',
      clone_cleanup_request_id: null,
    }, requestId)).toBe(false);
    expect(isTechnicalSheetCloneCompletionConfirmed({
      clone_completed_request_id: requestId,
      clone_cleanup_request_id: requestId,
    }, requestId)).toBe(false);
  });

  it('preserva e normaliza linha de tira legada com id numerico ao clonar', () => {
    const [line] = prepareTechnicalStrapLinesForClone([{
      id: 1,
      label: 'TIRA LEGADA',
      quantity: 2,
    }]);

    expect(line).toMatchObject({
      label: 'TIRA LEGADA',
      quantity: 2,
      identity_basis: 'reference_base',
      identity_group_id: null,
    });
    expect(line.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(line.technical_strap_line_id).toBe(line.id);
  });
});
