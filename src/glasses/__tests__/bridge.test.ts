import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  translateGlassesEvent,
  _resetBridgeEventState,
  isReconnectTransition,
  isLowBattery,
  LOW_BATTERY_THRESHOLD,
  createInFlightGuard,
} from '../bridge'
import { INITIAL_STATE, type AppState, type Event } from '../state'
import {
  List_ItemEvent,
  OsEventTypeList,
  Sys_ItemEvent,
  Text_ItemEvent,
} from '@evenrealities/even_hub_sdk'

const listEvt = (
  eventType: OsEventTypeList,
  currentSelectItemIndex?: number,
) => ({
  listEvent: new List_ItemEvent({ eventType, currentSelectItemIndex }),
})

const textEvt = (eventType: OsEventTypeList) => ({
  textEvent: new Text_ItemEvent({ eventType }),
})

// Touch Sys_ItemEvent so the import isn't unused — the bridge handles
// sys events via the same code path as text events.
void Sys_ItemEvent

function poiListState(): AppState {
  return {
    ...INITIAL_STATE,
    screen: { name: 'POI_LIST', pois: [], hasMore: false },
  }
}

function detailState(): AppState {
  return {
    ...INITIAL_STATE,
    screen: {
      name: 'POI_DETAIL',
      poi: {
        id: 'x',
        name: 'X',
        category: 'park',
        categoryIcon: '★',
        lat: 0,
        lng: 0,
        distanceMeters: 0,
        distanceMiles: 0,
        bearingDegrees: 0,
        walkMinutes: 0,
        wikiTitle: null,
        wikiSummary: null,
        websiteUrl: null,
        source: 'osm',
        openingHours: null,
        isOpenNow: null,
      },
    },
  }
}

function makeBridge() {
  return { shutDownPageContainer: vi.fn() }
}

beforeEach(() => {
  _resetBridgeEventState()
})

describe('translateGlassesEvent — listEvent', () => {
  it('CLICK_EVENT dispatches tap with itemIndex', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(
      listEvt(OsEventTypeList.CLICK_EVENT, 3),
      poiListState(),
      dispatch,
    )
    expect(dispatch).toHaveBeenCalledWith({ type: 'tap', itemIndex: 3 })
  })

  it('SCROLL_TOP/BOTTOM map to cursor-up/cursor-down', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(
      listEvt(OsEventTypeList.SCROLL_TOP_EVENT),
      poiListState(),
      dispatch,
    )
    _resetBridgeEventState() // clear scroll cooldown between intentional calls
    translateGlassesEvent(
      listEvt(OsEventTypeList.SCROLL_BOTTOM_EVENT),
      poiListState(),
      dispatch,
    )
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'cursor-up' })
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'cursor-down' })
  })

  it('DOUBLE_CLICK on the list dispatches back (go to previous screen / exit)', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    const bridge = makeBridge()
    translateGlassesEvent(
      listEvt(OsEventTypeList.DOUBLE_CLICK_EVENT),
      poiListState(),
      dispatch,
    )
    expect(dispatch).toHaveBeenCalledWith({ type: 'back' })
    expect(bridge.shutDownPageContainer).not.toHaveBeenCalled()
  })
})

describe('translateGlassesEvent — text/sys events', () => {
  it('CLICK_EVENT on detail dispatches tap (no itemIndex)', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(
      textEvt(OsEventTypeList.CLICK_EVENT),
      detailState(),
      dispatch,
    )
    expect(dispatch).toHaveBeenCalledWith({ type: 'tap' })
  })

  it('SCROLL_TOP/BOTTOM map to cursor-up/cursor-down on detail', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(
      textEvt(OsEventTypeList.SCROLL_TOP_EVENT),
      detailState(),
      dispatch,
    )
    _resetBridgeEventState()
    translateGlassesEvent(
      textEvt(OsEventTypeList.SCROLL_BOTTOM_EVENT),
      detailState(),
      dispatch,
    )
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'cursor-up' })
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'cursor-down' })
  })

  it('DOUBLE_CLICK on POI_DETAIL dispatches back (unified: prev screen)', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    const bridge = makeBridge()
    translateGlassesEvent(
      textEvt(OsEventTypeList.DOUBLE_CLICK_EVENT),
      detailState(),
      dispatch,
    )
    expect(dispatch).toHaveBeenCalledWith({ type: 'back' })
    expect(bridge.shutDownPageContainer).not.toHaveBeenCalled()
  })

  it('DOUBLE_CLICK on a top-level screen dispatches back (reducer triggers exit)', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    const bridge = makeBridge()
    translateGlassesEvent(
      textEvt(OsEventTypeList.DOUBLE_CLICK_EVENT),
      { ...INITIAL_STATE, screen: { name: 'ERROR_LOCATION', message: 'x' } },
      dispatch,
    )
    expect(dispatch).toHaveBeenCalledWith({ type: 'back' })
    expect(bridge.shutDownPageContainer).not.toHaveBeenCalled()
  })

  it('ignores events with no payload', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent({}, detailState(), dispatch)
    expect(dispatch).not.toHaveBeenCalled()
  })
})

// Phase 1 fixes — HANDOFF §A1–A4. These cover real-hardware quirks that
// the previous translation didn't handle.
describe('translateGlassesEvent — Phase 1 fixes', () => {
  it('listEvent with undefined eventType is treated as CLICK (SDK quirk)', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(
      // eventType omitted → deserializes as undefined over real BLE bridge
      { listEvent: new List_ItemEvent({ currentSelectItemIndex: 2 }) },
      poiListState(),
      dispatch,
    )
    expect(dispatch).toHaveBeenCalledWith({ type: 'tap', itemIndex: 2 })
  })

  it('textEvent with undefined eventType is treated as CLICK', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(
      { textEvent: new Text_ItemEvent({}) },
      detailState(),
      dispatch,
    )
    expect(dispatch).toHaveBeenCalledWith({ type: 'tap' })
  })

  it('sysEvent with undefined eventType is treated as CLICK (simulator path)', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(
      { sysEvent: new Sys_ItemEvent({}) },
      detailState(),
      dispatch,
    )
    expect(dispatch).toHaveBeenCalledWith({ type: 'tap' })
  })

  it('scroll cooldown: a second scroll within 300ms is dropped', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(
      textEvt(OsEventTypeList.SCROLL_BOTTOM_EVENT),
      detailState(),
      dispatch,
    )
    // Intentionally NO reset — simulate a boundary bounce firing twice
    // back-to-back within the cooldown window.
    translateGlassesEvent(
      textEvt(OsEventTypeList.SCROLL_BOTTOM_EVENT),
      detailState(),
      dispatch,
    )
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({ type: 'cursor-down' })
  })

  it('scroll cooldown absorbs a rapid direction reversal (still a bounce)', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(
      listEvt(OsEventTypeList.SCROLL_TOP_EVENT),
      poiListState(),
      dispatch,
    )
    translateGlassesEvent(
      listEvt(OsEventTypeList.SCROLL_BOTTOM_EVENT),
      poiListState(),
      dispatch,
    )
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({ type: 'cursor-up' })
  })

  it('DOUBLE_CLICK on NAV_ACTIVE dispatches back (returns to POI_DETAIL)', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(
      textEvt(OsEventTypeList.DOUBLE_CLICK_EVENT),
      {
        ...INITIAL_STATE,
        screen: {
          name: 'NAV_ACTIVE',
          destination: detailState().screen.name === 'POI_DETAIL'
            ? (detailState().screen as any).poi
            : (null as any),
          route: { totalDistanceMeters: 0, totalDurationSeconds: 0, steps: [], geometry: [] },
          currentStepIndex: 0,
          position: null,
          hasArrived: false,
        } as any,
      },
      dispatch,
    )
    expect(dispatch).toHaveBeenCalledWith({ type: 'back' })
  })

  it('DOUBLE_CLICK on WIKI_READ dispatches back (returns to POI_DETAIL)', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(
      textEvt(OsEventTypeList.DOUBLE_CLICK_EVENT),
      {
        ...INITIAL_STATE,
        screen: {
          name: 'WIKI_READ',
          poi: (detailState().screen as any).poi,
          pages: ['p1', 'p2'],
          pageIndex: 0,
        } as any,
      },
      dispatch,
    )
    expect(dispatch).toHaveBeenCalledWith({ type: 'back' })
  })

  it('listEvent with unknown type falls through to textEvent when present', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(
      {
        // Unrecognized listEvent (e.g. a future SDK enum value) + a
        // meaningful textEvent should not be silently eaten.
        listEvent: new List_ItemEvent({ eventType: 999 as OsEventTypeList }),
        textEvent: new Text_ItemEvent({ eventType: OsEventTypeList.CLICK_EVENT }),
      },
      detailState(),
      dispatch,
    )
    expect(dispatch).toHaveBeenCalledWith({ type: 'tap' })
  })
})

// Phase F/H → v1.2 manual multi-tap back detector (2026-04-26/27 → 2026-05-02)
// The SDK's DOUBLE_CLICK_EVENT is unreliable on real BLE. We fall back
// to counting raw CLICK_EVENTs within a 350ms window. On the 2nd tap,
// `tap` is suppressed and only `back` is dispatched to prevent accidentally
// executing an action while backing out.
describe('manual back-tap detector', () => {
  it('single click dispatches tap only (no back)', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(
      textEvt(OsEventTypeList.CLICK_EVENT),
      detailState(),
      dispatch,
    )
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({ type: 'tap' })
  })

  it('two rapid clicks on a text screen: click 1 → tap, click 2 → back only (tap suppressed)', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    // Click 1
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch)
    // Click 2 (immediate — well within 350ms window)
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch)

    // Call 1: tap (click 1)
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'tap' })
    // Call 2: back only (click 2 — tap is suppressed)
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'back' })
    expect(dispatch).toHaveBeenCalledTimes(2)
  })

  it('two rapid clicks on a list screen: click 1 → tap+itemIndex, click 2 → back only', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(listEvt(OsEventTypeList.CLICK_EVENT, 1), poiListState(), dispatch)
    translateGlassesEvent(listEvt(OsEventTypeList.CLICK_EVENT, 1), poiListState(), dispatch)

    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'tap', itemIndex: 1 })
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'back' })
    expect(dispatch).toHaveBeenCalledTimes(2)
  })

  it('triple-tap: back fires on the 2nd click; 3rd click starts fresh as tap', () => {
    // Simulates a user who triple-taps.
    // back fires on click 2; click 3 starts a fresh sequence.
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch)
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch)
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch)

    // Calls: tap (click 1), back (click 2, tap suppressed), tap (click 3 starts fresh)
    const calls = dispatch.mock.calls.map((c) => c[0])
    expect(calls.filter((c) => (c as Event).type === 'back')).toHaveLength(1)
    expect(calls.filter((c) => (c as Event).type === 'tap')).toHaveLength(2)
  })

  it('triple-tap with SDK debouncing one click: 2 clicks received → still fires back', () => {
    // SDK drops the middle click of a three-tap gesture — we receive 2.
    // Since 2 >= 2, back still fires.
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch)
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch)

    const calls = dispatch.mock.calls.map((c) => (c[0] as Event).type)
    expect(calls).toContain('back')
  })

  it('slow second tap (outside window) resets the sequence — no back', () => {
    // We can't control Date.now() directly in node, but _resetBridgeEventState
    // resets _lastClickAt to 0 — simulating an expired window.
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch)
    // Simulate time passing by resetting state (same effect as window expiry)
    _resetBridgeEventState()
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch)

    // Both clicks are treated as first-taps of their own sequences.
    const calls = dispatch.mock.calls.map((c) => (c[0] as Event).type)
    expect(calls).not.toContain('back')
    expect(calls.every((t) => t === 'tap')).toBe(true)
  })

  it('after a detected back-tap, the next single click does NOT re-trigger back', () => {
    // _clickCount resets to 0 after firing — the next tap starts fresh.
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch)
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch)
    // At this point back has fired and count is reset.

    dispatch.mockClear()
    // A third tap within the window: count goes from 0 → 1, not >= 2 → no back.
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch)
    expect(dispatch).toHaveBeenCalledWith({ type: 'tap' })
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'back' })
  })
})

// ─── isReconnectTransition (N2 — device-status reactions) ─────────────

describe('isReconnectTransition', () => {
  it('true on a false → true transition', () => {
    expect(isReconnectTransition(false, true)).toBe(true)
  })

  it('false when already connected (true → true)', () => {
    expect(isReconnectTransition(true, true)).toBe(false)
  })

  it('false when going disconnected (true → false)', () => {
    expect(isReconnectTransition(true, false)).toBe(false)
  })

  it('false on the very first callback (null → true) — not a reconnect', () => {
    expect(isReconnectTransition(null, true)).toBe(false)
  })

  it('false staying disconnected (false → false)', () => {
    expect(isReconnectTransition(false, false)).toBe(false)
  })
})

// ─── isLowBattery (N3 — battery-aware minimap degradation) ────────────

describe('isLowBattery', () => {
  it('true below the threshold', () => {
    expect(isLowBattery(LOW_BATTERY_THRESHOLD - 1)).toBe(true)
  })

  it('false at or above the threshold', () => {
    expect(isLowBattery(LOW_BATTERY_THRESHOLD)).toBe(false)
    expect(isLowBattery(100)).toBe(false)
  })

  it('false when battery is unknown (null/undefined) — never degrade on missing data', () => {
    expect(isLowBattery(null)).toBe(false)
    expect(isLowBattery(undefined)).toBe(false)
  })
})

// ─── createInFlightGuard (M3 — minimap push serialization) ────────────
//
// initGlasses wires one guard instance around the NAV_ACTIVE minimap push
// call site (pushMinimap) so an overlapping position update can't kick off
// a second encode+BLE-send while one is already running. The guard itself
// has all the real logic to get wrong, so it's tested here in complete
// isolation from the SDK bridge/fetch/minimap machinery — see task-13
// notes: the brief originally assumed bridge.test.ts already had a DI seam
// for encodeMinimapPng/initGlasses; it doesn't, so we test the extracted
// guard directly instead of standing up a full mocked-SDK harness.
describe('createInFlightGuard', () => {
  it('skips a second task while the first is still in flight', async () => {
    const guard = createInFlightGuard()
    let resolveFirst: () => void = () => {}
    const first = vi.fn(() => new Promise<void>((r) => { resolveFirst = r }))
    const second = vi.fn(async () => {})

    guard.runIfIdle(first)
    guard.runIfIdle(second) // dropped — first hasn't resolved yet

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()

    resolveFirst()
    await Promise.resolve() // let the first task's promise settle
    await Promise.resolve() // let the .finally() microtask run and clear `busy`

    guard.runIfIdle(second) // idle again — should run
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('runs the task immediately when idle', () => {
    const guard = createInFlightGuard()
    const task = vi.fn(async () => {})
    guard.runIfIdle(task)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('runs a third task normally once a second (skipped) attempt has come and gone', async () => {
    // Guards against a subtle bug: a dropped call must not itself leave
    // `busy` stuck true, and must not somehow "queue" — only genuinely
    // idle calls run.
    const guard = createInFlightGuard()
    let resolveFirst: () => void = () => {}
    const first = vi.fn(() => new Promise<void>((r) => { resolveFirst = r }))
    const skipped = vi.fn(async () => {})
    const third = vi.fn(async () => {})

    guard.runIfIdle(first)
    guard.runIfIdle(skipped) // dropped while first is in flight
    resolveFirst()
    await Promise.resolve()
    await Promise.resolve()

    guard.runIfIdle(third)
    expect(skipped).not.toHaveBeenCalled()
    expect(third).toHaveBeenCalledTimes(1)
  })
})
