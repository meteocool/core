# Dependency Modernization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Modernize dependencies and scripts while preserving behavior and layout.

**Architecture:** Keep runtime logic intact; update package versions, scripts, and icon imports for performance. Remove unused deployment artifacts (Dockerfile) and Windows tooling (cross-env) while retaining Cloudflare flow.

**Tech Stack:** Vite, Svelte, ESLint/Prettier, Cloudflare Wrangler

---

### Task 1: Remove cross-env and normalize scripts

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Step 1: Write the failing test**

Not applicable (no unit test harness). We will validate via lint/typecheck at the end of the plan.

**Step 2: Run test to verify it fails**

Not applicable (see Step 1).

**Step 3: Write minimal implementation**

- Remove `cross-env` from `devDependencies`.
- Replace `cross-env` usage in scripts with POSIX env assignments.
- Remove now-redundant `build-nocrossenv` script.

**Step 4: Run test to verify it passes**

Not applicable (see Step 1).

**Step 5: Commit**

Defer commit until Task 4 completes.

---

### Task 2: Upgrade dependency versions + update icon imports

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/lib/IconRegistry.js`

**Step 1: Write the failing test**

Not applicable (no unit test harness). We will validate via lint/typecheck at the end of the plan.

**Step 2: Run test to verify it fails**

Not applicable (see Step 1).

**Step 3: Write minimal implementation**

- Upgrade `@lucide/svelte`, `eslint-config-prettier`, `nanobar` to current versions.
- Keep `@types/node` on latest 24.x for Node 24.12 LTS alignment.
- Update `IconRegistry` to import icons directly from `@lucide/svelte/icons/*` per current docs.

**Step 4: Run test to verify it passes**

Not applicable (see Step 1).

**Step 5: Commit**

Defer commit until Task 4 completes.

---

### Task 3: Remove Dockerfile (Cloudflare-only deploy)

**Files:**
- Delete: `Dockerfile`

**Step 1: Write the failing test**

Not applicable (no unit test harness). We will validate via lint/typecheck at the end of the plan.

**Step 2: Run test to verify it fails**

Not applicable (see Step 1).

**Step 3: Write minimal implementation**

- Remove `Dockerfile` from repo.
- Confirm no references remain in docs.

**Step 4: Run test to verify it passes**

Not applicable (see Step 1).

**Step 5: Commit**

Defer commit until Task 4 completes.

---

### Task 4: Verification + commit

**Files:**
- Verify: `package.json`, `package-lock.json`, `src/lib/IconRegistry.js`

**Step 1: Write the failing test**

Not applicable (no unit test harness). We will validate via lint/typecheck.

**Step 2: Run test to verify it fails**

Run:
- `npm run lint`
- `npm run typecheck`

Expected: PASS.

**Step 3: Write minimal implementation**

If failures occur, fix them with minimal changes.

**Step 4: Run test to verify it passes**

Re-run:
- `npm run lint`
- `npm run typecheck`

Expected: PASS.

**Step 5: Commit**

```
git add package.json package-lock.json src/lib/IconRegistry.js Dockerfile

git commit --amend --no-edit
```

