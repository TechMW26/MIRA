import test from 'node:test';
import assert from 'node:assert/strict';
import { miraRobotState, MIRA_ROBOT_COLORS } from './miraRobotState.js';

test('Talio mascot maps chat, task and voice phases to supported states', () => {
  for (const [phase, state] of Object.entries({idle:'idle',planning:'thinking',searching:'searching',executing:'working',synthesizing:'speaking',responding:'speaking',listening:'listening',error:'error'})) {
    assert.equal(miraRobotState(phase), state);
  }
  assert.equal(miraRobotState('idle','happy'), 'happy');
  assert.equal(MIRA_ROBOT_COLORS.color, '#787878');
});
