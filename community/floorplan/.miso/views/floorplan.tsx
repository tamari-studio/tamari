import { Badge, Empty, Page } from '../ui/kit'

export const config = { title: 'Floorplan', icon: 'map' } as const

export default function Floorplan() {
  return (
    <Page title="Floorplan">
      <p className="text-sm text-muted-foreground">An event or venue floor plan with stands, who is placed where, and an export.</p>
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
