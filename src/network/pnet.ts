import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { generateKey, preSharedKey } from '@libp2p/pnet'
import { toString as uint8ToString } from 'uint8arrays/to-string'
import type { PnetStatus } from '../types/index.js'

const SWARM_KEY_PATH = process.env.SWARM_KEY_PATH || resolve(process.cwd(), 'config/swarm.key')

export function loadSwarmKey(): Uint8Array | null {
  if (!existsSync(SWARM_KEY_PATH)) return null
  const raw = readFileSync(SWARM_KEY_PATH)
  return new Uint8Array(raw)
}

export function getConnectionProtector() {
  const psk = loadSwarmKey()
  if (!psk) return null
  return preSharedKey({ psk })
}

export function isPrivateNetwork(): boolean {
  return existsSync(SWARM_KEY_PATH)
}

export function getKeyFingerprint(): string | undefined {
  const psk = loadSwarmKey()
  if (!psk) return undefined
  const hash = createHash('sha256').update(psk).digest('hex')
  return hash.slice(0, 16)
}

export function getPnetStatus(): PnetStatus {
  return {
    mode: isPrivateNetwork() ? 'private' : 'public',
    keyFingerprint: getKeyFingerprint(),
  }
}

export function generateSwarmKey(): string {
  const key = new Uint8Array(95)
  generateKey(key)
  return uint8ToString(key)
}

export function saveSwarmKey(keyContent: string, path?: string): void {
  const target = path || SWARM_KEY_PATH
  writeFileSync(target, keyContent, 'utf-8')
}
