import type { FastifyRequest, FastifyReply } from 'fastify'
import type { Config } from '../types/index.js'

function pathMatches(pattern: string, path: string): boolean {
  if (pattern === '/api/v0/*') return path.startsWith('/api/v0/')
  return path === pattern || path.startsWith(pattern + '?')
}

export function createAuthHook(config: Config) {
  const tokens = new Map<string, string[]>()

  for (const [, auth] of Object.entries(config.api.authorizations)) {
    const secret = auth.authSecret.replace(/^bearer:/, '')
    tokens.set(secret, auth.allowedPaths)
  }

  return async function authenticate(request: FastifyRequest, reply: FastifyReply) {
    if (request.url === '/api/v0/health') return

    const header = request.headers.authorization
    if (!header || !header.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'Missing or invalid Authorization header' })
      return reply
    }

    const token = header.slice(7)
    const allowedPaths = tokens.get(token)

    if (!allowedPaths) {
      reply.code(401).send({ error: 'Invalid token' })
      return reply
    }

    const matches = allowedPaths.some((pattern) => pathMatches(pattern, request.url))
    if (!matches) {
      reply.code(403).send({ error: 'Token not authorized for this path' })
      return reply
    }
  }
}
