# TransitOps — Smart Transport Operations Platform

TransitOps is a modern, responsive fleet management and operations platform designed to streamline vehicle registry, driver assignments, trip dispatches, maintenance logging, fuel and expense tracking, and real-time operational analytics.

---

## Features

- **Authentication & Lockout**: Secure credentials validation with role-based access control (RBAC). Locks out accounts temporarily for brute-force mitigation after 5 failed login attempts.
- **Centralized Rules Engine**: Enforces atomic state transitions on vehicle and driver statuses, serving as the single source of truth for business validations.
- **Trips Management**: Supports draft, dispatch, cancel, and complete transitions. Enforces cargo weight capacity checks and dynamic driver license validity tests.
- **Maintenance Records**: Tracks vehicle servicing logs. Prevents duplicate active maintenance logs and updates vehicle status automatically.
- **Fuel & Expense Tracking**: Logs fuel quantity and costs, adds miscellaneous toll/other costs, and dynamically computes overall vehicle operational expenditures.
- **Live Dashboard**: Provides a unified dashboard containing key metrics like fleet utilization %, driver availability, vehicle status counts, and recent trips with filters.
- **Fleet Analytics & CSV Export**: Displays ROI metrics, fuel efficiency, operational costs, and supports a direct CSV download of analytics reports.
- **Settings & RBAC Editor**: Fleet Manager portal to configure depot metadata and manage permissions matrices.

---

## Tech Stack

- **Backend**: Node.js, Express, SQLite3 (embedded relational database)
- **Frontend**: Vanilla HTML5, CSS3, JavaScript (glassmorphic single-page application)
- **Database**: SQLite (SQL query-driven schema)

---

## Installation & Setup

### 1. Prerequisites
Ensure you have [Node.js](https://nodejs.org/) installed (v18+ recommended).

### 2. Clone and Install Dependencies
Navigate to the project root directory and run:
```bash
npm install
```

### 3. Environment Configuration
Create a `.env` file in the root directory (or use default values automatically applied by the app):
```env
PORT=3000
JWT_SECRET=transitops_super_secret_jwt_key
```

### 4. Run the Application
Start the development server:
```bash
npm run dev
```
The server will boot on `http://localhost:3000`. On first boot, the SQLite database `shared/transitops.db` will be automatically initialized, tables created, and seeded with mock and default data.

---

## User Roles & Credentials

To test the application, log in with the following seeded credentials on the login screen:

| Role | Email | Password | Allowed Modules / Tabs |
|---|---|---|---|
| **Fleet Manager** | `manager@transitops.in` | `Password123` | Dashboard, Maintenance (Edit), Settings & RBAC |
| **Dispatcher** | `dispatcher@transitops.in` | `Password123` | Dashboard, Trips (Edit), Maintenance (View) |
| **Financial Analyst** | `finance@transitops.in` | `Password123` | Dashboard, Fuel & Expenses, Analytics |
| **Safety Officer** | `safety@transitops.in` | `Password123` | Dashboard |

---

## Verification & Testing

### Standalone Rules Engine Tests
Verify atomic state transitions and business rules:
```bash
node rules-engine/test-transitions.js
```

### API Integration Tests
Verify REST endpoints and role permissions under a running server:
1. Start the server (`npm run dev` or `node server.js`).
2. Run the integration test suite:
```bash
node rules-engine/test-api.js
```