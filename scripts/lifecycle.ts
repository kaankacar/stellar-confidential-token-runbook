// Run 2, the six steps: register Alice, register Bob, deposit (public),
// merge Alice, confidential transfer Alice to Bob, merge Bob, withdraw (public).
// Keys are recoverable (SEP-53 signer root), openings live in state/ (gitignored),
// every transaction is logged with its hash, ledger, fee and latency.
//
//   pnpm lifecycle -- --log docs/field-note/runs/run2-lifecycle.log [--deployment public|own]
//                     [--from <step>] [--deposit 100] [--transfer 42.5] [--withdraw 10]
// Steps, in order: register, deposit, merge-alice, transfer, merge-bob, withdraw.
// --from resumes at a step; the ones before it are taken as done (register is
// skipped on its own when the account is already registered).
import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  ChainClient,
  CircuitProver,
  StateEngine,
  buildRegisterWitness,
  buildTransferWitness,
  buildWithdrawWitness,
  fetchEvents,
  humanizeContractError,
  submitDeposit,
  submitMerge,
  submitRegister,
  submitTransfer,
  submitWithdraw,
  type AccountState,
  type KeyPair,
  type Point,
} from 'stellar-confidential-token-sdk';
import { loadCircuit, type CircuitName } from 'stellar-confidential-token-sdk/proving/artifacts';
import { JsonFileStore } from 'stellar-confidential-token-sdk/state/json-store';
import { DEPLOYMENT_OPTION, explorerAccount, loadDeployment, parseDeploymentName, statePath } from './lib/config.ts';
import { deriveRecoverableKeys, participant, pointHex, type Participant } from './lib/keys.ts';
import { COMMON_OPTIONS, createLogger, errorMessage, fail, formatMs, helpIfAsked, installCrashLogger, scriptArgs, type Logger } from './lib/log.ts';
import { logTx, resolveSecret, stroops, xlm, xlmBalance, type TxDetails } from './lib/stellar.ts';

const STEPS = ['register', 'deposit', 'merge-alice', 'transfer', 'merge-bob', 'withdraw'] as const;
type Step = (typeof STEPS)[number];

const USAGE = `
Run 2, the lifecycle.
  pnpm lifecycle -- [--deployment public|own] [--log <path>] [--from <step>]
                    [--deposit <XLM>] [--transfer <XLM>] [--withdraw <XLM>]
Steps: ${STEPS.join(', ')}.
`;

const { values } = parseArgs({
  args: scriptArgs(),
  options: {
    ...COMMON_OPTIONS,
    ...DEPLOYMENT_OPTION,
    from: { type: 'string', default: 'register' },
    deposit: { type: 'string', default: '100' },
    transfer: { type: 'string', default: '42.5' },
    withdraw: { type: 'string', default: '10' },
  },
});
helpIfAsked(values.help, USAGE);
const logger = createLogger(values.log);
installCrashLogger(logger);
const dep = loadDeployment(parseDeploymentName(values.deployment));
const fromStep = values.from as Step;
if (!STEPS.includes(fromStep)) fail(logger, `--from must be one of ${STEPS.join(', ')}`);
const DEPOSIT = stroops(values.deposit);
const TRANSFER = stroops(values.transfer);
const WITHDRAW = stroops(values.withdraw);

const client = new ChainClient({ rpcUrl: dep.rpcUrl, networkPassphrase: dep.networkPassphrase, contracts: dep.contracts });

/** What a run leaves behind so a later run (or run 3) can pick up where it stopped. */
interface RunState {
  registeredLedger?: { alice?: number; bob?: number };
  txs?: Partial<Record<string, TxDetails>>;
}
const runStatePath = statePath(`lifecycle.${dep.name}.json`);
const runState: RunState = existsSync(runStatePath) ? (JSON.parse(readFileSync(runStatePath, 'utf8')) as RunState) : {};
function saveRunState(): void {
  writeFileSync(runStatePath, `${JSON.stringify(runState, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2)}\n`);
}
function recordTx(step: string, tx: TxDetails): void {
  runState.txs = { ...runState.txs, [step]: tx };
  saveRunState();
}

const stepIndex = (s: Step): number => STEPS.indexOf(s);
const runs = (s: Step): boolean => stepIndex(s) >= stepIndex(fromStep);

async function prove(prover: CircuitProver, circuit: CircuitName, inputs: Record<string, string>): Promise<Uint8Array> {
  const t0 = Date.now();
  const { proof, publicInputs } = await prover.prove(inputs);
  logger.log(`${circuit} proof: ${proof.length} bytes, ${publicInputs.length} public inputs, built in ${formatMs(Date.now() - t0)}`);
  return proof;
}

function describe(label: string, state: AccountState): void {
  logger.log(`${label}: spendable ${xlm(state.spendable.v)} XLM, receiving ${xlm(state.receiving.v)} XLM, synced through ledger ${state.syncedLedger} (openings re-committed and checked against the chain)`);
}

function engineFor(p: Participant, fromLedger: number): StateEngine {
  return new StateEngine({
    client,
    store: new JsonFileStore(statePath(`openings.${p.label}.${dep.name}.json`)),
    keys: p.keys,
    address: p.address,
    fromLedger,
  });
}

async function withContractError<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const raw = errorMessage(error);
    const human = humanizeContractError(raw);
    return fail(logger, `${what}: ${human ? `${human} (${raw.split('\n')[0]})` : raw.split('\n')[0]}`);
  }
}

async function main(): Promise<void> {
  const started = Date.now();
  logger.log(`testnet, deployment "${dep.name}": token ${dep.contracts.token}, auditor id ${dep.auditorId}; amounts deposit ${xlm(DEPOSIT)}, transfer ${xlm(TRANSFER)}, withdraw ${xlm(WITHDRAW)} XLM; starting at step "${fromStep}"`);

  logger.section('accounts and keys');
  const accountsPath = statePath(`accounts.${dep.name}.json`);
  const aliceSecret = await resolveSecret('alice', process.env['STELLAR_SECRET'], dep, accountsPath, logger);
  const bobSecret = await resolveSecret('bob', process.env['BOB_SECRET'], dep, accountsPath, logger);
  const alice = participant('alice', aliceSecret, dep.contracts.token, dep.networkPassphrase);
  const bob = participant('bob', bobSecret, dep.contracts.token, dep.networkPassphrase);
  for (const p of [alice, bob]) {
    const again = deriveRecoverableKeys(p.keypair, dep.contracts.token);
    const same = again.keys.PVK.equals(p.keys.PVK) && again.keys.Y.equals(p.keys.Y);
    logger.log(`${p.label} ${p.address}: confidential keys from a SEP-53 signature by the account key, j=${p.j}, Y ${pointHex(p.keys.Y)}, PVK ${pointHex(p.keys.PVK)}; derived twice, ${same ? 'identical (recoverable)' : 'DIFFERENT'}`);
    logger.log(`  ${explorerAccount(p.address)}`);
    if (!same) fail(logger, 'key derivation is not deterministic');
  }
  const kAud: Point = await client.auditorKey(dep.auditorId);
  logger.log(`auditor id ${dep.auditorId} key ${pointHex(kAud)}; both accounts bind to it at registration, for good`);

  logger.section('RPC window check (read-only)');
  try {
    const probe = await fetchEvents(client, { startLedger: dep.deployedAtLedger, contractId: dep.contracts.token, pageLimit: 1 });
    logger.log(`fetchEvents from the deployment ledger ${dep.deployedAtLedger} returned ${probe.events.length} event(s), latest ledger ${probe.latestLedger}`);
  } catch (error) {
    logger.log(`fetchEvents from the deployment ledger ${dep.deployedAtLedger} fails: ${errorMessage(error).split('\n')[0]}`);
    logger.log('  the demo e2e starts every StateEngine at deployedAtLedger; a month after deployment the RPC refuses that. This runbook starts each engine at the ledger the account registered in.');
  }

  const provers: Partial<Record<CircuitName, CircuitProver>> = {};
  const proverFor = (name: CircuitName): CircuitProver => (provers[name] ??= new CircuitProver(loadCircuit(name)));

  try {
    // Step 1: register. Single-use per account, so skip when already done.
    logger.section('step 1, register (proof)');
    for (const p of [alice, bob]) {
      if (await client.isRegistered(p.address)) {
        const ledger = runState.registeredLedger?.[p.label as 'alice' | 'bob'];
        logger.log(`${p.label}: already registered${ledger ? ` (ledger ${ledger})` : ''}, skipped`);
        continue;
      }
      if (!runs('register')) fail(logger, `${p.label} is not registered but --from skips the register step`);
      const w = buildRegisterWitness(p.keys, p.address);
      const proof = await prove(proverFor('register'), 'register', w.inputs);
      const t0 = Date.now();
      const r = await withContractError(`register ${p.label}`, () => submitRegister(client, p.signer, p.address, dep.auditorId, w, proof));
      const tx = await logTx(logger, client.server, `${p.label} register`, r, t0);
      runState.registeredLedger = { ...runState.registeredLedger, [p.label]: tx.ledger };
      recordTx(`register-${p.label}`, tx);
    }
    const aliceFrom = runState.registeredLedger?.alice;
    const bobFrom = runState.registeredLedger?.bob;
    if (!aliceFrom || !bobFrom) fail(logger, 'registration ledgers unknown; delete state/ and start from register');
    const aliceEngine = engineFor(alice, aliceFrom);
    const bobEngine = engineFor(bob, bobFrom);
    const onChain = await client.confidentialBalance(alice.address);
    if (onChain) logger.log(`alice on chain: auditor id ${onChain.auditorId}, spendable commitment ${pointHex(onChain.spendableBalance)}, receiving commitment ${pointHex(onChain.receivingBalance)} (commitments, not amounts)`);

    // Step 2: deposit, public XLM into the pool, credited to Alice's receiving balance.
    if (runs('deposit')) {
      logger.section('step 2, deposit (no proof, amount public)');
      const before = (await xlmBalance(dep, alice.address)) ?? 0n;
      const t0 = Date.now();
      const r = await withContractError('deposit', () => submitDeposit(client, alice.signer, alice.address, alice.address, DEPOSIT));
      const tx = await logTx(logger, client.server, `alice deposit ${xlm(DEPOSIT)} XLM`, r, t0);
      recordTx('deposit', tx);
      const after = (await xlmBalance(dep, alice.address)) ?? 0n;
      logger.log(`alice public XLM: ${xlm(before)} before, ${xlm(after)} after (${xlm(after - before)}: the deposit plus the fee, both public)`);
      describe('alice after deposit', await aliceEngine.sync());
    }

    // Step 3: merge, receiving into spendable, no proof, all or nothing.
    if (runs('merge-alice')) {
      logger.section('step 3, merge alice (no proof)');
      const t0 = Date.now();
      const r = await withContractError('merge alice', () => submitMerge(client, alice.signer, alice.address));
      recordTx('merge-alice', await logTx(logger, client.server, 'alice merge', r, t0));
      describe('alice after merge', await aliceEngine.sync());
    }

    // Step 4: confidential transfer. Only the sender signs; the amount is hidden.
    if (runs('transfer')) {
      logger.section('step 4, confidential transfer alice to bob (proof, amount hidden)');
      const { v, r: blinding } = await aliceEngine.spendableForProof();
      logger.log(`alice proves against spendable ${xlm(v)} XLM (the opening the engine re-checked against the chain just now)`);
      const w = buildTransferWitness({ keys: alice.keys, v, r: blinding, amount: TRANSFER, pvkB: bob.keys.PVK, kAudR: kAud, kAudS: kAud });
      const proof = await prove(proverFor('transfer'), 'transfer', w.inputs);
      const t0 = Date.now();
      const r = await withContractError('transfer', () => submitTransfer(client, alice.signer, alice.address, bob.address, w, proof));
      recordTx('transfer', await logTx(logger, client.server, `alice transfer ${xlm(TRANSFER)} XLM to bob`, r, t0));
      logger.log('bob signed nothing. The explorer shows alice as the source and the token contract as the target; bob is an argument inside the call.');
      describe('alice after transfer', await aliceEngine.sync());
      describe('bob after transfer', await bobEngine.sync());
      logger.log("bob's receiving amount above came from decrypting the transfer event with his viewing key; the chain holds only the commitment");
    }

    // Step 5: Bob merges the incoming claim.
    if (runs('merge-bob')) {
      logger.section('step 5, merge bob (no proof)');
      const t0 = Date.now();
      const r = await withContractError('merge bob', () => submitMerge(client, bob.signer, bob.address));
      recordTx('merge-bob', await logTx(logger, client.server, 'bob merge', r, t0));
      describe('bob after merge', await bobEngine.sync());
    }

    // Step 6: withdraw, confidential claim back to public XLM.
    if (runs('withdraw')) {
      logger.section('step 6, withdraw bob (proof, amount public again)');
      const before = (await xlmBalance(dep, bob.address)) ?? 0n;
      const { v, r: blinding } = await bobEngine.spendableForProof();
      logger.log(`bob proves against spendable ${xlm(v)} XLM`);
      const w = buildWithdrawWitness({ keys: bob.keys, v, r: blinding, amount: WITHDRAW, kAudS: kAud });
      const proof = await prove(proverFor('withdraw'), 'withdraw', w.inputs);
      const t0 = Date.now();
      const r = await withContractError('withdraw', () => submitWithdraw(client, bob.signer, bob.address, bob.address, WITHDRAW, w, proof));
      const tx = await logTx(logger, client.server, `bob withdraw ${xlm(WITHDRAW)} XLM`, r, t0);
      recordTx('withdraw', tx);
      const after = (await xlmBalance(dep, bob.address)) ?? 0n;
      logger.log(`bob public XLM: ${xlm(before)} before, ${xlm(after)} after (${xlm(after - before)} = withdraw ${xlm(WITHDRAW)} minus the fee ${xlm(tx.feeCharged)})`);
      describe('bob after withdraw', await bobEngine.sync());
    }

    logger.section('summary');
    const txs = runState.txs ?? {};
    let fees = 0n;
    for (const [step, tx] of Object.entries(txs)) {
      if (!tx) continue;
      fees += BigInt(tx.feeCharged);
      logger.log(`${step.padEnd(15)} ledger ${tx.ledger}  fee ${xlm(BigInt(tx.feeCharged))} XLM  ${tx.hash}`);
    }
    logger.log(`${Object.keys(txs).length} transactions, ${xlm(fees)} XLM in fees, run took ${formatMs(Date.now() - started)}`);
  } finally {
    await Promise.all(Object.values(provers).map((p) => p?.destroy()));
  }
}

await main();
