/**
 * NFT Ownership Verification
 *
 * Queries the Robo Rhapsody ERC-721 contract on PulseChain to confirm whether
 * a connected wallet holds at least one token. A verified holder is entitled to
 * load their NFT skin via the NFT Skin Loader.
 *
 * Uses a read-only public client (no wallet / gas required).
 * Graceful degradation: verify() returns false on any network or RPC error —
 * the game remains playable with the default skin.
 *
 * ADR: docs/architecture/ADR-002-web3-library.md
 */

import {
  createPublicClient,
  http,
  type Address,
  type PublicClient,
} from 'viem';
import { pulsechain } from '../config/wallet-connection.config';
import {
  NFT_ABI,
  NFT_CONTRACT_CONFIG,
  type NftContractConfig,
} from '../config/nft-contract.config';

export class NftOwnership {
  private readonly _client: PublicClient;
  private readonly _contractAddress: Address;

  /**
   * @param config  - Contract + RPC config. Defaults to production values.
   * @param client  - Optional injected PublicClient (for testing / DI).
   *
   * @example
   * const nft = new NftOwnership();
   * const isHolder = await nft.verify(walletAddress);
   */
  constructor(
    private readonly _config: NftContractConfig = NFT_CONTRACT_CONFIG,
    client?: PublicClient,
  ) {
    this._contractAddress = _config.contractAddress;
    this._client = client ?? createPublicClient({
      chain:     pulsechain,
      transport: http(_config.rpcUrl),
    });
  }

  /**
   * Returns true if the given address holds at least one Robo Rhapsody token.
   * Returns false on any error (RPC failure, wrong chain, invalid address).
   *
   * @param address - The wallet address to check (EIP-55 checksummed).
   *
   * @example
   * if (await nft.verify(address)) {
   *   skinLoader.loadNftSkin(address);
   * }
   */
  async verify(address: Address): Promise<boolean> {
    try {
      const balance = await this._client.readContract({
        address:      this._contractAddress,
        abi:          NFT_ABI,
        functionName: 'balanceOf',
        args:         [address],
      });

      return (balance as bigint) > 0n;

    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[NftOwnership] verify() failed — defaulting to false:', err);
      }
      return false;
    }
  }
}
