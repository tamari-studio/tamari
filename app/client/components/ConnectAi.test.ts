import { expect, test } from 'bun:test'
import { APP_NAME } from '../../lib/brand'
import { setupPrompt } from './ConnectAi'

test('the setup prompt says what the app is, adds it to Claude Code, and asks for whoami', () => {
  const prompt = setupPrompt('https://acme.example/api/mcp', 'tok_123')
  const name = APP_NAME.toLowerCase()
  expect(prompt.split('\n')[0]).toContain(`${APP_NAME} is my company's workspace app`)
  expect(prompt).toContain(`claude mcp add --transport http ${name} https://acme.example/api/mcp --header "Authorization: Bearer tok_123"`)
  expect(prompt).toContain('/mcp')
  expect(prompt).toContain(`Call the ${name} whoami tool and tell me the result.`)
})
