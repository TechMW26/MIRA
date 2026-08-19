import { AGENT_CAPABILITIES } from './agentCapabilities.js';

export function buildRegressionValidationCalls() {
  return [{ name: AGENT_CAPABILITIES.WORKSPACE_VALIDATE, arguments: {} }];
}

export function desktopGoalNeedsMoreWork({
  request = {},
  successfulCalls = [],
  validationFailures = [],
} = {}) {
  const inspected = successfulCalls.some((name) => [
    AGENT_CAPABILITIES.FILE_READ,
    AGENT_CAPABILITIES.FILE_SEARCH,
    AGENT_CAPABILITIES.WORKSPACE_SEARCH,
  ].includes(name));
  const changed = successfulCalls.some((name) => [
    AGENT_CAPABILITIES.FILE_WRITE,
    AGENT_CAPABILITIES.FILE_REPLACE,
  ].includes(name));
  const executed = successfulCalls.some((name) => [
    AGENT_CAPABILITIES.SHELL_RUN,
    AGENT_CAPABILITIES.TEST_RUN,
    AGENT_CAPABILITIES.WORKSPACE_VALIDATE,
    AGENT_CAPABILITIES.WORKSPACE_START,
  ].includes(name));
  return {
    inspection: !inspected,
    mutation: Boolean(request.mutation && !changed),
    execution: Boolean(request.execution && !executed),
    validation: validationFailures.length > 0,
  };
}
