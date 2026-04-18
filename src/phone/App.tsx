import { AppShell, NavBar, ScreenHeader, Card } from 'even-toolkit/web'
import type { NavItem } from 'even-toolkit/web'
import { useState } from 'react'

const tabs: NavItem[] = [
  { id: 'nearby', label: 'Nearby' },
  { id: 'settings', label: 'Settings' },
]

export function App() {
  const [tab, setTab] = useState<string>('nearby')

  return (
    <AppShell header={<NavBar items={tabs} activeId={tab} onNavigate={setTab} />}>
      <div className="px-3 pt-4 pb-8">
        <ScreenHeader title="Wander" subtitle="Discover what's around you" />
        <Card className="mt-3">
          <p className="text-[15px] tracking-[-0.2px] text-text">
            {tab === 'nearby'
              ? 'Nearby places will appear here once Phase 2 lands.'
              : 'Search radius and categories will be configurable here.'}
          </p>
        </Card>
      </div>
    </AppShell>
  )
}
