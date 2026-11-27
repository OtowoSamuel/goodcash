import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IdPrivacyNote } from './AddGsModal';

describe('IdPrivacyNote', () => {
  it('says in plain words where the ID goes and that GoodCash does not keep it', () => {
    render(<IdPrivacyNote idType="NIN" />);
    const note = screen.getByTestId('id-privacy-note');
    expect(note.textContent).toContain('What happens to your NIN');
    expect(note.textContent).toContain('only for this payment');
    expect(note.textContent).toContain('GoodCash does not keep it');
    expect(note.textContent).not.toMatch(/partner|KYC|token/i);
  });
});
