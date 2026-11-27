// SPA の入口(D-137・D-138)。ブリッジが HTTP の / に配り、同じ host:port の WebSocket(ブリッジの 7080)につなぐ
import { render } from 'preact'

import { App } from './app'
import { bridgeUrlOf, createBridgeLink } from './bridge-link'
import { createNotices } from './notices'
import { createAppStores } from './stores'

const link = createBridgeLink({ url: bridgeUrlOf(location), createSocket: (url) => new WebSocket(url) })
const notices = createNotices()
// store はつなぐ前に作る(hello の後の初期の要求の答えを取りこぼさないように。D-155)
const stores = createAppStores({ link, notices })
link.start()
render(<App link={link} notices={notices} {...stores} />, document.getElementById('app') as HTMLElement)
