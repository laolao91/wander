import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerProperty,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'

export async function initGlasses(): Promise<void> {
  const bridge = await waitForEvenAppBridge()

  const splash = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    borderWidth: 0,
    borderColor: 5,
    borderRadius: 0,
    paddingLength: 8,
    containerID: 1,
    containerName: 'wander-splash',
    content: [
      '                  WANDER',
      '',
      '     ━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '   Discover what is around you',
      '',
      '   Scaffold ready - phase 1',
    ].join('\n'),
    isEventCapture: 1,
  })

  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [splash],
    }),
  )

  bridge.onEvenHubEvent((event) => {
    const e = event.textEvent ?? event.sysEvent
    if (!e) return
    const type = e.eventType
    if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      void bridge.shutDownPageContainer(0)
    }
  })
}
