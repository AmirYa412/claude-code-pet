/** Context tier: 0 relaxed (0–40%), 1 exhausted (41–69%), 2 panic (70%+). */
export type Mood = 0 | 1 | 2

/** A short-lived reaction layered over the mood; `idle` is none. */
export type Reaction = 'idle' | 'heard' | 'done' | 'phew' | 'party' | 'money' | 'relief' | 'oops' | 'sleepy'

/** What the pet does: `idle` between turns; while Claude works, thinking or a tool's prop. */
export type Activity = 'idle' | 'think' | 'build' | 'write' | 'look' | 'web' | 'type' | 'clone' | 'todo' | 'magic' | 'rocket' | 'broom' | 'test' | 'pass' | 'fail'

/** The statusline fields drawn beside the pet. */
export type Info = { model: string; dir: string; branch: string }

declare module 'claude-code' {
  interface PluginState {
    'pixel-pet': {
      mood: Mood
      reaction: Reaction
      activity: Activity
      ctx: number | null
      cost: number | null
      info: Info | null
    }
  }
}
