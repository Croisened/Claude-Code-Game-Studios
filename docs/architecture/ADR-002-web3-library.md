# ADR-002: Web3 Library — viem

> **Status**: Accepted
> **Date**: 2026-03-31
> **Authors**: Nathanial Ryan + Claude Code
> **Sprint**: Sprint 2 (S2-04 spike)

---

## Context

Robo Rhapsody needs browser-native Web3 integration for two features:

1. **Wallet Connection** — connect MetaMask (or compatible wallet) via EIP-1193
   (`window.ethereum`), display the connected address, persist across reload.
2. **NFT Ownership Verification** — query the Robo Rhapsody ERC-721 contract to
   confirm whether the connected address holds a token, then load the token's
   skin metadata.

The library must:
- Run in the browser (no Node.js-only APIs)
- Support EIP-1193 wallet providers (`window.ethereum`)
- Support read-only contract calls (no gas required for ownership check)
- Be TypeScript-first (project uses strict TypeScript)
- Import cleanly into a Vite/ESM build with no CommonJS shim issues
- Be small — this is a web game; bundle size directly affects load time

Three candidates were evaluated during the S2-04 spike.

---

## Decision

**Use viem v2.**

---

## Alternatives Considered

### Option A: ethers.js v6

- Bundle: ~120KB gzipped (full import)
- TypeScript: types included, but not designed TypeScript-first
- API: mature, verbose — provider/signer/contract abstraction layers
- ESM: supported, but historical CommonJS baggage causes occasional Vite quirks
- Verdict: reliable but oversized for this use case

### Option B: wagmi

- wagmi is a React hooks layer built on top of viem
- This project uses vanilla TypeScript (no React)
- Verdict: eliminated immediately — wrong abstraction for this stack

### Option C: viem v2 ✓ (chosen)

- Bundle: ~35KB gzipped (tree-shakeable; only import what's used)
- TypeScript: designed TypeScript-first — all types inferred from ABI definitions
- API: `createWalletClient` / `createPublicClient` with transport abstraction
- ESM: native, no CommonJS shim issues
- CORS: public RPC calls go through the transport layer; MetaMask injects its own
  transport via `window.ethereum` — no server-side CORS exposure
- Verdict: best fit

---

## Consequences

### Positive

- Smallest bundle impact (~35KB) — load time budget preserved
- ABI-typed contract calls — TypeScript catches wrong argument types at compile time
- Clean ESM import — no Vite config workarounds needed
- Active development and growing ecosystem (replacing ethers.js as the de facto standard)

### Negative / Risks

- Newer library — less Stack Overflow coverage than ethers.js
- LLM training data coverage is thinner (viem postdates most training cutoffs)
  — verify API calls against official docs, not LLM memory
- `window.ethereum` availability is not guaranteed — must handle no-wallet gracefully

### Constraints

- All Web3 code must handle the no-wallet case without throwing (graceful degradation)
- RPC endpoint for read-only calls: use a public provider (Infura / Alchemy free tier)
  or `window.ethereum` if connected — API key stored in `.env`, never committed
- Contract ABI for NFT ownership check: stored in `src/config/nft-contract.config.ts`

---

## Usage Pattern

```typescript
import { createWalletClient, createPublicClient, custom, http } from 'viem';
import { mainnet } from 'viem/chains';

// Connect via injected wallet (MetaMask)
const walletClient = createWalletClient({
  chain: mainnet,
  transport: custom(window.ethereum),
});
const [address] = await walletClient.requestAddresses();

// Read-only NFT ownership check
const publicClient = createPublicClient({
  chain: mainnet,
  transport: http('https://mainnet.infura.io/v3/YOUR_KEY'),
});
const balance = await publicClient.readContract({
  address: NFT_CONTRACT_ADDRESS,
  abi: NFT_ABI,
  functionName: 'balanceOf',
  args: [address],
});
```

---

## References

- viem docs: https://viem.sh
- viem GitHub: https://github.com/wevm/viem
- EIP-1193 (window.ethereum): https://eips.ethereum.org/EIPS/eip-1193
- ADR-001: docs/architecture/ADR-001-web-runner-architecture.md
