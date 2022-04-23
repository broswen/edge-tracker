import {Env} from "./index";
import TrackerRequest from "./TrackerRequest";
// @ts-ignore
import {encode} from "bencode-js";
import {TrackerResponse} from "./TrackerResponse";
import {INVENTORY_KEY} from "./inventory";

const ONE_DAY = 1000*60*24
const MAX_PEERS = 30
const INVENTORY_COOLDOWN = 1000 * 5
const PEER_PREFIX = 'peers/'

class PeerState {
  peer_id: string
  ip: string
  port: number
  completed: boolean
  key?: string
  timestamp = 0
  useragent = ''


  constructor(peer_id: string, ip: string, port: number, completed: boolean, key?: string) {
    this.peer_id = peer_id
    this.ip = ip
    this.port = port
    this.completed = completed
    this.key = key
  }

}

export class Torrent {
  state: DurableObjectState
  downloaded = 0
  lastUpdate = 0
  env: Env
  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
    this.state.blockConcurrencyWhile(async () => {
      this.downloaded = (await this.state.storage?.get<number>('downloaded')) ?? 0
    })
  }

  // cleanPeers filters out any peers where the last announce timestamp is greater than 1 day
  async cleanPeers() {
    const peers: Map<string, PeerState> = (await this.state.storage?.list<PeerState>( {prefix: PEER_PREFIX})) ?? new Map<string, PeerState>()
    for (const peer of Object.values(peers)) {
      if (Date.now() - peer.timestamp > ONE_DAY) {
        await this.state.storage?.delete(PEER_PREFIX + peer.peer_id)
      }
    }
  }

  // getPeers returns a random list of peer ids up to the limit
  async getPeers(limit: number): Promise<string[]> {
    const peers: Map<string, PeerState> = (await this.state.storage?.list<PeerState>( {prefix: PEER_PREFIX})) ?? new Map<string, PeerState>()
    const peer_ids = Array.from(peers.values()).map(p => p.peer_id)
    const ids = []
    while (ids.length < limit && peer_ids.length > 0) {
      const index = Math.floor(Math.random() * peer_ids.length)
      ids.push(peer_ids[index])
      peer_ids.splice(index, 1)
    }
    return ids
  }

  // Handle HTTP requests from clients.
  async fetch(request: Request) {
    const url = new URL(request.url)
    if (url.pathname === '/announce') {
      const req = new TrackerRequest(request.url, request.headers.get('CF-Connecting-IP') ?? '')

      if (req.event === 'stopped') {
        await this.state.storage?.delete(PEER_PREFIX + req.peer_id)
      } else {
        const prevState = await this.state.storage?.get<PeerState>(PEER_PREFIX + req.peer_id)

        // if client is starting and previous state exists, validate key matches before updating info
        // prevent another client redirecting traffic to another IP destined for another ID
        if (req.event === 'started' && prevState && prevState.key !== req.key) {
          return new Response(`key mismatch for ${req.peer_id}`, {status: 401})
        }

        if (req.event === 'completed')  {
          this.downloaded++
          this.state.storage?.put('downloaded', this.downloaded)
        }

        await this.state.storage?.put<PeerState>(PEER_PREFIX + req.peer_id, {
          timestamp: Date.now(),
          useragent: request.headers.get('user-agent') ?? '',
          peer_id: req.peer_id,
          ip: req.ip,
          port: req.port,
          //if previous state exists, and it was completed, or current event is completed
          completed: (prevState && prevState.completed) || req.event === 'completed',
          key: req.key
        })
      }

      //limit to 30 peers in response
      req.numwant = Math.min(MAX_PEERS, req.numwant)

      await this.cleanPeers()
      const allPeers = await this.state.storage?.list<PeerState>({prefix: PEER_PREFIX}) ?? new Map<string, PeerState>()
      const peers = await this.getPeers(req.numwant)

      const res: TrackerResponse = {
        complete: 0,
        incomplete: 0,
        interval: 30,
        'min interval': 30,
        peers: []
      }

      for (const id of peers) {
        const peer = await this.state.storage?.get<PeerState>(PEER_PREFIX + id)
        if (peer) {
          if (typeof res.peers === 'string') {
            //TODO: fix compact peers response
            res.peers += `${req.ip}:${req.port}`
          } else {
            res.peers.push({
              'peer id': encodeURIComponent(peer.peer_id),
              ip: peer.ip,
              port: peer.port,
            })
          }
        }
      }

      for (const peer of Array.from(allPeers.values())) {
        if (peer.completed) {
          res.complete++
        } else {
          res.incomplete++
        }
      }

      //update inventory if time since last update is greater than cooldown
      if (Date.now() - this.lastUpdate > INVENTORY_COOLDOWN) {
        const u = new URL('https://example.com/_announce')
        u.searchParams.append('info_hash', req.info_hash)
        u.searchParams.append('complete', res.complete.toString())
        u.searchParams.append('incomplete', res.incomplete.toString())
        u.searchParams.append('downloaded', this.downloaded.toString())
        const id = this.env.INVENTORY.idFromName(INVENTORY_KEY)
        const obj = this.env.INVENTORY.get(id)
        obj.fetch(u.toString())
        this.lastUpdate = Date.now()
      }

      return new Response(encode(res))
    } else if (url.pathname === '/_peers') {
      const peers = await this.state.storage?.list<PeerState>({prefix: PEER_PREFIX})
      if (!peers) {
        return new Response(JSON.stringify([]), {headers: {'Content-Type': 'application/json'}})
      }
      return new Response(JSON.stringify(Array.from(peers.values())), {headers: {'Content-Type': 'application/json'}})
    } else if (url.pathname === '/_purge') {
      this.downloaded = 0
      this.lastUpdate = 0
      await this.state.storage?.deleteAll()
      return new Response('purged')
    } else {
      return new Response('not found', {status: 404})
    }
  }
}