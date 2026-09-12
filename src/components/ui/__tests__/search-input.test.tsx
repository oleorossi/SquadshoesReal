import { describe, expect, it } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SearchInput } from '../search-input';

describe('SearchInput — Enter confirma e tira o foco', () => {
  it('Enter no texto desfoca o campo e não dispara submit do form', () => {
    const { container } = render(
      <form onSubmit={(e) => { e.preventDefault(); (e.currentTarget as HTMLFormElement).dataset.submitted = '1'; }}>
        <SearchInput value="eva" onChange={() => {}} placeholder="Buscar…" />
      </form>,
    );
    const input = container.querySelector('input') as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(document.activeElement).not.toBe(input);
    expect((container.querySelector('form') as HTMLFormElement).dataset.submitted).toBeUndefined();
  });
});
