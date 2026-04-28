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

  it('DOUBLE_CLICK on the list dispatches request-exit (confirmation prompt)', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    const bridge = makeBridge()
    translateGlassesEvent(
      listEvt(OsEventTypeList.DOUBLE_CLICK_EVENT),
      poiListState(),
      dispatch,
      bridge,
    )
    expect(dispatch).toHaveBeenCalledWith({ type: 'request-exit' })
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

  it('DOUBLE_CLICK on POI_DETAIL now dispatches request-exit (unified flow)', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    const bridge = makeBridge()
    translateGlassesEvent(
      textEvt(OsEventTypeList.DOUBLE_CLICK_EVENT),
      detailState(),
      dispatch,
      bridge,
    )
    expect(dispatch).toHaveBeenCalledWith({ type: 'request-exit' })
    expect(bridge.shutDownPageContainer).not.toHaveBeenCalled()
  })

  it('DOUBLE_CLICK on a top-level screen surfaces the exit prompt', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    const bridge = makeBridge()
    translateGlassesEvent(
      textEvt(OsEventTypeList.DOUBLE_CLICK_EVENT),
      { ...INITIAL_STATE, screen: { name: 'ERROR_LOCATION', message: 'x' } },
      dispatch,
      bridge,
    )
    expect(dispatch).toHaveBeenCalledWith({ type: 'request-exit' })
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

  it('DOUBLE_CLICK on NAV_ACTIVE surfaces exit prompt (unified)', () => {
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
    expect(dispatch).toHaveBeenCalledWith({ type: 'request-exit' })
  })

  it('DOUBLE_CLICK on WIKI_READ surfaces exit prompt (unified)', () => {
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
    expect(dispatch).toHaveBeenCalledWith({ type: 'request-exit' })
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

// Phase F/H manual multi-tap exit detector (2026-04-26/27)
// The SDK's DOUBLE_CLICK_EVENT is unreliable on real BLE. We fall back
// to counting raw CLICK_EVENTs within a 350ms window. Fires on count >= 2
// so a triple-tap gesture works even when the SDK debounces one click.
describe('manual exit-tap detector', () => {
  it('single click dispatches tap only (no request-exit)', () => {
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

  it('two rapid clicks on a text screen dispatch tap then tap+request-exit', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    // Click 1
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())
    // Click 2 (immediate — well within 350ms window)
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())

    // Call 1: tap (click 1)
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'tap' })
    // Call 2: tap (click 2, before exit check)
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'tap' })
    // Call 3: request-exit (exit tap detected on click 2)
    expect(dispatch).toHaveBeenNthCalledWith(3, { type: 'request-exit' })
    expect(dispatch).toHaveBeenCalledTimes(3)
  })

  it('two rapid clicks on a list screen dispatch tap+itemIndex then request-exit', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(listEvt(OsEventTypeList.CLICK_EVENT, 1), poiListState(), dispatch, makeBridge())
    translateGlassesEvent(listEvt(OsEventTypeList.CLICK_EVENT, 1), poiListState(), dispatch, makeBridge())

    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'tap', itemIndex: 1 })
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'tap', itemIndex: 1 })
    expect(dispatch).toHaveBeenNthCalledWith(3, { type: 'request-exit' })
    expect(dispatch).toHaveBeenCalledTimes(3)
  })

  it('triple-tap fires request-exit on the 2nd click (resilient to debounced 3rd)', () => {
    // Simulates a user who triple-taps but the SDK delivers all 3.
    // request-exit fires on click 2; click 3 starts a fresh sequence.
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())

    // Calls: tap, tap, request-exit (click 2), tap (click 3 starts fresh)
    const calls = dispatch.mock.calls.map((c) => c[0])
    expect(calls.filter((c) => (c as Event).type === 'request-exit')).toHaveLength(1)
    expect(calls.filter((c) => (c as Event).type === 'tap')).toHaveLength(3)
  })

  it('triple-tap with SDK debouncing one click: 2 clicks received → still fires', () => {
    // SDK drops the middle click of a three-tap gesture — we receive 2.
    // Since 2 >= 2, request-exit still fires. This is the main motivation
    // for the count-based approach over exactly-2.
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())

    const calls = dispatch.mock.calls.map((c) => (c[0] as Event).type)
    expect(calls).toContain('request-exit')
  })

  it('slow second tap (outside window) resets the sequence — no exit', () => {
    // We can't control Date.now() directly in node, but _resetBridgeEventState
    // resets _lastClickAt to 0 — simulating an expired window.
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())
    // Simulate time passing by resetting state (same effect as window expiry)
    _resetBridgeEventState()
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())

    // Both clicks are treated as first-taps of their own sequences.
    const calls = dispatch.mock.calls.map((c) => (c[0] as Event).type)
    expect(calls).not.toContain('request-exit')
    expect(calls.every((t) => t === 'tap')).toBe(true)
  })

  it('after a detected exit-tap, the next single click does NOT re-trigger exit', () => {
    // _clickCount resets to 0 after firing — the next tap starts fresh.
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())
    // At this point request-exit has fired and count is reset.

    dispatch.mockClear()
    // A third tap within the window: count goes from 0 → 1, not >= 2 → no exit.
    translateGlassesEvent(textEvt(OsEventTypeList.CLICK_EVENT), detailState(), dispatch, makeBridge())
    expect(dispatch).toHaveBeenCalledWith({ type: 'tap' })
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'request-exit' })
  })
})
