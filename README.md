# 🚀 LeetCode Backend — Distributed Microservices Platform

> A production-grade, distributed competitive programming and online judge platform built with **Node.js**, **TypeScript**, **Express**, **Docker**, **Redis**, **BullMQ**, and **MongoDB**. Inspired by systems like LeetCode and Codeforces.

---

## 📌 Table of Contents

- [Overview & High-Level Architecture](#-overview--high-level-architecture)
- [System Architecture Diagram](#-system-architecture-diagram)
- [Microservices Breakdown](#-microservices-breakdown)
  - [1. Problem Service (Port 3000)](#1-problem-service-port-3000)
  - [2. Submission Service (Port 3001)](#2-submission-service-port-3001)
  - [3. Evaluation Service (Port 3002)](#3-evaluation-service-port-3002)
- [End-to-End Submission Lifecycle](#-end-to-end-submission-lifecycle)
- [Sandbox & Security Architecture](#-sandbox--security-architecture)
- [Supported Languages & Verdicts](#-supported-languages--verdicts)
- [Unified Tech Stack](#-unified-tech-stack)
- [Consolidated API Reference](#-consolidated-api-reference)
- [Data Models & Queue Contracts](#-data-models--queue-contracts)
- [Environment Variables Reference](#-environment-variables-reference)
- [Getting Started & Local Setup](#-getting-started--local-setup)
- [End-to-End Smoke Test](#-end-to-end-smoke-test)
- [Repository Directory Structure](#-repository-directory-structure)
- [System Design Highlights](#-system-design-highlights)

---

## 🌟 Overview & High-Level Architecture

Online judges face distinct architectural hurdles compared to standard web applications:
1. **Untrusted Code Execution**: Users submit arbitrary source code that could execute malicious commands, read host system files, consume infinite CPU/RAM, or launch network attacks.
2. **Compute-Intensive Workloads**: Compiling and running code against multiple test cases is CPU-bound and slow. It cannot run synchronously inside an HTTP request cycle without crashing or blocking the web server.
3. **Decoupled Workflows**: Problem management, submission tracking, and code evaluation have drastically different operational and scaling requirements.

This project solves these challenges by breaking the system down into **three decoupled microservices**:

```
 ┌─────────────────────────────────────────────────────────────────────────────────┐
 │                                 CLIENT / FRONTEND                               │
 └───────────────────────┬─────────────────────────────────▲───────────────────────┘
                         │ 1. POST /submissions            │ 6. GET /submissions/:id
                         │    (Submit code)                │    (Poll for verdict)
                         ▼                                 │
 ┌─────────────────────────────────────────────────────────┴───────────────────────┐
 │                                SUBMISSION SERVICE                               │
 │                                   (Port 3001)                                   │
 │   - Validates submission payload (code, language: cpp | python)                 │
 │   - Verifies problem via Problem Service HTTP API                               │
 │   - Persists submission with status 'pending'                                   │
 │   - Publishes evaluation job to Redis BullMQ queue ('submission')               │
 │   - Exposes PATCH callback endpoint to receive verdict updates                  │
 └─────────────┬───────────────────────────▲─────────────────────────────┬─────────┘
               │                           │                             │
   2. GET /problems/:id                    │ 5. PATCH /:id/status        │ 3. Push Job
      (Fetch problem & test cases)         │    (Update verdict)         │    (Async)
               ▼                           │                             ▼
 ┌───────────────────────────┐             │                ┌─────────────────────────┐
 │      PROBLEM SERVICE      │             │                │    REDIS BULLMQ QUEUE   │
 │        (Port 3000)        │             │                │      ('submission')     │
 │                           │             │                └────────────┬────────────┘
 │ - Single source of truth  │             │                             │
 │ - Problem CRUD & Search   │             │                             │ 4. Pull Job
 │ - Test cases & Editorials │             │                             │    (Worker)
 │ - Markdown Sanitization   │             │                             ▼
 └───────────────────────────┘ ┌───────────┴─────────────────────────────────────────┐
                               │                 EVALUATION SERVICE                  │
                               │                    (Port 3002)                      │
                               │                                                     │
                               │   - Consumes jobs from BullMQ queue                 │
                               │   - Runs test cases in parallel via Docker          │
                               │   - Container limits: 1GB RAM, Network: none, CPU   │
                               │   - Evaluates: python (3.8-slim) & cpp (gcc:latest) │
                               │   - Computes verdicts per testcase: AC, WA, TLE,    │
                               │     Error                                           │
                               │   - Calls back to Submission Service status API     │
                               └──────────────────────────┬──────────────────────────┘
                                                          │ Spawns & Controls
                                                          ▼
                                             ┌─────────────────────────┐
                                             │     DOCKER ENGINE       │
                                             │   (Sandboxed Container) │
                                             └─────────────────────────┘
```

---

## 🧩 Microservices Breakdown

### 1. Problem Service (Port 3000)
> **Role**: Content management microservice for coding problems, test cases, and editorials.

- **Primary Responsibility**: Acts as the single source of truth for problem content.
- **Database**: MongoDB (Collection: `problems`).
- **Key Features**:
  - Full CRUD operations for coding problems (`easy`, `medium`, `hard`).
  - Search problems by keyword across title and description.
  - Filter problems by difficulty level.
  - Stores input/output test case pairs (`testcases`) used by the judge.
  - 3-step Markdown sanitization pipeline:
    `Markdown Input` ➔ `marked (HTML)` ➔ `sanitize-html (Strips dangerous tags)` ➔ `turndown (Clean Markdown)`.
  - Schema-level and request-level validation using Zod and Mongoose.
  - Structured logging with Winston and correlation ID tracking.

### 2. Submission Service (Port 3001)
> **Role**: Submission orchestration, ingestion, tracking, and queue dispatch.

- **Primary Responsibility**: Coordinates between the user, the database, and the asynchronous evaluation pipeline.
- **Database**: MongoDB (Collection: `submissions`).
- **Message Broker**: Redis via BullMQ.
- **Key Features**:
  - Ingests code submissions and validates that language is strictly `cpp` or `python`.
  - Calls Problem Service HTTP API (`GET /api/v1/problems/:id`) to ensure the problem exists and to retrieve its test cases.
  - Creates and persists a submission record with status `pending`.
  - Publishes an evaluation job containing user code, language, and problem test cases to Redis BullMQ (`submission` queue).
  - Returns the generated submission record immediately to the caller without waiting for code execution.
  - Exposes an internal status callback (`PATCH /api/v1/submissions/:id/status`) for the Evaluation Service to update status to `completed` and store per-testcase results in `submissionData`.
  - Implements the **Factory Pattern** (`SubmissionFactory`) to manage singleton instances of repositories, services, and controllers.

### 3. Evaluation Service (Port 3002)
> **Role**: Sandboxed code execution engine and automated judge.

- **Primary Responsibility**: Consumes evaluation jobs from BullMQ, safely executes code in isolated Docker containers, and assigns verdicts.
- **Container Runtime**: Docker via Dockerode.
- **Message Consumer**: BullMQ Worker listening on `submission` queue.
- **Key Features**:
  - Automatically pulls required base images on startup (`python:3.8-slim` and `gcc:latest`).
  - Pulls jobs off Redis asynchronously.
  - Spawns disposable, ephemeral Docker containers for each test case run in parallel using `Promise.all()`.
  - Limits memory to 1GB (`1024 * 1024 * 1024`), sets `CpuQuota: 50000`, `CpuPeriod: 100000`, `PidsLimit: 100`, and `SecurityOpt: ['no-new-privileges']`.
  - Completely disables container networking (`NetworkMode: 'none'`) to prevent outbound data exfiltration, port scanning, or malicious network requests.
  - Compiles and runs user code against every input test case and compares the sanitized output with expected outputs.
  - Assigns per-testcase verdicts: `AC`, `WA`, `TLE`, or `Error`.
  - Calls back to Submission Service (`PATCH /api/v1/submissions/:id/status`) via Axios HTTP to mark status as `completed` and save `submissionData`.

---

## 🔄 End-to-End Submission Lifecycle

Below is the chronological sequence of a code submission from initial click to final result:

```
User/Client           SubmissionService           ProblemService            BullMQ/Redis           EvaluationService           Docker
    │                         │                         │                         │                        │                     │
    │  1. POST /submissions   │                         │                         │                        │                     │
    ├────────────────────────>│                         │                         │                        │                     │
    │                         │  2. GET /problems/:id   │                         │                        │                     │
    │                         ├────────────────────────>│                         │                        │                     │
    │                         │  3. Return problem JSON │                         │                        │                     │
    │                         │<────────────────────────┤                         │                        │                     │
    │                         │                                                   │                        │                     │
    │                         │  4. Save submission (status: 'pending')           │                        │                     │
    │                         │  5. Push job to 'submission' queue                │                        │                     │
    │                         ├──────────────────────────────────────────────────>│                        │                     │
    │  6. 201 Created (ID)    │                                                   │                        │                     │
    │<────────────────────────┤                                                   │                        │                     │
    │                         │                                                   │  7. Pull job           │                     │
    │                         │                                                   │<───────────────────────┤                     │
    │                         │                                                   │                        │  8. Create Container│
    │                         │                                                   │                        ├────────────────────>│
    │                         │                                                   │                        │  9. Run test cases  │
    │                         │                                                   │                        │<───────────────────>│
    │                         │                                                   │                        │ 10. Destroy Container
    │                         │                                                   │                        ├────────────────────>│
    │                         │                                                   │                        │                     │
    │                         │  11. PATCH /submissions/:id/status                │                        │                     │
    │                         │      { status: "completed", submissionData }      │                        │                     │
    │                         │<───────────────────────────────────────────────────────────────────────────┤                     │
    │                         │  12. Update record in DB                          │                        │                     │
    │                         │                                                                                                  │
    │  13. GET /submissions/:id (Poll)                                                                                           │
    ├────────────────────────>│                                                                                                  │
    │  14. Return Final Result│                                                                                                  │
    │<────────────────────────┤                                                                                                  │
```

---

## 🛡️ Sandbox & Security Architecture

Running user-supplied code is the highest risk component of any competitive programming system. The **Evaluation Service** applies multi-layered container isolation:

| Security Vector | Mitigation Strategy | Implementation Details in `createContainer.util.ts` |
|---|---|---|
| **Malicious Network Access** | Complete network isolation | `NetworkMode: 'none'`. Code cannot ping, fetch, connect to Redis, database, or any external hosts. |
| **Infinite Loops / DoS** | Wall-clock execution timeout | Timers enforce timeout (default `2000ms`). Containers exceeding time are assigned `TLE` and removed. |
| **Fork Bombs / Process Exhaustion** | Process limits | `PidsLimit: 100` strictly prevents fork bombs and uncontrolled process spawning. |
| **CPU Starvation** | CPU quotas | `CpuQuota: 50000` and `CpuPeriod: 100000` restrict CPU execution time to a strict fraction of CPU cores. |
| **Memory Exhaustion (OOM)** | Memory allocation limits | `Memory: 1024 * 1024 * 1024` (1GB) ceiling prevents host memory starvation. |
| **Privilege Escalation** | Security options | `SecurityOpt: ['no-new-privileges']` prevents child processes from gaining elevated root privileges. |
| **Host Filesystem Tampering** | Ephemeral containers | Code runs inside temporary containers; files (`code.py`, `code.cpp`, `input.txt`) are isolated to the container and destroyed after execution. |
| **Input / Injection Attacks** | Markdown sanitization & Zod | Problem descriptions are sanitized via `sanitize-html`. All request bodies are strictly validated with Zod schemas. |

---

## ⚖️ Supported Languages & Verdicts

### Supported Programming Languages

Currently, the backend supports **Python** and **C++**:

| Language | Identifier | Docker Image | Compilation / Execution Command | Timeout |
|---|---|---|---|---|
| **Python** | `python` | `python:3.8-slim` | `python3 code.py < input.txt` | `2000ms` |
| **C++** | `cpp` | `gcc:latest` | `g++ code.cpp -o code && ./code < input.txt` | `2000ms` |

> *Note: Submissions with any other language (e.g. Java, JavaScript) are rejected by the Submission Service validator with: `"Language must be either 'cpp' or 'python'"`. Additional language runtimes can be added in `language.config.ts`, `constanats.ts`, and `commands.util.ts`.*

---

### Judge Verdict Reference

Verdicts are calculated per testcase by comparing sanitized container output against expected output:

| Verdict Code | Full Name | Explanation |
|:---:|---|---|
| `AC` | **Accepted** | Solution executed successfully and its output matches the expected test case output. |
| `WA` | **Wrong Answer** | Solution executed successfully, but its output did not match expected output. |
| `TLE` | **Time Limit Exceeded** | Code exceeded the allocated time limit (`2000ms`). |
| `Error` | **Runtime / Compilation Error** | Container process returned a non-zero exit code (`status.StatusCode != 0`), such as compile failures or unhandled exceptions. |

---

## 🛠️ Unified Tech Stack

| Layer | Technologies | Role / Description |
|---|---|---|
| **Runtime & Language** | Node.js (v20+), TypeScript (v5.8+) | Unified strong typing across all services |
| **Web Framework** | Express.js (v5.x) | HTTP server, middleware chaining, routing |
| **Databases** | MongoDB, Mongoose (v8.x) | Document storage for problems and submissions |
| **Queue & Broker** | Redis (ioredis v6), BullMQ (v6.x) | Distributed asynchronous queue for code evaluation jobs |
| **Sandboxing Engine** | Docker Engine, Dockerode (v5.x) | Programmatic container creation, execution, and cleanup |
| **Validation** | Zod (v3.24+) | Runtime schema validation for query params and request bodies |
| **Markdown Processing** | `marked`, `sanitize-html`, `turndown` | 3-step Markdown sanitization to eliminate XSS risks |
| **Logging & Tracing** | Winston (v3.17+), Winston Daily Rotate File, UUID | Structured logging with per-request correlation IDs |
| **HTTP Client** | Axios (v1.20+) | Inter-service REST communication |

---

## 📡 Consolidated API Reference

### 1. Problem Service (`http://localhost:3000`)

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `GET` | `/api/v1/health` | Health check endpoint | Public |
| `POST` | `/api/v1/problems` | Create a new problem with testcases and editorial | Public / Admin |
| `GET` | `/api/v1/problems` | List problems with optional search and difficulty filter | Public |
| `GET` | `/api/v1/problems/:id` | Get full problem details by ID (including testcases) | Public / Inter-service |
| `PUT` | `/api/v1/problems/:id` | Update an existing problem by ID | Public / Admin |
| `DELETE` | `/api/v1/problems/:id` | Delete a problem by ID | Public / Admin |

#### Query Parameters for `GET /api/v1/problems`:
- `search` *(string, optional)*: Case-insensitive search query against title and description.
- `difficulty` *(string, optional)*: Filter by `easy`, `medium`, or `hard`.

---

### 2. Submission Service (`http://localhost:3001`)

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `GET` | `/api/v1/health` | Health check endpoint | Public |
| `POST` | `/api/v1/submissions` | Create a new submission and enqueue for evaluation | Public |
| `GET` | `/api/v1/submissions/:id` | Get submission status and testcase verdicts | Public |
| `GET` | `/api/v1/submissions/problem/:problemId` | List all submissions for a specific problem | Public |
| `PATCH` | `/api/v1/submissions/:id/status` | Update submission status and per-testcase verdicts | **Internal (Evaluation Service)** |

---

### 3. Evaluation Service (`http://localhost:3002`)

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `GET` | `/api/v1/health` | Health check endpoint | Public |
| *Queue Worker* | `submission` queue | Listens on Redis BullMQ queue for new submission jobs | Internal Worker |

---

## 📄 Data Models & Queue Contracts

### Problem Document Model (`ProblemService`)
```typescript
{
  _id: string;
  title: string;
  description: string;       // Sanitized Markdown
  difficulty: "easy" | "medium" | "hard";
  editorial?: string;        // Sanitized Markdown
  testcases: Array<{
    _id?: string;
    input: string;
    output: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}
```

### Submission Document Model (`SubmissionService`)
```typescript
{
  id: string;
  problemId: string;
  code: string;
  language: "cpp" | "python";
  status: "pending" | "completed";
  submissionData: Record<string, "AC" | "WA" | "TLE" | "Error">; // Maps testcase _id to verdict
  createdAt: Date;
  updatedAt: Date;
}
```

### BullMQ Job Data Contract (`EvaluationJob`)
```typescript
{
  submissionId: string;
  code: string;
  language: "python" | "cpp";
  problem: {
    id: string;
    title: string;
    description: string;
    difficulty: string;
    editorial?: string;
    testcases: Array<{
      _id: string;
      input: string;
      output: string;
    }>;
  };
}
```

---

## ⚙️ Environment Variables Reference

Each microservice contains its own `.env` file. Below is the configuration reference:

### 1. Problem Service (`ProblemService/.env`)
```env
PORT=3000
DB_URL=mongodb://localhost:27017/problem_service
```

### 2. Submission Service (`SubmissionService/.env`)
```env
PORT=3001
DB_URL=mongodb://localhost:27017/submission_service
REDIS_PORT=6379
REDIS_HOST=127.0.0.1
PROBLEM_SERVICE_URL=http://localhost:3000/api/v1
```

### 3. Evaluation Service (`EvaluationService/.env`)
```env
PORT=3002
REDIS_PORT=6379
REDIS_HOST=127.0.0.1
PROBLEM_SERVICE=http://localhost:3000/api/v1
SUBMISSION_SERVICE=http://localhost:3001/api/v1
```

---

## 🚀 Getting Started & Local Setup

### Prerequisites
Before running the services, ensure you have the following installed:
1. **Node.js** (v20+ recommended) & **npm**
2. **MongoDB** (running locally on port `27017` or via Docker)
3. **Redis** (running locally on port `6379` or via Docker)
4. **Docker Desktop** (running, to execute sandboxed containers)

---

### Step 1: Clone Repository
```bash
git clone https://github.com/123manojverma/Leetcode-Backend.git
cd LeetcodeBackend
```

---

### Step 2: Spin Up Infrastructure (MongoDB & Redis)
If you run MongoDB and Redis via Docker:
```bash
# Start MongoDB
docker run -d --name leetcode-mongo -p 27017:27017 mongo:latest

# Start Redis
docker run -d --name leetcode-redis -p 6379:6379 redis:alpine
```

---

### Step 3: Install Dependencies & Start Services

Open three terminal windows:

#### Terminal 1 — Problem Service
```bash
cd ProblemService
npm install
npm run dev
```

#### Terminal 2 — Submission Service
```bash
cd SubmissionService
npm install
npm run dev
```

#### Terminal 3 — Evaluation Service
```bash
cd EvaluationService
npm install
npm run dev
```
*(On startup, Evaluation Service will automatically pull `python:3.8-slim` and `gcc:latest` Docker images if not already cached).*

---

### Step 4: Verify Services Health

Check that all three services are up:

```bash
# 1. Problem Service
curl http://localhost:3000/api/v1/health

# 2. Submission Service
curl http://localhost:3001/api/v1/health

# 3. Evaluation Service
curl http://localhost:3002/api/v1/health
```

---

## 🧪 End-to-End Smoke Test

Here is a quick curl walkthrough to test the entire lifecycle:

### Step 1: Create a Problem
```bash
curl -X POST http://localhost:3000/api/v1/problems \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Square of Number",
    "description": "Given an integer n, print its square.",
    "difficulty": "easy",
    "testcases": [
      {
        "input": "5",
        "output": "25"
      }
    ]
  }'
```
*Take note of the returned `id` (e.g. `6705187e1f40957f89abc123`).*

---

### Step 2: Submit a Solution (Python)
```bash
curl -X POST http://localhost:3001/api/v1/submissions \
  -H "Content-Type: application/json" \
  -d '{
    "problemId": "<REPLACE_WITH_PROBLEM_ID>",
    "language": "python",
    "code": "n = int(input())\nprint(n * n)"
  }'
```
*Response immediately returns HTTP 201 with `id` and `status: "pending"`.*

---

### Step 3: Check Execution & Final Verdict
Wait a moment for BullMQ and Docker to execute the code, then query:

```bash
curl http://localhost:3001/api/v1/submissions/<REPLACE_WITH_SUBMISSION_ID>
```

You will receive the updated submission with per-testcase verdicts:
```json
{
  "success": true,
  "message": "Submission fetched successfully",
  "data": {
    "id": "6705188f1f40957f89abc456",
    "problemId": "6705187e1f40957f89abc123",
    "code": "n = int(input())\nprint(n * n)",
    "language": "python",
    "status": "completed",
    "submissionData": {
      "6705187e1f40957f89abc124": "AC"
    }
  }
}
```

---

## 📂 Repository Directory Structure

```
LeetcodeBackend/
│
├── README.md                          # Master Project Documentation (You are here)
│
├── ProblemService/                    # Problem Management Microservice (:3000)
│   ├── src/
│   │   ├── config/                    # Server & DB configuration
│   │   ├── controllers/               # Problem CRUD controllers
│   │   ├── errors/                    # Custom AppErrors
│   │   ├── middlewares/               # Zod validation & correlation IDs
│   │   ├── models/                    # Problem & testcases schema
│   │   ├── repositories/              # MongoDB repository
│   │   ├── routers/                   # Express routes
│   │   ├── services/                  # Business logic & Markdown sanitization
│   │   ├── utils/                     # Markdown sanitizers & loggers
│   │   └── server.ts                  # Entry point
│   ├── .env                           # Environment variables
│   ├── package.json
│   └── README.md                      # Problem Service Docs
│
├── SubmissionService/                 # Submission Orchestrator Microservice (:3001)
│   ├── src/
│   │   ├── apis/                      # ProblemService API HTTP client
│   │   ├── config/                    # Server, DB & Redis configuration
│   │   ├── controllers/               # Submission controller
│   │   ├── factories/                 # Singleton factory (SubmissionFactory)
│   │   ├── middlewares/               # Validation & correlation IDs
│   │   ├── models/                    # Submission schema (cpp | python)
│   │   ├── producers/                 # BullMQ queue producer
│   │   ├── queues/                    # BullMQ queue ('submission')
│   │   ├── repositories/              # Submission repository
│   │   ├── routers/                   # Express submission routes
│   │   ├── services/                  # Submission service logic
│   │   ├── validators/                # Zod schemas (cpp | python only)
│   │   └── server.ts                  # Entry point
│   ├── .env                           # Environment variables
│   ├── package.json
│   └── README.md                      # Submission Service Docs
│
└── EvaluationService/                 # Code Execution Sandbox Microservice (:3002)
    ├── src/
    │   ├── apis/                      # SubmissionService callback HTTP client
    │   ├── config/                    # Server, Redis, Logger & Language config
    │   ├── interfaces/                # EvaluationJob, TestCase interfaces
    │   ├── utils/
    │   │   └── containers/            # Dockerode container creation & runner
    │   ├── workers/                   # BullMQ worker ('submission' queue)
    │   └── server.ts                  # Entry point (auto-pulls python & gcc images)
    ├── .env                           # Environment variables
    ├── package.json
    └── README.md                      # Evaluation Service Docs
```

---

## 💡 System Design Highlights

1. **Separation of Concerns**: Problem management operates independently from high-throughput code submissions and CPU-heavy Docker execution.
2. **Non-Blocking Architecture**: Submissions return immediately (`HTTP 201 Created`) with an ID. Code evaluation is processed asynchronously via Redis BullMQ.
3. **Multi-Layer Container Sandboxing**: Containers have networking disabled (`NetworkMode: 'none'`), process limits (`PidsLimit: 100`), CPU quotas, memory limits (1GB), and strict wall-clock timeouts.
4. **Resiliency & Fault Tolerance**: Jobs persist in Redis BullMQ. If an individual container throws a runtime error or segmentation fault, the worker catches the exit code, marks the test case as `Error`, and continues processing.
5. **Observability**: UUID correlation IDs are attached to every incoming request and propagated across logs.

## 👨‍💻 Contributing & Contact

Contributions, bug reports, and suggestions are welcome! Feel free to open an issue or pull request on the [GitHub repository](https://github.com/123manojverma/Leetcode-Backend).

---

> ⚡ **LeetCode-Backend** — Designed and engineered for secure, isolated, and high-concurrency online code evaluation.
