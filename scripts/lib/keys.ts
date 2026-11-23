// Recoverable confidential keys, per stellar-confidential docs/sdk/key-derivation.md
// (signer roots). The root is the account's Ed25519 signature over the SEP-53
// payload of skSigningMessage(token, account). The same keypair always gives the
// same root, so the same confidential keys come back on any machine. The SDK
// leaves three obligations to the caller, and they live here: verify the
// signature, obtain it twice and compare, never persist the root.
import { Keypair } from '@stellar/stellar-sdk';
import {
  deriveKeys,
  deriveSk,
  keypairSigner,
  sep53Payload,
  skSigningMessage,
  type KeyPair,
  type Signer,
} from 'stellar-confidential-token-sdk';

export interface RecoverableKeys {
  keys: KeyPair;
  /** The rejection-sampling counter the derivation stopped at. Almost always 0. */
  j: number;
}

export function deriveRecoverableKeys(keypair: Keypair, token: string): RecoverableKeys {
  const account = keypair.publicKey();
  const payload = Buffer.from(sep53Payload(skSigningMessage(token, account)));
  const roots: Buffer[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const root = keypair.sign(payload);
    if (!keypair.verify(payload, root)) {
      throw new Error(`the signature over the key-derivation payload does not verify for ${account}`);
    }
    roots.push(root);
  }
  const [first, second] = roots;
  if (first === undefined || second === undefined || !first.equals(second)) {
    throw new Error(`two signatures over the same payload differ for ${account}; keys from this signer could not be recovered later`);
  }
  const derived = deriveSk(new Uint8Array(first), token, account);
  return { keys: deriveKeys(derived.sk, derived.addrF), j: derived.j };
}

export interface Participant {
  label: string;
  keypair: Keypair;
  address: string;
  signer: Signer;
  keys: KeyPair;
  j: number;
}

export function participant(label: string, secret: string, token: string, networkPassphrase: string): Participant {
  const keypair = Keypair.fromSecret(secret);
  const { keys, j } = deriveRecoverableKeys(keypair, token);
  return {
    label,
    keypair,
    address: keypair.publicKey(),
    signer: keypairSigner(secret, networkPassphrase),
    keys,
    j,
  };
}

/** Short, non-secret fingerprint of a public point for the log. */
export function pointHex(p: { toHex(): string }): string {
  const hex = p.toHex();
  return `${hex.slice(0, 10)}…${hex.slice(-6)}`;
}
