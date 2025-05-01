# nexus-scheduler

**AI-powered scheduling engine with natural language booking, real-time availability, and multi-provider support.**

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-336791?style=flat&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat&logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)
![Anthropic](https://img.shields.io/badge/Claude_API-D97757?style=flat)
![WebSockets](https://img.shields.io/badge/WebSockets-010101?style=flat)
![GitHub Actions](https://img.shields.io/badge/CI%2FCD-2088FF?style=flat&logo=github-actions&logoColor=white)

---

## What this is

Nexus Scheduler is a backend service that exposes scheduling as a conversational API. Instead of building rigid UI booking flows, clients send natural language — *"Book me a slot next Tuesday afternoon"* or *"Cancel my 3pm and move it to Thursday"* — and the engine resolves availability, checks constraints, handles conflicts, and confirms atomically.

This is not a chatbot wrapper. It's a structured booking engine with an AI reasoning layer sitting in front of it. The AI handles intent extraction and ambiguity resolution; the booking engine handles correctness and consistency.

**Built to solve a real problem:** most scheduling systems break down at the edges — double-bookings under concurrency, ambiguous user input, timezone handling, recurring event conflicts. This system handles all of them explicitly.

---

## Architecture

```
Client (HTTP / WebSocket)
        │
        ▼
┌─────────────────────┐
│   API Gateway        │  Express + TypeScript
│   Rate limiting      │  100 req/min per tenant
│   JWT auth           │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐        ┌──────────────────────┐
│   Intent Resolver    │──────▶│   Claude API          │
│   (AI layer)         │◀──────│   Tool use / fn call  │
│   Extracts:          │        │   Streaming responses │
│   - action type      │        └──────────────────────┘
│   - time expressions │
│   - participant refs │
└────────┬────────────┘
         │  Resolved intent (structured JSON)
         ▼
┌─────────────────────┐
│   Booking Engine     │  Core domain logic
│   - availability     │  Pessimistic locking via Redis
│   - conflict check   │  PostgreSQL transactions
│   - slot reservation │  Idempotency keys on all writes
│   - confirmation     │
└────────┬────────────┘
         │
    ┌────┴────┐
    ▼         ▼
PostgreSQL   Redis
(source of   (distributed lock,
 truth)       availability cache,
              job queue)
```

**Key design decisions:**

- **Pessimistic locking for slot reservation** — Redis distributed lock held for the duration of a booking transaction. Eliminates double-booking under concurrent load without sacrificing throughput.
- **AI as intent layer only** — Claude resolves ambiguous input into a strict JSON schema. The booking engine never receives raw text. This means the AI can be swapped or versioned without touching business logic.
- **Idempotency keys on all mutations** — every booking, cancellation, and reschedule is idempotent. Safe to retry on network failure.
- **Streaming responses via WebSocket** — the AI reasoning step streams token-by-token to the client so users see progress, not a spinner.

---

## Tech stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Runtime | Node.js 20 + TypeScript | Type safety across the full request lifecycle |
| API | Express.js | Lightweight, well-understood, easy to instrument |
| AI | Anthropic Claude (tool use) | Tool/function calling gives structured JSON output from natural language |
| Real-time | WebSockets (ws) | Streaming AI responses without polling |
| Primary DB | PostgreSQL 15 | ACID transactions for booking consistency |
| Cache / locks | Redis 7 | Distributed locking, availability cache, rate limiting |
| Job queue | BullMQ | Reminder emails, async confirmation events |
| Auth | JWT + refresh tokens | Stateless, scalable across instances |
| Containerisation | Docker + Docker Compose | Full local stack in one command |
| CI/CD | GitHub Actions | Lint → test → build → push on every PR |

---

## Features

- **Natural language booking** — resolves relative time expressions (`next Tuesday`, `end of month`, `in two weeks`), participant references, and duration hints
- **Real-time conflict detection** — availability checked and locked atomically; no race conditions
- **Multi-timezone support** — all times stored as UTC; display timezone per tenant/user config
- **Recurring event scheduling** — daily, weekly, monthly, custom intervals with exception handling
- **Streaming responses** — WebSocket endpoint streams AI reasoning in real time
- **Webhook events** — `booking.created`, `booking.cancelled`, `booking.rescheduled` posted to registered URLs
- **Rate limiting** — per-tenant, per-endpoint, configurable via environment
- **Observability** — structured JSON logging (Pino), request tracing, health endpoints

---

## API

### REST endpoints

```
POST   /api/v1/bookings/intent      # Submit natural language, get structured intent
POST   /api/v1/bookings             # Create booking (structured)
GET    /api/v1/bookings/:id         # Get booking detail
PATCH  /api/v1/bookings/:id         # Reschedule
DELETE /api/v1/bookings/:id         # Cancel
GET    /api/v1/availability         # Query available slots
POST   /api/v1/webhooks             # Register webhook URL
```

### WebSocket

```
ws://host/ws/booking-stream

# Send:
{ "type": "intent", "message": "Book me a slot next Tuesday afternoon", "tenant_id": "..." }

# Receive (streamed):
{ "type": "stream", "delta": "Checking availability for..." }
{ "type": "resolved", "intent": { "action": "create", "datetime": "2026-05-27T14:00:00Z", ... } }
{ "type": "confirmed", "booking": { "id": "...", "slot": "...", "confirmation_code": "..." } }
```

### Natural language examples

```
"Book me next Tuesday at 2pm for 30 minutes"
"Cancel my appointment this Friday"
"Do I have anything on Thursday afternoon?"
"Move my 10am tomorrow to the same time next week"
"Schedule a 1-hour call with John for sometime next Monday"
```

---

## Getting started

**Prerequisites:** Docker, Docker Compose, an Anthropic API key.

```bash
git clone https://github.com/ykachala/nexus-scheduler.git
cd nexus-scheduler
cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env
docker compose up
```

The API is available at `http://localhost:3000`. Postgres on `5432`, Redis on `6379`.

```bash
# Run tests
npm test

# Run with hot reload (local dev without Docker)
npm install
npm run dev
```

### Environment variables

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://user:pass@localhost:5432/nexus
REDIS_URL=redis://localhost:6379
ANTHROPIC_API_KEY=sk-ant-...
JWT_SECRET=your-secret
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=100
```

---

## Performance

Load tested with [k6](https://k6.io) against a 2-vCPU / 4GB instance:

| Scenario | RPS | p95 latency | Error rate |
|----------|-----|-------------|------------|
| Availability queries (cached) | 1,200 | 18ms | 0% |
| Standard booking (DB write) | 340 | 95ms | 0% |
| AI intent resolution (streaming) | 80 | 1.2s first token | 0% |
| Concurrent booking same slot (50 VUs) | — | — | 0% double-bookings |

*AI latency is network-bound to Anthropic's API. All booking engine operations are sub-100ms.*

---

## Deployment

### Docker Compose (single server)

```bash
docker compose -f docker-compose.prod.yml up -d
```

### Kubernetes (Helm chart included)

```bash
helm install nexus-scheduler ./helm/nexus-scheduler \
  --set image.tag=latest \
  --set env.ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
```

### AWS ECS

A Terraform module for ECS + RDS + ElastiCache is included under `infrastructure/terraform/`.

---

## Project structure

```
nexus-scheduler/
├── src/
│   ├── api/              # Route handlers, middleware
│   ├── ai/               # Intent resolver, Claude integration, tool definitions
│   ├── booking/          # Core domain: availability, locking, confirmation
│   ├── queue/            # BullMQ workers: reminders, webhook dispatch
│   ├── websocket/        # WS server and streaming handler
│   ├── db/               # Prisma schema, migrations, query helpers
│   └── config/           # Env, logger, rate limiter setup
├── tests/
│   ├── unit/
│   ├── integration/
│   └── load/             # k6 scripts
├── helm/                 # Kubernetes Helm chart
├── infrastructure/       # Terraform (AWS ECS + RDS + ElastiCache)
├── docker-compose.yml
├── docker-compose.prod.yml
└── .github/workflows/    # CI: lint, test, build, push
```

---

## Related

- [saas-multitenant-kit](https://github.com/ykachala/saas-multitenant-kit) — the multi-tenant foundation this can be embedded into  
- [hookstream](https://github.com/ykachala/hookstream) — handles the webhook delivery for booking events

---

**Author:** Yoweli Kachala &nbsp;|&nbsp; [LinkedIn](https://linkedin.com/in/yoweli-kachala) &nbsp;|&nbsp; Cape Town, South Africa
