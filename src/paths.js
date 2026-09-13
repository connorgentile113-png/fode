import os from 'node:os';
import path from 'node:path';
export const stateDir = process.env.FODE_STATE_DIR || path.join(os.homedir(), '.local/state/fode');
export const socketPath = path.join(stateDir, 'harness.sock');
