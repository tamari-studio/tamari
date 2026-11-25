import { Badge, Empty, Page } from '../ui/kit'

export const config = { title: 'My day', icon: 'calendar' } as const

export default function MyDay() {
  return (
    <Page title="My day">
      <p className="text-sm text-muted-foreground">One person's day: calendar and tasks side by side.</p>
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
