import { describe, it, expect, vi, beforeEach } from 'vitest'
import { translateGlassesEvent, _resetBridgeEventState } from '../bridge'
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
      makeBridge(),
    )
    expect(dispatch).toHaveBeenCalledWith({ type: 'tap', itemIndex: 3 })
  })

  it('SCROLL_TOP/BOTTOM map to cursor-up/cursor-down', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(
      listEvt(OsEventTypeList.SCROLL_TOP_EVENT),
      poiListState(),
      dispatch,
      makeBridge(),
    )
    _resetBridgeEventState() // clear scroll cooldown between intentional calls
    translateGlassesEvent(
      listEvt(OsEventTypeList.SCROLL_BOTTOM_EVENT),
      poiListState(),
      dispatch,
      makeBridge(),
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
      bridge,
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
      makeBridge(),
    )
    expect(dispatch).toHaveBeenCalledWith({ type: 'tap' })
  })

  it('SCROLL_TOP/BOTTOM map to cursor-up/cursor-down on detail', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(
      textEvt(OsEventTypeList.SCROLL_TOP_EVENT),
      detailState(),
      dispatch,
      makeBridge(),
    )
    _resetBridgeEventState()
    translateGlassesEvent(
      textEvt(OsEventTypeList.SCROLL_BOTTOM_EVENT),
      detailState(),
      dispatch,
      makeBridge(),
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
      bridge,
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
      bridge,
    )
    expect(dispatch).toHaveBeenCalledWith({ type: 'back' })
    expect(bridge.shutDownPageContainer).not.toHaveBeenCalled()
  })

  it('ignores events with no payload', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent({}, detailState(), dispatch, makeBridge())
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
      makeBridge(),
    )
    expect(dispatch).toHaveBeenCalledWith({ type: 'tap', itemIndex: 2 })
  })

  it('textEvent with undefined eventType is treated as CLICK', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(
      { textEvent: new Text_ItemEvent({}) },
      detailState(),
      dispatch,
      makeBridge(),
    )
    expect(dispatch).toHaveBeenCalledWith({ type: 'tap' })
  })

  it('sysEvent with undefined eventType is treated as CLICK (simulator path)', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(
      { sysEvent: new Sys_ItemEvent({}) },
      detailState(),
      dispatch,
      makeBridge(),
    )
    expect(dispatch).toHaveBeenCalledWith({ type: 'tap' })
  })

  it('scroll cooldown: a second scroll within 300ms is dropped', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(
      textEvt(OsEventTypeList.SCROLL_BOTTOM_EVENT),
      detailState(),
      dispatch,
      makeBridge(),
    )
    // Intentionally NO reset — simulate a boundary bounce firing twice
    // back-to-back within the cooldown window.
    translateGlassesEvent(
      textEvt(OsEventTypeList.SCROLL_BOTTOM_EVENT),
      detailState(),
      dispatch,
      makeBridge(),
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
      makeBridge(),
    )
    translateGlassesEvent(
      listEvt(OsEventTypeList.SCROLL_BOTTOM_EVENT),
      poiListState(),
      dispatch,
      makeBridge(),
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
      makeBridge(),
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
      makeBridge(),
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
      makeBridge(),
    )
    expect(dispatch).toHaveBeenCalledWith({ type: 'tap' })
  })
})

// B2 regression tests — widen double-tap window + counter-reset on screen change
// Filed 2026-05-02: Android BLE adds ~200ms latency per event, so a deliberate
// double-tap in ~150ms arrives at the software layer ~350ms apart — right at or
// past the old 350ms boundary. Extended window to 500ms to absorb real-world BLE lag.
describe('manual back-tap detector — B2 timing regression', () => {
  it('two taps 451ms apart still fire back (BLE latency window)', () => {
    // With the OLD 350ms window, tap 2 at +451ms is outside the window so
    // both taps register as independent taps (no back). With the new 500ms
    // window, tap 2 is still inside and produces back.
    //
    // Strategy: use mockImplementation with a values queue so we control exactly
    // what each Date.now() call returns regardless of how many calls the bridge
    // makes internally. The tap-1 sequence contains 3 Date.now() calls (2 from
    // SDK internals + 1 from isManualExitTap), tap-2 contains 1. We set the
    // last 2 values (calls 3 and 4) to t1 and t1+451 so that:
    //   - tap-1's isManualExitTap sees t1 → _lastClickAt = t1
    //   - tap-2's isManualExitTap sees t1+451 → gap is 451ms
    // With 500ms window: 451 < 500 → back. With OLD 350ms: 451 > 350 → tap.
    const t1 = 1000
    const t2 = t1 + 451  // 451ms gap — inside 500ms window but outside old 350ms
    const values = [0, 0, t1, t2]  // primed for the known 3+1 call pattern
    let idx = 0
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      const v = idx < values.length ? values[idx] : t2
      idx++
      return v
    })

    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())

    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'tap' })
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'back' })
    expect(dispatch).toHaveBeenCalledTimes(2)

    nowSpy.mockRestore()
  })

  it('_resetBridgeEventState clears counter so next tap does not carry over', () => {
    // Simulate a tap on one screen, then a screen transition (which calls reset),
    // then confirm the very next tap on the new screen is treated as tap-1 only.
    const dispatch = vi.fn<(e: Event) => void>()
    // Tap on the first screen — sets _clickCount to 1.
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())

    // Screen change fires — reset the counter (as dispatch() in initGlasses will do).
    _resetBridgeEventState()

    // Immediate tap on the new screen — would be back if count hadn't reset.
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())

    // Only two dispatches; the second must be tap (not back) because the counter reset.
    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'tap' })
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'back' })
  })

  it('POI_DETAIL → POI_ACTIONS does NOT reset counter (B1 double-tap carries through)', () => {
    // The double-tap-to-go-back gesture from POI_DETAIL spans the POI_DETAIL →
    // POI_ACTIONS transition: tap 1 opens the actions menu, tap 2 (rapid) fires
    // `back` from POI_ACTIONS → POI_LIST. The counter must NOT be reset when
    // dispatch() transitions POI_DETAIL → POI_ACTIONS, otherwise tap 2 would
    // execute the first action (navigate) instead of going back.
    //
    // We test this at the translateGlassesEvent level by sending two clicks
    // WITHOUT calling _resetBridgeEventState between them (simulating the
    // bridge NOT resetting on this specific transition).
    //
    // Click 1 → tap (opens POI_ACTIONS). No reset. Click 2 → back.
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())
    // Deliberately do NOT call _resetBridgeEventState() here — this mirrors the
    // bridge.ts behaviour where POI_DETAIL → POI_ACTIONS skips the reset.
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())

    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'tap' })
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'back' })
  })
})

// Phase F/H → v1.2 manual multi-tap back detector (2026-04-26/27 → 2026-05-02)
// The SDK's DOUBLE_CLICK_EVENT is unreliable on real BLE. We fall back
// to counting raw CLICK_EVENTs within a 500ms window (widened from 350ms in B2).
// On the 2nd tap, `tap` is suppressed and only `back` is dispatched to prevent
// accidentally executing an action while backing out.
describe('manual back-tap detector', () => {
  it('single click dispatches tap only (no back)', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(
      textEvt(OsEventTypeList.CLICK_EVENT),
      detailState(),
      dispatch,
      makeBridge(),
    )
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({ type: 'tap' })
  })

  it('two rapid clicks on a text screen: click 1 → tap, click 2 → back only (tap suppressed)', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    // Click 1
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())
    // Click 2 (immediate — well within 350ms window)
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())

    // Call 1: tap (click 1)
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'tap' })
    // Call 2: back only (click 2 — tap is suppressed)
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'back' })
    expect(dispatch).toHaveBeenCalledTimes(2)
  })

  it('two rapid clicks on a list screen: click 1 → tap+itemIndex, click 2 → back only', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(listEvt(OsEventTypeList.CLICK_EVENT, 1), poiListState(), dispatch, makeBridge())
    translateGlassesEvent(listEvt(OsEventTypeList.CLICK_EVENT, 1), poiListState(), dispatch, makeBridge())

    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'tap', itemIndex: 1 })
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'back' })
    expect(dispatch).toHaveBeenCalledTimes(2)
  })

  it('triple-tap: back fires on the 2nd click; 3rd click starts fresh as tap', () => {
    // Simulates a user who triple-taps.
    // back fires on click 2; click 3 starts a fresh sequence.
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())

    // Calls: tap (click 1), back (click 2, tap suppressed), tap (click 3 starts fresh)
    const calls = dispatch.mock.calls.map((c) => c[0])
    expect(calls.filter((c) => (c as Event).type === 'back')).toHaveLength(1)
    expect(calls.filter((c) => (c as Event).type === 'tap')).toHaveLength(2)
  })

  it('triple-tap with SDK debouncing one click: 2 clicks received → still fires back', () => {
    // SDK drops the middle click of a three-tap gesture — we receive 2.
    // Since 2 >= 2, back still fires.
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())

    const calls = dispatch.mock.calls.map((c) => (c[0] as Event).type)
    expect(calls).toContain('back')
  })

  it('slow second tap (outside window) resets the sequence — no back', () => {
    // We can't control Date.now() directly in node, but _resetBridgeEventState
    // resets _lastClickAt to 0 — simulating an expired window.
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())
    // Simulate time passing by resetting state (same effect as window expiry)
    _resetBridgeEventState()
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())

    // Both clicks are treated as first-taps of their own sequences.
    const calls = dispatch.mock.calls.map((c) => (c[0] as Event).type)
    expect(calls).not.toContain('back')
    expect(calls.every((t) => t === 'tap')).toBe(true)
  })

  it('after a detected back-tap, the next single click does NOT re-trigger back', () => {
    // _clickCount resets to 0 after firing — the next tap starts fresh.
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())
    // At this point back has fired and count is reset.

    dispatch.mockClear()
    // A third tap within the window: count goes from 0 → 1, not >= 2 → no back.
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())
    expect(dispatch).toHaveBeenCalledWith({ type: 'tap' })
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'back' })
  })
})
