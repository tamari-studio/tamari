import { Badge, Empty, Page } from '../ui/kit'

export const config = { title: 'Outreach', icon: 'mail' } as const

export default function Outreach() {
  return (
    <Page title="Outreach">
      <p className="text-sm text-muted-foreground">Contacts, a pipeline and outreach drafts, sent one click at a time.</p>
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
