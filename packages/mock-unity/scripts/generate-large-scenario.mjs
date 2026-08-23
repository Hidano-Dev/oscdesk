import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const groupCount = 64
const entriesPerGroup = 4
const outputPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scenarios/large-input-select.json')

const entries = []

for (let groupIndex = 1; groupIndex <= groupCount; groupIndex += 1) {
  const group = `Slot ${String(groupIndex).padStart(2, '0')}`
  const prefix = `/slots/${String(groupIndex).padStart(2, '0')}`

  entries.push(
    {
      address: `${prefix}/label`,
      label: `${group} Label`,
      type: 's',
      widget: 'input',
      pattern: '^[A-Za-z0-9 _-]{1,32}$',
      default: `Slot ${String(groupIndex).padStart(2, '0')}`,
      group,
    },
    {
      address: `${prefix}/channel`,
      label: `${group} Channel`,
      type: 'i',
      widget: 'input',
      range: [1, 128],
      default: groupIndex,
      group,
    },
    {
      address: `${prefix}/intensity`,
      label: `${group} Intensity`,
      type: 'f',
      widget: 'input',
      range: [0, 1],
      default: Number((groupIndex / groupCount).toFixed(3)),
      group,
    },
    {
      address: `${prefix}/device`,
      label: `${group} Device`,
      type: 's',
      widget: 'select',
      optionsRef: 'devices',
      default: 'Device A',
      group,
    },
  )
}

entries.push(
  {
    address: '/global/client-name',
    label: 'Global Client Name',
    type: 's',
    widget: 'input',
    default: 'large-scenario',
    group: 'Global',
  },
  {
    address: '/global/port',
    label: 'Global Port',
    type: 'i',
    widget: 'input',
    range: [1, 65535],
    default: 9000,
    group: 'Global',
  },
  {
    address: '/global/mode',
    label: 'Global Mode',
    type: 's',
    widget: 'select',
    options: ['Performance', 'Preview', 'Safe'],
    default: 'Performance',
    group: 'Global',
  },
  {
    address: '/global/optional-device',
    label: 'Global Optional Device',
    type: 's',
    widget: 'select',
    options: [],
    group: 'Global',
  },
)

if (entries.length !== groupCount * entriesPerGroup + 4) {
  throw new Error(`unexpected entry count: ${entries.length}`)
}

const scenario = {
  projectId: 'oscdesk-large-input-select',
  optionLists: {
    devices: ['Device A', 'Device B', 'Device C', 'Device D'],
  },
  entries,
}

fs.writeFileSync(outputPath, `${JSON.stringify(scenario, null, 2)}\n`, 'utf8')
