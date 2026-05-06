import { useState } from 'react';

/**
 * Simple useState wrapper — always starts fresh with the default value.
 * No persistence across navigation.
 */
export function usePersistedState<T>(_key: string, defaultValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  return useState<T>(defaultValue);
}
