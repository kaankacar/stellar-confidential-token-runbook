# Spec: Confidential Tokens on Stellar (Field Note No. 04, DR-6)

Repo `kaankacar/stellar-confidential-token-runbook`, local folder `/Users/kaankacar/ctfn`. The demo of this Field Note is Bri Wylde's game "Who Ate Gerald?" (https://gerald.stellar.buzz, https://github.com/briwylde08/who-ate-gerald). This repo holds the other half: the six confidential token steps and the auditor decrypt, run by Kaan on Stellar testnet against OpenZeppelin's stable release, with timestamped logs, stills and the write-up. Logs, timestamps and explorer links matter as much as the code.

## Facts verified on 23 November 2026

### The release
- OpenZeppelin `stellar-contracts` v0.8.0, released 2026-10-20 (https://github.com/OpenZeppelin/stellar-contracts/releases/tag/v0.8.0, commit `ddc327e`). Confidential tokens moved from `stellar-tokens` into their own crate `stellar-confidential` 0.8.0 (crates.io, published 2026-10-20T17:02Z). It depends on `soroban-sdk` 28.0.0 and `ultrahonk-soroban-verifier` 0.1.0 (Protocol 28+). The preview branch `feat/confidential-verifier-ultrahonk` was merged as PR #820 on 2026-09-23 and deleted.
- Three contracts per deployment: the token, a verifier registry (one UltraHonk verification key per circuit) and an auditor key registry. Token entry points: `register(account, auditor_id, data)` with proof, single-use per account; `deposit(from, to, amount)`; `merge(account)`; `withdraw(from, to, amount, data)` with proof; `confidential_transfer(from, to, data)` with proof; `confidential_transfer_from`, `set_spender` (proof), `revoke_spender`; reads `confidential_balance`, `is_spender`, `get_spender_delegation`. The two balances are `receiving` and `spendable`; `merge` folds receiving into spendable without a proof.
- Circuits: register, withdraw, transfer, set_spender, spender_transfer, clawback. Nargo 1.0.0-beta.11, bb 0.87.0, keccak transcript, non-ZK UltraHonk flavour. The on-chain verifier implements only the non-ZK flavour; OpenZeppelin's README says it does not guarantee that proofs keep balances and amounts private. Nethermind's ZK verifier is PR #38 on rs-soroban-ultrahonk, open.
- Audit: `audits/Stellar Contracts Library v0.8.0 Audit.pdf` in the repo covers the token, verifier, auditor registry, compliance extension and circuits. Nethermind's verifier was audited by OpenZeppelin (report 2026-09-18).
- Docs: `packages/confidential/docs/` (overview, protocol/, sdk/, selective-disclosure/) and https://docs.openzeppelin.com/stellar-contracts/tokens/confidential/confidential.

### The client SDK
- `stellar-confidential-token-sdk` v0.3.0 by brozorec, GitHub-only, commit `aad1706` (2026-10-24): https://github.com/brozorec/stellar-confidential-token-sdk. Node >= 20. Pins `@aztec/bb.js` 0.87.0 exact, `@noir-lang/noir_js` 1.0.0-beta.11, `@stellar/stellar-sdk` ^14.2.0. Circuits and verification keys are bundled under `circuits/` with a `manifest.json` of SHA-256 hashes (source tag v0.8.0, commit `ddc327e`). No nargo or bb install needed. RPC-only works; an indexer is optional.
- Install is a git dependency. pnpm 11 ignores `package.json` `pnpm.onlyBuiltDependencies` (the field the SDK README implies) and wants `allowBuilds` in `pnpm-workspace.yaml` with the exact tarball URL as the key.
- The npm package named `stellar-confidential-token-sdk` (0.1.9) is an unrelated project.
- API used here: `ChainClient`, `keypairSigner`, `CircuitProver` + `loadCircuit`, `buildRegisterWitness` + `submitRegister`, `submitDeposit`, `submitMerge`, `buildTransferWitness` + `submitTransfer`, `buildWithdrawWitness` + `submitWithdraw`, `StateEngine` + `JsonFileStore`, `fetchEvents`, `auditTransfer`, `auditWithdraw`, `skSigningPayload` + `deriveSk` + `deriveKeys`, `addressToField`.
- Known gaps the SDK declares: no on-chain VK identity check before proving; no warning when a client has not synced within the RPC retention window; signer-root obligations left to the caller. The demo's `e2e.ts` derives keys from `randomScalar()`, which cannot be recovered.

### The public 0.8.0 deployment (brozorec's, testnet, ledger 5371973, 2026-10-24)
- token `CA642WUED6PACAQGVKSXND3DRSXGR7DP2L7TRHZORPWEPNRVGGN4L4ED` (vanilla: no admin, no freeze, no clawback)
- verifier `CAN45PFA5CVUCU3JB77IE2JNWNTRCDWMRNG55U452L3N2IOCAGOLTUVQ`
- auditor `CBQZRK72Y6KJ5DR4CUHKLHMHIKBMOZNSYTWHRUQPEXA35PRCBMSPBZTW`, auditor id 0; the demo auditor's secret scalar is published on purpose in `packages/app/lib/deployment.ts` of the demo repo so anyone can play the auditor
- factory `CAWPCXMW47UET5Z4N5T44PRDGAY6CZVP2O2JDEBL7YWEUHJGQ2BR4L6R`
- underlying native XLM SAC `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`
- Demo repo https://github.com/brozorec/stellar-confidential-token-demo at `626d00f` (2026-10-25), live at https://stellar-confidential-token-demo.billowing-moon-0c6f.workers.dev/.

### Bri's game (the preview build)
- https://gerald.stellar.buzz, repo https://github.com/briwylde08/who-ate-gerald (SDF-owned, last push 2026-11-20). Deployed 2026-07-28 at ledger 3850741: token `CCLDBRA5UVX6RMXSN44FMLK6RK4XMQ3XELL4TZC6XPL4D2JPPQNI4VSK` (soroban-sdk 26.1.0 per on-chain meta), verifier `CDCET36PIS44DWJM5UQSSI4ZHGRDSBIIQW4G4ALPYK3Y6FEQGY5ZWFXL`, auditor `CCMZTP6QWYOAQVCTMEII6D7DKO75CGMLADQL3DJV3IBXOGZ7P3ZZRMZX`, indexer `ember-indexer.sdf-ecosystem.workers.dev`. SDK vendored from the demo at commit `b3da4fe` with local patches.
- Bri's draft: Google Doc `1Ar-CYjZwl0-EhyqktHgBLXsCQEQUW3BzRHbDq5-Xrv4` ("Who Ate Gerald? Building a confidential token game on Stellar", September 2026). It says "pending" where the code says "receiving".

### Toolchain here
- Node 24.15.0, pnpm 11.6.0, TypeScript 5.9, tsx 4.23, `@stellar/stellar-sdk` 14.6.1 (the SDK's major). Stellar CLI 26.0.0 on this machine; the demo's contract build needs >= 28.1.0 (run 1 upgrades it). Rust target `wasm32v1-none` installed. ffmpeg 8.1.1, Google Chrome for puppeteer-core 25.13.0.

## Decisions
- Field Note No. 04, co-authored: Bri's game, mental model and gotchas in her first person; Kaan's runbook in his first person with a byline. Attribution lists both.
- The SPP SDK half of the DR-6 card title is parked. This note is Confidential Tokens only.
- All transactions on testnet by friendbot. There is no mainnet confidential token. No money moves.
- Runs 2 and 3 target the public 0.8.0 deployment. Run 1 (own deployment) is time-boxed to two hours; if it works, runs 2 and 3 repeat on it, otherwise its failure is a friction row.
- Keys are recoverable: SEP-53 signature over `skSigningPayload(token, account)` by the Stellar keypair, verified, obtained twice, then `deriveSk` and `deriveKeys`. Never `randomScalar()` for an account that registers.
- Every log line that mentions a transaction carries its hash, ledger and fee. Openings (`r`), secret scalars and signer roots never reach a log.
- No feedback aimed at Stellar or SDF anywhere. Stellar-side facts (the stale privacy page) go in `friction-log-full.md` as plain rows with a workaround, never with an Ask.
- Card caption: `Confidential Tokens on Stellar` / `No. 04` / `register / transfer / audit` / `2026`.

## Repo layout
```
SPEC.md  README.md  .env.example  package.json  pnpm-workspace.yaml  tsconfig.json
config/deployment.public.json      the public 0.8.0 deployment
config/deployment.own.json         written by run 1 if it succeeds (public fields only)
scripts/recon.ts  lifecycle.ts  audit.ts
scripts/lib/log.ts  config.ts  keys.ts  stellar.ts
state/                             JsonFileStore files (gitignored)
docs/field-note/confidential-tokens-field-note.md  friction-log.md  friction-log-full.md
docs/field-note/runs/*.log  card/  shots.mjs  typer.html  shots/  clips/  assemble-video.sh  handin/
```

## Scripts (`pnpm <name> -- --flag`; every script takes `--log <path>` and `--deployment public|own`)
- `recon`: read-only. Contract meta and interface of the public 0.8.0 token and Bri's preview token; `get_verification_key` for the six circuit types compared with SHA-256 of the SDK's bundled `vks/*.vk.bin`; auditor key id 0; RPC `getHealth` oldest ledger vs the deployment ledger; crates.io version; SDK version matrix; `is_registered` for Alice.
- `lifecycle`: register Alice, register Bob, deposit 100 XLM Alice to Alice, merge Alice, confidential_transfer Alice to Bob 42.5 XLM, merge Bob, withdraw Bob to Bob 10 XLM. Recoverable keys, `JsonFileStore` under `state/`, `StateEngine.sync()` after every step, proof time and size per proof, tx hash + ledger + fee + latency per step. `--from <step>` resumes.
- `auditor` (`pnpm audit` is a pnpm built-in): `fetchEvents` from the register ledger; the transfer event's field names (no amount); `auditTransfer` and `auditWithdraw` with the auditor secret; Horizon XLM balances for Bob before and after the withdraw.

## Docs and hand-in (owner: Kaan's session)
- Write-up `docs/field-note/confidential-tokens-field-note.md`: Attribution; 1 What we built; 2 How it went (2a the game, 2b the six steps on v0.8.0); 3 The mental model that made it click; 4 Friction log; 5 Where we think this goes; 6 Try it yourself. Short sentences, no em dashes, ISO Z timestamps, only numbers that carry a finding.
- `friction-log.md`: `# | While doing | What went wrong | Fix or workaround | Status`, rows O1… for OpenZeppelin only, each Fix cell ends with "Ask: …", Status fixed / open / by design. `friction-log-full.md`: sections A Release and SDK packaging, B Keys and registration, C Proving and submitting, D Reading state back, E Docs and tooling.
- Stills `DR-6_confidential-tokens-field-note_<NN>-<slug>.png`, video `DR-6_confidential-tokens-field-note_<date>.mp4`, Drive `Demos + Field Notes/Confidential Tokens`, Google Docs by markdown import, Notion page from the Field Notes template, DR-6 Deliverable link, Bri reviews before Shipped.

## Conventions
- Short sentences, active voice, no em dashes anywhere (code comments included).
- Commit messages: short, human, imperative, no AI attribution of any kind.
- Timestamps in ISO 8601 UTC with a `Z`. Amounts in XLM with 7 decimals when they matter; stroops when the contract sees them.
- Code: strict TypeScript, no `any`, `noUncheckedIndexedAccess`.
- Never re-run a money step as a diagnostic without a new log file.

## Addendum

**23 Nov 2026, runs.** Run 0 (public): 6 of 6 registered verification keys match the SDK bundle by SHA-256; the deployment ledger 5371973 is 393,630 ledgers outside the RPC window (120,960 ledgers, about 7.7 days). Run 2 (public): all seven transactions in 53.5 s, every proof under 0.8 s in Node (register 14,592 bytes), fees 2.85 XLM of which 2.77 XLM was Alice's register: it restored 8 archived ledger entries (the VKs, the auditor key, the token instance had passed their TTL a month after deployment; Protocol 23 restores inside the invoking call). Bob's register cost 0.015 XLM. The demo's `fromLedger: deployedAtLedger` fails on the RPC ("startLedger must be within the ledger range"); the SDK rethrows the raw JSON-RPC object, not an Error. Run 3 (public): the transfer event has no amount field; `auditTransfer` with the published demo secret recovers 42.5 XLM and the sender's 57.5 XLM balance, a random key gives noise; Horizon lists 4 transactions for Bob and the transfer is not one of them. Run 1: `pnpm build:contracts` with stellar CLI 30.0.1 (release tarball in the scratchpad, system CLI 26.0.0 untouched) built 7 wasms in 1 min 12 s; `pnpm deploy:contracts` with a fresh `ctfn-deployer` identity deployed verifier, auditor, token and factory and registered six VKs in 1 min 35 s. The demo hardcodes the deployer identity name `admin`; patched locally to read `DEPLOYER` from the environment. pnpm: the demo pins pnpm 10.33.0 by `packageManager` and corepack switched to it, where `pnpm.onlyBuiltDependencies` still works; this repo on pnpm 11.6.0 needs `allowBuilds` in `pnpm-workspace.yaml`. Script name: `pnpm audit` is a pnpm built-in, so the run 3 script is `pnpm auditor`.
Runs 0b, 2b, 3b (own deployment, token `CCVEVX5GVSVHEKVW4LBQITNSMLFD4Z7YTDFDAINZKPKSQ4K26AHXWBAS`, verifier `CAZQI3UKIECWONHSAYQREWQOFBFRW4N6VKGAWL7XL3B7OCDWTBKLQ2HF`, auditor `CBI77HZ4CZUZDB5AOJYNLH46TJE74LIVXCSSFOO5PIE5IXHACBP4U7LD`, factory `CC3LTF3BVVO35MSUDPIUIEADCAGU7Q6CKDTPUTCVNO2KVE2BBDG4XMSR`, ledger 5886679): 6 of 6 VKs match; the deployment ledger is inside the window and `fetchEvents` from it works; the seven transactions took 1 min 04 s and 0.107 XLM in fees, Alice's register 0.021 XLM with no restored entries; the auditor recovers 42.5 and 32.5 XLM; Bob's page again lacks the transfer. The own auditor secret is in `.env` as `AUDITOR_SECRET_HEX_OWN` and in `state/own-deployment-secrets.json`, both gitignored.
