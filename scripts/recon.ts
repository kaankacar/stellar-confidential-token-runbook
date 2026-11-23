// Run 0, recon: read before you touch. Everything here is a read: contract
// metadata and interfaces by the stellar CLI, the registered verification keys
// by simulation, the auditor key, the RPC retention window, the crate version.
//
//   pnpm recon -- --log docs/field-note/runs/run0-recon.log [--deployment public|own]
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { Keypair, xdr } from '@stellar/stellar-sdk';
import {
  CIRCUIT_TYPE,
  ChainClient,
  VERSIONS,
  auditorPublicKey,
  fromHex,
  type CircuitTypeName,
} from 'stellar-confidential-token-sdk';
import { DEPLOYMENT_OPTION, explorerContract, loadDeployment, parseDeploymentName, statePath } from './lib/config.ts';
import { pointHex } from './lib/keys.ts';
import { COMMON_OPTIONS, createLogger, errorMessage, formatMs, helpIfAsked, installCrashLogger, scriptArgs } from './lib/log.ts';
import { readAccounts } from './lib/stellar.ts';

const USAGE = `
Run 0, recon (read-only).
  pnpm recon -- [--deployment public|own] [--log <path>]
`;

const BRI_TOKEN = 'CCLDBRA5UVX6RMXSN44FMLK6RK4XMQ3XELL4TZC6XPL4D2JPPQNI4VSK';
const BRI_VERIFIER = 'CDCET36PIS44DWJM5UQSSI4ZHGRDSBIIQW4G4ALPYK3Y6FEQGY5ZWFXL';
const VK_FILE: Record<CircuitTypeName, string> = {
  Register: 'register',
  Withdraw: 'withdraw',
  Transfer: 'transfer',
  SpenderTransfer: 'spender_transfer',
  SetSpender: 'set_spender',
  Clawback: 'clawback',
};

const { values } = parseArgs({ args: scriptArgs(), options: { ...COMMON_OPTIONS, ...DEPLOYMENT_OPTION } });
helpIfAsked(values.help, USAGE);
const logger = createLogger(values.log);
installCrashLogger(logger);
const dep = loadDeployment(parseDeploymentName(values.deployment));
const client = new ChainClient({ rpcUrl: dep.rpcUrl, networkPassphrase: dep.networkPassphrase, contracts: dep.contracts });

function cli(args: string[]): string {
  return execFileSync('stellar', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
}

function contractMeta(id: string): { sdk: string; cli: string } {
  const out = cli(['contract', 'info', 'meta', '--network', dep.network, '--id', id]);
  const pick = (key: string): string => /^\s*•\s*(\S+): (\S+)/m.exec(out.split('\n').find((l) => l.includes(`${key}:`)) ?? '')?.[2] ?? '?';
  return { sdk: pick('rssdkver').split('#')[0] ?? '?', cli: pick('cliver').split('#')[0] ?? '?' };
}

function contractFunctions(id: string): string[] {
  const out = cli(['contract', 'info', 'interface', '--network', dep.network, '--id', id]);
  return [...out.matchAll(/^\s*fn (\w+)\(/gm)].map((m) => m[1] ?? '').filter((f) => f !== '__constructor').sort();
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function main(): Promise<void> {
  const started = Date.now();
  logger.log(`testnet, deployment "${dep.name}": token ${dep.contracts.token}, verifier ${dep.contracts.verifier}, auditor ${dep.contracts.auditor}, deployed at ledger ${dep.deployedAtLedger}`);
  logger.log(`  ${explorerContract(dep.contracts.token)}`);
  logger.log(`stellar CLI: ${cli(['--version']).split('\n')[0] ?? '?'}; node ${process.version}`);

  logger.section('release and SDK');
  logger.log(`SDK ${VERSIONS.sdk} implements ${VERSIONS.protocol.crate} ${VERSIONS.protocol.version} (${VERSIONS.protocol.tag}, ${VERSIONS.protocol.commit.slice(0, 7)}); nargo ${VERSIONS.toolchain.nargo}, bb.js ${VERSIONS.toolchain.bbJs}, noir_js ${VERSIONS.toolchain.noirJs}, on-chain verifier ${VERSIONS.toolchain.onChainVerifier}, domain separators ${VERSIONS.domainSeparators}`);
  try {
    const res = await fetch('https://crates.io/api/v1/crates/stellar-confidential', { headers: { 'user-agent': 'Mozilla/5.0 (field-note recon)' } });
    const body = (await res.json()) as { crate: { max_version: string; updated_at: string }; versions: { num: string; created_at: string }[] };
    const latest = body.versions.find((v) => v.num === body.crate.max_version);
    logger.log(`crates.io stellar-confidential: max ${body.crate.max_version}, published ${latest?.created_at ?? '?'}; the SDK matches: ${body.crate.max_version === VERSIONS.protocol.version}`);
  } catch (error) {
    logger.log(`crates.io: could not read (${errorMessage(error)})`);
  }

  logger.section('contract metadata: stable 0.8.0 token vs the July preview token the game uses');
  for (const [label, id] of [['0.8.0 token', dep.contracts.token], ['game token (preview)', BRI_TOKEN]] as const) {
    const t0 = Date.now();
    const meta = contractMeta(id);
    const fns = contractFunctions(id);
    logger.log(`${label} ${id}: soroban-sdk ${meta.sdk}, built with CLI ${meta.cli}, ${fns.length} functions (${formatMs(Date.now() - t0)})`);
    logger.log(`  ${fns.join(', ')}`);
  }
  const stableFns = contractFunctions(dep.contracts.token);
  const previewFns = contractFunctions(BRI_TOKEN);
  const onlyStable = stableFns.filter((f) => !previewFns.includes(f));
  const onlyPreview = previewFns.filter((f) => !stableFns.includes(f));
  logger.log(`interface diff: only in 0.8.0 [${onlyStable.join(', ') || 'none'}], only in preview [${onlyPreview.join(', ') || 'none'}]`);
  const verifierMeta = contractMeta(dep.contracts.verifier);
  const briVerifierMeta = contractMeta(BRI_VERIFIER);
  logger.log(`verifier registries: 0.8.0 ${dep.contracts.verifier} soroban-sdk ${verifierMeta.sdk}; preview ${BRI_VERIFIER} soroban-sdk ${briVerifierMeta.sdk}`);

  logger.section('verification keys: on-chain registry vs the SDK bundle');
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve('stellar-confidential-token-sdk/circuits/manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { sha256: Record<string, string> };
  const vksDir = join(dirname(manifestPath), 'vks');
  let matches = 0;
  for (const name of Object.keys(CIRCUIT_TYPE) as CircuitTypeName[]) {
    const circuitType = CIRCUIT_TYPE[name];
    const file = `${VK_FILE[name]}.vk.bin`;
    const bundled = new Uint8Array(readFileSync(join(vksDir, file)));
    const bundledHash = sha256(bundled);
    const manifestHash = manifest.sha256[`vks/${file}`] ?? '?';
    let onChain = 'absent';
    let onChainHash = '';
    try {
      const t0 = Date.now();
      const val = await client.simulate(dep.contracts.verifier, 'get_verification_key', [xdr.ScVal.scvU32(circuitType)]);
      const name2 = val.switch().name;
      if (name2 === 'scvBytes') {
        const bytes = new Uint8Array(val.bytes());
        onChainHash = sha256(bytes);
        onChain = `${bytes.length} bytes in ${formatMs(Date.now() - t0)}`;
      } else {
        onChain = `returned ${name2}`;
      }
    } catch (error) {
      onChain = `simulation failed: ${errorMessage(error).split('\n')[0]}`;
    }
    const same = onChainHash !== '' && onChainHash === bundledHash;
    if (same) matches += 1;
    logger.log(`${name.padEnd(15)} type ${String(circuitType).padStart(3)}  bundle ${bundled.length} bytes sha256 ${bundledHash.slice(0, 12)}… (manifest ${manifestHash === bundledHash ? 'agrees' : 'DISAGREES'})  on-chain ${onChain}${onChainHash ? ` sha256 ${onChainHash.slice(0, 12)}…` : ''}  ${same ? 'MATCH' : 'NO MATCH'}`);
  }
  logger.log(`${matches} of ${Object.keys(CIRCUIT_TYPE).length} registered keys match the bundle. The SDK does not check this before proving (its README lists the gap); a mismatch shows up only as an on-chain rejection.`);

  logger.section('auditor key');
  const kAud = await client.auditorKey(dep.auditorId);
  logger.log(`auditor id ${dep.auditorId} on ${dep.contracts.auditor}: K_aud ${pointHex(kAud)}`);
  const secretHex = process.env[dep.name === 'own' ? 'AUDITOR_SECRET_HEX_OWN' : 'AUDITOR_SECRET_HEX'];
  if (secretHex) {
    const derived = auditorPublicKey(fromHex(secretHex));
    logger.log(`AUDITOR_SECRET_HEX from .env derives ${pointHex(derived)}: ${derived.equals(kAud) ? 'matches the registered key' : 'DOES NOT match the registered key'}`);
  } else {
    logger.log(`${dep.name === 'own' ? 'AUDITOR_SECRET_HEX_OWN' : 'AUDITOR_SECRET_HEX'} not set; run 3 needs it`);
  }

  logger.section('RPC retention window');
  const health = await client.server.getHealth();
  const latest = await client.latestLedger();
  const window = health.latestLedger - health.oldestLedger;
  logger.log(`getHealth: oldest ledger ${health.oldestLedger}, latest ${health.latestLedger}, retention window ${health.ledgerRetentionWindow} ledgers (${window} served, about ${(window * 5.5 / 86400).toFixed(1)} days at 5.5 s); latestLedger() ${latest}`);
  const inside = dep.deployedAtLedger >= health.oldestLedger;
  logger.log(`deployment ledger ${dep.deployedAtLedger} is ${inside ? 'inside' : 'OUTSIDE'} the window${inside ? '' : `, ${health.oldestLedger - dep.deployedAtLedger} ledgers too old. A StateEngine started from it cannot read events older than ${health.oldestLedger}; fresh accounts register inside the window so they are fine, but any opening whose event ages out before a sync is gone (no indexer here).`}`);

  logger.section('accounts');
  const accountsPath = statePath(`accounts.${dep.name}.json`);
  const stored = readAccounts(accountsPath);
  const candidates: [string, string | undefined][] = [
    ['alice', process.env['STELLAR_SECRET'] ? Keypair.fromSecret(process.env['STELLAR_SECRET']).publicKey() : stored.alice?.address],
    ['bob', process.env['BOB_SECRET'] ? Keypair.fromSecret(process.env['BOB_SECRET']).publicKey() : stored.bob?.address],
  ];
  for (const [role, address] of candidates) {
    if (!address) {
      logger.log(`${role}: no key yet; run 2 creates and funds one by friendbot`);
      continue;
    }
    const registered = await client.isRegistered(address);
    logger.log(`${role} ${address}: is_registered ${registered}${registered ? ' (register is single-use per account, run 2 must skip it)' : ''}`);
  }

  logger.section('summary');
  logger.log(`recon done in ${formatMs(Date.now() - started)}; no transaction was sent`);
}

await main();
