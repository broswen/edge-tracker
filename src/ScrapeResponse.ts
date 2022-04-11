export interface  TorrentInfo {
    complete: number
    downloaded: number
    incomplete: number
}

export interface ScrapeResponse {
    files: {
        [key: string]: TorrentInfo
    }
}
