import type { FastifyInstance } from 'fastify'
import { openDatabase, getDatabase, dropDatabase, listDatabases } from '../lib/orbitdb.js'

export async function dbRoutes(app: FastifyInstance) {
  app.post('/api/v0/db/create', async (request, reply) => {
    const { name, type } = request.query as { name: string; type: string }

    if (!name || !type) {
      return reply.code(400).send({ error: 'name and type query params required' })
    }

    const validTypes = ['events', 'documents', 'keyvalue', 'keyvalue-indexed']
    if (!validTypes.includes(type)) {
      return reply.code(400).send({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` })
    }

    const db = await openDatabase(name, type)
    return { name, type, address: db.address.toString() }
  })

  app.post('/api/v0/db/drop', async (request, reply) => {
    const { name } = request.query as { name: string }
    if (!name) return reply.code(400).send({ error: 'name query param required' })

    const dropped = await dropDatabase(name)
    if (!dropped) return reply.code(404).send({ error: 'Database not found' })
    return { dropped: true }
  })

  app.post('/api/v0/db/list', async () => {
    return { databases: listDatabases() }
  })

  app.post('/api/v0/db/put', async (request, reply) => {
    const { db: dbName, key } = request.query as { db: string; key: string }
    if (!dbName) return reply.code(400).send({ error: 'db query param required' })

    const db = await getDatabase(dbName)
    if (!db) return reply.code(404).send({ error: 'Database not found or not open' })

    const body = request.body as any

    if (db.type === 'keyvalue' || db.type === 'keyvalue-indexed') {
      if (!key) return reply.code(400).send({ error: 'key query param required for keyvalue stores' })
      const hash = await db.put(key, body)
      return { hash, key }
    }

    if (db.type === 'documents') {
      const hash = await db.put(body)
      return { hash }
    }

    return reply.code(400).send({ error: 'Use /api/v0/db/add for event log stores' })
  })

  app.post('/api/v0/db/get', async (request, reply) => {
    const { db: dbName, key } = request.query as { db: string; key: string }
    if (!dbName) return reply.code(400).send({ error: 'db query param required' })

    const db = await getDatabase(dbName)
    if (!db) return reply.code(404).send({ error: 'Database not found or not open' })

    if (db.type === 'keyvalue' || db.type === 'keyvalue-indexed') {
      if (!key) return reply.code(400).send({ error: 'key query param required' })
      const value = await db.get(key)
      return { key, value }
    }

    if (db.type === 'documents') {
      if (!key) return reply.code(400).send({ error: 'key query param required' })
      const docs = await db.get(key)
      return { results: docs }
    }

    return reply.code(400).send({ error: 'Use /api/v0/db/all for event log stores' })
  })

  app.post('/api/v0/db/del', async (request, reply) => {
    const { db: dbName, key } = request.query as { db: string; key: string }
    if (!dbName || !key) return reply.code(400).send({ error: 'db and key query params required' })

    const db = await getDatabase(dbName)
    if (!db) return reply.code(404).send({ error: 'Database not found or not open' })

    const hash = await db.del(key)
    return { hash, deleted: key }
  })

  app.post('/api/v0/db/all', async (request, reply) => {
    const { db: dbName } = request.query as { db: string }
    if (!dbName) return reply.code(400).send({ error: 'db query param required' })

    const db = await getDatabase(dbName)
    if (!db) return reply.code(404).send({ error: 'Database not found or not open' })

    const entries: any[] = []
    for await (const entry of db.iterator()) {
      entries.push(entry)
    }
    return { entries }
  })

  app.post('/api/v0/db/query', async (request, reply) => {
    const { db: dbName } = request.query as { db: string }
    if (!dbName) return reply.code(400).send({ error: 'db query param required' })

    const db = await getDatabase(dbName)
    if (!db) return reply.code(404).send({ error: 'Database not found or not open' })

    if (db.type !== 'documents') {
      return reply.code(400).send({ error: 'Query is only supported on document stores' })
    }

    const body = request.body as { filter?: Record<string, unknown> }
    const results: any[] = []

    for await (const doc of db.iterator()) {
      if (!body?.filter) {
        results.push(doc)
        continue
      }
      const matches = Object.entries(body.filter).every(
        ([k, v]) => doc.value?.[k] === v
      )
      if (matches) results.push(doc)
    }

    return { results }
  })

  app.post('/api/v0/db/add', async (request, reply) => {
    const { db: dbName } = request.query as { db: string }
    if (!dbName) return reply.code(400).send({ error: 'db query param required' })

    const db = await getDatabase(dbName)
    if (!db) return reply.code(404).send({ error: 'Database not found or not open' })

    if (db.type !== 'events') {
      return reply.code(400).send({ error: '/api/v0/db/add is only for event log stores' })
    }

    const hash = await db.add(request.body)
    return { hash }
  })
}
