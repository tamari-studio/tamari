import { afterAll, expect, test } from 'bun:test'

import { checkHost, checkLink, isBlockedAddress, markdownText, readArticle, readArticleBasic, setResolverForTests } from './_page'

const DNS: Record<string, string[]> = {
  'public.example.com': ['93.184.215.14', '2606:2800:21f:cb07:6820:80da:af6b:8b2c'],
  'rebind.example.com': ['127.0.0.1'],
  'mixed.example.com': ['93.184.215.14', '10.0.0.5'],
  'ula.example.com': ['fd12:3456::1'],
  'mapped.example.com': ['::ffff:127.0.0.1'],
  'cgnat.example.com': ['100.100.1.1'],
  'metadata.example.com': ['169.254.169.254']
}
setResolverForTests(async host => {
  if (!(host in DNS)) throw new Error('ENOTFOUND')
  return DNS[host]!
})
afterAll(() => setResolverForTests())

test('blocked addresses: loopback, private, link-local, CGNAT, multicast and their IPv6 forms', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.31.0.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fd00::1', 'fc00::1', '::ffff:10.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', 'ff02::1', 'not-an-ip']) {
    expect(isBlockedAddress(ip)).toBe(true)
  }
  for (const ip of ['93.184.215.14', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700::1111']) {
    expect(isBlockedAddress(ip)).toBe(false)
  }
})

test('a host is checked by every address it resolves to', async () => {
  await expect(checkHost('public.example.com')).resolves.toBeUndefined()
  for (const host of ['rebind.example.com', 'mixed.example.com', 'ula.example.com', 'mapped.example.com', 'cgnat.example.com', 'metadata.example.com']) {
    await expect(checkHost(host)).rejects.toThrow('private or local address')
  }
  await expect(checkHost('missing.example.com')).rejects.toThrow('could not be found')
  await expect(checkHost('127.0.0.1')).rejects.toThrow('private or local address')
  await expect(checkHost('[::1]')).rejects.toThrow('private or local address')
})

test('only public http(s) links on standard ports are fetched', () => {
  expect(checkLink(' https://news.example.org/2026/11/12/x#top ').toString()).toBe('https://news.example.org/2026/11/12/x')
  for (const bad of [
    'news.example.org/x',
    'file:///etc/passwd',
    'http://localhost/a',
    'http://intranet/a',
    'http://10.0.0.2/a',
    'http://172.20.1.1/a',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/a',
    'http://printer.local/a',
    'https://news.example.org:8443/a',
    'https://a:b@news.example.org/a'
  ]) {
    expect(() => checkLink(bad)).toThrow()
  }
  expect(checkLink('http://93.184.215.14/a').hostname).toBe('93.184.215.14')
})

test('reads title, site, date and text, preferring the article element and dropping page chrome', () => {
  const html = `<html><head><title>Fallback title | Site</title>
<script type="application/ld+json">{"datePublished":"2026-11-10T09:00:00+01:00"}</script></head>
<body><header>Menu</header><main><aside>Ads</aside><p>Main text one.</p><p>Main text two &pound;5m.</p></main><footer>Footer</footer></body></html>`
  const a = readArticleBasic(html, 'https://www.example.org/story')
  expect(a).toEqual({
    title: 'Fallback title | Site',
    site: 'example.org',
    author: null,
    published: '2026-11-10T08:00:00.000Z',
    description: '',
    text: 'Main text one.\nMain text two £5m.'
  })
})

const CLUTTERED = `<!doctype html><html><head>
<title>Meridian Labs raises $500m | Example News</title>
<meta property="og:title" content="Meridian Labs raises $500m">
<meta property="og:site_name" content="Example News">
<meta name="author" content="Example Reporter">
<meta property="article:published_time" content="2026-11-12T12:38:00+00:00">
</head><body>
<nav><a href="/">Home</a> <a href="/robotics">Robotics</a></nav>
<div class="share"><a href="#">Share</a> <a href="#">Chatter</a> <a href="#">Postly</a> <a href="#">Linkly</a></div>
<article>
<h1>Meridian Labs raises $500m</h1>
<p>Aurora Ventures has led a $500m funding round in Portuguese battery software startup <a href="https://www.meridian-labs.example/en/">Meridian Labs</a> that automates energy trading.</p>
<p>The investment firm led the <strong>Series F</strong> funding round, which also features Harbor Capital, Linden Fund and Birch Partners and valued Meridian at $8.5bn. Meridian has raised around $2bn in total.</p>
<p>The Lisbon-based software company writes control software for grid batteries, solar parks and wind farms, as well as building the forecasting models behind the tech.</p>
<p>Its software carries out work such as scheduling charging, selling stored power, balancing loads and reporting output to grid operators.</p>
<img src="https://news.example.org/img.jpg" alt="A battery">
</article>
<aside><h3>Newsletter</h3><p>Sign up for our weekly newsletter</p><form><input></form></aside>
<footer>© Example News 2026</footer>
</body></html>`

test('reads a page like the Obsidian Web Clipper (Defuddle): main text and metadata, no page chrome', async () => {
  const a = await readArticle(CLUTTERED, 'https://news.example.org/2026/11/12/meridian')
  expect(a).toMatchObject({ title: 'Meridian Labs raises $500m', site: 'Example News', author: 'Example Reporter', published: '2026-11-12T12:38:00.000Z' })
  expect(a.text).toContain('Aurora Ventures has led a $500m funding round in Portuguese battery software startup Meridian Labs that automates')
  expect(a.text).toContain('led the Series F funding round')
  for (const chrome of ['Chatter', 'Sign up for our weekly newsletter', '© Example News', 'https://', '![', '**']) expect(a.text).not.toContain(chrome)
})

test('falls back to the simple reader when Defuddle finds too little', async () => {
  const a = await readArticle('<html><body><p>Short.</p></body></html>', 'https://x.io/a')
  expect(a.text).toBe('Short.')
})

test('markdown becomes reading text: link words kept, images and emphasis dropped', () => {
  expect(markdownText('## Key\n\n- **Big** [round](https://x.io) ![img](a.png)\n\n\n\nEnd <br>')).toBe('## Key\n\n- Big round\n\nEnd')
})

test('a page without a date or article element still reads', () => {
  const a = readArticleBasic('<p>Only a paragraph.</p>', 'https://x.io/a')
  expect(a.published).toBeNull()
  expect(a.text).toBe('Only a paragraph.')
  expect(a.site).toBe('x.io')
})
