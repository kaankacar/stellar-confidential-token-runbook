// Testnet plumbing: friendbot, Horizon balances, transaction details, amounts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Keypair, rpc } from '@stellar/stellar-sdk';
import type { InvokeResult } from 'stellar-confidential-token-sdk';
import type { Deployment } from './config.ts';
import { explorerTx } from './config.ts';
import { formatMs, type Logger } from './log.ts';

export const STROOPS = 10_000_000n;

/** 425000000n -> "42.5000000". */
export function xlm(stroops: bigint): string {
  const sign = stroops < 0n ? '-' : '';
  const abs = stroops < 0n ? -stroops : stroops;
  return `${sign}${abs / STROOPS}.${(abs % STROOPS).toString().padStart(7, '0')}`;
}

/** "42.5" -> 425000000n. */
export function stroops(amount: string): bigint {
  const [whole, frac = ''] = amount.split('.');
  if (whole === undefined || !/^\d+$/.test(whole) || !/^\d{0,7}$/.test(frac)) throw new Error(`bad XLM amount ${amount}`);
  return BigInt(whole) * STROOPS + BigInt(frac.padEnd(7, '0'));
}

export async function friendbot(dep: Deployment, address: string): Promise<'funded' | 'already funded'> {
  const res = await fetch(`${dep.friendbotUrl}/?addr=${encodeURIComponent(address)}`);
  if (res.ok) return 'funded';
  if (res.status === 400) return 'already funded';
  throw new Error(`friendbot ${res.status} for ${address}`);
}

/** Native XLM balance from Horizon, in stroops. Null when the account does not exist. */
export async function xlmBalance(dep: Deployment, address: string): Promise<bigint | null> {
  const res = await fetch(`${dep.horizonUrl}/accounts/${address}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`horizon ${res.status} for ${address}`);
  const body = (await res.json()) as { balances: { asset_type: string; balance: string }[] };
  const native = body.balances.find((b) => b.asset_type === 'native');
  return native ? stroops(native.balance) : 0n;
}

export interface TxDetails {
  hash: string;
  ledger: number;
  closedAt: string;
  feeCharged: bigint;
}

/** Ledger, close time and fee of a transaction the RPC already applied. */
export async function txDetails(server: rpc.Server, hash: string): Promise<TxDetails> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const tx = await server.getTransaction(hash);
    if (tx.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return {
        hash,
        ledger: tx.ledger,
        closedAt: new Date(tx.createdAt * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        feeCharged: BigInt(tx.resultXdr.feeCharged().toString()),
      };
    }
    if (tx.status === rpc.Api.GetTransactionStatus.FAILED) throw new Error(`transaction ${hash} failed on chain`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`transaction ${hash} not found after 15 s`);
}

/** One log line per transaction: hash, ledger, fee, latency from call to close, then the explorer link. */
export async function logTx(logger: Logger, server: rpc.Server, label: string, result: InvokeResult, startedAt: number): Promise<TxDetails> {
  const details = await txDetails(server, result.hash);
  const latency = Date.now() - startedAt;
  logger.log(`${label}: tx ${details.hash}, ledger ${details.ledger}, closed ${details.closedAt}, fee ${details.feeCharged} stroops (${xlm(details.feeCharged)} XLM), latency call to close ${formatMs(latency)}`);
  logger.log(`  ${explorerTx(details.hash)}`);
  return details;
}

export interface StoredAccount {
  address: string;
  secret: string;
}

export interface StoredAccounts {
  alice?: StoredAccount;
  bob?: StoredAccount;
}

/** Gitignored record of the throwaway keys a run created, so later runs reuse them. */
export function readAccounts(path: string): StoredAccounts {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')) as StoredAccounts;
}

export function writeAccounts(path: string, accounts: StoredAccounts): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(accounts, null, 2)}\n`, { mode: 0o600 });
}

/**
 * The secret for a role: the env var when set, else the one a previous run
 * stored, else a fresh keypair funded by friendbot and stored for next time.
 */
export async function resolveSecret(
  role: 'alice' | 'bob',
  envValue: string | undefined,
  dep: Deployment,
  accountsPath: string,
  logger: Logger,
): Promise<string> {
  if (envValue) {
    const address = Keypair.fromSecret(envValue).publicKey();
    logger.log(`${role}: ${address} from the environment`);
    return envValue;
  }
  const stored = readAccounts(accountsPath);
  const existing = stored[role];
  if (existing) {
    logger.log(`${role}: ${existing.address} from ${accountsPath}`);
    return existing.secret;
  }
  const keypair = Keypair.random();
  const funded = await friendbot(dep, keypair.publicKey());
  stored[role] = { address: keypair.publicKey(), secret: keypair.secret() };
  writeAccounts(accountsPath, stored);
  logger.log(`${role}: ${keypair.publicKey()} created, ${funded} by friendbot, stored in ${accountsPath}`);
  return keypair.secret();
}
