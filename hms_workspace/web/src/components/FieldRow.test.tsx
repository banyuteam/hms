import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppProviders } from '@/AppProviders';
import { FieldList, FieldRow } from './FieldRow';

const view = (ui: React.ReactNode) =>
  render(
    <AppProviders>
      <FieldList>{ui}</FieldList>
    </AppProviders>,
  );

describe('FieldRow', () => {
  it('shows a masked value with a reveal control', () => {
    view(<FieldRow label="Phone" masked={{ value: '0812', masked: '08••' }} />);
    expect(screen.getByText('08••')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Phone/ })).toBeInTheDocument();
  });

  it('live data (mask + server reveal, no value in the browser) shows the mask and a reveal control, not "—"', () => {
    view(
      <FieldRow
        label="NIK"
        masked={{ value: '', masked: '3273••••••••0002', reveal: async () => '3273010210850002' }}
      />,
    );
    expect(screen.getByText('3273••••••••0002')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /NIK/ })).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('an unrecorded masked value shows "—" and no reveal control (nothing to reveal)', () => {
    view(<FieldRow label="E-mail" masked={{ value: '', masked: '' }} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('plain values and the missing-value dash are unchanged', () => {
    view(
      <>
        <FieldRow label="A" value="x" />
        <FieldRow label="B" />
      </>,
    );
    expect(screen.getByText('x')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
