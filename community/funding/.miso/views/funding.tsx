import { Badge, Empty, Page } from '../ui/kit'

export const config = { title: 'Funding', icon: 'compass' } as const

export default function Funding() {
  return (
    <Page title="Funding">
      <p className="text-sm text-muted-foreground">Find the grants and funders that fit the company, and keep a shortlist.</p>
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
