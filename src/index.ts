import Fastify from 'fastify'
import { loadConfig } from './config/index.js'
import { createAuthHook } from './auth/bearer.js'
import { initOrbitDB, shutdown } from './lib/orbitdb.js'
import { dbRoutes } from './routes/db.js'
import { swarmRoutes } from './routes/swarm.js'
import { pnetRoutes } from './routes/pnet.js'
import { idRoutes } from './routes/id.js'

const config = loadConfig()

const app = Fastify({
  logger: true,
})

app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  try {
    const json = body ? JSON.parse(body as string) : undefined
    done(null, json)
  } catch (err: any) {
    done(err, undefined)
  }
})

const authHook = createAuthHook(config)
app.addHook('onRequest', authHook)

app.register(dbRoutes)
app.register(swarmRoutes)
app.register(pnetRoutes)
app.register(idRoutes)

async function start() {
  try {
    await initOrbitDB(config)

    await app.listen({
      host: config.api.host,
      port: config.api.port,
    })

    console.log(`OrbitDB API server listening on ${config.api.host}:${config.api.port}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

async function gracefulShutdown(signal: string) {
  console.log(`Received ${signal}, shutting down...`)
  await app.close()
  await shutdown()
  process.exit(0)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

start()
