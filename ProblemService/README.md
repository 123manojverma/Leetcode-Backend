# 📚 Problem Service

> The central content management microservice for the LeetCode-Backend platform — responsible for storing, managing, and serving coding problems along with their test cases and editorials.

---

## 📌 Table of Contents

- [What Problem Does It Solve?](#-what-problem-does-it-solve)
- [Core Features](#-core-features)
- [Tech Stack](#-tech-stack)
- [Architecture — Layered Design](#-architecture--layered-design)
- [Project Structure](#-project-structure)
- [Data Model](#-data-model)
- [API Endpoints](#-api-endpoints)
- [Request & Response Reference](#-request--response-reference)
- [Markdown Sanitization Pipeline](#-markdown-sanitization-pipeline)
- [Validation](#-validation)
- [Logging & Observability](#-logging--observability)
- [Environment Variables](#-environment-variables)
- [Getting Started](#-getting-started)

---

## ❓ What Problem Does It Solve?

On any competitive programming platform, the problem content layer is the foundation everything else depends on. The **Problem Service** is a dedicated microservice that:

- Acts as the **single source of truth** for all problem data (title, description, difficulty, editorial, test cases)
- Decouples problem management from submission logic, so changes to problems don't require touching submission or evaluation code
- Provides a **clean REST API** that other services (like Evaluation Service) and clients can consume
- Handles **rich text content safely** by sanitizing Markdown input before persisting, preventing XSS and content injection
- Enforces **data integrity** through schema-level validation (Mongoose) and request-level validation (Zod)

---

## ✨ Core Features

- 📝 **Full CRUD for Problems** — Create, read, update, and delete problems via REST API
- 🔍 **Search Problems** — Case-insensitive text search across title and description fields
- 🎯 **Filter by Difficulty** — Fetch only `easy`, `medium`, or `hard` problems
- 🧪 **Embedded Test Cases** — Test cases (input/output pairs) are stored alongside each problem
- 🛡️ **Markdown Sanitization** — Description and editorial fields are sanitized through a 3-step pipeline (Markdown → HTML → sanitize → back to Markdown)
- ✅ **Request Validation** — All create/update endpoints are validated with Zod schemas before reaching the controller
- 📊 **Structured Logging** — Winston logger with correlation IDs and daily rotating log files
- 🏗️ **Layered Architecture** — Clean separation of concerns: Router → Controller → Service → Repository → Model

---

## 🛠️ Tech Stack

| Technology | Role |
|-----------|------|
| **Node.js + TypeScript** | Runtime and type safety |
| **Express.js v5** | HTTP server and routing |
| **MongoDB** | NoSQL database for problem storage |
| **Mongoose** | ODM — schema definition, indexing, querying |
| **Zod** | Runtime request body and param validation |
| **marked** | Converts Markdown input to HTML |
| **sanitize-html** | Strips dangerous HTML tags and attributes |
| **turndown** | Converts sanitized HTML back to clean Markdown |
| **Winston** | Structured JSON logging |
| **winston-daily-rotate-file** | Daily log file rotation |
| **UUID** | Correlation ID generation |
| **dotenv** | Environment variable loading |

---

## 🏗️ Architecture — Layered Design

The service follows a strict layered architecture with clear separation of concerns and constructor-based dependency injection:

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
|   Controller     |  Handles HTTP — extracts params/body, calls service, sends response
+------------------+
     |
     v
+------------------+
|   Service        |  Business logic — sanitization, error throwing, orchestration
+------------------+
     |
     v
+------------------+
|   Repository     |  Data access — all Mongoose queries live here
+------------------+
     |
     v
+------------------+
|   Model          |  Mongoose schema + indexes + toJSON transform
+------------------+
     |
     v
   MongoDB
```

### Dependency Injection Chain

```typescript
// In problem.router.ts — wired at startup
const problemRepository = new ProblemRepository();
const problemService    = new ProblemService(problemRepository);
const problemController = new ProblemController(problemService);
```

Each layer depends only on the interface of the layer below, not the concrete class — making individual layers independently testable.

---

## 📁 Project Structure

```
ProblemService/
├── src/
│   ├── server.ts                      # Entry point: Express app, routes, DB connection
│   ├── config/
│   │   ├── index.ts                   # Loads and exports PORT and DB_URL from env
│   │   ├── db.config.ts               # Mongoose connection with lifecycle event handlers
│   │   └── logger.config.ts           # Winston logger with daily rotation + correlation ID
│   ├── controllers/
│   │   └── problem.controller.ts      # HTTP handlers: create, read, update, delete, search, filter
│   ├── dtos/
│   │   └── problem.dto.ts             # Data Transfer Object definitions (response shaping)
│   ├── middlewares/
│   │   ├── correlation.middleware.ts  # Attaches UUID correlation ID to every request
│   │   └── error.middleware.ts        # Global error handler for AppError and unexpected errors
│   ├── models/
│   │   └── problem.model.ts           # Mongoose schema: Problem + TestCase, with indexes
│   ├── repositories/
│   │   └── problem.repository.ts      # All database queries: CRUD, filter, search
│   ├── routers/
│   │   ├── v1/
│   │   │   ├── index.router.ts        # Mounts problem and ping sub-routers under /api/v1
│   │   │   ├── problem.router.ts      # All /problems routes with DI wiring
│   │   │   └── ping.router.ts         # Health check routes
│   │   └── v2/
│   │       └── index.router.ts        # v2 router placeholder
│   ├── services/
│   │   └── problem.service.ts         # Business logic: sanitize content, validate existence
│   ├── utils/
│   │   ├── markdown.sanitizer.ts      # 3-step Markdown → sanitized HTML → Markdown pipeline
│   │   ├── errors/
│   │   │   └── app.error.ts           # Custom error classes: NotFoundError, BadRequestError
│   │   └── helpers/
│   │       └── request.helpers.ts     # AsyncLocalStorage for per-request correlation ID
│   └── validators/
│       ├── index.ts                   # validateRequestBody and validateRequestParams middleware factories
│       ├── problem.validator.ts        # Zod schemas: createProblemSchema, updateProblemSchema, findByDifficultySchema
│       └── ping.validator.ts          # Zod schema for ping endpoint
├── logs/                              # Daily rotating log files (auto-created)
├── .env                               # Environment variable definitions
├── package.json
└── tsconfig.json
```

---

## 🗃️ Data Model

### Problem Schema

```typescript
{
  title:       string    // Required, unique, max 100 chars
  description: string    // Required, sanitized Markdown
  difficulty:  "easy" | "medium" | "hard"  // Required, default: "easy"
  editorial:   string?   // Optional, sanitized Markdown
  testcases:   TestCase[]
  createdAt:   Date      // Auto-managed by Mongoose timestamps
  updatedAt:   Date      // Auto-managed by Mongoose timestamps
}
```

### TestCase Sub-schema

```typescript
{
  _id:    ObjectId  // Auto-generated (used by Evaluation Service to map verdicts)
  input:  string    // Required, trimmed
  output: string    // Required, trimmed
}
```

### MongoDB Indexes

| Index | Type | Purpose |
|-------|------|---------|
| `title` | Unique | Prevent duplicate problem titles |
| `difficulty` | Non-unique | Fast filtering by difficulty level |

### Response Shape (toJSON Transform)

Mongoose's `toJSON` transform strips `_id` and `__v`, then exposes `id` as a clean string:
```json
{
  "id": "507f1f77bcf86cd799439011",
  "title": "Two Sum",
  "description": "Given an array of integers...",
  "difficulty": "easy",
  "editorial": "Use a hash map...",
  "testcases": [
    { "_id": "...", "input": "nums = [2,7,11,15], target = 9", "output": "0 1" }
  ],
  "createdAt": "2026-10-08T10:00:00.000Z",
  "updatedAt": "2026-10-08T10:00:00.000Z"
}
```

---

## 🔌 API Endpoints

All routes are mounted under `/api/v1/problems`.

| Method | Path | Description | Validation |
|--------|------|-------------|-----------|
| `POST` | `/api/v1/problems` | Create a new problem | Body (Zod) |
| `GET` | `/api/v1/problems` | Get all problems (sorted by newest) | — |
| `GET` | `/api/v1/problems/:id` | Get a single problem by ID | — |
| `PUT` | `/api/v1/problems/:id` | Update a problem by ID | Body (Zod) |
| `DELETE` | `/api/v1/problems/:id` | Delete a problem by ID | — |
| `GET` | `/api/v1/problems/difficulty/:difficulty` | Filter problems by difficulty | Params (Zod) |
| `GET` | `/api/v1/problems/find/search?query=` | Search problems by title or description | Query string |
| `GET` | `/api/v1/health` | Health check | — |

---

## 📋 Request & Response Reference

### POST `/api/v1/problems` — Create Problem

**Request Body:**
```json
{
  "title": "Two Sum",
  "description": "Given an array of integers `nums` and an integer `target`...",
  "difficulty": "easy",
  "editorial": "## Approach\nUse a hash map to track complements...",
  "testcases": [
    { "input": "nums = [2,7,11,15], target = 9", "output": "0 1" },
    { "input": "nums = [3,2,4], target = 6", "output": "1 2" }
  ]
}
```

**Response `201`:**
```json
{
  "message": "Problem created successfully",
  "success": true,
  "data": { "id": "...", "title": "Two Sum", ... }
}
```

---

### GET `/api/v1/problems` — Get All Problems

**Response `200`:**
```json
{
  "message": "Problem fetched successfully",
  "success": true,
  "data": {
    "problems": [ { ... }, { ... } ],
    "total": 42
  }
}
```

---

### GET `/api/v1/problems/:id` — Get Problem by ID

**Response `200`:**
```json
{
  "message": "Problem fetched successfully",
  "success": true,
  "data": { "id": "...", "title": "Two Sum", ... }
}
```

**Response `404`** (if not found):
```json
{ "message": "Problem not found", "success": false }
```

---

### PUT `/api/v1/problems/:id` — Update Problem

**Request Body** (all fields optional):
```json
{
  "difficulty": "medium",
  "editorial": "Updated editorial content..."
}
```

**Response `200`:**
```json
{
  "message": "Problem updated successfully",
  "success": true,
  "data": { ... }
}
```

---

### DELETE `/api/v1/problems/:id` — Delete Problem

**Response `200`:**
```json
{
  "message": "Problem deleted successfully",
  "success": true,
  "data": true
}
```

---

### GET `/api/v1/problems/difficulty/:difficulty` — Filter by Difficulty

**Valid values:** `easy`, `medium`, `hard`

**Response `200`:**
```json
{
  "message": "Problem fetched successfully",
  "success": true,
  "data": [ { ... }, { ... } ]
}
```

---

### GET `/api/v1/problems/find/search?query=two+sum` — Search Problems

Performs a case-insensitive regex search across `title` and `description` fields.

**Response `200`:**
```json
{
  "message": "Problem fetched successfully",
  "success": true,
  "data": [ { ... } ]
}
```

**Response `400`** (if query is empty):
```json
{ "message": "Query is required", "success": false }
```

---

## 🛡️ Markdown Sanitization Pipeline

The `description` and `editorial` fields accept Markdown input. Before persisting to MongoDB, the content is passed through a 3-step sanitization pipeline to prevent XSS and content injection:

```
User Input (Markdown)
        |
        v
  marked.parse()
  Markdown --> HTML
        |
        v
  sanitizeHtml()
  Strip dangerous tags/attributes
  Allow: img, pre, code, a, p, ul, ol, h1-h6, etc.
  Allow attrs: src/alt/title on img, class on code/pre, href on a
  Allow schemes: http, https only
        |
        v
  TurndownService.turndown()
  HTML --> clean Markdown
        |
        v
  Stored in MongoDB as clean Markdown
```

**Why round-trip through HTML?**
Markdown itself has no sanitization standard — going through HTML lets `sanitize-html` apply a well-defined allowlist of safe tags and attributes before converting back to Markdown for consistent storage.

---

## ✅ Validation

### Request Body Validation (Zod)

Applied as middleware before the controller runs:

**Create Problem — required fields:**
| Field | Type | Rules |
|-------|------|-------|
| `title` | `string` | min length: 1 |
| `description` | `string` | min length: 1 |
| `difficulty` | `"easy" \| "medium" \| "hard"` | enum |
| `editorial` | `string` | optional |
| `testcases` | `Array<{input, output}>` | optional; each field min length: 1 |

**Update Problem** — same fields, all optional.

**Filter by difficulty** — param must be one of `easy`, `medium`, `hard`.

If validation fails, the middleware returns `400 Bad Request` with Zod's structured error details before the controller is ever invoked.

---

## 📝 Logging & Observability

The service uses **Winston** for structured JSON logging with **daily log rotation**.

### Log Format
```json
{
  "level": "info",
  "message": "Connected to mongodb successfully",
  "timestamp": "10-08-2026 15:30:00",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "data": {}
}
```

### Log Transports
| Transport | Details |
|-----------|---------|
| **Console** | Real-time JSON output to stdout |
| **Daily rotating file** | `logs/YYYY-MM-DD-app.log` |
| Max file size | 20 MB per file |
| Retention | 14 days |

### Correlation IDs
Every HTTP request gets a UUID correlation ID from `attachCorrelationIdMiddleware`, stored in **AsyncLocalStorage**. The logger reads it automatically on every call — every log line from a single request carries the same ID, enabling full request tracing even across deeply nested service/repository calls.

### Database Lifecycle Logging
The DB config logs:
- `info` — successful connection
- `error` — connection or query errors
- `warn` — disconnection events
- Graceful shutdown on `SIGINT`

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `DB_URL` | `mongodb://localhost:27017/lc_problem_db` | MongoDB connection string |

### Sample `.env` File
```env
PORT=3000
DB_URL=mongodb://localhost:27017/lc_problem_db
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18+
- **MongoDB** running locally or on a remote host (Atlas supported)

### Installation

```bash
cd ProblemService
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
1. Start the Express HTTP server on the configured `PORT` (default: `3000`)
2. Connect to MongoDB at the configured `DB_URL`

### Verify the Service is Running

```bash
curl http://localhost:3000/api/v1/health
# Response: 200 OK
```

### Quick Test — Create a Problem

```bash
curl -X POST http://localhost:3000/api/v1/problems \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Two Sum",
    "description": "Given an array of integers, return indices of the two numbers that add up to target.",
    "difficulty": "easy",
    "testcases": [
      { "input": "nums = [2,7,11,15], target = 9", "output": "0 1" }
    ]
  }'
```
