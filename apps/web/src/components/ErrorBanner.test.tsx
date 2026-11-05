import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ErrorBanner } from './ErrorBanner';

describe('ErrorBanner', () => {
  it('renders error message with inline error banner', () => {
    render(<ErrorBanner message="Swap failed due to network error." language="en" />);

    expect(screen.getByText(/Swap failed\./i)).toBeInTheDocument();
    expect(screen.getByText(/Swap failed due to network error\./i)).toBeInTheDocument();
  });

  it('renders retry button when onRetry is provided', () => {
    const onRetry = vi.fn();
    render(<ErrorBanner message="Swap failed." onRetry={onRetry} language="en" />);

    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('calls onRetry when retry button is clicked', () => {
    const onRetry = vi.fn();
    render(<ErrorBanner message="Swap failed." onRetry={onRetry} language="en" />);

    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not render retry button when onRetry is not provided', () => {
    render(<ErrorBanner message="Swap failed." language="en" />);

    expect(screen.queryByRole('button', { name: /Retry/i })).not.toBeInTheDocument();
  });
});
