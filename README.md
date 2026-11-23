# Confidential tokens on Stellar: the six steps on the stable release

The runbook half of Field Note No. 04, "Confidential Tokens on Stellar". The demo half is Bri Wylde's game [Who Ate Gerald?](https://gerald.stellar.buzz) ([source](https://github.com/briwylde08/who-ate-gerald)). This repo runs register, deposit, merge, confidential transfer, merge and withdraw on Stellar testnet against OpenZeppelin's `stellar-confidential` 0.8.0, then opens the transfer with the auditor's key. Every transaction is logged with its hash, ledger, fee and latency.

## The three verbs

- **register**: one proof per account, single-use, binds the confidential keys and the auditor.
- **transfer**: one proof, the sender signs alone, the amount is hidden, the parties are not.
- **audit**: no proof, the auditor's secret opens every amount for the accounts bound to it.

## Layout

```
config/deployment.public.json   the public 0.8.0 testnet deployment from the demo repo
config/deployment.own.json      the one run 1 made from the same code
scripts/recon.ts                run 0: interfaces, verification keys vs the bundle, the RPC window
scripts/lifecycle.ts            run 2: the six steps with recoverable keys
scripts/audit.ts                run 3: events, the auditor decrypt, the recipient's explorer page, fees
scripts/lib/                    logger, deployment config, key derivation, testnet plumbing
docs/field-note/                the note, the friction logs, the run logs, the card, the stills
state/                          gitignored: throwaway keys and openings
```

## Requirements

Node 22 or newer, pnpm 10 or 11. The SDK is a git dependency that compiles on install; on pnpm 11 the allowlist in `pnpm-workspace.yaml` lets it. No Rust, nargo or bb: circuits and verification keys come with the SDK. Rust and Stellar CLI 28.1.0+ are needed only to deploy your own contracts (see the [demo repo](https://github.com/brozorec/stellar-confidential-token-demo)).

```bash
pnpm install
cp .env.example .env
```

Leave the two account secrets empty and the scripts create throwaway keys by friendbot and keep them in `state/`. `AUDITOR_SECRET_HEX` is the demo auditor's secret, published on purpose in `packages/app/lib/deployment.ts` of the demo repo.

## Scripts

Run them as `pnpm <name> -- --flag`. Every script takes `--log <path>` and `--deployment public|own`.

| Script | Use |
|---|---|
| `pnpm recon` | Read-only. Contract metadata and interfaces (0.8.0 next to the July preview), the six verification keys on chain against the SDK bundle, the auditor key, the RPC retention window. |
| `pnpm lifecycle` | The seven transactions. `--from <step>` resumes; `--deposit`, `--transfer`, `--withdraw` set the XLM amounts (100, 42.5, 10). |
| `pnpm auditor` | Read-only. The events, what the public sees, `auditTransfer` and `auditWithdraw`, Horizon's view of the recipient, and what each transaction paid for. (`pnpm audit` is a pnpm built-in.) |
| `pnpm typecheck` | `tsc --noEmit`. |
| `pnpm card` | Renders the field note card. |

## Deployments

Public (brozorec's, ledger 5371973): token `CA642WUED6PACAQGVKSXND3DRSXGR7DP2L7TRHZORPWEPNRVGGN4L4ED`, verifier `CAN45PFA5CVUCU3JB77IE2JNWNTRCDWMRNG55U452L3N2IOCAGOLTUVQ`, auditor `CBQZRK72Y6KJ5DR4CUHKLHMHIKBMOZNSYTWHRUQPEXA35PRCBMSPBZTW`.

Own (run 1, 23 November 2026, ledger 5886679): token `CCVEVX5GVSVHEKVW4LBQITNSMLFD4Z7YTDFDAINZKPKSQ4K26AHXWBAS`, verifier `CAZQI3UKIECWONHSAYQREWQOFBFRW4N6VKGAWL7XL3B7OCDWTBKLQ2HF`, auditor `CBI77HZ4CZUZDB5AOJYNLH46TJE74LIVXCSSFOO5PIE5IXHACBP4U7LD`.

Both wrap the native XLM Stellar Asset Contract. Testnet only; there is no confidential token on mainnet.

## Checks

- `pnpm typecheck` is clean.
- Run 0 reports 6 of 6 verification keys matching the bundle.
- Run 2 ends with the recipient's receiving balance equal to the transfer, then zero after his merge; every `sync()` re-commits the openings and checks them against the chain.
- Run 3 recovers the transfer amount with the auditor's key and shows the transfer missing from the recipient's Horizon transaction list.

## Links

- OpenZeppelin: [docs](https://docs.openzeppelin.com/stellar-contracts/tokens/confidential/confidential), [`packages/confidential` at v0.8.0](https://github.com/OpenZeppelin/stellar-contracts/tree/v0.8.0/packages/confidential), [release notes](https://github.com/OpenZeppelin/stellar-contracts/releases/tag/v0.8.0), [crate](https://crates.io/crates/stellar-confidential/0.8.0).
- SDK: [brozorec/stellar-confidential-token-sdk](https://github.com/brozorec/stellar-confidential-token-sdk). Demo: [repo](https://github.com/brozorec/stellar-confidential-token-demo), [site](https://stellar-confidential-token-demo.billowing-moon-0c6f.workers.dev/).
- Verifier: [NethermindEth/rs-soroban-ultrahonk](https://github.com/NethermindEth/rs-soroban-ultrahonk).
- Stellar docs: [Privacy on Stellar](https://developers.stellar.org/docs/build/apps/privacy).

## Field note

This repo is the runbook behind Field Note No. 04, "Confidential Tokens on Stellar", co-written with Bri Wylde. The write-up, the friction logs, the run logs, the card and the stills live in [docs/field-note](docs/field-note).
