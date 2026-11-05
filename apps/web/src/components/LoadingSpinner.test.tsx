import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LoadingSpinner, Skeleton } from './LoadingSpinner';

describe('LoadingSpinner', () => {
  it('renders spinner with default size', () => {
    render(<LoadingSpinner label="Loading rate…" />);

    expect(screen.getByLabelText('Loading rate…')).toBeInTheDocument();
    expect(screen.getByTestId('loading-spinner')).toBeTruthy();
  });

  it('renders spinner with custom size', () => {
    render(<LoadingSpinner size="lg" label="Executing swap…" />);

    expect(screen.getByLabelText('Executing swap…')).toBeInTheDocument();
  });

  it('renders without label when not provided', () => {
    render(<LoadingSpinner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

describe('Skeleton', () => {
  it('renders skeleton placeholder', () => {
    render(<Skeleton width="200px" height="32px" />);

    const skeleton = screen.getByTestId('skeleton');
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveStyle({ width: '200px', height: '32px' });
  });
});
