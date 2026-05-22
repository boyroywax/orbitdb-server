import { createHelia } from 'helia'
import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'
import { noise } from '@chainsafe/libp2p-noise'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { yamux } from '@chainsafe/libp2p-yamux'
import { identify } from '@libp2p/identify'
import { bootstrap } from '@libp2p/bootstrap'
import { mdns } from '@libp2p/mdns'
import { createOrbitDB } from '@orbitdb/core'
import { getConnectionProtector, isPrivateNetwork } from '../network/pnet.js'
import {
  MAX_SYNC_CHUNK,
  SYNC_PROTOCOL_ID,
  registerPintoSyncHandler,
  type SyncEvent,
} from '../network/pinto-sync.js'
import { createDIDIdentity } from '../identity/did.js'
import type { Config } from '../types/index.js'

let orbitdb: any = null
let heliaNode: any = null

const openDatabases = new Map<string, any>()

export async function initOrbitDB(config: Config): Promise<any> {
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
      pubsub: gossipsub(),
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

  if (config.pintoSync.enabled) {
    const readEvents = async (limit: number): Promise<SyncEvent[]> => {
      const db = await openDatabase(config.pintoSync.eventsDb, 'events')
      const entries: SyncEvent[] = []
      for await (const entry of db.iterator()) {
        const raw = (entry as any)?.value ?? (entry as any)?.payload?.value
        if (!raw || typeof raw !== 'object') continue
        const event = raw as SyncEvent
        if (
          typeof event.eventId !== 'string' ||
          typeof event.kind !== 'string' ||
          typeof event.authorDid !== 'string' ||
          typeof event.createdAt !== 'string' ||
          !event.object ||
          typeof event.object.cid !== 'string'
        ) {
          continue
        }
        entries.push(event)
      }

      return entries
        .sort((a, b) => {
          if (a.createdAt === b.createdAt) return a.eventId < b.eventId ? 1 : -1
          return a.createdAt < b.createdAt ? 1 : -1
        })
        .slice(0, Math.max(1, Math.min(limit, MAX_SYNC_CHUNK)))
    }

    registerPintoSyncHandler(libp2p as unknown as { handle: (protocol: string, handler: (ctx: { stream: any }) => Promise<void>) => void }, {
      readEvents,
      responderNodeDid: did.id,
      responderInstance: config.pintoSync.instance,
    })

    console.log(
      `Pinto sync handler registered on ${SYNC_PROTOCOL_ID} (eventsDb=${config.pintoSync.eventsDb}, instance=${config.pintoSync.instance})`,
    )
  } else {
    console.log('Pinto sync handler disabled by config (pintoSync.enabled=false)')
  }

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
