/**
 * Wallet Connection
 *
 * Manages EIP-1193 wallet connection (MetaMask / PulseChain Wallet).
 * Persists the connected address across page reloads via localStorage.
 * Fires connect/disconnect callbacks so UI and other systems can react
 * without polling.
 *
 * Graceful degradation: all methods return null / false when no wallet
 * extension is present — never throws to the caller.
 *
 * ADR: docs/architecture/ADR-002-web3-library.md
 */

import { createWalletClient, custom, type WalletClient, type Address, type EIP1193Provider } from 'viem';

// Augment the global Window interface to include the EIP-1193 provider injected
// by MetaMask / PulseChain Wallet. Optional — not all browsers have a wallet.
declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}
import {
  pulsechain,
  WALLET_CONNECTION_CONFIG,
  type WalletConnectionConfig,
} from '../config/wallet-connection.config';

type ConnectCallback    = (address: Address) => void;
type DisconnectCallback = () => void;

export class WalletConnection {
  private _address:  Address | null = null;
  private _client:   WalletClient  | null = null;

  private readonly _connectCallbacks:    ConnectCallback[]    = [];
  private readonly _disconnectCallbacks: DisconnectCallback[] = [];

  constructor(
    private readonly _config: WalletConnectionConfig = WALLET_CONNECTION_CONFIG,
  ) {
    this._restoreFromStorage();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Request wallet connection. Opens the wallet extension prompt.
   * Returns the connected address, or null if no wallet is installed or the
   * user rejects the request.
   *
   * @example
   * const address = await walletConnection.connect();
   * if (address) console.log('Connected:', address);
   */
  async connect(): Promise<Address | null> {
    if (!this._hasWallet()) return null;

    try {
      this._client = createWalletClient({
        chain:     pulsechain,
        transport: custom(window.ethereum!),
      });

      const addresses = await this._client.requestAddresses();
      if (!addresses.length) return null;

      const address = addresses[0];
      this._address = address;
      this._persist(address);
      this._connectCallbacks.forEach(cb => cb(address));

      if (import.meta.env.DEV) {
        console.log('[WalletConnection] Connected:', address);
      }

      await this._warnIfWrongChain();

      return address;

    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[WalletConnection] connect() failed:', err);
      }
      return null;
    }
  }

  /**
   * Disconnect the wallet. Clears address from memory and localStorage.
   *
   * @example
   * walletConnection.disconnect();
   */
  disconnect(): void {
    this._address = null;
    this._client  = null;
    this._clearStorage();
    this._disconnectCallbacks.forEach(cb => cb());

    if (import.meta.env.DEV) {
      console.log('[WalletConnection] Disconnected');
    }
  }

  /**
   * Returns the currently connected wallet address, or null if not connected.
   *
   * @example
   * const addr = walletConnection.getAddress();
   * if (addr) showAddress(addr);
   */
  getAddress(): Address | null {
    return this._address;
  }

  /**
   * Returns true if a wallet address is currently connected.
   *
   * @example
   * if (walletConnection.isConnected()) showDisconnectButton();
   */
  isConnected(): boolean {
    return this._address !== null;
  }

  /**
   * Subscribe to wallet connect events.
   *
   * @example
   * walletConnection.onConnect(addr => updateUI(addr));
   */
  onConnect(cb: ConnectCallback): void {
    this._connectCallbacks.push(cb);
  }

  /**
   * Subscribe to wallet disconnect events.
   *
   * @example
   * walletConnection.onDisconnect(() => showConnectPrompt());
   */
  onDisconnect(cb: DisconnectCallback): void {
    this._disconnectCallbacks.push(cb);
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _hasWallet(): boolean {
    return typeof window !== 'undefined' && typeof window.ethereum !== 'undefined';
  }

  /** Silently restore a previously persisted address — no wallet prompt. */
  private _restoreFromStorage(): void {
    try {
      const stored = localStorage.getItem(this._config.storageKey);
      if (stored && stored.startsWith('0x')) {
        this._address = stored as Address;
      }
    } catch {
      // localStorage unavailable (e.g. private browsing restrictions) — ignore
    }
  }

  private _persist(address: Address): void {
    try {
      localStorage.setItem(this._config.storageKey, address);
    } catch {
      // ignore storage failures — in-memory address still works for the session
    }
  }

  private _clearStorage(): void {
    try {
      localStorage.removeItem(this._config.storageKey);
    } catch {
      // ignore
    }
  }

  /** Warn in dev if the wallet is on a different chain than expected. */
  private async _warnIfWrongChain(): Promise<void> {
    if (!import.meta.env.DEV || !this._client) return;
    try {
      const chainId = await this._client.getChainId();
      if (chainId !== this._config.expectedChainId) {
        console.warn(
          `[WalletConnection] Wallet is on chain ${chainId}, expected ` +
          `${this._config.expectedChainId} (PulseChain). ` +
          `NFT verification may fail.`,
        );
      }
    } catch {
      // non-critical — ignore
    }
  }
}
