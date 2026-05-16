import { createHelia } from 'helia'
import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { identify } from '@libp2p/identify'
import { bootstrap } from '@libp2p/bootstrap'
import { mdns } from '@libp2p/mdns'
import { createOrbitDB, OrbitDB } from '@orbitdb/core'
import { getConnectionProtector, isPrivateNetwork } from '../network/pnet.js'
import { createDIDIdentity } from '../identity/did.js'
import type { Config } from '../types/index.js'

let orbitdb: OrbitDB | null = null
let heliaNode: Awaited<ReturnType<typeof createHelia>> | null = null

const openDatabases = new Map<string, any>()

export async function initOrbitDB(config: Config): Promise<OrbitDB> {
  if (orbitdb) return orbitdb

  const connectionProtector = getConnectionProtector()

  const libp2pOptions: any = {
    addresses: {
      listen: [
        `/ip4/0.0.0.0/tcp/${config.libp2p.swarmPort}`,
        `/ip4/0.0.0.0/tcp/0/ws`,
      ],
    },
    transports: [tcp(), webSockets()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
    },
    peerDiscovery: [mdns()],
  }

  if (connectionProtector) {
    libp2pOptions.connectionProtector = connectionProtector
  }

  if (config.libp2p.bootstrapPeers.length > 0) {
    libp2pOptions.peerDiscovery.push(
      bootstrap({ list: config.libp2p.bootstrapPeers })
    )
  }

  if (isPrivateNetwork() && process.env.LIBP2P_FORCE_PNET !== '1') {
    process.env.LIBP2P_FORCE_PNET = '1'
  }

  const libp2p = await createLibp2p(libp2pOptions)

  heliaNode = await createHelia({
    libp2p,
    blockstore: undefined,
    datastore: undefined,
  })

  const did = await createDIDIdentity()

  orbitdb = await createOrbitDB({
    ipfs: heliaNode,
    directory: config.orbitdb.directory,
  })

  console.log(`OrbitDB initialized — PeerID: ${heliaNode.libp2p.peerId.toString()}`)
  console.log(`DID: ${did.id}`)
  console.log(`Network mode: ${isPrivateNetwork() ? 'PRIVATE' : 'PUBLIC'}`)

  return orbitdb
}

export async function openDatabase(name: string, type: string, options?: Record<string, unknown>) {
  if (!orbitdb) throw new Error('OrbitDB not initialized')

  if (openDatabases.has(name)) {
    return openDatabases.get(name)
  }

  const db = await orbitdb.open(name, { type, ...options })
  openDatabases.set(name, db)
  return db
}

export async function getDatabase(name: string) {
  return openDatabases.get(name) || null
}

export async function closeDatabase(name: string) {
  const db = openDatabases.get(name)
  if (!db) return false
  await db.close()
  openDatabases.delete(name)
  return true
}

export async function dropDatabase(name: string) {
  const db = openDatabases.get(name)
  if (!db) return false
  await db.drop()
  openDatabases.delete(name)
  return true
}

export function listDatabases(): string[] {
  return Array.from(openDatabases.keys())
}

export function getHelia() {
  return heliaNode
}

export function getOrbitDB() {
  return orbitdb
}

export async function shutdown() {
  for (const [name, db] of openDatabases) {
    await db.close()
    openDatabases.delete(name)
  }
  if (orbitdb) {
    await orbitdb.stop()
    orbitdb = null
  }
  if (heliaNode) {
    await heliaNode.stop()
    heliaNode = null
  }
}
