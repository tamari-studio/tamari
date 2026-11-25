import { DEPLOY_ENV, previewBannerText } from '../lib/deploy-env'

export function PreviewBanner() {
  const text = previewBannerText(DEPLOY_ENV)
  if (!text) return null
  return (
    <div role="status" className="shrink-0 bg-destructive px-3 py-1.5 text-center text-sm text-primary-foreground">
      {text}
    </div>
  )
}
