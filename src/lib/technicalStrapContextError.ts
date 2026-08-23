import {
  SingleFlightBusyError,
  SingleFlightCooldownError,
} from '@/lib/singleFlightCooldown';

export type TechnicalStrapContextErrorCode =
  | 'technical_sheet_stale'
  | 'strap_pipeline_busy'
  | 'database_lock_timeout'
  | 'pool_timeout'
  | null;

export function technicalStrapContextErrorCode(
  error: unknown,
): TechnicalStrapContextErrorCode {
  const technicalDetails = error && typeof error === 'object'
    ? [
      (error as Record<string, unknown>).code,
      (error as Record<string, unknown>).message,
      (error as Record<string, unknown>).details,
      (error as Record<string, unknown>).hint,
    ].filter((value): value is string => typeof value === 'string').join(' ')
    : '';

  if (technicalDetails.includes('technical_sheet_stale')) return 'technical_sheet_stale';
  if (technicalDetails.includes('strap_pipeline_busy')) return 'strap_pipeline_busy';
  if (technicalDetails.includes('55P03')) return 'database_lock_timeout';
  if (technicalDetails.includes('PGRST003')) return 'pool_timeout';
  return null;
}

export function technicalStrapContextErrorMessage(error: unknown): string {
  if (error instanceof SingleFlightBusyError) {
    return 'Já existe uma correção desta referência em andamento nesta aba. Aguarde a conclusão.';
  }
  if (error instanceof SingleFlightCooldownError) {
    const seconds = Math.max(1, Math.ceil(error.retryAfterMs / 1_000));
    return `A correção anterior acabou há pouco. Aguarde ${seconds} segundo${seconds === 1 ? '' : 's'} antes de tentar novamente.`;
  }

  const code = technicalStrapContextErrorCode(error);
  if (code === 'technical_sheet_stale') {
    return 'A ficha técnica mudou durante a correção. Os dados foram atualizados; confira e tente novamente.';
  }
  if (code === 'strap_pipeline_busy') {
    return 'Outra operação de tiras está em andamento. Aguarde alguns segundos e tente novamente.';
  }
  if (code === 'database_lock_timeout') {
    return 'Outro cadastro está usando estes dados. Aguarde alguns segundos e tente novamente.';
  }
  if (code === 'pool_timeout') {
    return 'O banco está ocupado e não conseguiu iniciar a correção a tempo. Aguarde alguns segundos e tente novamente.';
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || '');
  }
  return '';
}
