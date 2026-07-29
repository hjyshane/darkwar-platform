// Runtime seam (spec 10.5): feature components never touch the runtime
// directly. DiscordRuntimeAdapter arrives at S13 — deliberately last,
// because the iframe/OAuth surface is the most fragile part of the stack.

export interface RuntimeAdapter {
  readonly kind: 'web' | 'discord';
}

export const webRuntimeAdapter: RuntimeAdapter = { kind: 'web' };
