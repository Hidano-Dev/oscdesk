import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const slotCount = 64
const valuesPerSlot = 4
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const outputDirectory = path.resolve(scriptDirectory, '../scenarios')
const outputName = process.argv.includes('--without-staging')
  ? 'large-input-select-without-staging.json'
  : 'large-input-select.json'
const outputPath = path.join(outputDirectory, outputName)

// 共有参照(optionsRef)の削減効果と、単一データグラムの実用上限を
// 実運用に近い日本語混在の選択肢で回帰検証する。
const devices = [
  'マイク配列 (インテル® スマート・サウンド・テクノロジー)',
  'ライン入力 (Yamaha AG06MK2 Audio Interface)',
  'マイク (USB Audio Device Generic Input)',
  'ステレオ ミキサー (Realtek(R) Audio Driver)',
  'マイク (2- USB Advanced Audio Device)',
  'デジタル オーディオ インターフェイス (5- USB Audio CODEC)',
  'Voicemeeter Out (VB-Audio VAIO)',
  '接続されていません (Not Found)',
]

const entries = []
const staging = {
  staged: [],
  triggers: [],
  expansions: [],
}

for (let slotIndex = 1; slotIndex <= slotCount; slotIndex += 1) {
  const slot = String(slotIndex).padStart(2, '0')
  const group = `Member ${slot}`
  const prefix = `/vp/member/${slot}`

  entries.push(
    {
      address: `${prefix}/name`,
      label: `${group} Name`,
      type: 's',
      widget: 'input',
      pattern: '^[A-Za-z0-9 _-]{1,32}$',
      default: `Member ${slot}`,
      group,
    },
    {
      address: `${prefix}/channel`,
      label: `${group} Channel`,
      type: 'i',
      widget: 'input',
      range: [1, 128],
      default: slotIndex,
      group,
    },
    {
      address: `${prefix}/intensity`,
      label: `${group} Intensity`,
      type: 'f',
      widget: 'input',
      range: [0, 1],
      default: Number((slotIndex / slotCount).toFixed(3)),
      group,
    },
    {
      address: `${prefix}/device`,
      label: `${group} Device`,
      type: 's',
      widget: 'select',
      optionsRef: 'devices',
      default: devices[(slotIndex - 1) % devices.length],
      group,
    },
    {
      address: `${prefix}/update`,
      label: `${group} Update`,
      type: 'i',
      widget: 'button',
      default: 0,
      group,
    },
  )

  staging.staged.push(
    `${prefix}/name`,
    `${prefix}/channel`,
    `${prefix}/intensity`,
    `${prefix}/device`,
  )
  staging.triggers.push({
    address: `${prefix}/update`,
    appliesTo: [`${prefix}/*`],
  })
}

entries.push(
  {
    address: '/vp/all/update',
    label: 'Update All Members',
    type: 'i',
    widget: 'button',
    default: 0,
    group: 'All Members',
  },
  {
    address: '/vp/mb/address',
    label: 'MotionBuilder Address',
    type: 's',
    widget: 'input',
    default: '192.168.101.11',
    group: 'MotionBuilder',
  },
  {
    address: '/vp/mb/port',
    label: 'MotionBuilder Port',
    type: 'i',
    widget: 'input',
    range: [1, 65535],
    default: 22000,
    group: 'MotionBuilder',
  },
  {
    address: '/vp/mb/update',
    label: 'MotionBuilder Update',
    type: 'i',
    widget: 'button',
    default: 0,
    group: 'MotionBuilder',
  },
)

staging.triggers.push(
  { address: '/vp/all/update', appliesTo: ['/vp/member/*/*'] },
  { address: '/vp/mb/update', appliesTo: ['/vp/mb/*'] },
)
staging.staged.push('/vp/mb/address', '/vp/mb/port')

const scenario = {
  projectId: 'oscdesk-large-input-select',
  optionLists: { devices },
  entries,
}

if (!process.argv.includes('--without-staging')) {
  scenario.staging = staging
}

if (entries.length !== slotCount * (valuesPerSlot + 1) + 1 + 3) {
  throw new Error(`unexpected entry count: ${entries.length}`)
}

fs.writeFileSync(outputPath, `${JSON.stringify(scenario, null, 2)}\n`, 'utf8')
console.log(`generated ${path.relative(process.cwd(), outputPath)} (${entries.length} entries)`)
