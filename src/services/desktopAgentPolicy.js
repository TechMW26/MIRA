import { AGENT_CAPABILITIES } from './agentCapabilities.js';

export function buildRegressionValidationCalls() {
  return [{ name: AGENT_CAPABILITIES.WORKSPACE_VALIDATE, arguments: {} }];
}

const OPTIMIZATION_PATTERN = /\b(optimi[sz](?:e|ation|ing)?|performance|speed|latency|refine|cleanup|clean up)\b/i;
const REPAIR_PATTERN = /\b(fix|debug|repair|broken|bug|error|failing|failure|regression)\b/i;
const GIT_PATTERN = /\b(git|github|commit|push|pull|branch|remote|merge)\b/i;
const TEST_PATTERN = /\b(test|lint|typecheck|validate|validation|check|regression)\b/i;

function workflowStep(id, stage, title) {
  return { id, stage, title, instruction: '', status: 'pending', result: '' };
}

export function buildDesktopWorkflowSteps(text = '', request = {}) {
  const value = String(text || '').trim();
  if (request.serverStart) {
    return [
      workflowStep('desktop-plan:inspect', 'inspect', 'Inspect startup configuration'),
      workflowStep('desktop-plan:act', 'act', 'Launch the development server'),
      workflowStep('desktop-plan:complete', 'complete', 'Confirm the live server output'),
    ];
  }
  if (GIT_PATTERN.test(value)) {
    return [
      workflowStep('desktop-plan:inspect', 'inspect', 'Inspect repository state'),
      workflowStep('desktop-plan:act', 'act', 'Complete the requested Git operation'),
      workflowStep('desktop-plan:validate', 'validate', 'Verify the resulting Git state'),
    ];
  }
  if (REPAIR_PATTERN.test(value)) {
    return [
      workflowStep('desktop-plan:inspect', 'inspect', 'Trace the reported failure'),
      workflowStep('desktop-plan:act', 'act', 'Implement the targeted fix'),
      workflowStep('desktop-plan:validate', 'validate', 'Run regression checks'),
    ];
  }
  if (OPTIMIZATION_PATTERN.test(value)) {
    return [
      workflowStep('desktop-plan:inspect', 'inspect', 'Identify optimization targets'),
      workflowStep('desktop-plan:act', 'act', 'Apply focused optimizations'),
      workflowStep('desktop-plan:validate', 'validate', 'Measure and validate the result'),
    ];
  }
  if (request.mutation) {
    return [
      workflowStep('desktop-plan:inspect', 'inspect', 'Inspect the relevant implementation'),
      workflowStep('desktop-plan:act', 'act', 'Apply the requested changes'),
      workflowStep('desktop-plan:validate', 'validate', 'Review and validate the changes'),
    ];
  }
  if (request.execution || TEST_PATTERN.test(value)) {
    return [
      workflowStep('desktop-plan:inspect', 'inspect', 'Inspect the command context'),
      workflowStep('desktop-plan:act', 'act', 'Run the requested operation'),
      workflowStep('desktop-plan:complete', 'complete', 'Report the verified result'),
    ];
  }
  return [
    workflowStep('desktop-plan:inspect', 'inspect', 'Inspect the relevant project areas'),
    workflowStep('desktop-plan:complete', 'complete', 'Synthesize the workspace findings'),
  ];
}

export function desktopWorkflowStageForTool(name = '') {
  if ([
    AGENT_CAPABILITIES.FILE_LIST,
    AGENT_CAPABILITIES.FILE_READ,
    AGENT_CAPABILITIES.FILE_SEARCH,
    AGENT_CAPABILITIES.WORKSPACE_INDEX,
    AGENT_CAPABILITIES.WORKSPACE_SEARCH,
    AGENT_CAPABILITIES.GIT_STATUS,
    AGENT_CAPABILITIES.GIT_INFO,
  ].includes(name)) return 'inspect';
  if ([
    AGENT_CAPABILITIES.WORKSPACE_VALIDATE,
    AGENT_CAPABILITIES.TEST_RUN,
    AGENT_CAPABILITIES.GIT_DIFF,
    AGENT_CAPABILITIES.CHANGE_LIST,
  ].includes(name)) return 'validate';
  return 'act';
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
