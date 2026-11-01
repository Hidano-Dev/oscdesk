import readline from 'node:readline'

import { buildSurfaceView, SurfaceDefinitionSchema } from '@oscdesk/shared'

// UI(Python)のテストが、ブリッジと同じ規則で部品の木(surface フレームの view。D-124)を得るための道具。
// 標準入力の 1 行 = 結び付けを含む定義 1 つ(JSON)を読み、1 行 = {"view": ...} か {"error": "..."} を返す。
// 採用と同じ判定(SurfaceDefinitionSchema)を通らない定義は、ブリッジが配らないので error で返す。
// 規則を Python のテストに写すと、写しが古くなったときにテストが本番と違う画面を前提にしてしまうため、この道具を通す

const lines = readline.createInterface({ input: process.stdin })

lines.on('line', line => {
  let reply: unknown
  try {
    // PowerShell のパイプは先頭に BOM を付けるので外す(手で試すとき用)
    const parsed = SurfaceDefinitionSchema.safeParse(JSON.parse(line.replace(/^﻿/, '')))
    reply = parsed.success
      ? { view: buildSurfaceView(parsed.data) }
      : { error: parsed.error.issues.map(issue => `${issue.path.join('/')}: ${issue.message}`).join('; ') }
  } catch (error) {
    reply = { error: error instanceof Error ? error.message : String(error) }
  }
  process.stdout.write(`${JSON.stringify(reply)}\n`)
})
