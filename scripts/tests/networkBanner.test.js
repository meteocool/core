import assert from 'node:assert/strict'
import { shouldShowNetworkBanner } from '../../src/lib/networkBanner.js'

assert.equal(shouldShowNetworkBanner({ online: true, isSlow: false }), false)
assert.equal(shouldShowNetworkBanner({ online: false, isSlow: false }), true)
assert.equal(shouldShowNetworkBanner({ online: true, isSlow: true }), true)
