import { Badge, Empty, Page } from '../ui/kit'

export const config = { title: 'KPI board', icon: 'chart' } as const

export default function KpiBoard() {
  return (
    <Page title="KPI board">
      <p className="text-sm text-muted-foreground">Targets and actual values for event or team KPIs, from connected sources.</p>
      <Empty
        title="This space is a blueprint"
        steps={[
          'Connect your coding agent: open Settings, then Connect your AI.',
          'Ask it to build this space from SPACE.md, which is in the folder of this space.',
          'Reload this page when it says it is done.'
        ]}
      >
        <Badge tone="outline">Blueprint</Badge>
      </Empty>
    </Page>
  )
}
