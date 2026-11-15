'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

// knownBug(id, name, fn): `fn` asserts the CORRECT behavior.
//   - While the bug exists, fn fails an assertion and this test passes.
//   - Once the bug is fixed, fn passes and this test FAILS, telling you to change
//     knownBug(...) into test(...) so the fix stays covered.
// Only assertion failures count as "bug still present"; any other error (a broken
// fixture, a TypeError in the test itself) fails the test so it can't hide problems.
function knownBug(id, name, fn) {
  test(`[known bug ${id}] ${name}`, async (t) => {
    try {
      await fn(t);
    } catch (e) {
      if (e instanceof assert.AssertionError) {
        t.diagnostic(`bug ${id} still present: ${e.message.split('\n')[0]}`);
        return;
      }
      throw e;
    }
    assert.fail(`Bug ${id} looks fixed. Change knownBug(...) to test(...) in this file.`);
  });
}

module.exports = { knownBug };
