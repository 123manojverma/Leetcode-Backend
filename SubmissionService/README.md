# 📬 Submission Service

> The submission orchestration microservice for the LeetCode-Backend platform — responsible for accepting user code submissions, persisting them, dispatching them to the Evaluation Service via a message queue, and tracking their final verdict.

---

## 📌 Table of Contents

- [What Problem Does It Solve?](#-what-problem-does-it-solve)
- [Core Features](#-core-features)
- [Tech Stack](#-tech-stack)
- [Architecture — Layered Design with Factory Pattern](#-architecture--layered-design-with-factory-pattern)
- [Project Structure](#-project-structure)
- [Data Model](#-data-model)
- [Submission Lifecycle — End-to-End Flow](#-submission-lifecycle--end-to-end-flow)
- [API Endpoints](#-api-endpoints)
- [Request & Response Reference](#-request--response-reference)
- [BullMQ Queue — Job Publishing](#-bullmq-queue--job-publishing)
- [Logging & Observability](#-logging--observability)
- [Environment Variables](#-environment-variables)
- [Getting Started](#-getting-started)

---

## ❓ What Problem Does It Solve?

When a user submits code, several things must happen correctly and in order:

| Challenge | Problem |
|-----------|---------|
| **Validation** | Is the problem ID valid? Does the problem actually exist? Is the code and language provided? |
| **Persistence** | The submission must be saved immediately so the user can poll its status |
| **Decoupling** | Code execution is heavy and slow — it must not block the HTTP response |
| **Coordination** | The result from the Evaluation Service must be written back to the correct submission record |
| **Traceability** | Every submission needs a unique ID that ties the HTTP request, the queue job, and the final verdict together |

The **Submission Service** solves all of these by acting as the **coordinator** between the user, the database, and the Evaluation Service:

1. It validates the request and checks the problem exists (via Problem Service API)
2. It saves the submission to MongoDB with status `pending`
3. It publishes an evaluation job to a Redis-backed BullMQ queue with full problem + code context
4. It immediately returns the submission ID to the user (non-blocking)
5. Later, the Evaluation Service calls back via `PATCH /:id/status` to set the final verdict

---

## ✨ Core Features

- 📥 **Submission Ingestion** — Accepts code, language, and problem ID; validates and persists immediately
- 🔗 **Problem Existence Check** — Calls the Problem Service HTTP API to verify the problem exists before persisting
- 📨 **Async Queue Publishing** — Dispatches evaluation jobs to BullMQ (Redis) without blocking the HTTP response
- 🔄 **Status Callback Endpoint** — `PATCH /:id/status` for the Evaluation Service to write back verdicts
- 📋 **Submission History** — Fetch all submissions for a given problem ID
- 🏭 **Factory Pattern** — `SubmissionFactory` manages singleton instances of Repository, Service, and Controller
- 🔁 **Retry with Backoff** — BullMQ jobs are retried up to 3 times with exponential backoff on failure
- 📊 **Structured Logging** — Winston logger with correlation IDs and daily rotating log files

---

## 🛠️ Tech Stack

| Technology | Role |
|-----------|------|
| **Node.js + TypeScript** | Runtime and type safety |
| **Express.js v5** | HTTP server and routing |
| **MongoDB + Mongoose** | Submission persistence and querying |
| **BullMQ** | Distributed job queue for dispatching evaluation jobs |
| **Redis (ioredis)** | BullMQ message broker and job store |
| **Axios** | HTTP client for calling the Problem Service |
| **Zod** | Request body and query parameter validation |
| **Winston** | Structured JSON logging |
| **winston-daily-rotate-file** | Daily log file rotation |
| **UUID** | Correlation ID generation |

---

## 🏗️ Architecture — Layered Design with Factory Pattern

### Layer Flow

```
HTTP Request
     |
     v
+------------------+
|   Router         |  Validates request (Zod) and routes to controller
+------------------+
     |
     v
+------------------+
|   Controller     |  Handles HTTP — delegates to service, sends response
+------------------+
     |
     v
+------------------+
|   Service        |  Business logic:
|                  |  1. Validate problem exists (Problem Service API)
|                  |  2. Persist submission (Repository)
|                  |  3. Publish job to BullMQ queue (Producer)
+------------------+
     |         |
     v         v
+----------+  +------------------+
| Repository|  |   Producer       |
| (MongoDB) |  |   (BullMQ Queue) |
+----------+  +------------------+
```

### Factory Pattern — Singleton DI

The `SubmissionFactory` class manages the creation and reuse of singleton instances across the application — a clean alternative to manual wiring in the router:

```typescript
// SubmissionFactory.ts
static getSubmissionController(): SubmissionController {
    if (!this.submissionController) {
        this.submissionController = new SubmissionController(
            this.getSubmissionService()   // lazily creates service
        );
    }
    return this.submissionController;
}
```

```typescript
// submission.router.ts
const submissionController = SubmissionFactory.getSubmissionController();
```

This ensures there is exactly one instance of each class for the lifetime of the process, with each layer receiving its dependency via constructor injection.

---

## 📁 Project Structure

```
SubmissionService/
├── src/
│   ├── server.ts                      # Entry point: Express app, middleware, routes, DB connection
│   ├── apis/
│   │   └── problem.api.ts             # Axios HTTP client to Problem Service (GET /problems/:id)
│   ├── config/
│   │   ├── index.ts                   # Loads PORT, DB_URL, REDIS_HOST/PORT, PROBLEM_SERVICE from env
│   │   ├── db.config.ts               # Mongoose connection with lifecycle events + SIGINT handler
│   │   ├── logger.config.ts           # Winston logger with daily rotation + correlation ID
│   │   └── redis.config.ts            # ioredis connection factory
│   ├── controllers/
│   │   └── submission.controller.ts   # HTTP handlers: create, getById, getByProblemId, delete, updateStatus
│   ├── factories/
│   │   └── submission.factory.ts      # Singleton factory: Repository -> Service -> Controller
│   ├── middlewares/
│   │   ├── correlation.middleware.ts  # Attaches UUID correlation ID to every request via AsyncLocalStorage
│   │   └── error.middleware.ts        # Global error handlers for AppError and unexpected errors
│   ├── models/
│   │   └── submission.model.ts        # Mongoose schema + enums: SubmissionStatus, SubmissionLanguage
│   ├── producers/
│   │   └── submission.producer.ts     # addSubmissionJob(): adds EvaluationJob to BullMQ queue
│   ├── queues/
│   │   └── submission.queue.ts        # BullMQ Queue instance with retry + exponential backoff config
│   ├── repositories/
│   │   └── submission.repository.ts   # All Mongoose queries: create, findById, findByProblemId, delete, updateStatus
│   ├── routers/
│   │   ├── v1/
│   │   │   ├── index.router.ts        # Mounts submission and ping sub-routers
│   │   │   ├── submission.router.ts   # All /submissions routes, wired via SubmissionFactory
│   │   │   └── ping.router.ts         # Health check routes
│   │   └── v2/
│   │       └── index.router.ts        # v2 router placeholder
│   ├── services/
│   │   └── submission.service.ts      # Core business logic: validate, persist, publish to queue
│   ├── utils/
│   │   ├── errors/
│   │   │   └── app.error.ts           # Custom error classes: BadRequestError, NotFoundError, InternalServerError
│   │   └── helpers/
│   │       └── request.helpers.ts     # AsyncLocalStorage for per-request correlation ID
│   └── validators/
│       ├── index.ts                   # validateRequestBody and validateQueryParams middleware factories
│       └── submission.validator.ts    # Zod schemas: createSubmissionSchema, updateSubmissionStatusSchema, submissionQuerySchema
├── logs/                              # Daily rotating log files (auto-created)
├── .env                               # Environment variable definitions
├── package.json
└── tsconfig.json
```

---

## 🗃️ Data Model

### Submission Schema

```typescript
{
  problemId:      string               // Required — links to a Problem in the Problem Service
  code:           string               // Required — the raw source code submitted by the user
  language:       "cpp" | "python"     // Required — determines which Docker image to use for evaluation
  status:         "pending" | "completed"  // Default: "pending"; updated by Evaluation Service
  submissionData: Record<string, string>   // Map of { testCaseId: verdict } — populated after evaluation
  createdAt:      Date                 // Auto-managed by Mongoose
  updatedAt:      Date                 // Auto-managed by Mongoose
}
```

### Enums

```typescript
enum SubmissionStatus {
  PENDING   = "pending",    // Evaluation not yet complete
  COMPLETED = "completed"   // Evaluation finished; submissionData populated
}

enum SubmissionLanguage {
  CPP    = "cpp",
  PYTHON = "python"
}
```

### MongoDB Indexes

| Index | Type | Purpose |
|-------|------|---------|
| `{ status: 1, createdAt: -1 }` | Compound | Fast querying of pending/completed submissions sorted by recency |

### Response Shape (toJSON Transform)

Mongoose's `toJSON` transform strips `_id` and `__v`, exposing `id` as a clean string:
```json
{
  "id": "507f1f77bcf86cd799439011",
  "problemId": "65abc123def456",
  "code": "print('Hello World')",
  "language": "python",
  "status": "completed",
  "submissionData": {
    "testCaseId_1": "AC",
    "testCaseId_2": "WA"
  },
  "createdAt": "2026-10-08T10:00:00.000Z",
  "updatedAt": "2026-10-08T10:00:05.000Z"
}
```

---

## 🔄 Submission Lifecycle — End-to-End Flow

```
User/Client
    |
    | POST /api/v1/submissions
    | { problemId, code, language }
    v
+----------------------------------------------------------+
|                   SUBMISSION SERVICE                      |
|                                                          |
|  1. Zod validates request body                           |
|                                                          |
|  2. Service: getProblemById(problemId)                   |
|     --> GET {PROBLEM_SERVICE}/problems/:id               |
|     --> If not found: throw NotFoundError (404)          |
|                                                          |
|  3. Service: repository.create(submissionData)           |
|     --> Save to MongoDB with status = "pending"          |
|     --> Returns submission with auto-generated _id       |
|                                                          |
|  4. Service: addSubmissionJob({ submissionId,            |
|              problem, code, language })                  |
|     --> Publish job to BullMQ "submission" queue         |
|                                                          |
|  5. Return 201 with submission { id, status: "pending" } |
+----------------------------------------------------------+
    |                                 |
    | (async, background)             | (immediate response)
    v                                 v
+-------------------+          User gets submission ID
| Evaluation Service|          and can poll for status
|                   |
|  Picks up job     |
|  Runs code in     |
|  Docker containers|
|  Assigns verdicts |
|                   |
|  PATCH /submissions/:id/status
|  { status: "completed",
|    submissionData: { tcId: "AC" } }
+-------------------+
    |
    v
+----------------------------------------------------------+
|                   SUBMISSION SERVICE                      |
|                                                          |
|  6. Validates PATCH body (Zod)                           |
|  7. repository.updateStatus(id, "completed", data)       |
|     --> Mongoose findByIdAndUpdate with returnDocument   |
|  8. Submission document now has verdicts per test case   |
+----------------------------------------------------------+
```

---

## 🔌 API Endpoints

All routes are mounted under `/api/v1/submissions`.

| Method | Path | Description | Validation | Called By |
|--------|------|-------------|-----------|-----------|
| `POST` | `/api/v1/submissions` | Create a new submission | Body (Zod) | User/Client |
| `GET` | `/api/v1/submissions/:id` | Get submission by ID | — | User/Client |
| `GET` | `/api/v1/submissions/problem/:problemId` | Get all submissions for a problem | Query (Zod) | User/Client |
| `DELETE` | `/api/v1/submissions/:id` | Delete a submission by ID | — | User/Client |
| `PATCH` | `/api/v1/submissions/:id/status` | Update submission status + verdicts | Body (Zod) | **Evaluation Service** |
| `GET` | `/api/v1/health` | Health check | — | Any |

---

## 📋 Request & Response Reference

### POST `/api/v1/submissions` — Create Submission

**Request Body:**
```json
{
  "problemId": "507f1f77bcf86cd799439011",
  "code": "def twoSum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i",
  "language": "python"
}
```

**Response `201` — Submission accepted and queued:**
```json
{
  "success": true,
  "message": "Submission created successfully",
  "data": {
    "id": "507f1f77bcf86cd799439011",
    "problemId": "65abc123def456",
    "code": "...",
    "language": "python",
    "status": "pending",
    "submissionData": {},
    "createdAt": "2026-10-08T10:00:00.000Z",
    "updatedAt": "2026-10-08T10:00:00.000Z"
  }
}
```

**Response `404`** — Problem not found:
```json
{ "success": false, "message": "Problem not found or something went wrong" }
```

---

### GET `/api/v1/submissions/:id` — Get Submission by ID

**Response `200`:**
```json
{
  "success": true,
  "message": "Submission fetched successfully",
  "data": {
    "id": "...",
    "status": "completed",
    "submissionData": {
      "testCaseId_1": "AC",
      "testCaseId_2": "WA",
      "testCaseId_3": "TLE"
    }
  }
}
```

**Response `404`** — Submission not found:
```json
{ "success": false, "message": "Submission not found" }
```

---

### GET `/api/v1/submissions/problem/:problemId` — Get All Submissions for a Problem

Returns all submissions linked to the given `problemId`, sorted by creation time.

**Response `200`:**
```json
{
  "success": true,
  "message": "Submissions fetched successfully",
  "data": [ { ... }, { ... } ]
}
```

---

### DELETE `/api/v1/submissions/:id` — Delete Submission

**Response `200`:**
```json
{
  "success": true,
  "message": "Submission deleted successfully"
}
```

---

### PATCH `/api/v1/submissions/:id/status` — Update Submission Status

> This endpoint is called exclusively by the **Evaluation Service** after code execution is complete.

**Request Body:**
```json
{
  "status": "completed",
  "submissionData": {
    "testCaseId_1": "AC",
    "testCaseId_2": "WA",
    "testCaseId_3": "TLE"
  }
}
```

**Response `200`:**
```json
{
  "success": true,
  "message": "Submission status updated successfully",
  "data": { "id": "...", "status": "completed", "submissionData": { ... } }
}
```

---

## 📬 BullMQ Queue — Job Publishing

### Queue Configuration (`src/queues/submission.queue.ts`)

```typescript
new Queue("submission", {
  connection: createNewRedisConnection(),
  defaultJobOptions: {
    attempts: 3,               // Retry up to 3 times on failure
    backoff: {
      type: "exponential",
      delay: 2000              // 2s -> 4s -> 8s retry delays
    }
  }
})
```

### Job Payload (`ISubmissionJob`)

When a submission is created, the producer publishes the following job to the `"submission"` queue:

```typescript
interface ISubmissionJob {
  submissionId: string;       // MongoDB _id of the saved submission
  problem: IProblemDetails;   // Full problem object fetched from Problem Service
                              // (includes testcases with expected outputs)
  code: string;               // User's source code
  language: "cpp" | "python"; // Target language for Docker container selection
}
```

The full `problem` object (including all test cases) is embedded in the job payload — this means the Evaluation Service does **not** need to call the Problem Service separately, reducing latency and inter-service coupling.

### Producer (`src/producers/submission.producer.ts`)

```typescript
const job = await submissionQueue.add("evaluate-submission", data);
// Returns the BullMQ job ID for logging/tracing
```

Errors during job publishing are caught and logged — the submission record is still persisted even if the queue publish fails (the submission remains `pending` and can be retried or investigated).

---

## 📝 Logging & Observability

The service uses **Winston** for structured JSON logging with **daily log rotation**.

### Log Format
```json
{
  "level": "info",
  "message": "Submission job added: 42",
  "timestamp": "10-08-2026 15:45:00",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "data": { "submissionId": "507f1f77bcf86cd799439011" }
}
```

### Transport Configuration
| Transport | Details |
|-----------|---------|
| **Console** | Real-time JSON output to stdout |
| **Daily rotating file** | `logs/YYYY-MM-DD-app.log` |
| Max file size | 20 MB per file |
| Retention | 14 days |

### Controller-Level Logging
The controller logs at each key step with structured context:
- `info` on creating a submission (with body)
- `info` on successful creation (with submission ID)
- `info` on fetching, deleting, updating (with relevant IDs and status)

### Correlation IDs
Every HTTP request receives a UUID correlation ID via `attachCorrelationIdMiddleware`. Stored in `AsyncLocalStorage`, it is injected into every log line from that request — enabling end-to-end tracing from HTTP receipt through DB save through queue publish.

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP server port |
| `DB_URL` | `mongodb://localhost:27017/mydatabase` | MongoDB connection string |
| `REDIS_HOST` | `localhost` | Redis server hostname or IP |
| `REDIS_PORT` | `6379` | Redis server port |
| `PROBLEM_SERVICE` | `http://localhost:3000/api/v1` | Base URL of the Problem Service |

### Sample `.env` File
```env
PORT=3001
DB_URL=mongodb://localhost:27017/lc_submission_db
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
PROBLEM_SERVICE=http://localhost:3000/api/v1
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18+
- **MongoDB** running locally or on a remote host
- **Redis** running locally or on a remote host
- **Problem Service** running and reachable at `PROBLEM_SERVICE` URL

### Installation

```bash
cd SubmissionService
npm install
```

### Running the Service

```bash
# Development with hot-reload (nodemon)
npm run dev

# Production
npm start
```

On startup, the service will:
1. Start the Express HTTP server on the configured `PORT` (default: `3001`)
2. Connect to MongoDB at the configured `DB_URL`

### Verify the Service is Running

```bash
curl http://localhost:3001/api/v1/health
# Response: 200 OK
```

### Quick Test — Submit Code

```bash
curl -X POST http://localhost:3001/api/v1/submissions \
  -H "Content-Type: application/json" \
  -d '{
    "problemId": "<valid-problem-id-from-problem-service>",
    "code": "print(sum(map(int, input().split())))",
    "language": "python"
  }'
```
