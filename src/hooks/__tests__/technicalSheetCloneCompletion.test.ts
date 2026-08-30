import { describe, expect, it } from 'vitest';

import { isTechnicalSheetCloneCompletionConfirmed } from '../useTechnicalSheets';

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
});
