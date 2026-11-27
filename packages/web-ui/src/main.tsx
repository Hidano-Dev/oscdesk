// SPA の入口(D-137・D-138)。ブリッジが HTTP の / に配り、同じ host:port の WebSocket(ブリッジの 7080)につなぐ
import { render } from 'preact'

import { App } from './app'
import { createBlueprintStore } from './blueprint-store'
import { bridgeUrlOf, createBridgeLink } from './bridge-link'
import { createDestinationsStore } from './destinations-store'
import { createEditMode } from './edit-mode'
import { createEditorStore } from './editor-store'
import { createNetworkStore } from './network-store'
import { createNotices } from './notices'
import { createPendingOptionsStore } from './pending-options-store'
import { createProjectStore } from './project-store'

const link = createBridgeLink({ url: bridgeUrlOf(location), createSocket: (url) => new WebSocket(url) })
const notices = createNotices()
const destinations = createDestinationsStore({ link, notices })
const editor = createEditorStore({ link, notices })
const network = createNetworkStore({ link, notices })
const editMode = createEditMode()
const pendingOptions = createPendingOptionsStore({ link, notices })
const project = createProjectStore({ link, notices, editing: editMode.editing })
const blueprint = createBlueprintStore({ link, notices })
link.start()
render(
  <App
    link={link}
    notices={notices}
    destinations={destinations}
    editor={editor}
    network={network}
    editMode={editMode}
    pendingOptions={pendingOptions}
    project={project}
    blueprint={blueprint}
  />,
  document.getElementById('app') as HTMLElement,
)
