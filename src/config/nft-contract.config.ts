/**
 * NFT Contract — Robo Rhapsody ERC-721 on PulseChain
 * ADR: docs/architecture/ADR-002-web3-library.md
 */

import type { Address } from 'viem';

/** Robo Rhapsody ERC-721 contract address on PulseChain (Chain ID 369). */
export const NFT_CONTRACT_ADDRESS: Address =
  '0xc349d3354f6f42abefbf556b703803b4fd229b6f';

/**
 * Minimal ERC-721 ABI — only the functions this game needs.
 * Full ABI not required; viem resolves calls by function selector.
 */
export const NFT_ABI = [
  {
    name:             'balanceOf',
    type:             'function',
    stateMutability:  'view',
    inputs:  [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '',      type: 'uint256' }],
  },
] as const;

export interface NftContractConfig {
  /** Contract address on PulseChain. */
  contractAddress: Address;
  /** Public RPC endpoint. Can be overridden with a private key via env var. */
  rpcUrl: string;
}

export const NFT_CONTRACT_CONFIG: NftContractConfig = {
  contractAddress: NFT_CONTRACT_ADDRESS,
  rpcUrl:          import.meta.env.VITE_PULSECHAIN_RPC ?? 'https://rpc.pulsechain.com',
};
