// In order for the workers runtime to find the class that implements
// our Durable Object namespace, we must export it from the root module.

export { Torrent } from './torrent'
// @ts-ignore

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)
    try {
      if (url.pathname === '/announce') {
        return await handleAnnounce(request, env)
      } else if (url.pathname === '/scrape') {
        return await handleScrape(request, env)
      } else if (url.pathname === '/_peers') {
        return await handleAnnounce(request, env)
      } else if (url.pathname === '/_purge') {
        return await handleAnnounce(request, env)
      } else {
        return new Response('not found', {status: 404})
      }
    } catch (e) {
      return new Response(`${e}`)
    }
  },
}

async function handleScrape(request: Request, env: Env) {
  return new Response('405', {status: 405})
}

async function handleAnnounce(request: Request, env: Env) {
  const url = new URL(request.url)
  if (!url.searchParams.has('info_hash')) {
    return new Response('must specify info_hash', {status: 400})
  }
  const hash_id = url.searchParams.get('info_hash') ?? ''
  const id = env.TORRENT.idFromName(hash_id)
  const obj = env.TORRENT.get(id)
  return obj.fetch(request)
}

export interface Env {
  TORRENT: DurableObjectNamespace
}
