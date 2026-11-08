import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Modal } from './Modal';

describe('Modal frame', () => {
  it('is centred on screen and dims the page behind it', () => {
    render(<Modal label="Example" title="Example" onClose={() => {}}>body</Modal>);
    const overlay = screen.getByRole('dialog');
    expect(overlay.className).toMatch(/items-center/);
    expect(overlay.className).toMatch(/justify-center/);
    expect(overlay.className).not.toMatch(/items-end/);
    expect(overlay.style.background).toMatch(/rgba\(5, 5, 9/);
  });

  it('keeps the title and the footer buttons in view, and closes from ✕, backdrop and Escape', () => {
    const onClose = vi.fn();
    render(<Modal label="Example" title="Example" onClose={onClose} footer={<button>Save</button>}>body</Modal>);
    expect(screen.getByText('Example')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(3);
    // clicking inside the panel must not close it
    fireEvent.click(screen.getByText('body'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
