import { randomUUID } from 'node:crypto'
import { TextDecoder, TextEncoder } from 'node:util'

export const SYNC_PROTOCOL_ID = '/pinto/v1.0.0/sync' as const
export const SYNC_PROTOCOL_VERSION = '1.0.0' as const
export const MAX_SYNC_LINE_BYTES = 262_144
export const MAX_SYNC_CHUNK = 200

type EnvelopeType = 'hello' | 'want' | 'events' | 'follow_ops' | 'ack' | 'error' | 'ping' | 'pong'

export type SyncEvent = {
  eventId: string
  kind: 'add' | 'pin' | 'unpin'
  authorDid: string
  createdAt: string
  object: { cid: string; name?: string; size?: number; mime?: string }
  tags: string[]
  text?: string
  refs?: {
    prev?: string
    replyTo?: string
    repostOf?: string
  }
  signature?: {
    alg: 'ed25519'
    key: string
    value: string
  }
  source?: string
}

type SyncHelloBody = {
  nodeDid: string
  instance: string
  caps: string[]
  limits: {
    maxChunk: number
    maxLineBytes: number
  }
}

type SyncWantBody = {
  cursor: string
  limit: number
  authors?: string[]
  tags?: string[]
}

type SyncEventsBody = {
  items: SyncEvent[]
  nextCursor: string
  done: boolean
}

type EnvelopeMap = {
  hello: SyncHelloBody
  want: SyncWantBody
  events: SyncEventsBody
  follow_ops: Record<string, unknown>
  ack: Record<string, unknown>
  error: { code?: string; message?: string; retryAfterMs?: number }
  ping: Record<string, unknown>
  pong: Record<string, unknown>
}

export type SyncEnvelope<T extends EnvelopeType = EnvelopeType> = {
  v: typeof SYNC_PROTOCOL_VERSION
  type: T
  msgId: string
  ts: string
  body: EnvelopeMap[T]
}

type AnySyncEnvelope = {
  [K in EnvelopeType]: SyncEnvelope<K>
}[EnvelopeType]

export type SyncStreamLike = {
  source: AsyncIterable<Uint8Array>
  sink: (source: AsyncIterable<Uint8Array>) => Promise<void>
}

type SyncStreamContext = {
  stream: SyncStreamLike
}

export type PintoSyncDependencies = {
  readEvents: (limit: number) => Promise<SyncEvent[]>
  responderNodeDid: string
  responderInstance: string
  responderCaps?: string[]
  chunkSize?: number
}

type Libp2pLike = {
  handle: (protocol: string, handler: (context: SyncStreamContext) => Promise<void>) => void
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const clampInt = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min
  const rounded = Math.round(value)
  return Math.min(max, Math.max(min, rounded))
}

const normalizeTag = (value: string): string => value.trim().toLowerCase().replace(/^#+/, '')

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object'

const isEnvelopeType = (value: unknown): value is EnvelopeType =>
  value === 'hello' ||
  value === 'want' ||
  value === 'events' ||
  value === 'follow_ops' ||
  value === 'ack' ||
  value === 'error' ||
  value === 'ping' ||
  value === 'pong'

const asTypedEnvelope = <T extends AnySyncEnvelope['type']>(envelope: AnySyncEnvelope, type: T): SyncEnvelope<T> => {
  if (envelope.type !== type) {
    throw new Error(`Expected envelope type '${type}' but got '${envelope.type}'`)
  }
  return envelope as SyncEnvelope<T>
}

const createEnvelope = <T extends EnvelopeType>(type: T, body: EnvelopeMap[T]): SyncEnvelope<T> => ({
  v: SYNC_PROTOCOL_VERSION,
  type,
  msgId: randomUUID(),
  ts: new Date().toISOString(),
  body,
})

export const toEnvelopeLine = (envelope: SyncEnvelope): string => {
  const line = `${JSON.stringify(envelope)}\n`
  const lineBytes = Buffer.byteLength(line, 'utf8')
  if (lineBytes > MAX_SYNC_LINE_BYTES) {
    throw new Error(`Envelope exceeds max line size (${lineBytes} > ${MAX_SYNC_LINE_BYTES})`)
  }
  return line
}

export const parseEnvelopeLine = (line: string): AnySyncEnvelope => {
  const lineBytes = Buffer.byteLength(line, 'utf8')
  if (lineBytes > MAX_SYNC_LINE_BYTES) {
    throw new Error(`Envelope exceeds max line size (${lineBytes} > ${MAX_SYNC_LINE_BYTES})`)
  }

  const trimmed = line.trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error('Invalid envelope JSON')
  }

  if (!isRecord(parsed)) throw new Error('Envelope must be a JSON object')
  if (parsed.v !== SYNC_PROTOCOL_VERSION) throw new Error(`Unsupported envelope version: ${String(parsed.v)}`)
  if (!isEnvelopeType(parsed.type)) throw new Error(`Unsupported envelope type: ${String(parsed.type)}`)
  if (typeof parsed.msgId !== 'string' || !parsed.msgId) throw new Error('Envelope msgId is required')
  if (typeof parsed.ts !== 'string' || !parsed.ts) throw new Error('Envelope ts is required')
  if (!isRecord(parsed.body)) throw new Error('Envelope body must be an object')

  return parsed as AnySyncEnvelope
}

const parseSyncRequestLines = (lines: string[]): { hello: SyncEnvelope<'hello'>; want: SyncEnvelope<'want'> } => {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new Error('Sync session requires at least hello and want envelopes')
  }

  const parsed = lines.map((line) => parseEnvelopeLine(line))
  if (parsed[0]?.type !== 'hello') {
    throw new Error('Sync session invalid: hello envelope must be first')
  }

  const want = parsed.find((item) => item.type === 'want')
  if (!want) {
    throw new Error('Sync session invalid: want envelope is required')
  }

  const helloEnvelope = asTypedEnvelope(parsed[0], 'hello')
  const wantEnvelope = asTypedEnvelope(want, 'want')
  wantEnvelope.body.limit = clampInt(wantEnvelope.body.limit, 1, MAX_SYNC_CHUNK)

  return { hello: helloEnvelope, want: wantEnvelope }
}

const selectEventsForWant = (events: SyncEvent[], want: SyncWantBody): SyncEvent[] => {
  const limit = clampInt(want.limit, 1, MAX_SYNC_CHUNK)
  const cursor = want.cursor?.trim() ?? ''

  const beforeCursor = (() => {
    if (!cursor) return events
    const index = events.findIndex((item) => item.eventId === cursor)
    if (index < 0) return events
    return events.slice(0, index)
  })()

  const authorSet = new Set((want.authors ?? []).map((item) => item.trim()).filter(Boolean))
  const tagSet = new Set((want.tags ?? []).map(normalizeTag).filter(Boolean))

  const filtered = beforeCursor.filter((item) => {
    if (authorSet.size > 0 && !authorSet.has(item.authorDid)) return false
    if (tagSet.size > 0) {
      const itemTags = new Set(item.tags.map(normalizeTag))
      const allTagsPresent = Array.from(tagSet).every((wanted) => itemTags.has(wanted))
      if (!allTagsPresent) return false
    }
    return true
  })

  return filtered.slice(0, limit)
}

const buildEventsChunks = (
  items: SyncEvent[],
  options?: { chunkSize?: number; startCursor?: string },
): Array<SyncEnvelope<'events'>> => {
  const chunkSize = clampInt(options?.chunkSize ?? MAX_SYNC_CHUNK, 1, MAX_SYNC_CHUNK)
  const chunks: Array<SyncEnvelope<'events'>> = []
  let cursor = options?.startCursor ?? ''

  if (items.length === 0) {
    chunks.push(
      createEnvelope('events', {
        items: [],
        nextCursor: cursor,
        done: true,
      }),
    )
    return chunks
  }

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunkItems = items.slice(i, i + chunkSize)
    const nextCursor = chunkItems.at(-1)?.eventId ?? cursor
    const done = i + chunkSize >= items.length
    chunks.push(
      createEnvelope('events', {
        items: chunkItems,
        nextCursor,
        done,
      }),
    )
    cursor = nextCursor
  }

  return chunks
}

const readLinesFromSource = async (source: AsyncIterable<Uint8Array>): Promise<string[]> => {
  let buffered = ''
  const lines: string[] = []

  for await (const chunk of source) {
    buffered += decoder.decode(chunk, { stream: true })

    while (true) {
      const newlineIndex = buffered.indexOf('\n')
      if (newlineIndex < 0) break
      const line = buffered.slice(0, newlineIndex + 1)
      buffered = buffered.slice(newlineIndex + 1)
      if (line.trim()) lines.push(line)
    }
  }

  buffered += decoder.decode()
  if (buffered.trim()) {
    lines.push(`${buffered.trim()}\n`)
  }

  return lines
}

const writeLinesToSink = async (stream: SyncStreamLike, lines: string[]): Promise<void> => {
  await stream.sink(
    (async function* (): AsyncIterable<Uint8Array> {
      for (const line of lines) {
        yield encoder.encode(line)
      }
    })(),
  )
}

const toErrorEnvelopeLine = (error: unknown): string =>
  toEnvelopeLine(
    createEnvelope('error', {
      code: 'bad_request',
      message: String(error ?? 'Invalid sync request'),
    }),
  )

export const handlePintoSyncStream = async (stream: SyncStreamLike, deps: PintoSyncDependencies): Promise<void> => {
  try {
    const requestLines = await readLinesFromSource(stream.source)
    const request = parseSyncRequestLines(requestLines)
    const feed = await deps.readEvents(MAX_SYNC_CHUNK)

    const responderHello = createEnvelope('hello', {
      nodeDid: deps.responderNodeDid,
      instance: deps.responderInstance,
      caps: deps.responderCaps ?? ['events.pull', 'events.push', 'tags.filter'],
      limits: {
        maxChunk: MAX_SYNC_CHUNK,
        maxLineBytes: MAX_SYNC_LINE_BYTES,
      },
    })

    const selected = selectEventsForWant(feed, request.want.body)
    const eventChunks = buildEventsChunks(selected, {
      chunkSize: deps.chunkSize,
      startCursor: request.want.body.cursor,
    })

    await writeLinesToSink(
      stream,
      [responderHello, ...eventChunks].map((envelope) => toEnvelopeLine(envelope)),
    )
  } catch (error) {
    await writeLinesToSink(stream, [toErrorEnvelopeLine(error)])
  }
}

export const registerPintoSyncHandler = (libp2p: Libp2pLike, deps: PintoSyncDependencies): void => {
  libp2p.handle(SYNC_PROTOCOL_ID, async ({ stream }) => {
    await handlePintoSyncStream(stream, deps)
  })
}
