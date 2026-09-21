import assert from "node:assert/strict";
import test from "node:test";
import {
  isDismissed, noticeKey, parseLedger, withDismissal,
} from "../../src/lib/noticeLedger.ts";

/**
 * Closing a standing notice silences that sentence, and only that sentence.
 *
 * The replay banner sits over the map until it is dismissed, and staging
 * replays for days, so the dismissal has to outlive the page. Keying it on the
 * message is what keeps that safe: a reworded warning is a new notice, so
 * nothing can be silenced for good by a change nobody reviewed.
 */

const REPLAY = "<b>This is not live weather.</b> The stack is replaying a recorded storm.";

test("a dismissed notice stays dismissed", () => {
  const stored = withDismissal("", REPLAY);
  assert.equal(isDismissed(stored, REPLAY), true);
});

test("a reworded notice is a different notice and still shows", () => {
  const stored = withDismissal("", REPLAY);
  assert.equal(isDismissed(stored, `${REPLAY} Timestamps are rewritten to now.`), false);
});

test("an unrelated notice is unaffected by another's dismissal", () => {
  const stored = withDismissal("", REPLAY);
  assert.equal(isDismissed(stored, "<b>Something went wrong.</b>"), false);
});

test("nothing is dismissed in an empty ledger", () => {
  assert.equal(isDismissed("", REPLAY), false);
  assert.deepEqual(parseLedger(""), []);
});

test("dismissing twice does not grow the ledger", () => {
  const once = withDismissal("", REPLAY);
  assert.equal(withDismissal(once, REPLAY), once);
  assert.equal(parseLedger(once).length, 1);
});

test("several notices coexist", () => {
  const stored = withDismissal(withDismissal("", REPLAY), "Another standing notice.");
  assert.equal(parseLedger(stored).length, 2);
  assert.equal(isDismissed(stored, REPLAY), true);
  assert.equal(isDismissed(stored, "Another standing notice."), true);
});

test("a key is short, stable and free of the message", () => {
  const key = noticeKey(REPLAY);
  assert.equal(key, noticeKey(REPLAY));
  assert.match(key, /^[0-9a-z]{1,7}$/);
  assert.equal(key.includes("live"), false);
});
