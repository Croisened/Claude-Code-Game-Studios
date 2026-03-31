// @vitest-environment jsdom

/**
 * WalletConnection — unit tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WalletConnection } from './wallet-connection';
import type { WalletConnectionConfig } from '../config/wallet-connection.config';

// ── Test config ───────────────────────────────────────────────────────────────

const TEST_CONFIG: WalletConnectionConfig = {
  storageKey:      'test_wallet_address',
  expectedChainId: 369,
};

// viem normalises addresses to EIP-55 checksum format on return.
const MOCK_ADDRESS = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF' as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Install a mock window.ethereum that returns the given addresses. */
/** Install a mock window.ethereum that returns the given addresses (checksummed). */
function installMockEthereum(addresses: string[] = [MOCK_ADDRESS]): void {
  Object.defineProperty(window, 'ethereum', {
    value: {
      request: vi.fn(({ method }: { method: string }) => {
        if (method === 'eth_requestAccounts') return Promise.resolve(addresses);
        if (method === 'eth_chainId') return Promise.resolve('0x171'); // 369
        return Promise.resolve(null);
      }),
    },
    writable:     true,
    configurable: true,
  });
}

/** Remove window.ethereum to simulate no wallet installed. */
function removeEthereum(): void {
  Object.defineProperty(window, 'ethereum', {
    value:        undefined,
    writable:     true,
    configurable: true,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WalletConnection', () => {
  beforeEach(() => {
    localStorage.clear();
    removeEthereum();
  });

  // ── connect() ──────────────────────────────────────────────────────────────

  describe('connect()', () => {
    it('returns the wallet address when connection succeeds', async () => {
      installMockEthereum([MOCK_ADDRESS]);
      const wc = new WalletConnection(TEST_CONFIG);

      const result = await wc.connect();

      expect(result).toBe(MOCK_ADDRESS);
    });

    it('sets isConnected() to true after successful connect', async () => {
      installMockEthereum([MOCK_ADDRESS]);
      const wc = new WalletConnection(TEST_CONFIG);

      await wc.connect();

      expect(wc.isConnected()).toBe(true);
    });

    it('sets getAddress() to the connected address', async () => {
      installMockEthereum([MOCK_ADDRESS]);
      const wc = new WalletConnection(TEST_CONFIG);

      await wc.connect();

      expect(wc.getAddress()).toBe(MOCK_ADDRESS);
    });

    it('persists address to localStorage on connect', async () => {
      installMockEthereum([MOCK_ADDRESS]);
      const wc = new WalletConnection(TEST_CONFIG);

      await wc.connect();

      expect(localStorage.getItem(TEST_CONFIG.storageKey)).toBe(MOCK_ADDRESS);
    });

    it('fires onConnect callbacks with the address', async () => {
      installMockEthereum([MOCK_ADDRESS]);
      const wc = new WalletConnection(TEST_CONFIG);
      const cb = vi.fn();
      wc.onConnect(cb);

      await wc.connect();

      expect(cb).toHaveBeenCalledOnce();
      expect(cb).toHaveBeenCalledWith(MOCK_ADDRESS);
    });

    it('returns null when no wallet extension is installed', async () => {
      removeEthereum();
      const wc = new WalletConnection(TEST_CONFIG);

      const result = await wc.connect();

      expect(result).toBeNull();
    });

    it('does not fire connect callbacks when no wallet is installed', async () => {
      removeEthereum();
      const wc = new WalletConnection(TEST_CONFIG);
      const cb = vi.fn();
      wc.onConnect(cb);

      await wc.connect();

      expect(cb).not.toHaveBeenCalled();
    });

    it('returns null when wallet returns empty address list', async () => {
      installMockEthereum([]);
      const wc = new WalletConnection(TEST_CONFIG);

      const result = await wc.connect();

      expect(result).toBeNull();
    });

    it('returns null when wallet request rejects (user dismisses prompt)', async () => {
      Object.defineProperty(window, 'ethereum', {
        value: {
          request: vi.fn().mockRejectedValue(new Error('User rejected')),
        },
        writable: true, configurable: true,
      });
      const wc = new WalletConnection(TEST_CONFIG);

      const result = await wc.connect();

      expect(result).toBeNull();
    });
  });

  // ── disconnect() ───────────────────────────────────────────────────────────

  describe('disconnect()', () => {
    it('clears the address after disconnect', async () => {
      installMockEthereum([MOCK_ADDRESS]);
      const wc = new WalletConnection(TEST_CONFIG);
      await wc.connect();

      wc.disconnect();

      expect(wc.getAddress()).toBeNull();
    });

    it('sets isConnected() to false after disconnect', async () => {
      installMockEthereum([MOCK_ADDRESS]);
      const wc = new WalletConnection(TEST_CONFIG);
      await wc.connect();

      wc.disconnect();

      expect(wc.isConnected()).toBe(false);
    });

    it('removes address from localStorage on disconnect', async () => {
      installMockEthereum([MOCK_ADDRESS]);
      const wc = new WalletConnection(TEST_CONFIG);
      await wc.connect();

      wc.disconnect();

      expect(localStorage.getItem(TEST_CONFIG.storageKey)).toBeNull();
    });

    it('fires onDisconnect callbacks', async () => {
      installMockEthereum([MOCK_ADDRESS]);
      const wc = new WalletConnection(TEST_CONFIG);
      await wc.connect();
      const cb = vi.fn();
      wc.onDisconnect(cb);

      wc.disconnect();

      expect(cb).toHaveBeenCalledOnce();
    });
  });

  // ── localStorage persistence ───────────────────────────────────────────────

  describe('localStorage persistence', () => {
    it('restores address from localStorage on construction', () => {
      localStorage.setItem(TEST_CONFIG.storageKey, MOCK_ADDRESS);

      const wc = new WalletConnection(TEST_CONFIG);

      expect(wc.getAddress()).toBe(MOCK_ADDRESS);
      expect(wc.isConnected()).toBe(true);
    });

    it('does not restore values that do not start with 0x', () => {
      localStorage.setItem(TEST_CONFIG.storageKey, 'not-an-address');

      const wc = new WalletConnection(TEST_CONFIG);

      expect(wc.getAddress()).toBeNull();
    });

    it('starts disconnected when localStorage is empty', () => {
      const wc = new WalletConnection(TEST_CONFIG);

      expect(wc.getAddress()).toBeNull();
      expect(wc.isConnected()).toBe(false);
    });
  });
});
