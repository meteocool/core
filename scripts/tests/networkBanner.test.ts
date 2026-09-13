import assert from "node:assert/strict";
import test from "node:test";
import { shouldShowNetworkBanner } from "../../src/lib/networkBanner.ts";

const base = { effectiveType: null } as const;

test("stays hidden on a healthy connection", () => {
  assert.equal(shouldShowNetworkBanner({ ...base, online: true, isSlow: false }), false);
});

test("shows when offline", () => {
  assert.equal(shouldShowNetworkBanner({ ...base, online: false, isSlow: false }), true);
});

test("shows on a slow connection", () => {
  assert.equal(shouldShowNetworkBanner({ ...base, online: true, isSlow: true }), true);
});

test("stays hidden with no reading at all", () => {
  assert.equal(shouldShowNetworkBanner(null), false);
  assert.equal(shouldShowNetworkBanner(undefined), false);
});
