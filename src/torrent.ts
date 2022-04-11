import {Env} from "./index";
import TrackerRequest from "./TrackerRequest";
// @ts-ignore
import {encode} from "bencode-js";
import {PeerInfo, TrackerResponse} from "./TrackerResponse";

const ONE_DAY = 1000*60*24
const MAX_PEERS = 30

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
  peers: {[key: string]: PeerState } = {}
  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.state.blockConcurrencyWhile(async () => {
      this.peers= (await this.state.storage?.get<{[key: string]: PeerState}>('peers')) ?? {}
    })
  }

  // cleanPeers filters out any peers where the last announce timestamp is greater than 1 day
  async cleanPeers() {
    console.log('before clean', this.peers)
    this.peers = Object.fromEntries(Object.entries(this.peers).filter((i) => Date.now() - i[1].timestamp < ONE_DAY))
    this.state.storage?.put('peers', this.peers)
    console.log('after clean', this.peers)
  }

  // getPeers returns a random list of peer ids up to the limit
  getPeers(limit: number): string[] {
    const copy = Object.keys(this.peers).slice(0)
    const ids = []
    while (ids.length < limit && copy.length > 0) {
      const index = Math.floor(Math.random() * copy.length)
      ids.push(copy[index])
      copy.splice(index, 1)
    }
    return ids
  }

  // Handle HTTP requests from clients.
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)
    if (url.pathname === '/announce') {
      console.log('announce request')
      console.log('peers', this.peers)
      const req = new TrackerRequest(request.url, request.headers.get('CF-Connecting-IP') ?? '')

      if (req.event === 'stopped') {
        delete this.peers[req.peer_id]
      } else {
        this.peers[req.peer_id] = {
          timestamp: Date.now(),
          useragent: request.headers.get('user-agent') ?? '',
          peer_id: req.peer_id,
          ip: req.ip,
          port: req.port,
          completed: req.event === 'completed',
          key: req.key
        }
      }

      //limit to 30 peers in response
      req.numwant = Math.min(MAX_PEERS, req.numwant)

      await this.cleanPeers()

      const peers = this.getPeers(req.numwant)

      const res: TrackerResponse = {
        complete: 0,
        incomplete: 0,
        interval: 30,
        'min interval': 30,
        peers: []
      }

      for (const id of peers) {
        const peer = this.peers[id]
          if (typeof res.peers === 'string') {
            //TODO: fix compact peers response
            res.peers += `${req.ip}:${req.port}`
          } else {
            res.peers.push({
              'peer id': encodeURI(peer.peer_id),
              ip: peer.ip,
              port: peer.port,
            })
          }
        if (peer.completed) {
          res.complete++
        } else {
          res.incomplete++
        }
      }
      return new Response(encode(res))
    } else if (url.pathname === '/_peers') {
      return new Response(JSON.stringify(this.peers), {headers: {'Content-Type': 'application/json'}})
    } else if (url.pathname === '/_purge') {
      this.peers = {}
      await this.state.storage?.put('peers', this.peers)
      return new Response('purged')
    } else {
      return new Response('not found', {status: 404})
    }
  }
}