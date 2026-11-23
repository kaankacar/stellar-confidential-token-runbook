// Deployment config and the links every log line carries.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export type DeploymentName = 'public' | 'own';

export interface Deployment {
  name: DeploymentName;
  network: 'testnet';
  rpcUrl: string;
  horizonUrl: string;
  friendbotUrl: string;
  networkPassphrase: string;
  contracts: {
    token: string;
    verifier: string;
    auditor: string;
    factory?: string;
    underlying: string;
  };
  auditorId: number;
  deployedAtLedger: number;
  deployedBy?: string;
  source?: string;
}

/** Options every run script accepts on top of --log and --help. */
export const DEPLOYMENT_OPTION = {
  deployment: { type: 'string', default: 'public' },
} as const;

export function parseDeploymentName(value: string | undefined): DeploymentName {
  if (value === undefined || value === 'public') return 'public';
  if (value === 'own') return 'own';
  throw new Error(`--deployment must be public or own, got ${value}`);
}

export function deploymentPath(name: DeploymentName): string {
  return resolve(ROOT, 'config', `deployment.${name}.json`);
}

export function loadDeployment(name: DeploymentName): Deployment {
  const path = deploymentPath(name);
  if (!existsSync(path)) {
    throw new Error(`no ${name} deployment at ${path}${name === 'own' ? ' (run 1 writes it)' : ''}`);
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Deployment;
  if (parsed.network !== 'testnet') throw new Error(`${path}: only testnet deployments are supported`);
  return parsed;
}

/** Where the run scripts keep their gitignored state (accounts, openings). */
export function statePath(file: string): string {
  return resolve(ROOT, 'state', file);
}

const EXPLORER = 'https://stellar.expert/explorer/testnet';
export const explorerTx = (hash: string): string => `${EXPLORER}/tx/${hash}`;
export const explorerContract = (id: string): string => `${EXPLORER}/contract/${id}`;
export const explorerAccount = (address: string): string => `${EXPLORER}/account/${address}`;
