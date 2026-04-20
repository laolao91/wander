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
    screen: { name: 'POI_LIST', pois: [] },
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
      actions: ['navigate', 'back'],
      cursorIndex: 0,
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
