# Friction log, full: Confidential Tokens on Stellar

Everything we hit, our own mistakes and tooling included. The partner-facing rows (O1 to O10) are in [friction-log.md](friction-log.md). Bri's rows come from building Who Ate Gerald? on the developer preview (July to September 2026, soroban-sdk 26.1.0, SDK vendored at `b3da4fe`); Kaan's from running the six steps on `stellar-confidential` 0.8.0 on 23 November 2026 with the SDK at `aad1706`. Status: fixed, open, or by design. Rows about Stellar tooling carry a workaround and no ask.

## A. Release and SDK packaging

| # | While doing | What went wrong | Fix or workaround | Status |
|---|---|---|---|---|
| A1 | `pnpm add stellar-confidential-token-sdk` | The npm package of that name (0.1.9, August 2026) is an unrelated project. OpenZeppelin publishes no client package; the SDK is `github:brozorec/stellar-confidential-token-sdk`. | Git dependency pinned to `#aad1706`. (O1) | open |
| A2 | First `pnpm install` on pnpm 11.6.0 | `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`: the SDK's `prepare` script (it compiles `dist/`) is blocked. The README-style `pnpm.onlyBuiltDependencies` in package.json is "no longer read" by pnpm 11; it wants `allowBuilds` in `pnpm-workspace.yaml`, and for a git dependency the key must be the exact tarball URL. The demo repo pins pnpm 10.33.0 by `packageManager`, where the old field still works. | `pnpm-workspace.yaml` with the tarball-URL key. (O1) | open |
| A3 | First `pnpm exec tsx` | `ERR_PNPM_IGNORED_BUILDS` for `esbuild` and `msgpackr-extract` (a bb.js dependency) stops `pnpm exec` until they are allowed too. | Add both to `allowBuilds`. | by design |
| A4 | Reading the demo README | "The UltraHonk verifier backend and the circuits are unaudited. Testnet only." The v0.8.0 audit report in the repo lists the verifier and every circuit in scope. | Read the release notes and the audit PDF. (O10) | open |
| A5 | Installing the SDK | `prepare` runs `tsc` on install; the clone-and-compile took 3 s and needs a TypeScript toolchain in the consumer's install step. | Nothing to do; it works. | by design |

## B. Keys and registration

| # | While doing | What went wrong | Fix or workaround | Status |
|---|---|---|---|---|
| B1 | Copying `scripts/e2e.ts` | Keys from `randomScalar()`: unrecoverable, and registration is single-use per account. | SEP-53 signer root: sign `skSigningPayload(token, account)` with the account key, verify, obtain twice, compare, `deriveSk`, `deriveKeys`. Never persist the root. (O2) | open |
| B2 | Re-running the lifecycle | `register` is single-use. A second run on the same account must skip it. | `isRegistered` check before the step; `--from` to resume. | by design |
| B3 | Deriving keys for a second deployment | Keys are bound to the token contract (`vk = Poseidon2(sk, addr_f)`), so the same account has different confidential keys on each token. | One `state/openings.<role>.<deployment>.json` per deployment. | by design |
| B4 | Supporting passkey accounts (Bri) | WebAuthn assertions are not deterministic; a passkey wallet is a new contract account, so the balance does not follow. | Ed25519 wallets for now. (O9) | open |
| B5 | Reading `docs/sdk/key-derivation.md` | The signer-root obligations (verify the signature, obtain it twice, never persist) are left to the caller, and the SDK README says so. | Done in `scripts/lib/keys.ts`. | by design |
| B6 | Registering | Each account binds one auditor id at registration, for good. The vanilla public token has one auditor, id 0. | Nothing to do. | by design |

## C. Proving and submitting

| # | While doing | What went wrong | Fix or workaround | Status |
|---|---|---|---|---|
| C1 | Building a proof | The on-chain verifier accepts only keccak-transcript, non-zero-knowledge UltraHonk proofs. The bb.js default transcript fails on chain silently. The SDK's `CircuitProver` defaults are right; constructing one with `{ zk: true }` is for off-chain disclosure only. | Use the SDK's defaults. | by design |
| C2 | Measuring a proof in Node 24 | Register 455 ms, transfer 765 ms, withdraw 637 ms; every proof 14,592 bytes; one prover 303 MB RSS. Bri's 128 MB workers cannot do it. | Browser or Node for proofs; merges need no proof. (O8) | open |
| C3 | Constructing provers | Backend init loads WASM and the CRS, so a prover per circuit must be built once and reused, then destroyed. | `proverFor(name)` cache, `destroy()` in `finally`. | by design |
| C4 | Registering the first account on the public deployment | 2.77 XLM: 8 archived entries restored inside the call (56 KB read and written). Bob's registration, 0.015 XLM. On the fresh own deployment, 0.021 XLM. | Expect it, or extend TTLs. (O5) | open |
| C5 | Running the demo's `deploy.ts` | It hardcodes the deployer identity name `admin`. | Patched to `process.env.DEPLOYER ?? "admin"`; used a fresh `ctfn-deployer`. | open |
| C6 | Building the contracts | `stellar contract build` only; soroban-sdk 28's `build.rs` refuses a plain `cargo build`. Needs Stellar CLI 28.1.0+; mine was 26.0.0. | Ran the 30.0.1 release binary from a folder on PATH; 7 wasms in 1 min 12 s, deployment in 1 min 35 s. | by design |
| C7 | Deploying | `deployments/testnet.json` is gitignored and holds the auditor's secret scalar next to the public ids. | Copied the public fields into `config/deployment.own.json`; the secret stays in `.env`. | by design |

## D. Reading state back

| # | While doing | What went wrong | Fix or workaround | Status |
|---|---|---|---|---|
| D1 | `StateEngine` with `fromLedger: deployedAtLedger` | The RPC serves 120,960 ledgers (about 7.7 days). The public deployment is 393,630 ledgers older: "startLedger must be within the ledger range". | Start at the account's registration ledger. (O3) | open |
| D2 | Catching that error | The SDK rethrows the RPC's JSON-RPC error object, not an `Error`; `String(err)` prints `[object Object]`. | `JSON.stringify` non-Error throws in the logger. (O3) | open |
| D3 | Reading the README on retention | Openings (`v`, `r`) live only in events. With the RPC alone, an opening whose event ages out before a sync is gone; the SDK warns about nothing when a client has not synced inside the window. | `JsonFileStore` under `state/`, sync after every step; an indexer for anything long-lived. | by design |
| D4 | Looking at the recipient's explorer page (Bri) | An account page lists transactions where the account is the source or a signer. A recipient named as a call argument never appears, so a shop with 320 incoming payments showed three transactions. Reproduced on 0.8.0: Bob's page lists 4 transactions and the transfer that paid him is not one of them. | Read the contract's events, not the account's page. | by design |
| D5 | Running automated shops (Bri) | Incoming transfers stay in the receiving balance until the account merges. The shops gathered 19,500 XLM that was unspendable because nothing merged. | A morning job that signs merges for the shops; no proof needed. | by design |
| D6 | Checking the transfer event | Twelve fields, no `amount`. The amount, the sender's new balance and the opening live in ciphertexts for the recipient and the auditor. | `auditTransfer(k, ev)` for the auditor, `StateEngine.sync()` for the recipient. | by design |

## E. Docs and tooling

| # | While doing | What went wrong | Fix or workaround | Status |
|---|---|---|---|---|
| E1 | Naming the run 3 script `audit` | `pnpm audit` is a pnpm built-in; `pnpm audit -- --log` fails with "Unknown audit subcommand". Our mistake. | Renamed to `pnpm auditor`. | fixed |
| E2 | Logging the RPC error in run 2 | Our logger printed `[object Object]` for the SDK's raw throw. | `errorMessage` stringifies objects. | fixed |
| E3 | Reading the blog, the docs and the code in one sitting | "pending" (blog, game) and "receiving" (code, docs) for the same balance. | One sentence in the note. (O7) | open |
| E4 | Reading the Stellar privacy page | It says the demo targets the earlier developer preview; the demo moved to 0.8.0 on 24 and 25 October. Our side. | A docs PR after this note ships. | open |
| E5 | Reading the OpenZeppelin docs page | Same stale sentence about the demo. | (O6) | open |
