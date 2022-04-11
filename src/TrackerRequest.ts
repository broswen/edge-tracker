import {encode} from "bencode";

export default class TrackerRequest {
    info_hash: string
    peer_id: string
    port: number
    uploaded: number
    downloaded: number
    left: number
    compact: number
    event: string
    ip: string
    numwant: number
    key: string
    constructor(url: string, ip: string) {
        const u = new URL(url)
        this.info_hash = u.searchParams.get('info_hash') ?? ''
        this.peer_id = u.searchParams.get('peer_id') ?? ''
        this.port = parseInt(u.searchParams.get('port') ?? '')
        this.uploaded = parseInt(u.searchParams.get('uploaded') ?? '')
        this.downloaded = parseInt(u.searchParams.get('downloaded') ?? '')
        this.left = parseInt(u.searchParams.get('left') ?? '')
        this.compact = parseInt(u.searchParams.get('compact') ?? '')
        this.numwant = parseInt(u.searchParams.get('numwant') ?? '')
        this.event = u.searchParams.get('event') ?? ''
        this.ip = ip
        this.key = u.searchParams.get('key') ?? ''
    }
}