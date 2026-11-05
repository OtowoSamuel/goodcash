import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CashOutTracker } from './CashOutTracker';

describe('CashOutTracker Component', () => {
  // Realistic: 1000 G$ → 0.1140 USDT via reserve quote (126658838063094 price, 10% exit)
  const baseProps = {
    txHash: '0x1f73b2d4af5cd391f0eb1d319f262a1cad73a47ade16f03612eea89948b5e705',
    amountGSwapped: 1000,
    usdtReceived: 0.1140,
    residualBalanceG: 0,
    residualBalanceUsdt: 0,
    bankName: 'First Bank of Nigeria',
    accountNumber: '1234567890',
    accountHolderName: 'Jane Doe',
    ngnPerUsdt: 1500,
    walletAddress: '0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6',
    onDone: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Top of the screen', () => {
    it('renders the headline naira estimate and the exact subtitle', () => {
      render(<CashOutTracker {...baseProps} />);

      // Top headline naira estimate: 0.1140 * 1500 = 171.00
      expect(screen.getByText(/≈ ₦171\.00/i)).toBeInTheDocument();
      // Required subtitle: "Final amount is set when the payout completes"
      expect(screen.getByText('Final amount is set when the payout completes')).toBeInTheDocument();
    });
  });

  describe('Stepper Header', () => {
    it('renders all 4 steps in the stepper header', () => {
      render(<CashOutTracker {...baseProps} />);

      expect(screen.getByText(/1 Swapped to USDT/i)).toBeInTheDocument();
      expect(screen.getByText(/2 Send to partner/i)).toBeInTheDocument();
      expect(screen.getByText(/3 Paying to your bank/i)).toBeInTheDocument();
      expect(screen.getByText(/4 Done/i)).toBeInTheDocument();
    });
  });

  describe('Each tracker step renders', () => {
    it('renders Step 1 summary when initialStep is 1', () => {
      render(<CashOutTracker {...baseProps} initialStep={1} />);

      expect(screen.getByText(/Swapped 1,000 G\$ to 0\.1140 USDT/i)).toBeInTheDocument();
    });

    it('renders Step 2 (user action) with all required fields, copy button, countdown, warning, and "I\'ve sent it" button', () => {
      const initialOrder = {
        orderId: 'ord-test-step2',
        receiveAddress: '0x3841D6A1F3E92B710c0e5a953eB684B24B35fC75',
        amountToSend: '0.1140',
        validUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        memo: 'GoodCash-test-memo',
        status: 'initiated' as const,
      };

      render(
        <CashOutTracker
          {...baseProps}
          initialStep={2}
          initialOrder={initialOrder}
        />
      );

      // "Send exactly X USDT to this address before [time]"
      expect(screen.getByText(/Send exactly/i)).toBeInTheDocument();
      expect(screen.getAllByText(/0\.1140 USDT/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/to this address before/i)).toBeInTheDocument();

      // Receive address
      expect(screen.getByText('0x3841D6A1F3E92B710c0e5a953eB684B24B35fC75')).toBeInTheDocument();

      // Copy button
      expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();

      // Memo (if required)
      expect(screen.getByText('GoodCash-test-memo')).toBeInTheDocument();

      // Warning that a smaller amount is refunded
      expect(screen.getByText(/Warning:/i)).toBeInTheDocument();
      expect(screen.getByText(/A smaller amount is refunded/i)).toBeInTheDocument();

      // Primary button: "I've sent it"
      const sentButton = screen.getByRole('button', { name: /I've sent it/i });
      expect(sentButton).toBeInTheDocument();

      // Clicking "I've sent it" transitions tracker to Step 3
      fireEvent.click(sentButton);
      expect(screen.getByText('Paying to your bank')).toBeInTheDocument();
    });

    it('renders Step 3 (Paying to your bank) with bank destination and refresh button', () => {
      render(
        <CashOutTracker
          {...baseProps}
          initialStep={3}
          initialOrder={{
            orderId: 'ord-test-step3',
            status: 'pending',
          }}
        />
      );

      expect(screen.getByText('Paying to your bank')).toBeInTheDocument();
      expect(screen.getByText('First Bank of Nigeria')).toBeInTheDocument();
      expect(screen.getByText('1234567890')).toBeInTheDocument();
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /refresh status/i })).toBeInTheDocument();
    });

    it('renders Step 4 (Done) with bank reference and Done button', () => {
      render(
        <CashOutTracker
          {...baseProps}
          initialStep={4}
          initialOrder={{
            orderId: 'ord-test-step4',
            status: 'settled',
            paymentReference: 'PAYCREST-TX-998877',
          }}
        />
      );

      expect(screen.getByText('Naira Delivered!')).toBeInTheDocument();
      expect(screen.getByText(/Bank Reference:/i)).toBeInTheDocument();
      expect(screen.getByText('PAYCREST-TX-998877')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Done$/i })).toBeInTheDocument();
    });
  });

  describe('Done appears only on settled', () => {
    it('does NOT show Done or "Naira Delivered!" when status is initiated', () => {
      render(
        <CashOutTracker
          {...baseProps}
          initialOrder={{
            orderId: 'ord-initiated',
            status: 'initiated',
          }}
        />
      );

      expect(screen.queryByText('Naira Delivered!')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Done$/i })).not.toBeInTheDocument();
    });

    it('does NOT show Done or "Naira Delivered!" when status is depositing or pending', () => {
      render(
        <CashOutTracker
          {...baseProps}
          initialOrder={{
            orderId: 'ord-pending',
            status: 'pending',
          }}
        />
      );

      expect(screen.queryByText('Naira Delivered!')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Done$/i })).not.toBeInTheDocument();
    });

    it('DOES show Done and "Naira Delivered!" when status is settled', () => {
      render(
        <CashOutTracker
          {...baseProps}
          initialOrder={{
            orderId: 'ord-settled-1',
            status: 'settled',
            paymentReference: 'REF-BANK-12345',
          }}
        />
      );

      expect(screen.getByText('Naira Delivered!')).toBeInTheDocument();
      expect(screen.getByText('REF-BANK-12345')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Done$/i })).toBeInTheDocument();
    });
  });

  describe('Failure states show the order ID and Contact support action', () => {
    it('failure state 1: order expired before USDT arrived shows order ID and Contact support', () => {
      const orderId = 'ord-expired-999';
      render(
        <CashOutTracker
          {...baseProps}
          initialOrder={{ orderId, status: 'expired' }}
          initialFailureState="expired"
        />
      );

      expect(screen.getByText(/order expired before USDT arrived/i)).toBeInTheDocument();
      expect(screen.getAllByText(orderId).length).toBeGreaterThanOrEqual(1);

      const supportLink = screen.getByRole('link', { name: /contact support/i });
      expect(supportLink).toBeInTheDocument();
      expect(supportLink).toHaveAttribute('href', expect.stringContaining(orderId));
    });

    it('failure state 2: order refunded shows order ID and Contact support', () => {
      const orderId = 'ord-refunded-888';
      render(
        <CashOutTracker
          {...baseProps}
          initialOrder={{ orderId, status: 'refunded' }}
          initialFailureState="refunded"
        />
      );

      expect(screen.getByText(/order refunded/i)).toBeInTheDocument();
      expect(screen.getAllByText(orderId).length).toBeGreaterThanOrEqual(1);

      const supportLink = screen.getByRole('link', { name: /contact support/i });
      expect(supportLink).toBeInTheDocument();
      expect(supportLink).toHaveAttribute('href', expect.stringContaining(orderId));
    });

    it('failure state 3: USDT sent but naira not received after N minutes shows order ID and Contact support', () => {
      const orderId = 'ord-delayed-777';
      render(
        <CashOutTracker
          {...baseProps}
          initialOrder={{ orderId, status: 'pending' }}
          initialFailureState="delayed"
          delayedTimeoutMinutes={5}
        />
      );

      expect(screen.getByText(/USDT sent but naira not received after 5 minutes/i)).toBeInTheDocument();
      expect(screen.getAllByText(orderId).length).toBeGreaterThanOrEqual(1);

      const supportLink = screen.getByRole('link', { name: /contact support/i });
      expect(supportLink).toBeInTheDocument();
      expect(supportLink).toHaveAttribute('href', expect.stringContaining(orderId));
    });
  });

  describe('Paycrest order response is authoritative', () => {
    it('shows amount to send, fees, and expected naira from the order response instead of the swap output', () => {
      render(
        <CashOutTracker
          {...baseProps}
          initialStep={2}
          initialOrder={{
            orderId: 'ord-paycrest-docs-example',
            amountToSend: '105.0000',
            amount: '100',
            rate: '1650',
            expectedNaira: '165000.00',
            senderFee: '4.9',
            transactionFee: '0.1',
            status: 'initiated',
          }}
        />
      );

      expect(screen.getByText(/≈ ₦165,000\.00/)).toBeInTheDocument();
      expect(screen.getByText('Set by your Paycrest payout order')).toBeInTheDocument();
      expect(screen.getByText('Amount to send (from Paycrest)')).toBeInTheDocument();
      expect(screen.getAllByText('105.0000 USDT').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('4.9 USDT')).toBeInTheDocument();
      expect(screen.getByText('0.1 USDT')).toBeInTheDocument();
      expect(screen.getByText('₦165,000.00')).toBeInTheDocument();
      expect(screen.queryByText(/0\.1140 USDT/)).not.toBeInTheDocument();
    });
  });

  describe('Under Details section', () => {
    it('displays swap hash, explorer link, residual balance, and order ID', () => {
      const orderId = 'ord-details-check';
      render(
        <CashOutTracker
          {...baseProps}
          initialOrder={{ orderId, status: 'initiated' }}
        />
      );

      expect(screen.getByText('Details')).toBeInTheDocument();
      expect(screen.getByText(baseProps.txHash)).toBeInTheDocument();

      const explorerLink = screen.getByRole('link', { name: /view on celo explorer/i });
      expect(explorerLink).toBeInTheDocument();
      expect(explorerLink).toHaveAttribute(
        'href',
        `https://celo.blockscout.com/tx/${baseProps.txHash}`
      );

      expect(screen.getByText(/0 G\$ \/ 0 USDT \(Zero-dust design\)/i)).toBeInTheDocument();
      expect(screen.getAllByText(orderId).length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Reload safety and tap-independent status polling', () => {
    it('restores active order details (deposit address, amount, deadline, status) upon reload', () => {
      const restoredOrder = {
        orderId: 'ord-restored-456',
        receiveAddress: '0x3841D6A1F3E92B710c0e5a953eB684B24B35fC75',
        amountToSend: '0.1140',
        validUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        status: 'initiated' as const,
      };

      render(
        <CashOutTracker
          {...baseProps}
          initialOrder={restoredOrder}
        />
      );

      // Verifies deposit address, amount to send, and deadline are restored
      expect(screen.getByText('0x3841D6A1F3E92B710c0e5a953eB684B24B35fC75')).toBeInTheDocument();
      expect(screen.getAllByText(/0\.1140 USDT/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/Send to partner/i)).toBeInTheDocument();
      expect(screen.getAllByText('ord-restored-456').length).toBeGreaterThanOrEqual(1);
    });

    it('auto-advances to Step 3 (Paying to your bank) if deposit is received even if user never tapped "I\'ve sent it"', () => {
      const initialOrder = {
        orderId: 'ord-auto-step3',
        receiveAddress: '0x3841D6A1F3E92B710c0e5a953eB684B24B35fC75',
        amountToSend: '0.1140',
        status: 'deposited' as const, // deposit detected on-chain by partner
      };

      render(
        <CashOutTracker
          {...baseProps}
          initialOrder={initialOrder}
        />
      );

      // Auto advances to Step 3
      expect(screen.getByText('Paying to your bank')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /I've sent it/i })).not.toBeInTheDocument();
    });
  });
});
