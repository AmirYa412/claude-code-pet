import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Activity, Info, Mood, Reaction } from '../types'

// The pixel Claude lives above the prompt, with the statusline beside it.
// On SVG surfaces (desktop) all motion is discrete SMIL inside one sandboxed
// frame: the renderer wakes only when a frame changes, and this module does
// no per-second work. Idle, the body stays still: only the face lives
// (blinks, glances, emotes). It moves while Claude works: a lightbulb when a
// message lands, headphones while thinking, a prop per tool. State is written
// only when a value actually changes.

const mood = atom({ plugin: 'pixel-pet', key: 'mood' } as const, 0 as Mood)
const reaction = atom({ plugin: 'pixel-pet', key: 'reaction' } as const, 'idle' as Reaction)
const activity = atom({ plugin: 'pixel-pet', key: 'activity' } as const, 'idle' as Activity)
const ctx = atom({ plugin: 'pixel-pet', key: 'ctx' } as const, null as number | null)
const cost = atom({ plugin: 'pixel-pet', key: 'cost' } as const, null as number | null)
const info = atom({ plugin: 'pixel-pet', key: 'info' } as const, null as Info | null)

const REACTION_MS = 4000
const HEARD_MS = 3000
const LONG_TURN_MS = 3 * 60 * 1000
const COST_MILESTONES = [5, 10, 25, 50, 100, 250, 500]
const MIN_HOLD_MS = 8000 // a tool's prop shows at least this long before another takes over
const SLEEP_AFTER_MS = 10 * 60 * 1000

// The repo's truecolor palette, plus the props'.
const ORANGE = '#DC6E4B'
const INK = '#0F0F0F'
const SPARKLE = '#FFD778'
const PINK = '#F06478'
const RED = '#EB2D46'
const GREY = '#B4B4B4'
const SWEAT = '#78B4E6'
const YELLOW = '#FFC83C'
const GREEN = '#50DC64'
const ALERT = '#FF5555'
// Statusline text: warm tones that match the pet; CTX keeps green/yellow/red.
const MODEL_TEXT = '#E8916F'
const DIR_TEXT = '#D6CFC7'
const BRANCH_TEXT = '#E6C79C'
const SEP_TEXT = '#8C847C'
const COST_TEXT = '#9C948C'
const NAVY = '#1E3A78'
const NAVY_LIGHT = '#2E57A8'
const WOOD = '#8B5A2B'
const STEEL = '#9AA0A6'
const STEEL_LIGHT = '#C8CDD2'
const GLASS = '#BFE3F7'
const BULB = '#FFD978'
const BULB_EDGE = '#F2B24C'
const WHITE = '#FFFFFF'
const BAGS = '#B4553A'
const OCEAN = '#3B82F6'
const ORANGE_FLAME = '#FF8A3D'
const LAND = '#4ADE80'
const TAN = '#E8C27A'
const COFFEE = '#6B3E1E'
const PAPER = '#F4F1EA'

// --- Faces -------------------------------------------------------------------

type Eye =
  | 'open' | 'half' | 'closed' | 'wide' | 'small' | 'x' | 'happy'
  | 'squint' | 'heart' | 'star' | 'winkL' | 'winkR'
type Emote = { eye: Eye; deco?: string; color?: string }

// The repo's three casts, mood for mood.
const POOLS: Record<Mood, Emote[]> = {
  0: [
    { eye: 'happy', deco: '✦', color: SPARKLE },
    { eye: 'winkL' },
    { eye: 'winkR' },
    { eye: 'open', deco: '♥', color: PINK },
    { eye: 'closed', deco: '✦', color: SPARKLE },
    { eye: 'star', deco: '✦', color: SPARKLE },
    { eye: 'open', deco: '?', color: SPARKLE },
    { eye: 'happy', deco: '☼', color: SPARKLE },
    { eye: 'wide', deco: '✦', color: SPARKLE },
    { eye: 'happy', deco: '♪', color: SPARKLE },
    { eye: 'heart' },
    { eye: 'happy', deco: '♫', color: SPARKLE },
    { eye: 'happy' },
    { eye: 'star' },
    { eye: 'wide', deco: '❋', color: ORANGE },
  ],
  1: [
    { eye: 'squint' },
    { eye: 'wide', deco: '!', color: SPARKLE },
    { eye: 'closed', deco: 'z', color: GREY },
    { eye: 'half', deco: '°', color: SWEAT },
    { eye: 'small' },
    { eye: 'wide', deco: '°', color: SWEAT },
    { eye: 'x' },
    { eye: 'squint', deco: '°', color: SWEAT },
    { eye: 'small', deco: '◗', color: SPARKLE },
  ],
  2: [
    { eye: 'x', deco: '!', color: RED },
    { eye: 'x', deco: '@', color: RED },
    { eye: 'x', deco: '/', color: RED },
    { eye: 'x', deco: 'X', color: RED },
  ],
}
const BASE_EYE: Record<Mood, Eye> = { 0: 'open', 1: 'half', 2: 'x' }

// --- Sprite (units of 2px; the Claude Code mascot's proportions) -------------
// Body 12×8 at (2,0), arms at the sides, four legs. The box hugs the body
// (room above for headphones, to the right for a held prop or the lightbulb)
// and never changes size, so nothing beside it jumps while it animates.

const EYE_X = [4.5, 11.5]
const EYE_Y = 3
const VIEW = { x: -1, y: -3, w: 24, h: 13 } // whole pixels at SCALE: both eyes draw alike
const SCALE = 2

const px = (x: number, y: number, w: number, h: number, fill = INK) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`

// Pixel shapes on a half-unit layout, drawn at one unit (2px) per cell.
const dots = (cx: number, cells: [number, number][], fill = INK) =>
  cells.map(([dx, dy]) => px(cx + dx * 2, EYE_Y + dy * 2, 1, 1, fill)).join('')

function oneEye(kind: Eye, cx: number, isLeft: boolean): string {
  switch (kind) {
    case 'open': return px(cx - 1, EYE_Y - 1.5, 2, 2.5)
    // Tired: a heavy lash line, a low pupil and dark bags underneath.
    case 'half': return px(cx - 1.5, EYE_Y - 0.5, 3, 0.5) + px(cx - 1, EYE_Y, 2, 1) + px(cx - 1.5, EYE_Y + 1.5, 3, 0.5, BAGS)
    case 'closed': return px(cx - 1.5, EYE_Y + 0.5, 3, 1)
    case 'wide': return px(cx - 1.5, EYE_Y - 1.5, 3, 2.5)
    case 'small': return px(cx - 0.5, EYE_Y - 0.5, 1, 1)
    case 'x': return `<path d="M${cx - 1.25} ${EYE_Y - 1.25}L${cx + 1.25} ${EYE_Y + 1.25}M${cx + 1.25} ${EYE_Y - 1.25}L${cx - 1.25} ${EYE_Y + 1.25}" stroke="${INK}" stroke-width="0.9"/>`
    case 'happy': return dots(cx, [[-0.75, 0], [-0.25, -0.5], [0.25, 0]])
    case 'squint': return dots(cx, isLeft ? [[-0.75, -0.75], [-0.25, -0.25], [-0.75, 0.25]] : [[0.25, -0.75], [-0.25, -0.25], [0.25, 0.25]])
    case 'heart': return dots(cx, [[-0.75, -0.5], [0.25, -0.5], [-0.75, 0], [-0.25, 0], [0.25, 0], [-0.25, 0.5]], RED)
    case 'star': return dots(cx, [[-0.25, -0.75], [-0.75, -0.25], [-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25]], SPARKLE)
    case 'winkL': return oneEye(isLeft ? 'closed' : 'open', cx, isLeft)
    case 'winkR': return oneEye(isLeft ? 'open' : 'closed', cx, isLeft)
  }
}

// Tired or panicked, every open-eyed look becomes the mood's own eyes; a shut
// eye stays shut.
const moodEye = (m: Mood, eye: Eye): Eye => (m === 0 || eye === 'closed' ? eye : BASE_EYE[m])

const eyes = (kind: Eye) => oneEye(kind, EYE_X[0]!, true) + oneEye(kind, EYE_X[1]!, false)

const glyph = (text: string, x: number, y: number, color: string, size = 5) =>
  `<text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" fill="${color}" font-family="system-ui,sans-serif" shape-rendering="auto">${text}</text>`

// --- Props ---------------------------------------------------------------------

const HEADPHONES =
  px(3, -2, 10, 1, NAVY) + px(2, -1, 1, 1, NAVY) + px(13, -1, 1, 1, NAVY) +
  px(1.5, 0, 1, 1.5, NAVY) + px(13.5, 0, 1, 1.5, NAVY) +
  px(0.5, 1.5, 2, 3, NAVY) + px(13.5, 1.5, 2, 3, NAVY) +
  px(1, 2, 0.5, 2, NAVY_LIGHT) + px(14.5, 2, 0.5, 2, NAVY_LIGHT)

const BULB_GLASS =
  px(6.5, -7, 3, 0.5, BULB_EDGE) + px(6, -6.5, 4, 2.5, BULB) + px(6.5, -4, 3, 0.5, BULB) +
  px(5.5, -6, 0.5, 1.5, BULB_EDGE) + px(10, -6, 0.5, 1.5, BULB_EDGE) +
  px(6.5, -6, 0.5, 0.5, WHITE) + px(7, -6.5, 0.5, 0.5, WHITE) +
  px(7, -3.5, 2, 0.5, STEEL) + px(7, -3, 2, 0.5, STEEL_LIGHT) + px(7.5, -2.5, 1, 0.5, STEEL)
const BULB_RAYS =
  px(4.5, -6.5, 0.5, 0.5, BULB_EDGE) + px(11, -6.5, 0.5, 0.5, BULB_EDGE) +
  px(4, -5, 0.5, 0.5, BULB_EDGE) + px(11.5, -5, 0.5, 0.5, BULB_EDGE)

const HAMMER_UP = px(16.5, 0.5, 1, 5, WOOD) + px(15, -1.5, 4, 2, STEEL) + px(15, -1.5, 4, 0.5, STEEL_LIGHT)
const HAMMER_DOWN =
  px(16, 4.5, 3.5, 1, WOOD) + px(19.5, 3, 2, 4, STEEL) + px(19.5, 3, 0.5, 4, STEEL_LIGHT) +
  px(21.5, 2.5, 0.5, 0.5, SPARKLE) + px(21.5, 7, 0.5, 0.5, SPARKLE)

const WAND =
  px(16, 4.5, 1, 1, WOOD) + px(17, 3.5, 1, 1, WOOD) + px(18, 2.5, 1, 1, WOOD) +
  px(19, 0.5, 1, 2, SPARKLE) + px(18.5, 1, 2, 1, SPARKLE) + px(19.25, 1.25, 0.5, 0.5, WHITE)
const WAND_SPARKS = [
  px(21, 0, 0.5, 0.5, SPARKLE) + px(20.5, 3, 0.5, 0.5, PINK),
  px(21.5, 1.5, 0.5, 0.5, PINK) + px(19, -1, 0.5, 0.5, SPARKLE),
  px(20, -0.5, 0.5, 0.5, WHITE) + px(21, 2.5, 0.5, 0.5, SPARKLE),
]

const MAGNIFIER =
  px(16, 4.5, 1, 1, INK) + px(17, 3.5, 1, 1, INK) +
  px(18, 0, 3.5, 3.5, STEEL) + px(18.5, 0.5, 2.5, 2.5, GLASS) + px(19, 1, 0.5, 0.5, WHITE)

// Pencil pointing down at a sheet on the ground; the line grows as it writes.
const PENCIL =
  px(16, 4.5, 1, 1, INK) + px(17, 3.5, 1, 1, TAN) + px(18, 2.5, 1, 1, SPARKLE) +
  px(19, 1.5, 1, 1, SPARKLE) + px(20, 0.5, 1, 1, PINK)
const SHEET = px(15, 8.5, 6, 1.5, PAPER)
const SHEET_LINES = [px(15.5, 9, 1, 0.5, GREY), px(15.5, 9, 2.5, 0.5, GREY), px(15.5, 9, 4.5, 0.5, GREY)]

// A tiny keyboard on the ground, a key lighting up under each tap.
const KEYBOARD =
  px(15, 7.5, 7, 2.5, STEEL) +
  [15.5, 17, 18.5, 20].map(x => px(x, 8, 1, 0.5, INK) + px(x + 0.5, 9, 1, 0.5, INK)).join('')
const KEY_FLASHES = [px(17, 8, 1, 0.5, SPARKLE), px(19, 9, 1, 0.5, SPARKLE), px(15.5, 8, 1, 0.5, SPARKLE)]

// A spinning globe on a stick.
const GLOBE =
  px(16.5, 4, 1, 1, WOOD) + px(18, 0, 2, 1, OCEAN) + px(17, 1, 4, 2, OCEAN) + px(18, 3, 2, 1, OCEAN)
const GLOBE_LAND = [
  px(17.5, 1, 1, 1, LAND) + px(19.5, 2, 1, 0.5, LAND) + px(18.5, 3, 0.5, 0.5, LAND),
  px(18.5, 1, 1, 1, LAND) + px(17, 2, 1, 0.5, LAND) + px(19.5, 3, 0.5, 0.5, LAND),
  px(19.5, 1, 1, 1, LAND) + px(18, 2, 1, 0.5, LAND) + px(18, 0, 0.5, 0.5, LAND),
]

// A mini Claude, for a subagent.
const CLONE =
  px(17.5, 6.5, 4, 2.5, ORANGE) + px(17, 7.5, 0.5, 1, ORANGE) + px(21.5, 7.5, 0.5, 1, ORANGE) +
  [18, 19, 20, 21].map(x => px(x, 9, 0.5, 1, ORANGE)).join('') +
  px(18.5, 7, 0.5, 1, INK) + px(20.5, 7, 0.5, 1, INK)

// A clipboard; a check mark ticks on and off.
const CLIPBOARD =
  px(17, 0.5, 3.5, 4.5, WOOD) + px(17.5, 1.5, 2.5, 3, PAPER) + px(18, 0, 1.5, 1, STEEL) +
  px(19, 2, 0.5, 0.5, GREY) + px(19, 3, 0.5, 0.5, GREY) + px(19, 4, 0.5, 0.5, GREY)
const CHECKS = [
  px(18, 2, 0.5, 0.5, LAND),
  px(18, 2, 0.5, 0.5, LAND) + px(18, 3, 0.5, 0.5, LAND),
  px(18, 2, 0.5, 0.5, LAND) + px(18, 3, 0.5, 0.5, LAND) + px(18, 4, 0.5, 0.5, LAND),
]

// An envelope, drawn at the origin; a track flies it in.
const ENVELOPE =
  px(0, 0, 4, 3, PAPER) +
  px(0.5, 0.5, 0.5, 0.5, GREY) + px(1, 1, 0.5, 0.5, GREY) + px(1.5, 1.5, 1, 0.5, GREY) +
  px(2.5, 1, 0.5, 0.5, GREY) + px(3, 0.5, 0.5, 0.5, GREY) + px(1.5, 2, 1, 0.5, RED)

// A thought bubble with a question in it.
const BUBBLE_DOTS = [px(15, 1, 1, 1, WHITE), px(16.5, -0.5, 1.5, 1.5, WHITE)]
const BUBBLE = px(18.5, -3, 4, 3.5, WHITE) + px(18, -2.5, 5, 2.5, WHITE)

// A rocket lifting off beside the pet, flame flickering.
const ROCKET =
  px(18.5, 1.5, 1, 1, RED) + px(18, 2.5, 2, 4, WHITE) + px(18.5, 3.5, 1, 1, OCEAN) +
  px(17.5, 5.5, 0.5, 1.5, RED) + px(20, 5.5, 0.5, 1.5, RED)
const FLAMES = [px(18.5, 6.5, 1, 1.5, SPARKLE) + px(18.5, 8, 1, 0.5, ORANGE_FLAME), px(18, 6.5, 2, 1, ORANGE_FLAME) + px(18.5, 7.5, 1, 1.5, SPARKLE)]

// A broom sweeping, dust puffing off the floor.
const BROOM = px(16, 4.5, 1, 1, WOOD) + px(17, 5.5, 1, 1, WOOD) + px(18, 6.5, 1, 1, WOOD) + px(18, 7.5, 3, 1.5, TAN)
const DUST = [px(21.5, 8.5, 0.5, 0.5, GREY) + px(22, 7.5, 0.5, 0.5, GREY), px(21, 7.5, 0.5, 0.5, GREY) + px(22, 9, 0.5, 0.5, GREY)]

// A test tube: bubbling while tests run, then green or red.
const tube = (liquid: string) =>
  px(17, 0, 2.5, 0.5, STEEL) + px(17.5, 0.5, 1.5, 4.5, GLASS) + px(17.5, 2.5, 1.5, 2.5, liquid) + px(18, 5, 0.5, 0.5, GLASS)
const BUBBLES = [px(18, 3, 0.5, 0.5, WHITE), px(18.5, 2, 0.5, 0.5, WHITE) + px(18, 4, 0.5, 0.5, WHITE)]

// A tiny book, held open.
const BOOK = px(16, 3.5, 3.5, 2.5, '#4F6BD8') + px(16.5, 4, 1.25, 1.5, PAPER) + px(17.75, 4, 1.25, 1.5, PAPER)
const PAGE_LINES = [px(16.75, 4.5, 0.75, 0.5, GREY), px(18, 4.5, 0.75, 0.5, GREY)]

// A butterfly, wings open and shut.
const BUTTERFLY = [px(0, 0, 1, 1, PINK) + px(1.5, 0, 1, 1, PINK) + px(1, 0, 0.5, 1.5, INK), px(0.5, 0, 0.5, 1, PINK) + px(1.5, 0, 0.5, 1, PINK) + px(1, 0, 0.5, 1.5, INK)]

// Confetti and dollar bills for the milestones.
const CONFETTI = [
  px(16, -2, 0.5, 0.5, PINK) + px(19, -1, 0.5, 0.5, SPARKLE) + px(21, -2.5, 0.5, 0.5, OCEAN) + px(1, -2, 0.5, 0.5, LAND),
  px(16.5, 0, 0.5, 0.5, PINK) + px(19.5, 1, 0.5, 0.5, SPARKLE) + px(21.5, -0.5, 0.5, 0.5, OCEAN) + px(0.5, 0, 0.5, 0.5, LAND),
  px(17, 2, 0.5, 0.5, PINK) + px(19, 3, 0.5, 0.5, SPARKLE) + px(21, 1.5, 0.5, 0.5, OCEAN) + px(1, 2, 0.5, 0.5, LAND),
]
const BILL = px(0, 0, 2.5, 1.5, LAND) + px(1, 0.5, 0.5, 0.5, '#1E7A3C')

// --- Variant props: a second animation per tool, picked at random ---

// Wrench on a bolt; a spark on each twist.
const WRENCH = px(16, 4.5, 1, 1, STEEL) + px(17, 3.5, 1, 1, STEEL) + px(17.5, 1.5, 0.5, 2, STEEL) + px(19, 1.5, 0.5, 2, STEEL) + px(17.5, 3, 2, 0.5, STEEL)
const WRENCH_SPARK = [px(20, 1, 0.5, 0.5, SPARKLE), px(20.5, 0, 0.5, 0.5, SPARKLE) + px(20, 2, 0.5, 0.5, WHITE)]

// Quill writing ink dots onto a sheet.
const QUILL = px(16, 4.5, 0.5, 1, INK) + px(16.5, 3.5, 1, 1, WHITE) + px(17, 2.5, 1, 1, WHITE) + px(17.5, 1.5, 1, 1, PAPER) + px(17, 3, 0.5, 0.5, GREY)
const INK_DOTS = [px(15.5, 9, 0.5, 0.5, INK), px(15.5, 9, 0.5, 0.5, INK) + px(16.5, 9, 0.5, 0.5, INK), px(15.5, 9, 0.5, 0.5, INK) + px(16.5, 9, 0.5, 0.5, INK) + px(17.5, 9, 1, 0.5, INK)]

// Binoculars held up, scanning.
const BINOCULARS = px(16.5, 1, 1.5, 1.5, INK) + px(18.5, 1, 1.5, 1.5, INK) + px(18, 1.25, 0.5, 0.75, INK) + px(17, 1.5, 0.5, 0.5, GLASS) + px(19, 1.5, 0.5, 0.5, GLASS) + px(16.5, 2.5, 0.5, 2, INK)

// A satellite dish sending out signal waves.
const DISH = px(17, 3, 3, 0.75, STEEL) + px(17.5, 3.75, 2, 0.5, STEEL_LIGHT) + px(18.5, 1.5, 0.5, 1.5, STEEL) + px(18.25, 4.25, 0.5, 3.5, GREY) + px(17.5, 7.75, 2, 0.5, GREY)
const WAVES = [px(20, 1, 0.5, 0.5, OCEAN), px(20, 1, 0.5, 0.5, OCEAN) + px(21, 0, 0.5, 1, OCEAN), px(20, 1, 0.5, 0.5, OCEAN) + px(21, 0, 0.5, 1, OCEAN) + px(22, -1, 0.5, 1.5, OCEAN)]

// A tiny laptop with green code scrolling.
const LAPTOP = px(16, 4.5, 5, 3, STEEL) + px(16.5, 5, 4, 2, '#0B1F12') + px(15.5, 7.5, 6, 0.75, STEEL_LIGHT)
const CODE = [px(17, 5.5, 2, 0.5, LAND) + px(17, 6.5, 3, 0.5, LAND), px(17, 5.5, 3, 0.5, LAND) + px(17.5, 6.5, 1.5, 0.5, LAND), px(17.5, 5.5, 1.5, 0.5, LAND) + px(17, 6.5, 2.5, 0.5, LAND)]

// A hot-air balloon rising.
const BALLOON = px(18, 1.5, 2.5, 0.5, RED) + px(17.5, 2, 3.5, 3, RED) + px(19, 2, 1, 3, SPARKLE) + px(18, 5, 2.5, 0.5, RED) + px(18.5, 5.5, 0.25, 1, GREY) + px(19.75, 5.5, 0.25, 1, GREY) + px(18.5, 6.5, 1.5, 1, WOOD)

// A trash can: a paper ball tossed in, the lid flips.
const CAN = px(18.5, 6.5, 2.5, 3.5, STEEL) + px(19, 7, 0.5, 2.5, STEEL_LIGHT) + px(20, 7, 0.5, 2.5, STEEL_LIGHT)
const LID_SHUT = px(18.25, 6, 3, 0.5, STEEL_LIGHT)
const LID_OPEN = px(18.25, 4, 0.5, 2, STEEL_LIGHT)
const TOSS = [
  LID_SHUT + px(16.5, 3, 1, 1, WHITE),
  LID_SHUT + px(18, 1.5, 1, 1, WHITE),
  LID_OPEN + px(19.25, 3.5, 1, 1, WHITE),
  LID_OPEN,
]

// A traffic light: yellow blinking while tests run, then green or red.
const LIGHT_OFF = '#3A3A3A'
const trafficLight = (top: string, mid: string, low: string) =>
  px(19.25, 6.5, 0.5, 3.5, GREY) + px(18.5, 1, 2, 5.5, INK) + px(19, 1.5, 1, 1, top) + px(19, 3, 1, 1, mid) + px(19, 4.5, 1, 1, low)

// A box a mini clone pops out of.
const BOX = px(17, 7, 5, 3, WOOD) + px(16.5, 6.5, 1.5, 0.5, TAN) + px(21, 6.5, 1.5, 0.5, TAN)

// Sticky notes slapped on one by one.
const NOTES = [
  px(17, 0, 2, 2, SPARKLE) + px(17.5, 1, 1, 0.5, GREY),
  px(17, 0, 2, 2, SPARKLE) + px(17.5, 1, 1, 0.5, GREY) + px(19.5, 1.5, 2, 2, PINK) + px(20, 2.5, 1, 0.5, GREY),
  px(17, 0, 2, 2, SPARKLE) + px(17.5, 1, 1, 0.5, GREY) + px(19.5, 1.5, 2, 2, PINK) + px(20, 2.5, 1, 0.5, GREY) + px(17.5, 3, 2, 2, LAND) + px(18, 4, 1, 0.5, GREY),
]

// A crystal ball glowing on its stand.
const crystal = (core: string) =>
  px(18, 7.5, 3, 1, WOOD) + px(18.5, 8.5, 2, 0.5, WOOD) + px(18, 4, 3, 3.5, core) + px(17.5, 4.5, 4, 2.5, core) + px(18.5, 4.5, 0.5, 0.5, WHITE)
const ORB = [crystal('#7E5BEF'), crystal('#B39DFF') + px(17, 3, 0.5, 0.5, SPARKLE) + px(21.5, 4, 0.5, 0.5, SPARKLE)]

// A coffee cup with steam, held low.
const CUP = px(16, 5, 2, 2, WHITE) + px(16.5, 5, 1, 0.5, COFFEE) + px(18, 5.5, 0.5, 1, WHITE)
const STEAM = [px(16.5, 3.5, 0.5, 0.5, GREY) + px(17, 2.5, 0.5, 0.5, GREY), px(17, 3.5, 0.5, 0.5, GREY) + px(16.5, 2.5, 0.5, 0.5, GREY)]

// --- Discrete timelines --------------------------------------------------------

// One animated value: a resting value plus timed changes, drawn as a <g>
// whose discrete SMIL animation holds each value until the next change.
class Track {
  private keys: [number, string][] = []
  constructor(readonly rest: string, readonly kind: 'translate' | 'opacity' = 'translate') {}

  at(t: number, value: string) {
    this.keys.push([t, value])
  }

  hold(t: number, d: number, value: string) {
    this.at(t, value)
    this.at(t + d, this.rest)
  }

  wrap(inner: string, cycle: number): string {
    const byTime = new Map<string, string>([['0.0000', this.rest]])
    for (const [t, v] of [...this.keys].sort((a, b) => a[0] - b[0])) {
      if (t < cycle) byTime.set((t / cycle).toFixed(4), v)
    }
    const times: string[] = []
    const values: string[] = []
    for (const [t, v] of byTime) {
      if (values[values.length - 1] !== v) {
        times.push(t)
        values.push(v)
      }
    }
    const isMove = this.kind === 'translate'
    const attr = isMove ? `transform="translate(${values[0]})"` : `opacity="${values[0]}"`
    if (values.length === 1) return `<g ${attr}>${inner}</g>`
    const timing = `calcMode="discrete" dur="${cycle.toFixed(2)}s" repeatCount="indefinite" values="${values.join(';')}" keyTimes="${times.join(';')}"`
    const anim = isMove
      ? `<animateTransform attributeName="transform" type="translate" ${timing}/>`
      : `<animate attributeName="opacity" ${timing}/>`
    return `<g ${attr}>${inner}${anim}</g>`
  }
}

// Frames that take turns: frame i shows for `step` seconds of each cycle.
function flipbook(frames: string[], step: number): string {
  const cycle = frames.length * step
  return frames
    .map((frame, i) => {
      const vis = new Track('0', 'opacity')
      vis.hold(i * step, step, '1')
      return vis.wrap(frame, cycle)
    })
    .join('')
}

const rand = (max: number) => Math.random() * max
const between = (lo: number, hi: number) => lo + rand(hi - lo)
const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!

class Scene {
  pose = new Track('0 0')
  gaze = new Track('0 0')
  armL: Track
  armR: Track
  base = new Track('1', 'opacity')
  emotes: { em: Emote; vis: Track }[] = []
  bits: { vis: Track; move: Track; inner: string }[] = []

  // Working and greeting scenes set this, so their eyes wear the mood's look.
  mood: Mood = 0

  constructor(readonly face: Eye, armRest = '0 0') {
    this.armL = new Track(armRest)
    this.armR = new Track(armRest)
  }

  emote(em: Emote, t: number, d: number) {
    const vis = new Track('0', 'opacity')
    vis.hold(t, d, '1')
    this.base.hold(t, d, '0')
    this.emotes.push({ em, vis })
  }

  glance(t: number): number {
    const d = between(1.2, 2.5)
    this.gaze.hold(t, d, pick(['-0.5 0', '0.5 0', '0 -0.5']))
    return d
  }

  // A small thing that shows for `d` seconds, moving through `path`.
  bit(inner: string, t: number, d: number, path: string[] = []): number {
    const vis = new Track('0', 'opacity')
    const move = new Track('0 0')
    vis.hold(t, d, '1')
    path.forEach((at, i) => move.at(t + ((i + 1) * d) / (path.length + 1), at))
    move.at(t + d, '0 0')
    this.bits.push({ vis, move, inner })
    return d
  }

  // --- idle beats: rare, short, then still again ---
  sweat(t: number): number {
    return this.bit(px(14.5, -1, 0.5, 1, SWEAT) + px(14, -0.5, 1, 0.5, SWEAT), t, 1.2, ['0 1', '0 2'])
  }

  lookAround(t: number): number {
    this.gaze.at(t, '-0.5 0')
    this.gaze.at(t + 0.8, '0.5 0')
    this.gaze.at(t + 1.6, this.gaze.rest)
    return 1.6
  }

  // Looks over at the statusline for a while.
  peek(t: number): number {
    const d = between(2.5, 4)
    this.gaze.hold(t, d, '0.5 0')
    return d
  }

  yawn(t: number): number {
    this.emote({ eye: 'closed' }, t, 1.6)
    this.bit(px(7, 5, 2, 1.5, INK), t + 0.2, 1.2)
    return 1.6
  }

  // A hop with a wind-up and a landing: squash, rise, peak, fall, settle.
  hop(t: number, times = 1, height = 1): number {
    const steps: [number, string][] = [[0, '0 0.5'], [0.08, `0 ${-height / 2}`], [0.16, `0 ${-height}`], [0.3, `0 ${-height / 2}`], [0.38, '0 0.5'], [0.46, this.pose.rest]]
    for (let i = 0; i < times; i++) for (const [at, v] of steps) this.pose.at(t + i * 0.5 + at, v)
    return times * 0.5
  }

  wave(t: number): number {
    // Arm rises, waves twice through a middle pose, then lowers.
    const arm = ['0 -1', '0 -2', '0 -1.5', '0 -2', '0 -1.5', '0 -2', '0 -1']
    arm.forEach((v, i) => this.armR.at(t + i * 0.17, v))
    this.armR.at(t + 1.2, this.armR.rest)
    this.emote({ eye: 'happy' }, t, 1.2)
    return 1.2
  }

  hearts(t: number): number {
    this.emote({ eye: 'happy' }, t, 1.8)
    return this.bit(glyph('♥', 17, 3.5, PINK, 4), t, 1.8, ['0 -1', '0.5 -2'])
  }

  eyeRoll(t: number): number {
    for (const [i, at] of ['-0.5 -0.5', '0 -0.5', '0.5 -0.5'].entries()) this.gaze.at(t + i * 0.4, at)
    this.gaze.at(t + 1.2, this.gaze.rest)
    return 1.2
  }

  shiver(t: number): number {
    for (let i = 0; i < 4; i++) this.pose.at(t + i * 0.1, i % 2 ? '-0.5 0' : '0.5 0')
    this.pose.at(t + 0.4, this.pose.rest)
    return 0.4
  }

  // Relaxed: a little two-step with a note.
  dance(t: number): number {
    for (let i = 0; i < 4; i++) {
      const isLeft = i % 2 === 0
      this.armL.at(t + i * 0.4, isLeft ? '0 -2' : '0 0')
      this.armR.at(t + i * 0.4, isLeft ? '0 0' : '0 -2')
      this.pose.at(t + i * 0.4, isLeft ? '-0.5 0' : '0.5 0')
    }
    this.armL.at(t + 1.6, this.armL.rest)
    this.armR.at(t + 1.6, this.armR.rest)
    this.pose.at(t + 1.6, this.pose.rest)
    this.emote({ eye: 'happy' }, t, 1.6)
    return this.bit(glyph('♪', 18, 2, SPARKLE, 4), t, 1.6, ['0 -1', '0.5 -1.5'])
  }

  // Relaxed: squint, twitch, achoo.
  sneeze(t: number): number {
    this.emote({ eye: 'squint' }, t, 0.7)
    this.pose.hold(t + 0.7, 0.15, '0 0.5')
    this.emote({ eye: 'closed' }, t + 0.7, 0.5)
    this.bit(glyph('✦', 18, 3, WHITE, 4), t + 0.7, 0.5)
    return 1.2
  }

  // Relaxed: looks up at a twinkling star.
  stargaze(t: number): number {
    this.gaze.hold(t, 2.4, '0.5 -0.5')
    for (let i = 0; i < 3; i++) this.bit(glyph('✦', 18.5, 0.5, SPARKLE, 3.5), t + i * 0.8, 0.4)
    return 2.4
  }

  // Exhausted: eyes sink shut, head drops... jolts awake.
  nodOff(t: number): number {
    this.emote({ eye: 'closed' }, t, 1.6)
    this.pose.hold(t + 0.4, 1.2, '0 0.5')
    this.pose.hold(t + 1.6, 0.15, '0 -0.5')
    this.emote({ eye: 'wide' }, t + 1.6, 0.8)
    this.bit(glyph('!', 18, 2, SPARKLE, 4.5), t + 1.6, 0.8)
    return 2.4
  }

  // Exhausted: a steaming cup, a slow sip.
  coffee(t: number): number {
    this.bit(CUP, t, 3)
    STEAM.forEach((frame, i) => {
      for (let k = 0; k < 3; k++) this.bit(frame, t + (k * 2 + i) * 0.5, 0.5)
    })
    this.emote({ eye: 'closed' }, t + 1, 1)
    return 3
  }

  // Panic: a flashing alarm above the head.
  alarm(t: number): number {
    this.emote({ eye: 'wide' }, t, 1.2)
    for (let i = 0; i < 3; i++) this.bit(glyph('!', 8, -0.2, RED, 3.5), t + i * 0.4, 0.2)
    return 1.2
  }

  // Panic: arms up, eyes squeezed shut, trembling.
  cower(t: number): number {
    this.armL.hold(t, 1.2, '0 -2')
    this.armR.hold(t, 1.2, '0 -2')
    this.emote({ eye: 'squint' }, t, 1.2)
    this.shiver(t + 0.4)
    return 1.2
  }

  // Panic: a nervous look at the CTX number, sweating.
  // Relaxed: eyes follow a butterfly fluttering across.
  butterfly(t: number): number {
    const looks = ['0.5 -0.5', '0.5 -0.5', '0 -0.5', '0 -0.5', '0.5 0', '0.5 -0.5']
    looks.forEach((at, i) => this.gaze.at(t + (i + 1) * 0.5, at))
    this.gaze.at(t + 3.5, this.gaze.rest)
    const wings = `<g transform="translate(21 -2)">${flipbook(BUTTERFLY, 0.15)}</g>`
    return this.bit(wings, t, 3.5, ['-2 1', '-4 -0.5', '-6 1', '-8 -0.5', '-5 2', '-1 0'])
  }

  // Relaxed: reads a few pages of a tiny book.
  read(t: number): number {
    this.gaze.hold(t, 3.2, '0.5 0.5')
    return this.bit(BOOK + flipbook(PAGE_LINES, 0.8), t, 3.2)
  }

  nervousPeek(t: number): number {
    this.gaze.hold(t, 1.6, '0.5 0')
    this.sweat(t + 0.3)
    return 1.6
  }
}

function weighted<T>(table: [number, T][]): T {
  let roll = rand(table.reduce((sum, [w]) => sum + w, 0))
  for (const [w, value] of table) {
    roll -= w
    if (roll < 0) return value
  }
  return table[table.length - 1]![1]
}

// A mood's idle life, mostly still: long rests, glances, and now and then a
// short beat (a wave, a yawn, floating hearts...), with an emote at the repo's
// cadence (~12s relaxed, ~9s exhausted, ~8s panic).
function idleScene(m: Mood): [Scene, number] {
  const scene = new Scene(BASE_EYE[m], m === 1 ? '0 1' : '0 0')
  const every = [12, 9, 8][m]!
  const rest = () => between(2.5, 5)
  const beats: [number, (t: number) => number][] = [
    [11, rest],
    [4, t => scene.glance(t)],
    [1.5, t => scene.lookAround(t)],
    ...(m === 0
      ? ([
          [1, t => scene.peek(t)],
          [1, t => scene.wave(t)],
          [1, t => scene.hearts(t)],
          [0.7, t => scene.yawn(t)],
          [0.6, t => scene.dance(t)],
          [0.4, t => scene.sneeze(t)],
          [0.8, t => scene.stargaze(t)],
          [0.6, t => scene.butterfly(t)],
          [0.6, t => scene.read(t)],
        ] as [number, (t: number) => number][])
      : m === 1
        ? ([
            [1.5, t => scene.sweat(t)],
            [1.5, t => scene.yawn(t)],
            [1, t => scene.eyeRoll(t)],
            [1, t => scene.nodOff(t)],
            [0.8, t => scene.coffee(t)],
          ] as [number, (t: number) => number][])
        : ([
            [1.5, t => scene.shiver(t)],
            [1.5, t => scene.sweat(t)],
            [1.2, t => scene.alarm(t)],
            [1, t => scene.cower(t)],
            [1, t => scene.nervousPeek(t)],
          ] as [number, (t: number) => number][])),
  ]
  let t = between(1, 3)
  while (t < 60) {
    const fillEnd = t + every * between(0.7, 1.3)
    while (t < fillEnd) t += weighted(beats)(t) + between(0.5, 1.5)
    const d = between(1.6, 2.4)
    scene.emote(pick(POOLS[m]), t, d)
    t += d + 0.5
  }
  return [scene, t + between(1, 3)]
}

function blinkTracks(m: Mood): { open: Track; shut: Track; cycle: number } {
  const open = new Track('1', 'opacity')
  const shut = new Track('0', 'opacity')
  const cycle = 31
  const count = m === 2 ? 5 : 3 // ~10s heartbeat calm, ~6s rattled
  const bucket = cycle / count
  for (let i = 0; i < count; i++) {
    const t = i * bucket + rand(bucket - 0.5)
    for (const at of [t, t + 0.24]) {
      // double blink: shut · open · shut
      open.hold(at, 0.12, '0')
      shut.hold(at, 0.12, '1')
    }
  }
  return { open, shut, cycle }
}

// `hand` rides with the right arm, so a held prop follows every swing.
type Extras = { behind?: string; front?: string; outside?: string; hand?: string }

function sprite(scene: Scene, cycle: number, blink: ReturnType<typeof blinkTracks> | null, extras: Extras = {}): string {
  const legs = [3, 5, 10, 12].map(x => px(x, 8, 1, 2, ORANGE)).join('')
  const emoteEyes = scene.emotes.map(({ em, vis }) => vis.wrap(eyes(moodEye(scene.mood, em.eye)), cycle)).join('')
  const emoteDecos = scene.emotes
    .filter(({ em }) => em.deco)
    .map(({ em, vis }) => vis.wrap(glyph(em.deco!, 18, 1, em.color ?? SPARKLE), cycle))
    .join('')
  const openEyes = scene.base.wrap(eyes(moodEye(scene.mood, scene.face)), cycle) + emoteEyes
  const face = blink
    ? blink.open.wrap(openEyes, blink.cycle) + blink.shut.wrap(eyes('closed'), blink.cycle)
    : openEyes
  const bits = scene.bits.map(({ vis, move, inner }) => vis.wrap(move.wrap(inner, cycle), cycle)).join('')

  const body =
    (extras.behind ?? '') +
    legs +
    scene.armL.wrap(px(0, 4, 2, 2, ORANGE), cycle) +
    scene.armR.wrap(px(14, 4, 2, 2, ORANGE) + (extras.hand ?? ''), cycle) +
    px(2, 0, 12, 8, ORANGE) +
    `<g shape-rendering="geometricPrecision">${scene.gaze.wrap(face, cycle)}</g>` +
    emoteDecos +
    bits +
    (extras.front ?? '')

  return SVG_OPEN + scene.pose.wrap(body, cycle) + (extras.outside ?? '') + '</svg>'
}

const SVG_OPEN =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}" ` +
  `width="${VIEW.w * SCALE}" height="${VIEW.h * SCALE}" shape-rendering="crispEdges">`

const svgBody = (svg: string) => svg.slice(SVG_OPEN.length, -'</svg>'.length)

const WORK_ACTS: Activity[] = ['think', 'build', 'write', 'look', 'web', 'type', 'clone', 'todo', 'magic']

// While Claude works: the running tool's animation first, then three others
// picked at random, each held 7–10s, in one loop the renderer plays alone.
function workingScene(m: Mood, act: Activity): string {
  const lead: Activity = act === 'idle' ? 'think' : act
  const others = WORK_ACTS.filter(a => a !== lead)
    .map(a => [Math.random(), a] as const)
    .sort((x, y) => x[0] - y[0])
    .slice(0, 3)
    .map(([, a]) => a)
  const slots = [lead, ...others].map(a => ({ a, d: between(7, 10) }))
  const cycle = slots.reduce((sum, { d }) => sum + d, 0)
  let t = 0
  const parts = slots.map(({ a, d }) => {
    const vis = new Track('0', 'opacity')
    vis.hold(t, d, '1')
    // Each hand-off pops up a pixel and settles, so the cut reads as a beat.
    const settle = new Track('0 0')
    settle.at(t, '0 -0.5')
    settle.at(t + 0.15, '0 0')
    t += d
    return vis.wrap(settle.wrap(svgBody(toolScene(m, a)), cycle), cycle)
  })
  return SVG_OPEN + parts.join('') + '</svg>'
}

// A Scene class whose instances carry the mood, for the working scenes.
function moodScene(m: Mood) {
  return class extends Scene {
    override mood = m
  }
}

// The second animation for a tool, or undefined where it has none.
function variantScene(m: Mood, act: Activity): string | undefined {
  const Scene = moodScene(m)
  switch (act) {
    case 'build': {
      // Twisting a wrench on a bolt.
      const scene = new Scene('squint')
      scene.armR.at(0.4, '0 -0.5')
      scene.gaze.at(0, '0.5 -0.5')
      return sprite(scene, 0.8, null, { hand: WRENCH + flipbook(WRENCH_SPARK, 0.4) })
    }
    case 'write': {
      // A quill leaving ink on the sheet.
      const scene = new Scene('small')
      for (let i = 0; i < 6; i++) scene.armR.at(i * 0.2, i % 2 ? '0 -0.5' : '0 0')
      scene.gaze.at(0, '0.5 0.5')
      return sprite(scene, 1.2, blinkTracks(m), { hand: QUILL, front: SHEET + flipbook(INK_DOTS, 0.4) })
    }
    case 'look': {
      // Binoculars up, scanning back and forth.
      const scene = new Scene('wide', '0 -2')
      scene.armR.at(0.8, '0 -2.5')
      scene.gaze.at(0, '0.5 -0.5')
      scene.gaze.at(0.8, '0 -0.5')
      return sprite(scene, 1.6, blinkTracks(m), { hand: BINOCULARS })
    }
    case 'web': {
      // A satellite dish pulsing signal.
      const scene = new Scene('wide')
      scene.gaze.at(0, '0.5 -0.5')
      return sprite(scene, 1.2, blinkTracks(m), { front: DISH + flipbook(WAVES, 0.4) })
    }
    case 'type': {
      // Tapping at a tiny laptop, code scrolling.
      const scene = new Scene('half')
      for (let i = 0; i < 6; i++) scene.armR.at(i * 0.15, i % 2 ? '0 0.5' : '0 1')
      scene.gaze.at(0, '0.5 0.5')
      return sprite(scene, 0.9, blinkTracks(m), { front: LAPTOP + flipbook(CODE, 0.3) })
    }
    case 'rocket': {
      // A hot-air balloon floating up.
      const scene = new Scene('wide')
      scene.gaze.at(0, '0.5 -0.5')
      const rise = new Track('0 1')
      rise.at(0.8, '0 0')
      rise.at(1.6, '0 -1')
      return sprite(scene, 2.4, blinkTracks(m), { front: rise.wrap(BALLOON, 2.4) })
    }
    case 'broom': {
      // Tossing a paper ball into the trash.
      const scene = new Scene('squint')
      scene.armR.at(0, '0 -1')
      scene.armR.at(0.4, '0 0')
      scene.gaze.at(0, '0.5 0.5')
      return sprite(scene, 1.6, null, { front: CAN + flipbook(TOSS, 0.4) })
    }
    case 'test':
    case 'pass':
    case 'fail': {
      // A traffic light: yellow blinks, then green or red.
      const scene = new Scene(act === 'pass' ? 'happy' : act === 'fail' ? 'squint' : 'wide')
      scene.gaze.at(0, '0.5 -0.5')
      const light =
        act === 'pass'
          ? trafficLight(LIGHT_OFF, LIGHT_OFF, LAND)
          : act === 'fail'
            ? trafficLight(RED, LIGHT_OFF, LIGHT_OFF)
            : flipbook([trafficLight(LIGHT_OFF, SPARKLE, LIGHT_OFF), trafficLight(LIGHT_OFF, LIGHT_OFF, LIGHT_OFF)], 0.4)
      if (act === 'test') return sprite(scene, 0.8, blinkTracks(m), { front: light })
      // The result: a hop for green, a head shake for red, the lamp flashing.
      if (act === 'pass') scene.hop(0.8)
      else {
        for (let i = 0; i < 4; i++) scene.pose.at(0.8 + i * 0.12, i % 2 ? '0.5 0' : '-0.5 0')
        scene.pose.at(1.28, '0 0')
      }
      return sprite(scene, 2.4, blinkTracks(m), { front: flipbook([light, trafficLight(LIGHT_OFF, LIGHT_OFF, LIGHT_OFF), light, light, light, light], 0.4) })
    }
    case 'clone': {
      // A mini clone pops out of a box.
      const scene = new Scene('happy')
      scene.gaze.at(0, '0.5 0')
      const pop = new Track('0 2')
      pop.at(0.4, '0 0')
      pop.at(1.2, '0 -0.5')
      pop.at(1.4, '0 0')
      return sprite(scene, 2, null, { front: pop.wrap(CLONE, 2) + BOX })
    }
    case 'todo': {
      // Slapping sticky notes up, one by one.
      const scene = new Scene('open')
      for (let i = 0; i < 3; i++) scene.armR.hold(i * 0.6, 0.2, '0 -2')
      scene.gaze.at(0, '0.5 -0.5')
      return sprite(scene, 1.8, blinkTracks(m), { front: flipbook(NOTES, 0.6) })
    }
    case 'magic': {
      // Gazing into a glowing crystal ball.
      const scene = new Scene('wide')
      scene.gaze.at(0, '0.5 0.5')
      return sprite(scene, 1.2, blinkTracks(m), { front: flipbook(ORB, 0.6) })
    }
    default:
      return undefined
  }
}

// A tool's prop in the right hand, animated on its own short loop; half the
// time its variant instead.
function toolScene(m: Mood, act: Activity): string {
  const variant = Math.random() < 0.5 ? variantScene(m, act) : undefined
  if (variant) return variant
  const Scene = moodScene(m)
  if (act === 'build') {
    // Hammering: a slow raise, a fast strike, a jolt on impact.
    const scene = new Scene('squint')
    scene.armR.at(0, '0 -0.5')
    scene.armR.at(0.2, '0 -1')
    scene.armR.at(0.5, '0 0')
    scene.pose.hold(0.5, 0.08, '0 0.5')
    scene.gaze.at(0, '0.5 0')
    const up = new Track('1', 'opacity')
    up.hold(0.5, 0.25, '0')
    const down = new Track('0', 'opacity')
    down.hold(0.5, 0.25, '1')
    return sprite(scene, 0.75, null, { hand: up.wrap(HAMMER_UP, 0.75) + down.wrap(HAMMER_DOWN, 0.75) })
  }
  if (act === 'look') {
    // Peering through a magnifier that bobs up and down.
    const scene = new Scene('wide')
    scene.armR.at(0.8, '0 -0.5')
    scene.gaze.at(0, '0.5 -0.5')
    return sprite(scene, 1.6, blinkTracks(m), { hand: MAGNIFIER })
  }
  if (act === 'magic') {
    // Waving a wand that sheds sparkles.
    const scene = new Scene('happy')
    scene.armR.at(0.45, '0 -1')
    return sprite(scene, 0.9, null, { hand: WAND + flipbook(WAND_SPARKS, 0.3) })
  }
  if (act === 'write') {
    // Scribbling on a sheet: the hand jiggles, the line grows.
    const scene = new Scene('small')
    for (let i = 0; i < 6; i++) scene.armR.at(i * 0.2, i % 2 ? '0 -0.5' : '0 0')
    scene.gaze.at(0, '0.5 0.5')
    return sprite(scene, 1.2, blinkTracks(m), { hand: PENCIL, front: SHEET + flipbook(SHEET_LINES, 0.4) })
  }
  if (act === 'type') {
    // Tapping at a tiny keyboard, one key lighting up per tap.
    const scene = new Scene('half')
    for (let i = 0; i < 6; i++) scene.armR.at(i * 0.15, i % 2 ? '0 0' : '0 1')
    scene.gaze.at(0, '0.5 0.5')
    return sprite(scene, 0.9, blinkTracks(m), { front: KEYBOARD + flipbook(KEY_FLASHES, 0.3) })
  }
  if (act === 'web') {
    // Holding up a spinning globe.
    const scene = new Scene('wide', '0 -1')
    scene.gaze.at(0, '0.5 -0.5')
    return sprite(scene, 1.2, blinkTracks(m), { hand: GLOBE + flipbook(GLOBE_LAND, 0.4) })
  }
  if (act === 'clone') {
    // A mini Claude hops beside it: a subagent at work.
    const scene = new Scene('happy')
    scene.gaze.at(0, '0.5 0')
    const hop = new Track('0 0')
    hop.at(0.3, '0 -1')
    return sprite(scene, 0.6, null, { front: hop.wrap(CLONE, 0.6) })
  }
  if (act === 'rocket') {
    // Shipping: a rocket lifts off, the pet watches it go.
    const scene = new Scene('wide')
    scene.gaze.at(0, '0.5 -0.5')
    const lift = new Track('0 0')
    lift.at(0.6, '0 -1')
    lift.at(1.2, '0 -2')
    return sprite(scene, 1.8, blinkTracks(m), { front: lift.wrap(ROCKET + flipbook(FLAMES, 0.15), 1.8) })
  }
  if (act === 'broom') {
    // Cleaning up: sweeping, dust puffing.
    const scene = new Scene('squint')
    for (let i = 0; i < 4; i++) scene.armR.at(i * 0.3, i % 2 ? '0 0' : '0 0.5')
    scene.gaze.at(0, '0.5 0.5')
    return sprite(scene, 1.2, null, { hand: BROOM, front: flipbook(DUST, 0.3) })
  }
  if (act === 'test' || act === 'pass' || act === 'fail') {
    // Tests: the tube bubbles while they run, then shows green or red.
    const liquid = act === 'pass' ? LAND : act === 'fail' ? RED : SPARKLE
    const scene = new Scene(act === 'pass' ? 'happy' : act === 'fail' ? 'squint' : 'wide', '0 -1')
    scene.gaze.at(0, '0.5 -0.5')
    if (act === 'test') return sprite(scene, 1.2, blinkTracks(m), { hand: tube(liquid) + flipbook(BUBBLES, 0.3) })
    if (act === 'pass') {
      // Green: the tube pumps high twice, then swirls while it bubbles; a hop, sparkles twinkling.
      for (let i = 0; i < 2; i++) scene.armR.hold(i * 0.6, 0.3, '0 -2.5')
      for (let i = 0; i < 6; i++) scene.armR.at(1.2 + i * 0.2, i % 2 ? '0 -1' : '0 -1.5')
      scene.hop(1.4)
      const twinkle = flipbook([glyph('✦', 21, 0, SPARKLE, 4), glyph('✦', 20, -2, SPARKLE, 3), ''], 0.4)
      return sprite(scene, 2.4, blinkTracks(m), { hand: tube(liquid) + flipbook(BUBBLES, 0.3) + twinkle })
    }
    // Red: a head shake at the tube, the "!" flashing, a bead of sweat.
    for (let i = 0; i < 4; i++) scene.pose.at(i * 0.12, i % 2 ? '0.5 0' : '-0.5 0')
    scene.pose.at(0.48, '0 0')
    scene.sweat(1)
    return sprite(scene, 2.4, blinkTracks(m), { hand: tube(liquid) + flipbook([glyph('!', 21, 1, RED, 4), ''], 0.4) })
  }
  if (act === 'todo') {
    // Ticking items off a clipboard.
    const scene = new Scene('open', '0 -1')
    scene.gaze.at(0, '0.5 0')
    return sprite(scene, 1.8, blinkTracks(m), { hand: CLIPBOARD + flipbook(CHECKS, 0.6) })
  }
  // Thinking, two ways: pondering under a thought bubble, or headphones on.
  if (pick([true, false])) {
    const scene = new Scene(BASE_EYE[m])
    scene.gaze.at(0, '-0.5 -0.5')
    const dots = BUBBLE_DOTS.map((dot, i) => {
      const vis = new Track('0', 'opacity')
      vis.at(0.4 + i * 0.4, '1')
      return vis.wrap(dot, 3.2)
    })
    const cloud = new Track('0', 'opacity')
    cloud.at(1.2, '1')
    const mark = new Track('0', 'opacity')
    mark.at(1.4, '1')
    return sprite(scene, 3.2, blinkTracks(m), {
      outside: dots.join('') + cloud.wrap(BUBBLE, 3.2) + mark.wrap(glyph(pick(['?', '!', '♪']), 20.5, -0.3, INK, 3.5), 3.2),
    })
  }
  const scene = new Scene('happy')
  scene.pose.at(0.8, '0 0.5')
  const note = new Track('0', 'opacity')
  note.hold(0, 1.2, '1')
  return sprite(scene, 1.6, null, {
    front: HEADPHONES,
    outside: note.wrap(glyph(pick(['♪', '♫']), 18.5, 1.5, SPARKLE, 4), 4.8),
  })
}

// The band redraws whenever anything on it changes (CTX %, cost, branch).
// Rebuilding the pet then would hand the app a new random animation, and the
// app reloads the pet's frame, which blinks it out for an instant. So the pet
// is rebuilt only when what it shows changes.
let petKey = ''
let petCache = ''

function stablePet(m: Mood, r: Reaction, act: Activity, isWorking: boolean): string {
  const key = `${m}|${r}|${act}|${isWorking}`
  if (key !== petKey) {
    petKey = key
    petCache = petSvg(m, r, act, isWorking)
  }
  return petCache
}

function petSvg(m: Mood, r: Reaction, act: Activity, isWorking: boolean): string {
  if (r === 'sleepy') {
    // Dozing: z's drift up and a bubble swells from its nose.
    const scene = new Scene('closed', '0 1')
    scene.bit(px(8.5, 5, 1, 1, GLASS), 0.5, 0.6)
    scene.bit(px(8, 4.5, 2, 2, GLASS), 1.1, 0.8)
    scene.bit(px(7.5, 4, 3, 3, GLASS) + px(8, 4.5, 0.5, 0.5, WHITE), 1.9, 1.2)
    const zs = [0, 1, 2]
      .map(i => {
        const vis = new Track('0', 'opacity')
        vis.hold(i * 1, 2.2, '1')
        return vis.wrap(glyph('z', 16 + i * 1.5, 2.5 - i * 1.2, GREY, 3 + i * 0.5), 4)
      })
      .join('')
    return sprite(scene, 4, null, { outside: zs })
  }

  if (r === 'done') {
    const scene = new Scene('happy')
    scene.hop(0)
    scene.armL.hold(0, 2.4, '0 -2')
    scene.armR.hold(0, 2.4, '0 -2')
    const spark = new Track('0', 'opacity')
    for (let i = 0; i < 5; i++) spark.hold(i * 0.6, 0.3, '1')
    return sprite(scene, 4, null, { outside: spark.wrap(glyph('✦', 18, 1, SPARKLE), 4) })
  }

  if (r === 'party') {
    // A long task landed: arms up, confetti raining.
    const scene = new Scene('happy')
    scene.armL.hold(0, 3, '0 -2')
    scene.armR.hold(0, 3, '0 -2')
    scene.hop(0, 3)
    return sprite(scene, 4, null, { outside: flipbook(CONFETTI, 0.3) })
  }

  if (r === 'money') {
    // The session cost passed a milestone: bills fly out, eyes wide.
    const scene = new Scene('wide')
    scene.gaze.at(0, '0 -0.5')
    for (let i = 0; i < 3; i++) {
      scene.bit(`<g transform="translate(${15 + i * 2} 3)">${BILL}</g>`, i * 0.6, 1.4, ['0 -2', '1 -4'])
    }
    scene.bit(glyph('$', 8, -0.3, LAND, 4), 0, 2.4)
    return sprite(scene, 4, null)
  }

  if (r === 'relief') {
    // Just compacted: a long stretch, a happy sigh.
    const scene = new Scene('happy')
    scene.armL.hold(0, 1.6, '0 -2')
    scene.armR.hold(0, 1.6, '0 -2')
    scene.pose.hold(0, 1.6, '0 -0.5')
    scene.emote({ eye: 'closed' }, 0, 1.6)
    scene.bit(glyph('✦', 18, 1, SPARKLE), 1.6, 1.6)
    return sprite(scene, 4, null)
  }

  if (r === 'phew') {
    // A very long turn: wiped out, sweating.
    const scene = new Scene('half', '0 1')
    scene.pose.at(0, '0 0.5')
    scene.emote({ eye: 'closed' }, 0.3, 1.5)
    scene.sweat(0.5)
    scene.sweat(2.3)
    return sprite(scene, 4, blinkTracks(1))
  }

  if (r === 'oops') {
    const scene = new Scene('squint')
    for (let i = 0; i < 6; i++) scene.pose.at(i * 0.1, i % 2 ? '-0.5 0' : '0.5 0')
    scene.pose.at(0.6, '0 0')
    scene.sweat(0.4)
    scene.sweat(2.2)
    return sprite(scene, 4, null)
  }

  if (r === 'heard') return heardScene(m)

  if (isWorking) return workingScene(m, act)

  const [scene, cycle] = idleScene(m)
  return sprite(scene, cycle, blinkTracks(m))
}

// A message landed: one of a few greetings, picked fresh each time.
function heardScene(m: Mood): string {
  const Scene = moodScene(m)
  const variant = pick(['bulb', 'letter', 'jump', 'pumped', 'hello'] as const)

  if (variant === 'letter') {
    // An envelope flies in and lands in its hand.
    const scene = new Scene('wide')
    scene.gaze.at(0, '0.5 -0.5')
    scene.armR.at(0.6, '0 -1')
    scene.emote({ eye: 'happy' }, 1.2, 1.8)
    const flight = new Track('22 -2')
    flight.at(0.3, '19 0')
    flight.at(0.6, '16 1.5')
    return sprite(scene, 3, null, { outside: flight.wrap(ENVELOPE, 3) })
  }

  if (variant === 'jump') {
    // Startled into a double hop, arms up.
    const scene = new Scene('wide')
    scene.hop(0, 2)
    scene.armL.hold(0, 0.8, '0 -2')
    scene.armR.hold(0, 0.8, '0 -2')
    scene.emote({ eye: 'happy' }, 1, 2)
    scene.bit(glyph('!', 8, -0.3, SPARKLE, 4), 0, 0.8)
    return sprite(scene, 3, null)
  }

  if (variant === 'pumped') {
    // Rolling up its sleeves: arm pumps, a determined squint, a spark.
    const scene = new Scene('squint')
    for (let i = 0; i < 4; i++) {
      scene.armL.at(i * 0.25, i % 2 ? '0 0' : '0 -2')
      scene.armR.at(i * 0.25, i % 2 ? '0 -2' : '0 0')
    }
    scene.armL.at(1, '0 0')
    scene.armR.at(1, '0 0')
    scene.bit(glyph('✦', 18, 1, SPARKLE), 1, 1.6)
    return sprite(scene, 3, null)
  }

  if (variant === 'hello') {
    // A wave and a little "hi".
    const scene = new Scene('happy')
    for (let i = 0; i < 6; i++) scene.armR.at(i * 0.25, i % 2 ? '0 -1' : '0 -2')
    scene.armR.at(1.5, '0 0')
    scene.bit(glyph('hi', 19, 2, SPARKLE, 4), 0.1, 2)
    return sprite(scene, 3, null)
  }

  {
    // A lightbulb flickers on beside the head.
    const scene = new Scene('wide')
    scene.gaze.at(0, '0.5 -0.5')
    scene.hop(0, 1, 0.5)
    const glass = new Track('0', 'opacity')
    glass.at(0.2, '1')
    const rays = new Track('0', 'opacity')
    for (let i = 0; i < 6; i++) rays.hold(0.4 + i * 0.5, 0.25, '1')
    return sprite(scene, 3.6, null, {
      outside: `<g transform="translate(10.5 4.5)">${glass.wrap(BULB_GLASS, 3.6) + rays.wrap(BULB_RAYS, 3.6)}</g>`,
    })
  }
}

// --- What the pet is doing, in words: the SVG's alt text ---------------------

const MOOD_NAMES = ['relaxed', 'exhausted', 'panic'] as const

function petAlt(m: Mood, r: Reaction, act: Activity, isWorking: boolean): string {
  const doing = r !== 'idle' ? r : isWorking ? act : 'idle'
  return `Claude pet: ${MOOD_NAMES[m]}, ${doing}`
}

// --- Statusline fields ---------------------------------------------------------

function tierOf(percent: number | undefined): Mood {
  if (percent === undefined) return 0
  return percent >= 70 ? 2 : percent >= 41 ? 1 : 0
}

// "claude-opus-5-5[1m]" -> "Opus 5.5 (1M)"; a dated id drops its date.
function prettyModel(id: string): string {
  const window = /\[(\w+)\]$/.exec(id)?.[1]
  const parts = id.replace(/\[.*\]$/, '').replace(/^claude-/, '').split('-').filter(p => !/^\d{8}$/.test(p))
  const words = parts.filter(p => !/^\d+$/.test(p)).map(p => p[0]!.toUpperCase() + p.slice(1))
  const version = parts.filter(p => /^\d+$/.test(p)).join('.')
  const name = [words.join(' '), version].filter(Boolean).join(' ') || id
  return window ? `${name} (${window.toUpperCase()})` : name
}

// Worktrees (<repo>/.claude/worktrees/<name>/<sub>) collapse to "🌲 repo/sub";
// everything else gets the home directory shortened to ~.
function displayDir(cwd: string): string {
  const mark = '/.claude/worktrees/'
  const at = cwd.indexOf(mark)
  if (at >= 0) {
    const repoName = cwd.slice(0, at).split('/').pop() ?? ''
    const rest = cwd.slice(at + mark.length)
    const slash = rest.indexOf('/')
    return slash < 0 ? `🌲 ${repoName}` : `🌲 ${repoName}/${rest.slice(slash + 1)}`
  }
  return shorten(cwd.replace(/^\/Users\/[^/]+/, '~'))
}

// Long paths keep their head and last two folders: "~/…/repo/sub".
function shorten(path: string, max = 36): string {
  if (path.length <= max) return path
  const parts = path.split('/')
  const tail = parts.slice(-2).join('/')
  return tail.length + 4 >= max ? `…${path.slice(-(max - 1))}` : `${parts[0]}/…/${tail}`
}

// The branch from .git/HEAD without running git. In a worktree .git is a file
// naming <main repo>/.git/worktrees/<name>: `mainRepo` is then that repo's name.
async function gitOf($: EngineInterface, root: string): Promise<{ branch: string; mainRepo?: string }> {
  let gitdir = `${root}/.git`
  let mainRepo: string | undefined
  if ((await $.fs.stat(gitdir)).kind === 'file') {
    const target = (await $.fs.read(gitdir)).trim().replace(/^gitdir:\s*/, '')
    gitdir = target.startsWith('/') ? target : `${root}/${target}`
    const at = gitdir.indexOf('/.git/worktrees/')
    if (at >= 0) mainRepo = gitdir.slice(0, at).split('/').pop()
  }
  const head = (await $.fs.read(`${gitdir}/HEAD`)).trim()
  const branch = head.startsWith('ref: refs/heads/') ? head.slice('ref: refs/heads/'.length) : head.slice(0, 7)
  return { branch, mainRepo }
}

// Like the statusline: any worktree reads "🌲 <repo>/<sub>", sub being where
// the session is inside the worktree.
function worktreeDir(mainRepo: string, root: string, cwd: string): string {
  const sub = cwd.startsWith(`${root}/`) ? cwd.slice(root.length + 1) : ''
  return shorten(sub ? `🌲 ${mainRepo}/${sub}` : `🌲 ${mainRepo}`)
}

// Long names end in "…" so the line never wraps.
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

async function refreshInfo($: EngineInterface) {
  const [model, cwd, repo] = await Promise.all([$.session.model(), $.session.cwd(), $.session.repo()])
  const git = repo ? await gitOf($, repo.root).catch(() => ({ branch: '', mainRepo: undefined })) : { branch: '' }
  const dir = repo && git.mainRepo ? worktreeDir(git.mainRepo, repo.root, cwd) : displayDir(cwd)
  const next: Info = { model: prettyModel(model), dir, branch: clip(git.branch, 28) }
  const cur = await read($, info)
  if (cur?.model !== next.model || cur.dir !== next.dir || cur.branch !== next.branch) {
    await update($, info, () => next)
  }
}

const TRACK = '#4A4A4A'
const BAR_W = 60
const BAR_H = 8

const SEP_PILL =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 15 16" width="15" height="16">` +
  `<rect x="6" width="3" height="16" rx="1.5" fill="${SEP_TEXT}"/></svg>`

// A smooth bar: a rounded track and a fill of the same height.
function ctxBarSvg(percent: number, color: string): string {
  const fill = Math.max(0, Math.min(100, percent)) / 100 * BAR_W
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BAR_W} ${BAR_H}" width="${BAR_W}" height="${BAR_H}">` +
    `<clipPath id="r"><rect width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/></clipPath>` +
    `<g clip-path="url(#r)"><rect width="${BAR_W}" height="${BAR_H}" fill="${TRACK}"/>` +
    `<rect width="${fill.toFixed(1)}" height="${BAR_H}" fill="${color}"/></g></svg>`
  )
}

// $0.42 · $12.30 · $140
function dollars(usd: number): string {
  return usd >= 100 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`
}

// --- Reactions and activity --------------------------------------------------------

const TOOL_PROPS: Record<string, Activity> = {
  Edit: 'build', MultiEdit: 'build', NotebookEdit: 'build',
  Write: 'write',
  Read: 'look', Grep: 'look', Glob: 'look', LS: 'look', ToolSearch: 'look',
  WebFetch: 'web', WebSearch: 'web',
  Bash: 'type', BashOutput: 'type', KillShell: 'type', PowerShell: 'type',
  Agent: 'clone', Task: 'clone',
  TodoWrite: 'todo', TaskCreate: 'todo', TaskUpdate: 'todo', TaskList: 'todo', TaskGet: 'todo',
  LSP: 'look', SendMessage: 'clone', ListAgents: 'clone',
  SendUserFile: 'write', Artifact: 'write', AskUserQuestion: 'think',
}

// MCP tools by what they do; anything else gets the magic wand.
// A shell command can say more than its tool: shipping, cleaning up, testing.
function commandActivity(command: string): Activity | undefined {
  if (/\b(git push|gh pr merge|deploy|publish|release)\b/.test(command)) return 'rocket'
  if (/(^|[\s;&|])(rm|rmdir|trash)\s|\b(clean|prune|delete)\b/.test(command)) return 'broom'
  if (/\b(test|pytest|jest|vitest|playwright|mocha|rspec|go test|cargo test)\b/.test(command)) return 'test'
  return undefined
}

function activityOf(tool: string): Activity {
  const known = TOOL_PROPS[tool]
  if (known) return known
  if (/browser|chrome|navigate|fetch|web/i.test(tool)) return 'web'
  if (/plan|todo|task/i.test(tool)) return 'todo'
  if (/read|search|find|list|get/i.test(tool)) return 'look'
  if (/write|edit|create|update|doc/i.test(tool)) return 'write'
  return 'magic'
}

let revert: Timer | undefined
let sleep: Timer | undefined
let shownAt = 0 // when the current prop took over
let contextWindow = 0 // tokens, from the last measurement

async function react($: EngineInterface, next: Reaction, ms?: number) {
  revert?.cancel()
  revert = undefined
  if ((await read($, reaction)) !== next) await update($, reaction, () => next)
  if (ms !== undefined) {
    revert = $.clock.after(ms, () => void react($, 'idle'))
  }
}

async function doing($: EngineInterface, next: Activity) {
  if ((await read($, activity)) !== next) await update($, activity, () => next)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // A (re)load starts with no timers: clear what one would have reverted.
    await react($, 'idle')
    await doing($, 'idle')
    await refreshInfo($).catch(() => undefined)

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const percent = e.context.percent
    contextWindow = e.context.window
    const tier = tierOf(percent)
    if ((await read($, mood)) !== tier) await update($, mood, () => tier)
    if (percent !== undefined && (await read($, ctx)) !== percent) await update($, ctx, () => percent)
    const usd = e.cost?.usd
    const was = await read($, cost)
    if (usd !== undefined && was !== usd) {
      await update($, cost, () => usd)
      // Passing $5, $10, $25... gets a reaction (not the first reading).
      if (was !== null && COST_MILESTONES.some(mark => was < mark && usd >= mark)) await react($, 'money', REACTION_MS)
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    sleep?.cancel()
    await doing($, 'think')
    await react($, 'heard', HEARD_MS)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    // A new prop takes over only once the current one has had its time.
    const now = await $.clock.now()
    const current = await read($, activity)
    const command = e.tool === 'Bash' ? String((e as { command?: unknown }).command ?? '') : ''
    const wanted = commandActivity(command) ?? activityOf(String(e.tool))
    if (wanted !== current && (current === 'think' || current === 'idle' || now - shownAt >= MIN_HOLD_MS)) {
      await doing($, wanted)
      shownAt = now
    }
    const ran = await next(e)
    const failed = ran.deny === undefined && ran.isError === true
    if ((await read($, activity)) === 'test') {
      // The tube shows the result for its own hold.
      await doing($, failed ? 'fail' : 'pass')
      shownAt = await $.clock.now()
    } else if (failed) await react($, 'oops', REACTION_MS)

    return ran
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (String(e.trigger) !== 'precompute' && !('skip' in done && done.skip)) {
      // The bar refills only on the next response; estimate it now from the summary's size.
      if (e.agentId === undefined && contextWindow > 0 && 'tokensAfter' in done && done.tokensAfter !== undefined) {
        const percent = Math.min(100, Math.round((done.tokensAfter / contextWindow) * 100))
        await update($, ctx, () => percent)
        await update($, mood, () => tierOf(percent))
      }
      await react($, 'relief', REACTION_MS)
    }

    return done
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    // A subagent's turn ending is no reason to cheer.
    if (e.agentId !== undefined) return next(e)
    await doing($, 'idle')
    // A long task: confetti when relaxed, worn out otherwise.
    const long = e.durationMs > LONG_TURN_MS
    await react($, long ? ((await read($, mood)) === 0 ? 'party' : 'phew') : 'done', REACTION_MS)
    sleep?.cancel()
    sleep = $.clock.after(SLEEP_AFTER_MS, () => void react($, 'sleepy'))
    await refreshInfo($).catch(() => undefined)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // The terminal keeps its own statusline (the repo's bash pet): draw nothing there.
    if (e.props.hasSurvey || e.surface === 'terminal') return next(e)

    const m = await read($, mood)
    const r = await read($, reaction)
    const act = await read($, activity)
    const used = await read($, ctx)
    const spent = await read($, cost)
    const fields = await read($, info)
    // Working when the engine says so, or between a sent message and its turn's end.
    const isWorking = e.props.isWorking || act !== 'idle'
    const { Box, Text, Svg } = $.ui.resolve(e)

    // A bold pill between fields.
    const sep = (
      <Box flexShrink={0}>
        <Svg source={SEP_PILL} alt="|" width={15} height={16} />
      </Box>
    )
    const ctxColor = used === null ? GREEN : used >= 70 ? ALERT : used >= 41 ? YELLOW : GREEN
    // The CTX bar: one even-height SVG bar.
    const bar =
      used === null ? null : <Svg source={ctxBarSvg(used, ctxColor)} alt={`Context ${Math.round(used)}% used`} width={BAR_W} height={BAR_H} />
    const line = (
      <Box flexDirection="row" flexWrap="nowrap" alignItems="center" flexShrink={1} minWidth={0} overflow="hidden">
        {fields?.model ? <Text color={MODEL_TEXT} bold wrap="truncate-end">{fields.model}</Text> : null}
        {fields?.model ? sep : null}
        {fields ? <Text color={DIR_TEXT} wrap="truncate-middle">{fields.dir}</Text> : null}
        {fields?.branch ? sep : null}
        {fields?.branch ? <Text color={BRANCH_TEXT} wrap="truncate-end">{fields.branch}</Text> : null}
        {used !== null ? sep : null}
        {used !== null ? <Text color={ctxColor} bold wrap="truncate-end">CTX </Text> : null}
        {bar}
        {used !== null ? <Text color={ctxColor} bold wrap="truncate-end"> {Math.round(used)}%</Text> : null}
        {spent !== null ? sep : null}
        {spent !== null ? <Text color={COST_TEXT} wrap="truncate-end">{dollars(spent)}</Text> : null}
      </Box>
    )

    return (
      <Box flexDirection="row" alignItems="center" gap={1} minWidth={0}>
        <Box flexShrink={0}>
          <Svg
            source={stablePet(m, r, act, isWorking)}
            alt={petAlt(m, r, act, isWorking)}
            width={VIEW.w * SCALE}
            height={VIEW.h * SCALE}
            isInteractive
          />
        </Box>
        {line}
      </Box>
    )
  })
}
