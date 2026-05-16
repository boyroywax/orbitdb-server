import type { FastifyInstance } from 'fastify'
import { multiaddr } from '@multiformats/multiaddr'
import { getHelia } from '../lib/orbitdb.js'

export async function swarmRoutes(app: FastifyInstance) {
  app.post('/api/v0/swarm/peers', async (_request, reply) => {
    const helia = getHelia()
    if (!helia) return reply.code(503).send({ error: 'Node not ready' })

    const connections = helia.libp2p.getConnections()
    const peers = connections.map((conn) => ({
      peerId: conn.remotePeer.toString(),
      addr: conn.remoteAddr.toString(),
      direction: conn.direction,
      status: conn.status,
    }))

    return { peers }
  })

  app.post('/api/v0/swarm/connect', async (request, reply) => {
    const { addr } = request.query as { addr: string }
    if (!addr) return reply.code(400).send({ error: 'addr query param required (multiaddr)' })

    const helia = getHelia()
    if (!helia) return reply.code(503).send({ error: 'Node not ready' })

    try {
      const ma = multiaddr(addr)
      await helia.libp2p.dial(ma)
      return { connected: addr }
    } catch (err: any) {
      return reply.code(500).send({ error: `Failed to connect: ${err.message}` })
    }
  })
}
