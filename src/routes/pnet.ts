import type { FastifyInstance } from 'fastify'
import { getPnetStatus, generateSwarmKey } from '../network/pnet.js'

export async function pnetRoutes(app: FastifyInstance) {
  app.post('/api/v0/pnet/status', async () => {
    return getPnetStatus()
  })

  app.post('/api/v0/pnet/generate', async () => {
    const key = generateSwarmKey()
    return {
      key,
      note: 'Save this key to config/swarm.key and restart the node to enable private network mode.',
    }
  })
}
