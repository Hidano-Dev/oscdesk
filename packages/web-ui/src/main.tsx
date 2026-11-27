// SPA の入口(D-137・D-138)。ブリッジが HTTP の / に配り、同じ host:port の WebSocket(ブリッジの 7080)につなぐ
import { render } from 'preact'

import { App } from './app'
import { bridgeUrlOf, createBridgeLink } from './bridge-link'
import { createDestinationsStore } from './destinations-store'
import { createNetworkStore } from './network-store'
import { createNotices } from './notices'

const link = createBridgeLink({ url: bridgeUrlOf(location), createSocket: (url) => new WebSocket(url) })
const notices = createNotices()
const destinations = createDestinationsStore({ link, notices })
const network = createNetworkStore({ link, notices })
link.start()
render(<App link={link} notices={notices} destinations={destinations} network={network} />, document.getElementById('app') as HTMLElement)
