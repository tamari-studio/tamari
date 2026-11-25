// Where things live. One repo holds both the app and its spaces: app/, api/,
// scripts/ and node_modules/, and workspaces/, spaces.json and packages/.
import { join } from 'node:path'

export const APP_ROOT = join(import.meta.dir, '..', '..')
