/**
 * Wallet Connection — configuration and PulseChain chain definition
 * GDD: design/gdd/wallet-connection.md
 * ADR: docs/architecture/ADR-002-web3-library.md
 */

import { defineChain } from 'viem';

/** PulseChain — EVM-compatible chain (Chain ID 369). Not bundled in viem/chains. */
export const pulsechain = defineChain({
  id: 369,
  name: 'PulseChain',
  nativeCurrency: { name: 'Pulse', symbol: 'PLS', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.pulsechain.com'] },
  },
  blockExplorers: {
    default: { name: 'PulseScan', url: 'https://scan.pulsechain.com' },
  },
});

export interface WalletConnectionConfig {
  /** localStorage key used to persist the connected wallet address. */
  storageKey: string;
  /** Expected chain ID — used to warn when wallet is on the wrong network. */
  expectedChainId: number;
}

export const WALLET_CONNECTION_CONFIG: WalletConnectionConfig = {
  storageKey:       'roborhapsody_wallet_address',
  expectedChainId:  369,
};
