import { Badge, Empty, Page } from '../ui/kit'

export const config = { title: 'Budget', icon: 'coin' } as const

export default function Budget() {
  return (
    <Page title="Budget">
      <p className="text-sm text-muted-foreground">Budget against actuals, from a bank export you upload.</p>
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
