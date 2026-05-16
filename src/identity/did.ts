import { Ed25519Provider } from 'key-did-provider-ed25519'
import { getResolver } from 'key-did-resolver'
import { DID } from 'did-resolver'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DID_KEY_PATH = process.env.DID_KEY_PATH || resolve(process.cwd(), 'config/did.key')

function loadOrCreateSeed(): Uint8Array {
  if (existsSync(DID_KEY_PATH)) {
    const hex = readFileSync(DID_KEY_PATH, 'utf-8').trim()
    return Uint8Array.from(Buffer.from(hex, 'hex'))
  }

  const seed = randomBytes(32)
  writeFileSync(DID_KEY_PATH, seed.toString('hex'), { mode: 0o600 })
  return new Uint8Array(seed)
}

export async function createDIDIdentity() {
  const seed = loadOrCreateSeed()
  const provider = new Ed25519Provider(seed)
  const resolver = getResolver()
  const did = new DID({ provider, resolver })
  await did.authenticate()
  return did
}
