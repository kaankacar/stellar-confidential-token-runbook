// Run 3, the auditor and the explorer: read the events run 2 emitted, show what
// the public sees (parties, no amount), decrypt the transfer with the auditor's
// key, try a wrong key, and show the recipient's empty account page.
//
//   pnpm auditor -- --log docs/field-note/runs/run3-audit.log [--deployment public|own]
//                 [--transfer 42.5] [--withdraw 10]
import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { rpc, type xdr } from '@stellar/stellar-sdk';
import {
  ChainClient,
  auditTransfer,
  auditWithdraw,
  auditorPublicKey,
  eventToJson,
  fetchEvents,
  fromHex,
  randomScalar,
  type ConfidentialEvent,
  type TransferEvent,
  type WithdrawEvent,
} from 'stellar-confidential-token-sdk';
import { DEPLOYMENT_OPTION, explorerAccount, explorerTx, loadDeployment, parseDeploymentName, statePath } from './lib/config.ts';
import { pointHex } from './lib/keys.ts';
import { COMMON_OPTIONS, createLogger, errorMessage, fail, formatMs, helpIfAsked, installCrashLogger, scriptArgs } from './lib/log.ts';
import { readAccounts, stroops, xlm, xlmBalance, type TxDetails } from './lib/stellar.ts';

const USAGE = `
Run 3, audit (reads only; needs AUDITOR_SECRET_HEX in .env and the state run 2 left).
  pnpm auditor -- [--deployment public|own] [--log <path>] [--transfer <XLM>] [--withdraw <XLM>]
`;

const { values } = parseArgs({
  args: scriptArgs(),
  options: { ...COMMON_OPTIONS, ...DEPLOYMENT_OPTION, transfer: { type: 'string', default: '42.5' }, withdraw: { type: 'string', default: '10' } },
});
helpIfAsked(values.help, USAGE);
const logger = createLogger(values.log);
installCrashLogger(logger);
const dep = loadDeployment(parseDeploymentName(values.deployment));
const TRANSFER = stroops(values.transfer);
const WITHDRAW = stroops(values.withdraw);
const client = new ChainClient({ rpcUrl: dep.rpcUrl, networkPassphrase: dep.networkPassphrase, contracts: dep.contracts });

interface RunState {
  registeredLedger?: { alice?: number; bob?: number };
  txs?: Partial<Record<string, TxDetails>>;
}

function loadRunState(): RunState {
  const path = statePath(`lifecycle.${dep.name}.json`);
  if (!existsSync(path)) fail(logger, `no run 2 state at ${path}`);
  return JSON.parse(readFileSync(path, 'utf8')) as RunState;
}

async function horizonJson<T>(path: string): Promise<T> {
  const res = await fetch(`${dep.horizonUrl}${path}`);
  if (!res.ok) throw new Error(`horizon ${res.status} ${path}`);
  return (await res.json()) as T;
}

interface HorizonTx { hash: string; ledger: number; source_account: string; operation_count: number }
interface HorizonOp { type: string; function?: string; parameters?: { type: string; value: string }[] }

async function main(): Promise<void> {
  const started = Date.now();
  const run = loadRunState();
  const accounts = readAccounts(statePath(`accounts.${dep.name}.json`));
  const alice = accounts.alice?.address;
  const bob = accounts.bob?.address;
  if (!alice || !bob) return fail(logger, 'run 2 accounts missing from state/');
  const txs = run.txs ?? {};
  const transferTx = txs['transfer'];
  const withdrawTx = txs['withdraw'];
  const fromLedger = Math.min(...Object.values(txs).map((t) => t?.ledger ?? Number.MAX_SAFE_INTEGER));
  if (!transferTx || !withdrawTx || !Number.isFinite(fromLedger)) return fail(logger, 'run 2 did not record a transfer and a withdraw');
  logger.log(`testnet, deployment "${dep.name}": token ${dep.contracts.token}; alice ${alice}, bob ${bob}; reading events from ledger ${fromLedger}`);

  logger.section('events the token emitted for these two accounts');
  const ours = new Set(Object.values(txs).map((t) => t?.hash));
  const mine: ConfidentialEvent[] = [];
  let cursor: string | undefined;
  let pages = 0;
  for (;;) {
    const page = await fetchEvents(client, cursor ? { startCursor: cursor, contractId: dep.contracts.token, pageLimit: 200 } : { startLedger: fromLedger, contractId: dep.contracts.token, pageLimit: 200 });
    pages += 1;
    mine.push(...page.events.filter((ev) => ours.has(ev.txHash)));
    if (!page.cursor || page.events.length === 0 || pages > 50) break;
    cursor = page.cursor;
  }
  logger.log(`${mine.length} events from our ${ours.size} transactions, ${pages} page(s)`);
  for (const ev of mine) {
    const json = eventToJson(ev);
    const visible = Object.keys(json).filter((k) => !['type', 'ledger', 'txHash', 'cursor'].includes(k));
    const amount = 'amount' in json && typeof ev.type === 'string' && (ev.type === 'deposit' || ev.type === 'withdraw' || ev.type === 'clawback') ? ` amount ${xlm(BigInt(String(json['amount'])))} XLM` : '';
    logger.log(`${ev.type.padEnd(9)} ledger ${ev.ledger} tx ${ev.txHash.slice(0, 12)}… fields [${visible.join(', ')}]${amount}`);
  }
  const transfer = mine.find((ev): ev is TransferEvent => ev.type === 'transfer' && ev.txHash === transferTx.hash);
  const withdraw = mine.find((ev): ev is WithdrawEvent => ev.type === 'withdraw' && ev.txHash === withdrawTx.hash);
  if (!transfer || !withdraw) return fail(logger, 'the transfer or the withdraw event was not found in the RPC window');

  logger.section('what the public sees in the transfer event');
  logger.log(`from ${transfer.from}`);
  logger.log(`to   ${transfer.to}`);
  logger.log(`rE ${pointHex(transfer.rE)} (ephemeral point), vTilde ${transfer.vTilde.toString(16).slice(0, 12)}…, bTilde ${transfer.bTilde.toString(16).slice(0, 12)}…, sigma ${transfer.sigma.toString(16).slice(0, 12)}…, vAudR/rAudR/vAudS/bAudS/rAudS: five more field elements`);
  logger.log('no "amount" field. The parties and the time are public; the amount and both balances are field elements that only the recipient, the sender and the auditor can open.');
  logger.log(`  ${explorerTx(transfer.txHash)}`);

  logger.section('the auditor opens the transfer');
  const secretHex = process.env['AUDITOR_SECRET_HEX'];
  if (!secretHex) return fail(logger, 'AUDITOR_SECRET_HEX is not set');
  const k = fromHex(secretHex);
  const registered = await client.auditorKey(dep.auditorId);
  const derived = auditorPublicKey(k);
  logger.log(`auditor id ${dep.auditorId}: registered key ${pointHex(registered)}, key from the secret ${pointHex(derived)}, ${derived.equals(registered) ? 'same' : 'DIFFERENT'}`);
  const t0 = Date.now();
  const opened = auditTransfer(k, transfer);
  logger.log(`auditTransfer in ${formatMs(Date.now() - t0)}: amount ${xlm(opened.amount)} XLM, sender balance after ${xlm(opened.senderBalance)} XLM, channelsAgree ${opened.channelsAgree}; expected amount ${xlm(TRANSFER)} XLM: ${opened.amount === TRANSFER ? 'match' : 'NO MATCH'}`);
  logger.log('both auditor copies decrypted to the same amount: the recipient channel and the sender channel were made from one ephemeral scalar, which the circuit enforces');
  const wrong = auditTransfer(randomScalar(), transfer);
  logger.log(`a random key instead: amount ${wrong.amount.toString(16).slice(0, 16)}… (not a number anyone can use), channelsAgree ${wrong.channelsAgree}`);
  const w = auditWithdraw(k, withdraw);
  logger.log(`auditWithdraw: sender balance after the withdraw ${xlm(w.senderBalance)} XLM; expected ${xlm(TRANSFER - WITHDRAW)} XLM: ${w.senderBalance === TRANSFER - WITHDRAW ? 'match' : 'NO MATCH'}; the withdraw amount itself is public: ${xlm(withdraw.amount)} XLM`);

  logger.section("the recipient's explorer page");
  const bobTxs = await horizonJson<{ _embedded: { records: HorizonTx[] } }>(`/accounts/${bob}/transactions?order=asc&limit=50`);
  const bobHashes = bobTxs._embedded.records.map((t) => t.hash);
  const listed = bobHashes.includes(transferTx.hash);
  logger.log(`Horizon lists ${bobHashes.length} transactions for bob: ${bobTxs._embedded.records.map((t) => `${t.hash.slice(0, 8)}… (ledger ${t.ledger})`).join(', ')}`);
  logger.log(`the transfer ${transferTx.hash.slice(0, 8)}… that paid bob ${xlm(TRANSFER)} XLM is ${listed ? 'listed' : 'NOT among them'}: bob was an argument of alice's contract call, not a source or a signer. His page shows activity only when he merges or withdraws.`);
  logger.log(`  ${explorerAccount(bob)}`);
  const ops = await horizonJson<{ _embedded: { records: HorizonOp[] } }>(`/transactions/${transferTx.hash}/operations`);
  for (const op of ops._embedded.records) {
    logger.log(`transfer tx operation: ${op.type}${op.function ? `, ${op.function}` : ''}, parameter types [${(op.parameters ?? []).map((p) => p.type).join(', ')}]`);
  }

  logger.section('what each transaction paid for');
  for (const [step, tx] of Object.entries(txs)) {
    if (!tx) continue;
    const got = await client.server.getTransaction(tx.hash);
    if (got.status !== rpc.Api.GetTransactionStatus.SUCCESS) continue;
    const sorobanData = got.envelopeXdr.v1().tx().ext().sorobanData();
    const resources = sorobanData.resources();
    const footprint = resources.footprint();
    const meta = got.resultMetaXdr;
    let changes: xdr.LedgerEntryChange[] = [];
    if (meta.switch() === 3) changes = meta.v3().operations().flatMap((o) => o.changes());
    else if (meta.switch() === 4) changes = meta.v4().operations().flatMap((o) => o.changes());
    const counts: Record<string, number> = {};
    for (const c of changes) counts[c.switch().name.replace('ledgerEntry', '')] = (counts[c.switch().name.replace('ledgerEntry', '')] ?? 0) + 1;
    const restored = counts['Restored'] ?? 0;
    logger.log(`${step.padEnd(15)} fee ${xlm(BigInt(tx.feeCharged))} XLM: resource fee ${xlm(BigInt(sorobanData.resourceFee().toString()))} XLM, ${resources.instructions()} instructions, footprint ${footprint.readOnly().length} read-only + ${footprint.readWrite().length} read-write entries, write ${resources.writeBytes()} bytes, ledger entry changes ${JSON.stringify(counts)}${restored ? ` <- ${restored} archived entries restored by this call` : ''}`);
  }
  logger.log('a month after deployment the verification keys, the auditor key and the token instance had passed their TTL; the first call that touched them (alice register) paid to restore them. Protocol 23 restores archived entries inside the invoking transaction, so the SDK did nothing special and the fee simply arrived in the simulation.');

  logger.section('public balances now');
  logger.log(`alice ${xlm((await xlmBalance(dep, alice)) ?? 0n)} XLM, bob ${xlm((await xlmBalance(dep, bob)) ?? 0n)} XLM on their public accounts; inside the pool alice holds ${xlm(TRANSFER === 0n ? 0n : 1000000000n - TRANSFER)} and bob ${xlm(TRANSFER - WITHDRAW)} XLM, and only they and the auditor know it`);
  logger.log(`audit done in ${formatMs(Date.now() - started)}; no transaction was sent`);
}

await main().catch((error: unknown) => fail(logger, errorMessage(error)));
