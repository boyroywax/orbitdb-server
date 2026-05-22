# orbitdb-server

HTTP RPC API server for OrbitDB v2. Kubo-aligned POST-based API with DID identity and optional private network (pnet) support.

## Features

- All OrbitDB v2 store types: events, documents, keyvalue, keyvalue-indexed
- Kubo-aligned RPC API: POST-based `/api/v0/*` endpoints
- Bearer token auth with path-based ACLs
- DID identity (`did:key` + Ed25519) via `@orbitdb/identity-provider-did`
- Private network support via pre-shared swarm key (`@libp2p/pnet`)
- Embedded IPFS (Helia) — no external Kubo node required
- Pinto v1 sync protocol handler on `/pinto/v1.0.0/sync` (config-gated)
- Multi-stage Dockerfile for container deployment

## Quick Start

```bash
npm install
npm run dev          # dev mode with hot reload
# or
npm run build && npm start
```

Server listens on `:3000` (API) and `:4001` (libp2p swarm).

## Configuration

Edit `config/config.json`:

```json
{
  "api": {
    "host": "0.0.0.0",
    "port": 3000,
    "authorizations": {
      "admin": {
        "authSecret": "bearer:your-admin-token",
        "allowedPaths": ["/api/v0/*"]
      },
      "reader": {
        "authSecret": "bearer:your-read-token",
        "allowedPaths": ["/api/v0/db/get", "/api/v0/db/all", "/api/v0/db/query", "/api/v0/id", "/api/v0/health"]
      }
    }
  },
  "libp2p": { "swarmPort": 4001, "bootstrapPeers": [] },
  "orbitdb": { "directory": "./data/orbitdb" },
  "ipfs": { "directory": "./data/ipfs" },
  "pintoSync": {
    "enabled": true,
    "eventsDb": "pinto-v1-events",
    "instance": "orbitdb-server/0.1.0"
  }
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CONFIG_PATH` | `./config/config.json` | Config file path |
| `SWARM_KEY_PATH` | `./config/swarm.key` | Swarm key path |
| `DID_KEY_PATH` | `./config/did.key` | DID seed file path |
| `LIBP2P_FORCE_PNET` | `0` | Set `1` to abort without swarm key |

### Pinto v1 Sync Configuration

`pintoSync` controls whether the libp2p stream handler for Pinto federation sync is registered:

```json
"pintoSync": {
  "enabled": true,
  "eventsDb": "pinto-v1-events",
  "instance": "orbitdb-server/0.1.0"
}
```

- `enabled`: when `true`, registers `/pinto/v1.0.0/sync`; when `false`, no sync stream handler is registered.
- `eventsDb`: OrbitDB events store name used as the sync source feed.
- `instance`: instance string returned in sync `hello` envelopes.

## Authentication

All requests except `/api/v0/health` require Bearer token:

```bash
curl -X POST http://localhost:3000/api/v0/id \
  -H "Authorization: Bearer your-admin-token"
```

## API Reference

All endpoints are `POST`. Params via query string, bodies as JSON.

### Database Lifecycle

```
POST /api/v0/db/create?name=<n>&type=<t>   create/open database
POST /api/v0/db/drop?name=<n>              drop database
POST /api/v0/db/list                       list open databases
```

Types: `events`, `documents`, `keyvalue`, `keyvalue-indexed`

### Data Operations

```
POST /api/v0/db/put?db=<n>&key=<k>    put value (body: JSON)
POST /api/v0/db/get?db=<n>&key=<k>    get by key
POST /api/v0/db/del?db=<n>&key=<k>    delete entry
POST /api/v0/db/all?db=<n>            list all entries
POST /api/v0/db/query?db=<n>          query docs (body: {"filter": {...}})
POST /api/v0/db/add?db=<n>            append to event log (body: JSON)
```

### Swarm

```
POST /api/v0/swarm/peers               list connected peers
POST /api/v0/swarm/connect?addr=<ma>   dial a multiaddr
```

### Private Network

```
POST /api/v0/pnet/status    mode (private/public) + key fingerprint
POST /api/v0/pnet/generate  generate new swarm key (does not auto-apply)
```

### Identity

```
POST /api/v0/id       PeerID, DID, pnet status, addresses
POST /api/v0/health   liveness (no auth required)
```

## Pinto Federation Sync Stream

When `pintoSync.enabled=true`, orbitdb-server also registers a libp2p stream handler on:

- `/pinto/v1.0.0/sync`

Behavior summary:

- Uses NDJSON envelopes matching Pinto v1 wire protocol sync flow (`hello`, `want`, `events`, `error`).
- Responds to inbound sync requests with bounded event chunks (max 200 items/chunk).
- Reads from the configured OrbitDB events store (`pintoSync.eventsDb`) and returns newest-first events.
- Handler registration is explicitly config-gated so operators can disable federation sync without disabling the API server.

## Examples

```bash
TOKEN="your-admin-token"
BASE="http://localhost:3000"

# Create keyvalue store
curl -X POST "$BASE/api/v0/db/create?name=mystore&type=keyvalue" \
  -H "Authorization: Bearer $TOKEN"

# Put a value
curl -X POST "$BASE/api/v0/db/put?db=mystore&key=hello" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '"world"'

# Get a value
curl -X POST "$BASE/api/v0/db/get?db=mystore&key=hello" \
  -H "Authorization: Bearer $TOKEN"

# Create a document store
curl -X POST "$BASE/api/v0/db/create?name=users&type=documents" \
  -H "Authorization: Bearer $TOKEN"

# Insert a document
curl -X POST "$BASE/api/v0/db/put?db=users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"_id": "user1", "name": "Alice", "role": "admin"}'

# Query documents
curl -X POST "$BASE/api/v0/db/query?db=users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"filter": {"role": "admin"}}'

# Create an event log
curl -X POST "$BASE/api/v0/db/create?name=audit&type=events" \
  -H "Authorization: Bearer $TOKEN"

# Append an event
curl -X POST "$BASE/api/v0/db/add?db=audit" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "login", "user": "alice", "ts": "2025-01-01T00:00:00Z"}'

# List all events
curl -X POST "$BASE/api/v0/db/all?db=audit" \
  -H "Authorization: Bearer $TOKEN"
```

## Private Network (pnet)

To run in private network mode, generate and install a swarm key:

```bash
# Generate a key
npm run generate-swarm-key > config/swarm.key

# Or via the API
curl -X POST "$BASE/api/v0/pnet/generate" \
  -H "Authorization: Bearer $TOKEN"
# Save the returned key to config/swarm.key

# Restart the server - it will detect the key and enter private mode
LIBP2P_FORCE_PNET=1 npm start
```

All nodes in the private network must share the same `swarm.key`. Nodes without the key cannot connect.

## Container Deployment

```bash
# Build
podman build -t orbitdb-server .

# Run (public network)
podman run -d --name orbitdb \
  -p 3000:3000 -p 4001:4001 \
  -v ./data/orbitdb:/app/data/orbitdb \
  -v ./data/ipfs:/app/data/ipfs \
  -v ./config:/app/config \
  -e LIBP2P_FORCE_PNET=0 \
  orbitdb-server

# Run (private network)
podman run -d --name orbitdb \
  -p 3000:3000 -p 4001:4001 \
  -v ./data/orbitdb:/app/data/orbitdb \
  -v ./data/ipfs:/app/data/ipfs \
  -v ./config:/app/config \
  -e LIBP2P_FORCE_PNET=1 \
  orbitdb-server
```

## Architecture

```
Fastify (:3000) -> Bearer Auth -> Routes
         |
OrbitDB v2 (events | documents | keyvalue | keyvalue-indexed)
         |
    Helia (IPFS)
         |
libp2p (TCP + WS | Noise | Yamux | mDNS | pnet optional)
```

## Development

```bash
npm run dev                    # tsx watch mode
npm run build                  # compile TypeScript
npm start                      # run compiled output
npm run generate-swarm-key     # generate a pnet swarm key
```

## License

MIT
