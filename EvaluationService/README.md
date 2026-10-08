# 🧪 Evaluation Service

> The secure, sandboxed code execution engine for the LeetCode-Backend platform — responsible for running user-submitted code against test cases and reporting results.

---

## 📌 Table of Contents

- [What Problem Does It Solve?](#-what-problem-does-it-solve)
- [How It Fits in the Architecture](#-how-it-fits-in-the-architecture)
- [Core Features](#-core-features)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [How It Works — End-to-End Workflow](#-how-it-works--end-to-end-workflow)
- [Docker Sandbox — Security & Isolation](#-docker-sandbox--security--isolation)
- [Supported Languages](#-supported-languages)
- [Verdict System](#-verdict-system)
- [Queue & Worker Architecture](#-queue--worker-architecture)
- [API Endpoints](#-api-endpoints)
- [Logging & Observability](#-logging--observability)
- [Environment Variables](#-environment-variables)
- [Getting Started](#-getting-started)

---

## ❓ What Problem Does It Solve?

When a user submits code on a competitive programming platform like LeetCode, several critical challenges need to be addressed:

| Challenge | Problem |
|-----------|---------|
| **Security** | User code is untrusted — it could delete files, make network calls, fork-bomb the server, or escape the process |
| **Fairness** | Each submission must be judged under the same resource limits (CPU, Memory, Time) |
| **Scalability** | Hundreds of submissions can arrive simultaneously; blocking the main server to run code is unacceptable |
| **Correctness** | The output of each test case must be compared precisely against the expected answer |
| **Isolation** | One user's failing/crashing code must not affect another user's submission |

The **Evaluation Service** solves all of these by:
- Running every submission inside an **isolated Docker container** with strict resource limits
- Processing jobs **asynchronously via a BullMQ queue** (backed by Redis) so the HTTP layer is never blocked
- Enforcing **time limits**, **memory caps**, **CPU quotas**, and **network isolation** at the container level
- Automatically reporting verdicts (`AC`, `WA`, `TLE`, `Error`) back to the Submission Service

---

## 🏗️ How It Fits in the Architecture

The Evaluation Service is one microservice in a larger LeetCode-style backend system:

```
+--------------------+         +---------------------+
|   Submission       |         |   Evaluation         |
|   Service          |------>  |   Service            |
|   (port 3001)      |  BullMQ |   (port 3002)        |
|                    |  Queue  |                      |
|  Creates job &     |  (Redis)|  Picks up job,       |
|  pushes to queue   |         |  runs code in Docker |
+--------------------+         |  containers, reports |
                               |  verdict back        |
         +---------------------+         |
         |   Problem Service             |  PATCH verdict
         |   (port 3000)                 v
         |   Supplies test cases  +--------------+
         +------------------------| Submission   |
                                  | Service DB   |
                                  +--------------+
```

- **Submission Service** creates a job with the code, language, and problem data, and pushes it to the Redis-backed BullMQ queue.
- **Evaluation Service** pulls the job, runs the code in Docker containers (one per test case), collects verdicts, and calls back the Submission Service PATCH API to update the submission status.

---

## ✨ Core Features

- 🐳 **Dockerized Code Execution** — Every submission runs in a fresh, ephemeral Docker container
- 🔒 **Security Hardening** — Containers have no network access, limited PIDs, capped CPU/Memory, and no privilege escalation
- ⏱️ **Time Limit Enforcement** — A configurable timeout detects containers that exceed the time limit
- 📋 **Per-Test-Case Evaluation** — Each test case runs independently and in parallel
- 🔁 **Automatic Retries** — Failed BullMQ jobs are retried up to 3 times with exponential backoff
- 📊 **Structured Logging** — Winston logger with daily log rotation and correlation IDs for distributed tracing
- 🚀 **Image Pre-warming** — Docker images are pulled on server start to avoid cold-start delays on first submission
- 🧩 **Multi-language Support** — Currently supports Python and C++ (easily extensible)

---

## 🛠️ Tech Stack

| Technology | Role |
|-----------|------|
| **Node.js + TypeScript** | Runtime and type safety |
| **Express.js v5** | HTTP server |
| **BullMQ** | Distributed job queue |
| **Redis (ioredis)** | BullMQ message broker and job store |
| **Dockerode** | Node.js Docker Engine API client |
| **Docker** | Sandboxed code execution environment |
| **Winston** | Structured logging |
| **winston-daily-rotate-file** | Daily log file rotation |
| **Zod** | Request body validation |
| **Axios** | HTTP calls to other microservices |
| **UUID** | Correlation ID generation |

---

## 📁 Project Structure

```
EvaluationService/
├── src/
│   ├── server.ts                      # Entry point: starts Express, workers, pulls Docker images
│   ├── apis/
│   │   └── submission.api.ts          # PATCH call to Submission Service to report verdict
│   ├── config/
│   │   ├── index.ts                   # Loads and exports environment config
│   │   ├── language.config.ts         # Per-language Docker image and timeout settings
│   │   ├── logger.config.ts           # Winston logger with daily rotation + correlation ID
│   │   └── redis.config.ts            # Redis connection factory (ioredis)
│   ├── controllers/
│   │   └── ping.controller.ts         # Health check controller
│   ├── interfaces/
│   │   └── evaluation.interface.ts    # TypeScript types: EvaluationJob, TestCase, Problem, EvaluationResult
│   ├── middlewares/
│   │   ├── correlation.middleware.ts  # Attaches UUID correlation ID to every request
│   │   └── error.middleware.ts        # Global error handler middleware
│   ├── queues/
│   │   └── submission.queue.ts        # BullMQ Queue with retry and backoff config
│   ├── routers/
│   │   ├── v1/
│   │   │   ├── index.router.ts        # Mounts v1 sub-routers
│   │   │   └── ping.router.ts         # GET /api/v1/ and GET /api/v1/health
│   │   └── v2/
│   │       └── index.router.ts        # v2 router placeholder (extensible)
│   ├── utils/
│   │   ├── constanats.ts              # Queue name, Docker image name constants
│   │   ├── containers/
│   │   │   ├── codeRunner.util.ts     # Core: create, start, wait, read logs, remove container
│   │   │   ├── commands.util.ts       # Shell command generators for each language
│   │   │   ├── createContainer.util.ts# Dockerode wrapper with security/resource constraints
│   │   │   └── pullimage.util.ts      # Pulls Docker images on service startup
│   │   ├── errors/
│   │   │   └── app.error.ts           # Custom error classes (InternalServerError, etc.)
│   │   └── helpers/
│   │       └── request.helpers.ts     # AsyncLocalStorage for per-request correlation ID
│   ├── validators/
│   │   └── ping.validator.ts          # Zod schema for ping endpoint
│   └── workers/
│       └── evaluation.worker.ts       # BullMQ Worker: processes jobs, matches verdicts
├── logs/                              # Daily rotating log files (auto-created)
├── .env                               # Environment variables
├── package.json
└── tsconfig.json
```

---

## 🔄 How It Works — End-to-End Workflow

Here is the complete lifecycle of a code submission, from queue pickup to verdict reporting:

```
Submission Service
      |
      |  Pushes EvaluationJob to BullMQ "submission" queue
      |  { submissionId, code, language, problem: { testcases: [...] } }
      v
+--------------------------------------------------------------+
|                    EVALUATION SERVICE                        |
|                                                              |
|  Step 1: BullMQ Worker picks up the job                      |
|                |                                             |
|  Step 2: For each test case (all run in parallel via         |
|          Promise.all)                                        |
|          |                                                   |
|          v                                                   |
|     createNewDockerContainer()                               |
|     -- Image: python:3.8-slim or gcc:latest                  |
|     -- Cmd: shell command to write code + run with input     |
|     -- HostConfig: memory, CPU, PID, network limits          |
|          |                                                   |
|          v                                                   |
|     container.start()                                        |
|          |                                                   |
|          |--- Start timeout timer (2000ms)                   |
|          |                                                   |
|          v                                                   |
|     container.wait()                                         |
|          |                                                   |
|          |-- If timeout fired --> return { status: "TLE" }   |
|          |                                                   |
|          v                                                   |
|     container.logs()  -- sanitize stdout/stderr output       |
|          |                                                   |
|          v                                                   |
|     container.remove()  -- always clean up                   |
|          |                                                   |
|          v                                                   |
|     Return EvaluationResult { status, output }               |
|                                                              |
|  Step 3: matchTestCasesWithResults()                         |
|     For each testcase, compare result.output to expected     |
|     Assign verdict: AC | WA | TLE | Error                    |
|                                                              |
|  Step 4: updateSubmission() -- PATCH Submission Service      |
|     { status: "completed",                                   |
|       submissionData: { "<testCaseId>": "AC|WA|TLE|Error" }} |
+--------------------------------------------------------------+
      |
      v
   Submission Service DB updated with final verdicts per test case
```

### Detailed Step Breakdown

#### Step 1 — Job Pickup
The BullMQ `Worker` continuously listens on the `"submission"` queue. When a job arrives, it unpacks an `EvaluationJob`:

```typescript
interface EvaluationJob {
  submissionId: string;       // ID of the submission to update
  code: string;               // The user's source code
  language: "python" | "cpp";
  problem: {
    testcases: Array<{
      _id: string;
      input: string;
      output: string;         // Expected output to compare against
    }>;
  };
}
```

#### Step 2 — Parallel Test Case Execution
For every test case, `runCode()` is called concurrently using `Promise.all()`. Each execution:

1. **Generates a shell command** via `commands.util.ts` for the given language
2. **Creates an isolated Docker container** with resource and security constraints
3. **Starts the container** and awaits completion
4. **Checks for TLE** — if the timeout fired before completion, returns a TLE result
5. **Reads and sanitizes container logs** (strips null bytes, ANSI escape codes, control characters)
6. **Checks exit code** — `0` means success, non-zero means runtime/compilation error
7. **Removes the container** to free resources

#### Step 3 — Verdict Matching

`matchTestCasesWithResults()` processes the results array:

| Container Status | Output vs Expected | Verdict |
|-----------------|-------------------|---------|
| `time_limit_exceeded` | — | **TLE** |
| `failed` (non-zero exit) | — | **Error** |
| `success` | Exact match | **AC** |
| `success` | No match | **WA** |

Returns: `{ [testCaseId]: "AC" | "WA" | "TLE" | "Error" }`

#### Step 4 — Reporting Back
The verdict map is sent to the Submission Service:
```
PATCH {SUBMISSION_SERVICE}/submissions/{submissionId}/status
Body: {
  status: "completed",
  submissionData: {
    "testcase_id_1": "AC",
    "testcase_id_2": "WA",
    "testcase_id_3": "TLE"
  }
}
```

---

## 🔒 Docker Sandbox — Security & Isolation

Every container is created with strict constraints via the Docker API to prevent malicious or runaway code:

```typescript
HostConfig: {
  Memory: 1024 * 1024 * 1024,       // 1 GB memory hard limit
  PidsLimit: 100,                    // Max 100 processes (blocks fork bombs)
  CpuQuota: 50000,                   // CPU time cap
  CpuPeriod: 100000,                 // Scheduling period = 50% of one core
  SecurityOpt: ['no-new-privileges'],// Blocks setuid / privilege escalation
  NetworkMode: 'none'                // No internet / LAN access from container
}
```

| Constraint | Value | Purpose |
|-----------|-------|---------|
| Memory limit | 1 GB | Prevents memory exhaustion attacks |
| PID limit | 100 | Prevents fork bombs (`:(){ :|:& };:`) |
| CPU quota | 50% of 1 core | Prevents monopolizing the host CPU |
| Network mode | None | User code cannot call external APIs or exfiltrate data |
| No new privileges | Enabled | User code cannot gain root access |

### Container Stdin / Stdout / Stderr Configuration

Containers are created with:
```typescript
AttachStdin: true,   // Allow input to be sent
AttachStdout: true,  // Capture standard output
AttachStderr: true,  // Capture errors
OpenStdin: true,     // Keep stdin open even without input
Tty: false           // No TTY (raw binary streams)
```

### How Code Runs in the Container

**Python:**
```bash
/bin/sh -c "echo '<CODE>' > code.py && echo '<INPUT>' > input.txt && python3 code.py < input.txt"
```

**C++:**
```bash
/bin/sh -c "echo '<CODE>' > code.cpp && echo '<INPUT>' > input.txt && g++ code.cpp -o code && ./code < input.txt"
```

The code string is echoed into a source file, input is written to `input.txt` and piped via `stdin`, and the program output is captured from `stdout`.

---

## 🌐 Supported Languages

| Language | Docker Image | Timeout | Notes |
|----------|-------------|---------|-------|
| **Python** | `python:3.8-slim` | 2000 ms | Lightweight slim image |
| **C++** | `gcc:latest` | 2000 ms | Full GCC toolchain; compiles then runs |

### Adding a New Language

1. Add the Docker image constant to `src/utils/constanats.ts`
2. Add the command generator function to `src/utils/containers/commands.util.ts`
3. Add the language entry (image + timeout) to `src/config/language.config.ts`
4. Update the `EvaluationJob.language` type union in `src/interfaces/evaluation.interface.ts`

---

## 🏆 Verdict System

| Verdict | Symbol | Meaning |
|---------|--------|---------|
| **AC** | ✅ Accepted | Program output exactly matches the expected output |
| **WA** | ❌ Wrong Answer | Program ran successfully but produced incorrect output |
| **TLE** | ⏱️ Time Limit Exceeded | Program ran longer than the configured timeout (2000ms) |
| **Error** | 💥 Runtime Error | Container exited with a non-zero status code (crash, exception, or C++ compilation failure) |

---

## 📬 Queue & Worker Architecture

### BullMQ Queue (`src/queues/submission.queue.ts`)

```typescript
new Queue("submission", {
  connection: createNewRedisConnection(),
  defaultJobOptions: {
    attempts: 3,               // Retry the job up to 3 times on failure
    backoff: {
      type: "exponential",
      delay: 2000              // 2s -> 4s -> 8s retry delays
    }
  }
})
```

- **Queue name:** `"submission"` (shared constant from `constanats.ts`)
- Jobs are persisted in Redis — survive service restarts
- Queue emits `error` and `waiting` events for monitoring

### BullMQ Worker (`src/workers/evaluation.worker.ts`)

```typescript
new Worker("submission", async (job) => {
  // Process EvaluationJob
  // Run all test cases in parallel
  // Match verdicts
  // Report back to Submission Service
}, {
  connection: createNewRedisConnection()
})
```

- Listens on the `"submission"` queue with a dedicated Redis connection
- Emits `completed`, `failed`, and `error` events
- Each worker process handles one job at a time (default BullMQ concurrency)

### Startup Sequence (`src/server.ts`)

```
app.listen(PORT)
  └─> startWorkers()        // Initialize BullMQ evaluation worker
  └─> pullAllImages()       // Pull python:3.8-slim and gcc:latest in parallel
```

Image pulling on startup ensures Docker images are cached locally before the first job arrives, eliminating cold-start latency.

---

## 🔌 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/health` | Health check — returns `200 OK` |
| `GET` | `/api/v1/` | Ping with Zod-validated body |

> **Important:** The Evaluation Service has **no HTTP endpoint for submitting code**. All code execution is driven exclusively by the BullMQ queue. The HTTP server exists only for health checks and potential future administrative endpoints.

---

## 📝 Logging & Observability

The service uses **Winston** for structured JSON logging with **daily file rotation**.

### Log Format (JSON)
```json
{
  "level": "info",
  "message": "Container created with id abc123def456",
  "timestamp": "10-08-2026 15:30:00",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "data": {}
}
```

### Transport Configuration
| Transport | Details |
|-----------|---------|
| **Console** | Real-time output to stdout |
| **Daily file** | `logs/YYYY-MM-DD-app.log` |
| Max file size | 20 MB per file |
| Retention | 14 days of log files |

### Correlation IDs for Distributed Tracing
The `attachCorrelationIdMiddleware` generates a UUID for every incoming HTTP request and stores it in **Node.js AsyncLocalStorage**. The logger reads this ID from storage on every call, ensuring every log line includes the same correlation ID. This allows you to filter all logs for a specific request/job even across deeply nested function calls.

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3002` | HTTP server port |
| `REDIS_HOST` | `localhost` | Redis hostname or IP address |
| `REDIS_PORT` | `6379` | Redis port |
| `PROBLEM_SERVICE` | `http://localhost:3000/api/v1` | Base URL of the Problem Service |
| `SUBMISSION_SERVICE` | `http://localhost:3001/api/v1` | Base URL of the Submission Service |

### Sample `.env` File
```env
PORT=3002
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
PROBLEM_SERVICE=http://localhost:3000/api/v1
SUBMISSION_SERVICE=http://localhost:3001/api/v1
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18+
- **Docker Desktop** (or Docker Engine) installed and running
- **Redis** accessible at the configured host/port

### Installation

```bash
cd EvaluationService
npm install
```

### Running the Service

```bash
# Development with hot-reload (nodemon)
npm run dev

# Production
npm start
```

### What Happens on Startup

1. Express server starts on configured `PORT` (default `3002`)
2. BullMQ evaluation worker begins listening for jobs on the `"submission"` queue
3. Docker images (`python:3.8-slim`, `gcc:latest`) are pulled in parallel

### Verify It Is Running

```bash
curl http://localhost:3002/api/v1/health
# Response: 200 OK
```
