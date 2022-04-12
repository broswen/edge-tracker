import {Env} from "./index";
// @ts-ignore
import {encode} from "bencode-js";
import {ScrapeResponse} from "./ScrapeResponse";

export const INVENTORY_KEY = 'INVENTORY'

class TorrentState {
  info_hash: string
  complete: number
  downloaded: number
  incomplete: number

  constructor(url: string) {
    const u = new URL(url)
    this.info_hash = u.searchParams.get('info_hash') ?? ''
    this.complete = parseInt(u.searchParams.get('complete') ?? '')
    this.downloaded = parseInt(u.searchParams.get('downloaded') ?? '')
    this.incomplete = parseInt(u.searchParams.get('incomplete') ?? '')
  }

}

export class Inventory {
  state: DurableObjectState
  constructor(state: DurableObjectState, env: Env) {
    this.state = state
  }

  // Handle HTTP requests from clients.
  async fetch(request: Request) {
    const url = new URL(request.url)
    if (url.pathname === '/scrape') {
      //get hashes from query params
      if (!url.searchParams.has('info_hash')) {
        return new Response('must specify info_hash', {status: 400})
      }

      const info_hashes = url.searchParams.getAll('info_hash') ?? []

      const res: ScrapeResponse = {
        files: {}
      }

      for (const hash of info_hashes) {
        const torrent = await this.state.storage?.get<TorrentState>(hash)
        if (!torrent) {
          continue
        }
        res.files[hash] = {
          complete: torrent.complete,
          downloaded: torrent.downloaded,
          incomplete: torrent.incomplete
        }
      }
      return new Response(encode(res))
    } else if (url.pathname === '/_announce') {
      //torrent DOs announce their state here using query params
      const torrent = new TorrentState(request.url)
      await this.state.storage?.put(torrent.info_hash, torrent)
      return new Response('OK')
    } else if (url.pathname === '/_torrents') {
      //debug endpoint for listing torrents internal state
      //TODO: list() is returning an empty map for some reason
      const torrents = await this.state.storage?.list<TorrentState>()
      console.log('torrents', torrents)
      return new Response(JSON.stringify(torrents), {headers: {'Content-Type': 'application/json'}})
    } else {
      return new Response('not found', {status: 404})
    }
  }
}