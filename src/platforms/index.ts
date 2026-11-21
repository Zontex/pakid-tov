import type { PlatformAdapter } from '../core/adapter.ts';
import { demoAdapter } from './demo/adapter.ts';

/** Every platform adapter that ships with Pakid Tov. One line per platform. */
export const platforms = new Map<string, PlatformAdapter>([[demoAdapter.id, demoAdapter]]);
