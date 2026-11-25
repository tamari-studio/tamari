// `app/build.ts` bakes VERCEL_ENV into the client as MISO_DEPLOY_ENV
// ('production' | 'preview' | 'development' on Vercel, 'local' elsewhere).
export const DEPLOY_ENV: string | undefined = process.env.MISO_DEPLOY_ENV

// Previews share production's dataset and secret names (plan 33, phase 2), so
// they say so on screen instead of looking like a sandbox.
export function previewBannerText(env: string | undefined): string | null {
  if (env !== 'preview') return null
  return 'This is a preview. It uses the real data, so anything you change here is saved for everyone.'
}
