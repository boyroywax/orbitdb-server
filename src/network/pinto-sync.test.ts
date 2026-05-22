import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SYNC_PROTOCOL_ID,
  handlePintoSyncStream,
  parseEnvelopeLine,
  registerPintoSyncHandler,
  toEnvelopeLine,
} from './pinto-sync.js'

type SyncEvent = {
  eventId: string
  kind: 'add' | 'pin' | 'unpin'
  authorDid: string
  createdAt: string
  object: { cid: string; name?: string; size?: number; mime?: string }
  tags: string[]
  text?: string
  source?: string
}

type MockStream = {
  source: AsyncIterable<Uint8Array>
  sink: (source: AsyncIterable<Uint8Array>) => Promise<void>
}

const encoder = new TextEncoder()

const makeEvent = (eventId: string): SyncEvent => ({
  eventId,
  kind: 'add',
  authorDid: 'did:key:alice',
  createdAt: '2026-01-01T00:00:00.000Z',
  object: { cid: `bafy${eventId}` },
  tags: ['sync'],
  source: 'v1',
})

const splitBytes = (input: string, chunkSizes: number[]): Uint8Array[] => {
  const bytes = encoder.encode(input)
  const chunks: Uint8Array[] = []
  let offset = 0
  for (const size of chunkSizes) {
    if (offset >= bytes.length) break
    const end = Math.min(bytes.length, offset + size)
    chunks.push(bytes.slice(offset, end))
    offset = end
  }
  if (offset < bytes.length) chunks.push(bytes.slice(offset))
  return chunks
}

const mockStreamFromInput = (chunks: Uint8Array[]): { stream: MockStream; written: Uint8Array[] } => {
  const written: Uint8Array[] = []
  const stream: MockStream = {
    source: (async function* () {
      for (const chunk of chunks) yield chunk
    })(),
    sink: async (source) => {
      for await (const chunk of source) written.push(chunk)
    },
  }
  return { stream, written }
}

const decodeWrittenLines = (written: Uint8Array[]): string[] =>
  Buffer.concat(written.map((chunk) => Buffer.from(chunk)))
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => `${line}\n`)

test('handlePintoSyncStream reads NDJSON request and writes hello+events responses', async () => {
  const requestText =
    toEnvelopeLine({
      v: '1.0.0',
      type: 'hello',
      msgId: 'm-1',
      ts: '2026-01-01T00:00:00.000Z',
      body: {
        nodeDid: 'did:key:zpeer',
        instance: 'pinto/peer',
        caps: ['events.pull'],
        limits: { maxChunk: 200, maxLineBytes: 262_144 },
      },
    }) +
    toEnvelopeLine({
      v: '1.0.0',
      type: 'want',
      msgId: 'm-2',
      ts: '2026-01-01T00:00:00.000Z',
      body: { cursor: '', limit: 2 },
    })

  const { stream, written } = mockStreamFromInput(splitBytes(requestText, [1, 2, 3, 5, 8, 13]))

  await handlePintoSyncStream(stream, {
    responderNodeDid: 'did:key:zlocal',
    responderInstance: 'pinto/orbitdb-server',
    readEvents: async () => [makeEvent('evt-2'), makeEvent('evt-1')],
    chunkSize: 1,
  })

  const lines = decodeWrittenLines(written)
  const envelopes = lines.map((line) => parseEnvelopeLine(line))

  assert.equal(envelopes[0]?.type, 'hello')
  assert.equal(envelopes[1]?.type, 'events')
  assert.equal(envelopes[2]?.type, 'events')
  assert.equal((envelopes[2]?.body as { done?: boolean }).done, true)
})

test('handlePintoSyncStream emits error envelope when hello is missing', async () => {
  const requestText = toEnvelopeLine({
    v: '1.0.0',
    type: 'want',
    msgId: 'm-2',
    ts: '2026-01-01T00:00:00.000Z',
    body: { cursor: '', limit: 2 },
  })

  const { stream, written } = mockStreamFromInput(splitBytes(requestText, [4, 4, 4]))

  await handlePintoSyncStream(stream, {
    responderNodeDid: 'did:key:zlocal',
    responderInstance: 'pinto/orbitdb-server',
    readEvents: async () => [makeEvent('evt-1')],
  })

  const lines = decodeWrittenLines(written)
  assert.equal(lines.length, 1)
  const envelope = parseEnvelopeLine(lines[0] ?? '')
  assert.equal(envelope.type, 'error')
  assert.equal((envelope.body as { code?: string }).code, 'bad_request')
})

test('registerPintoSyncHandler hooks handler on /pinto/v1.0.0/sync', async () => {
  let protocol = ''
  let handler: ((context: { stream: MockStream }) => Promise<void>) | undefined

  const libp2pLike = {
    handle: (id: string, fn: (context: { stream: MockStream }) => Promise<void>) => {
      protocol = id
      handler = fn
    },
  }

  registerPintoSyncHandler(libp2pLike, {
    responderNodeDid: 'did:key:zlocal',
    responderInstance: 'pinto/orbitdb-server',
    readEvents: async () => [makeEvent('evt-1')],
  })

  assert.equal(protocol, SYNC_PROTOCOL_ID)
  assert.ok(handler)

  const requestText =
    toEnvelopeLine({
      v: '1.0.0',
      type: 'hello',
      msgId: 'm-1',
      ts: '2026-01-01T00:00:00.000Z',
      body: {
        nodeDid: 'did:key:zpeer',
        instance: 'pinto/peer',
        caps: ['events.pull'],
        limits: { maxChunk: 200, maxLineBytes: 262_144 },
      },
    }) +
    toEnvelopeLine({
      v: '1.0.0',
      type: 'want',
      msgId: 'm-2',
      ts: '2026-01-01T00:00:00.000Z',
      body: { cursor: '', limit: 1 },
    })

  const { stream, written } = mockStreamFromInput(splitBytes(requestText, [5, 7, 11]))
  await handler?.({ stream })

  const lines = decodeWrittenLines(written)
  const first = parseEnvelopeLine(lines[0] ?? '')
  assert.equal(first.type, 'hello')
})
