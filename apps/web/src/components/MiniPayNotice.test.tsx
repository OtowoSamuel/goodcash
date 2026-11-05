import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MiniPayNotice } from './MiniPayNotice';
import type { Language } from '../lib/i18n';

describe('MiniPayNotice', () => {
  it('renders MiniPay blocked screen with restricted environment message', () => {
    const { container } = render(<MiniPayNotice language="en" />);

    expect(screen.getByRole('heading', { name: /MiniPay does not support G\$/i })).toBeInTheDocument();
    expect(container.querySelector('p')?.textContent).toContain('GoodCash needs a wallet that can hold G$');
    expect(container.querySelectorAll('p')[1]?.textContent).toContain('We do not connect the MiniPay wallet');
  });

  it('renders copy link button and open in browser link', () => {
    render(<MiniPayNotice language="en" />);

    expect(screen.getByRole('button', { name: /Copy GoodCash link/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open in browser/i })).toBeInTheDocument();
  });

  it('shows "Link copied" after clicking copy button', async () => {
    // Mock clipboard API for jsdom
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    render(<MiniPayNotice language="en" />);

    const copyButton = screen.getByRole('button', { name: /Copy GoodCash link/i });
    fireEvent.click(copyButton);

    expect(await screen.findByText(/Link copied/i)).toBeInTheDocument();
  });
});
