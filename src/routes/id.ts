import type { FastifyInstance } from 'fastify'
import { getHelia } from '../lib/orbitdb.js'
import { getPnetStatus } from '../network/pnet.js'
import { createDIDIdentity } from '../identity/did.js'

export async function idRoutes(app: FastifyInstance) {
  app.post('/api/v0/id', async (_request, reply) => {
    const helia = getHelia()
    if (!helia) return reply.code(503).send({ error: 'Node not ready' })

    const did = await createDIDIdentity()
    const addresses = helia.libp2p.getMultiaddrs().map((ma: any) => ma.toString())

    return {
      peerId: helia.libp2p.peerId.toString(),
      did: did.id,
      pnet: getPnetStatus(),
      addresses,
    }
  })

  app.post('/api/v0/health', async () => {
    const helia = getHelia()
    return {
      status: helia ? 'ok' : 'starting',
      timestamp: new Date().toISOString(),
    }
  })
}
