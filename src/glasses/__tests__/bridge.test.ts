import { describe, it, expect, vi } from 'vitest'
import { translateGlassesEvent } from '../bridge'
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
    translateGlassesEvent(
      listEvt(OsEventTypeList.SCROLL_BOTTOM_EVENT),
      poiListState(),
      dispatch,
      makeBridge(),
    )
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'cursor-up' })
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'cursor-down' })
  })

  it('DOUBLE_CLICK on the list shuts the app down', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    const bridge = makeBridge()
    translateGlassesEvent(
      listEvt(OsEventTypeList.DOUBLE_CLICK_EVENT),
      poiListState(),
      dispatch,
      bridge,
    )
    expect(dispatch).not.toHaveBeenCalled()
    expect(bridge.shutDownPageContainer).toHaveBeenCalledWith(0)
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
    translateGlassesEvent(
      textEvt(OsEventTypeList.SCROLL_BOTTOM_EVENT),
      detailState(),
      dispatch,
      makeBridge(),
    )
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'cursor-up' })
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'cursor-down' })
  })

  it('DOUBLE_CLICK on POI_DETAIL dispatches back (not exit)', () => {
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

  it('DOUBLE_CLICK on a top-level screen exits', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    const bridge = makeBridge()
    translateGlassesEvent(
      textEvt(OsEventTypeList.DOUBLE_CLICK_EVENT),
      { ...INITIAL_STATE, screen: { name: 'ERROR_LOCATION', message: 'x' } },
      dispatch,
      bridge,
    )
    expect(bridge.shutDownPageContainer).toHaveBeenCalledWith(0)
  })

  it('ignores events with no payload', () => {
    const dispatch = vi.fn<(e: Event) => void>()
    translateGlassesEvent({}, detailState(), dispatch, makeBridge())
    expect(dispatch).not.toHaveBeenCalled()
  })
})
