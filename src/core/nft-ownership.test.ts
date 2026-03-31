/**
 * NftOwnership — unit tests
 */

import { describe, it, expect, vi } from 'vitest';
import { NftOwnership } from './nft-ownership';
import { NFT_CONTRACT_ADDRESS, NFT_CONTRACT_CONFIG } from '../config/nft-contract.config';
import type { PublicClient, Address } from 'viem';

// ── Helpers ───────────────────────────────────────────────────────────────────

const HOLDER_ADDRESS:     Address = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF';
const NON_HOLDER_ADDRESS: Address = '0x0000000000000000000000000000000000000001';

/** Build a mock PublicClient whose readContract returns the given balance. */
function mockClientWithBalance(balance: bigint): PublicClient {
  return {
    readContract: vi.fn().mockResolvedValue(balance),
  } as unknown as PublicClient;
}

/** Build a mock PublicClient whose readContract rejects with an error. */
function mockClientWithError(message = 'RPC error'): PublicClient {
  return {
    readContract: vi.fn().mockRejectedValue(new Error(message)),
  } as unknown as PublicClient;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NftOwnership', () => {

  // ── verify() — holder ──────────────────────────────────────────────────────

  describe('verify() — NFT holder', () => {
    it('returns true when wallet holds one token', async () => {
      const nft = new NftOwnership(NFT_CONTRACT_CONFIG, mockClientWithBalance(1n));

      expect(await nft.verify(HOLDER_ADDRESS)).toBe(true);
    });

    it('returns true when wallet holds multiple tokens', async () => {
      const nft = new NftOwnership(NFT_CONTRACT_CONFIG, mockClientWithBalance(5n));

      expect(await nft.verify(HOLDER_ADDRESS)).toBe(true);
    });

    it('calls readContract with the correct contract address', async () => {
      const client = mockClientWithBalance(1n);
      const nft    = new NftOwnership(NFT_CONTRACT_CONFIG, client);

      await nft.verify(HOLDER_ADDRESS);

      expect(client.readContract).toHaveBeenCalledWith(
        expect.objectContaining({ address: NFT_CONTRACT_ADDRESS }),
      );
    });

    it('calls readContract with the wallet address as the argument', async () => {
      const client = mockClientWithBalance(1n);
      const nft    = new NftOwnership(NFT_CONTRACT_CONFIG, client);

      await nft.verify(HOLDER_ADDRESS);

      expect(client.readContract).toHaveBeenCalledWith(
        expect.objectContaining({ args: [HOLDER_ADDRESS] }),
      );
    });

    it('calls balanceOf function', async () => {
      const client = mockClientWithBalance(1n);
      const nft    = new NftOwnership(NFT_CONTRACT_CONFIG, client);

      await nft.verify(HOLDER_ADDRESS);

      expect(client.readContract).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: 'balanceOf' }),
      );
    });
  });

  // ── verify() — non-holder ──────────────────────────────────────────────────

  describe('verify() — non-holder', () => {
    it('returns false when wallet holds zero tokens', async () => {
      const nft = new NftOwnership(NFT_CONTRACT_CONFIG, mockClientWithBalance(0n));

      expect(await nft.verify(NON_HOLDER_ADDRESS)).toBe(false);
    });
  });

  // ── verify() — error handling ──────────────────────────────────────────────

  describe('verify() — graceful degradation', () => {
    it('returns false on RPC network error', async () => {
      const nft = new NftOwnership(NFT_CONTRACT_CONFIG, mockClientWithError('Network error'));

      expect(await nft.verify(HOLDER_ADDRESS)).toBe(false);
    });

    it('returns false on contract revert', async () => {
      const nft = new NftOwnership(NFT_CONTRACT_CONFIG, mockClientWithError('execution reverted'));

      expect(await nft.verify(HOLDER_ADDRESS)).toBe(false);
    });

    it('returns false on RPC timeout', async () => {
      const nft = new NftOwnership(NFT_CONTRACT_CONFIG, mockClientWithError('Request timeout'));

      expect(await nft.verify(HOLDER_ADDRESS)).toBe(false);
    });

    it('does not throw — always resolves to a boolean', async () => {
      const nft = new NftOwnership(NFT_CONTRACT_CONFIG, mockClientWithError('any error'));

      await expect(nft.verify(HOLDER_ADDRESS)).resolves.toBe(false);
    });
  });
});
