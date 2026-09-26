import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 64 スロット相当のステージング付きシナリオを決定論的に生成する(apply-trigger-form-values 6.2)。
//   node packages/mock-unity/scripts/generate-large-staging-scenario.mjs
//     → scenarios/large-staging.json を書き出す(コミット対象)
//   node packages/mock-unity/scripts/generate-large-staging-scenario.mjs --without-staging
//     → 同一エントリで staging 節を省いた対照シナリオを標準出力へ出す(コミットしない)
// scenario.test.ts は両者のワイヤ出力のバイト数を比べ、staged / appliesTo の増分を記録する。

const slotCount = 64
const valuesPerSlot = 4
const withoutStaging = process.argv.includes('--without-staging')
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const outputPath = path.resolve(scriptDirectory, '../scenarios/large-staging.json')

// 実運用に近い長さ(20〜40 文字、日本語混在)のオーディオデバイス名。large-input-select.json と同じ一覧。
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
  const group = `Slot ${slot}`
  const prefix = `/slots/${slot}`

  entries.push(
    {
      address: `${prefix}/label`,
      label: `${group} Label`,
      type: 's',
      widget: 'input',
      pattern: '^[A-Za-z0-9 _-]{1,32}$',
      default: `Slot ${slot}`,
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
    `${prefix}/label`,
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
    address: '/slots/all/update',
    label: 'Update All Slots',
    type: 'i',
    widget: 'button',
    default: 0,
    group: 'All Slots',
  },
  {
    address: '/mb/host',
    label: 'MotionBuilder Host',
    type: 's',
    widget: 'input',
    default: '192.168.101.11',
    group: 'MotionBuilder',
  },
  {
    address: '/mb/port',
    label: 'MotionBuilder Port',
    type: 'i',
    widget: 'input',
    range: [1, 65535],
    default: 22000,
    group: 'MotionBuilder',
  },
  {
    address: '/mb/update',
    label: 'MotionBuilder Update',
    type: 'i',
    widget: 'button',
    default: 0,
    group: 'MotionBuilder',
  },
)

staging.triggers.push(
  { address: '/slots/all/update', appliesTo: ['/slots/*/*'] },
  { address: '/mb/update', appliesTo: ['/mb/*'] },
)
staging.staged.push('/mb/host', '/mb/port')

if (entries.length !== slotCount * (valuesPerSlot + 1) + 1 + 3) {
  throw new Error(`unexpected entry count: ${entries.length}`)
}

const scenario = {
  projectId: 'oscdesk-large-staging',
  optionLists: { devices },
  entries,
}

if (!withoutStaging) {
  scenario.staging = staging
}

const json = `${JSON.stringify(scenario, null, 2)}\n`

if (withoutStaging) {
  process.stdout.write(json)
} else {
  fs.writeFileSync(outputPath, json, 'utf8')
  console.log(`generated ${path.relative(process.cwd(), outputPath)} (${entries.length} entries)`)
}
