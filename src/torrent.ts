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

  // Handle HTTP requests from clients.
  async fetch(request: Request) {
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

      await this.state.storage?.put('peers', this.peers)
      const res: TrackerResponse = {
        complete: 0,
        incomplete: 0,
        interval: 30,
        'min interval': 30,
        peers: []
      }
      //TODO: randomly select peers from list
      for (const [id, state] of Object.entries(this.peers)) {
        //remove peers that haven't announced themselves within a day
        if (Date.now() - state.timestamp > ONE_DAY) {
          delete(this.peers[id])
        }

        if (res.peers.length < req.numwant) {
          if (typeof res.peers === 'string') {
            //TODO: fix compact peers response
            res.peers += `${req.ip}:${req.port}`
          } else {
            res.peers.push({
              'peer id': encodeURI(state.peer_id),
              ip: state.ip,
              port: state.port,
            })
          }
        }
        if (state.completed) {
          res.complete++
        } else {
          res.incomplete++
        }
      }
      return new Response(encode(res))
    } else if (url.pathname === '/scrape') {
      return new Response('Not found', {status: 404})
    } else if (url.pathname === '/_peers') {
      return new Response(JSON.stringify(this.peers), {headers: {'Content-Type': 'application/json'}})
    } else if (url.pathname === '/_purge') {
      this.peers = {}
      await this.state.storage?.put('peers', this.peers)
      return new Response('purged')
    } else {
      return new Response('Not found', {status: 404})
    }
  }
}