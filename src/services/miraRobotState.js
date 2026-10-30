// Match Talio's MIRA mascot renderer and palette.
export const MIRA_ROBOT_COLORS = Object.freeze({ color: '#787878', trimColor: '#2a2c31', screenColor: '#e8f2ff' });

export function miraRobotState(activity = 'idle', expression = 'neutral') {
  if (['thinking', 'searching', 'listening', 'speaking', 'working', 'happy', 'error', 'sleeping'].includes(activity)) return activity;
  if (['generating', 'responding', 'composing', 'synthesizing'].includes(activity)) return 'speaking';
  if (['task', 'executing', 'coding', 'shaping', 'weaving'].includes(activity)) return 'working';
  if (['connecting', 'solving', 'planning'].includes(activity)) return 'thinking';
  if (['happy', 'excited', 'laughing', 'proud'].includes(expression)) return 'happy';
  return 'idle';
}
