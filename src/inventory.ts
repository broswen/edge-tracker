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
  torrents: {[key: string]: TorrentState} = {}
  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.state.blockConcurrencyWhile(async () => {
      this.torrents = (await this.state.storage?.get<{[key: string]: TorrentState}>('torrents')) ?? {}
    })
  }

  // Handle HTTP requests from clients.
  async fetch(request: Request) {
    const url = new URL(request.url)
    if (url.pathname === '/scrape') {
      //get hashes from query params
      let info_hashes = url.searchParams.getAll('info_hash') ?? []

      if (info_hashes.length < 1) {
        //if no hashes specified, fill with all existing hashes
        info_hashes = Object.keys(this.torrents)
      }
      const res: ScrapeResponse = {
        files: {}
      }
      for (const hash of info_hashes) {
        res.files[encodeURI(hash)] = {
          complete: this.torrents[hash].complete,
          downloaded: this.torrents[hash].downloaded,
          incomplete: this.torrents[hash].incomplete
        }
      }
      return new Response(encode(res))
    } else if (url.pathname === '/_announce') {
      //torrent DOs announce their state here using query params
      const torrent = new TorrentState(request.url)
      this.torrents[torrent.info_hash] = torrent
      await this.state.storage?.put('torrents', this.torrents)
      return new Response('OK')
    } else if (url.pathname === '/_torrents') {
      //debug endpoint for listing torrents internal state
      return new Response(JSON.stringify(this.torrents), {headers: {'Content-Type': 'application/json'}})
    } else {
      return new Response('not found', {status: 404})
    }
  }
}