# Steakz International (Multi-Branch)

This project implements strict branch scoping and RBAC for a multi-branch restaurant system.

## Key Rules
- All users operate inside ONE active branch context.
- ADMIN can switch `activeBranchId`; non-admins are locked to `user.branchId`.
- No endpoint returns mixed-branch data.
- Branch selector visible ONLY to ADMIN in the UI.

## Admin Endpoints
- POST /api/admin/staff
  - Create login + staff entry (same entity).
  - Body: `{ email, password, role: MANAGER|CHEF|STAFF, branchId }`
- PATCH /api/admin/staff/:id/reset-password
  - Body: `{ password }`

## Branches Endpoint
- GET /api/branches
  - ADMIN: all branches
  - Non-admin: only own branch

## Active Branch
- PATCH /api/users/:id/active-branch (ADMIN only)
  - Sets `activeBranchId` for ADMIN users; non-admins cannot switch.

## Frontend UX
- Branch selector appears only for ADMIN.
- Staff management: single "Add Staff" modal; optimistic append to table.
- Inventory: ADMIN + MANAGER only; branch-scoped.
- Route protection via `ProtectedRoute`.

## Quick Start
Backend (from repo root):

```bash
npm install
npm run dev
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Test Requests
Use `test-requests.http` in this folder with REST Client or paste into curl; set `{{ADMIN_TOKEN}}` and ids accordingly.
