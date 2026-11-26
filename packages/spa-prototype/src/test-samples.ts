// テスト用: protocol/wire-samples.json の destinations の見本を、shared のスキーマで読んだ型付きの値として返す
import fs from 'node:fs'
import path from 'node:path'

import { DownstreamFrameSchema, type DestinationsFrame } from '@oscdesk/shared'

const SAMPLES_PATH = path.resolve(__dirname, '../../../protocol/wire-samples.json')

interface Case { name: string; frame: unknown }

export function destinationsSample(name: string): DestinationsFrame {
  const cases = (JSON.parse(fs.readFileSync(SAMPLES_PATH, 'utf8')) as { cases: Case[] }).cases
  const found = cases.find((item) => item.name === name)
  if (found === undefined) throw new Error(`no sample ${name}`)
  const parsed = DownstreamFrameSchema.parse(found.frame)
  if (parsed.type !== 'destinations') throw new Error(`${name} is not a destinations frame`)
  return parsed
}
