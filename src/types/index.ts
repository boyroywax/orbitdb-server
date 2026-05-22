import { z } from 'zod'

export const AuthorizationSchema = z.object({
  authSecret: z.string(),
  allowedPaths: z.array(z.string()),
})

export const ConfigSchema = z.object({
  api: z.object({
    host: z.string().default('0.0.0.0'),
    port: z.number().default(3000),
    authorizations: z.record(z.string(), AuthorizationSchema),
  }),
  libp2p: z.object({
    swarmPort: z.number().default(4001),
    bootstrapPeers: z.array(z.string()).default([]),
  }),
  orbitdb: z.object({
    directory: z.string().default('./data/orbitdb'),
  }),
  ipfs: z.object({
    directory: z.string().default('./data/ipfs'),
  }),
  pintoSync: z
    .object({
      enabled: z.boolean().default(true),
      eventsDb: z.string().default('pinto-v1-events'),
      instance: z.string().default('orbitdb-server/0.1.0'),
    })
    .default({
      enabled: true,
      eventsDb: 'pinto-v1-events',
      instance: 'orbitdb-server/0.1.0',
    }),
})

export type Config = z.infer<typeof ConfigSchema>
export type Authorization = z.infer<typeof AuthorizationSchema>

export interface DbCreateRequest {
  name: string
  type: 'events' | 'documents' | 'keyvalue' | 'keyvalue-indexed'
}

export interface DbPutRequest {
  key: string
  value: unknown
}

export interface DbQueryRequest {
  filter: Record<string, unknown>
}

export interface PnetStatus {
  mode: 'private' | 'public'
  keyFingerprint?: string
}

export interface NodeIdentity {
  peerId: string
  did: string
  pnet: PnetStatus
  addresses: string[]
}
