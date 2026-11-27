// プロジェクトファイル(D-090)の書き出し・読み込みと「まだ Unity へ送っていない」の帯の画面(D-150。NiceGUI 版の
// project_panel.py から)。状態は project-store の signal を読むだけ
import { useRef } from 'preact/hooks'

import { unsentMessage } from './project-logic'
import type { ImportConfirm, ProjectStore } from './project-store'

export function ProjectPanel({ store }: { store: ProjectStore }) {
  const connected = store.connected.value
  const editing = store.editing.value
  const since = store.unsentSince.value
  const input = useRef<HTMLInputElement>(null)
  return (
    <section class="panel card" aria-label="プロジェクト">
      <header class="panel-head">
        <h2>プロジェクト</h2>
        <button type="button" class="flat" disabled={!connected || store.exporting.value} onClick={() => store.exportProject()}>
          {store.exporting.value ? '書き出し中…' : '書き出す'}
        </button>
        {editing && (
          <>
            <button type="button" class="flat" disabled={!connected || store.inspecting.value} onClick={() => input.current?.click()}>
              {store.inspecting.value ? '確認中…' : '読み込む'}
            </button>
            <input
              ref={input}
              type="file"
              accept=".json,application/json"
              class="hidden-file"
              aria-label="プロジェクトファイルを選ぶ"
              onChange={(event) => {
                const target = event.currentTarget
                const file = target.files?.[0]                // 同じファイルを続けて選び直せるように、受け口を空に戻す
                target.value = ''
                if (file !== undefined) void store.inspectFile(file)
              }}
            />
          </>
        )}
      </header>
      <p class="caption">定義・保持値(UI で管理する行を含む)・OSC パッドを 1 つのファイルにまとめます。読み込みは編集モードで行えます。</p>
      {since !== null && (
        <div class="banner warn" role="status">
          <span>{unsentMessage(since)}</span>
          <button type="button" class="warn" disabled={!connected} onClick={() => store.openSend()}>Unity へ送る</button>
        </div>
      )}
      {store.confirm.value !== null && <ImportDialog store={store} confirm={store.confirm.value} />}
      {store.sendConfirm.value && <SendDialog store={store} />}
    </section>
  )
}

function ImportDialog({ store, confirm }: { store: ProjectStore; confirm: ImportConfirm }) {
  const { summary } = confirm
  return (
    <div class="backdrop" onClick={(event) => event.target === event.currentTarget && store.cancelImport()}>
      <div class="dialog wide" role="dialog" aria-label="プロジェクトを読み込みますか?">
        <h3>プロジェクトを読み込みますか?</h3>
        <p>書き出した日時: {summary.exportedAt}</p>
        {summary.surface !== null
          ? (
            <>
              <p>定義「{summary.surface.name}」と保持値(値 {summary.surface.values} 件・行 {summary.surface.rows} 件・生成の記録 {summary.surface.spawns} 件)</p>
              {/* 生成の記録(HID-385)は今の記録と置き換わり、「Unity へ送る」まで各 PC へは生成しない */}
              {summary.surface.spawns > 0 && <p class="caption">生成の記録は今の記録と置き換わります。「Unity へ送る」を押すまで、各 PC へは生成しません。</p>}
              <p class="caption">
                採用中の定義「{confirm.activeSurface ?? 'なし'}」とその保持値を置き換えます。保存済みの定義「{summary.surface.name}」は上書きされます(直前の内容はブリッジの .backups に残ります)。
              </p>
            </>
          )
          : <p class="caption">定義は含まれていないので、採用中の定義と保持値はそのままです。</p>}
        {summary.pad !== null
          ? (
            <>
              <p>OSC パッド「{summary.pad.name}」(ボタン {summary.pad.buttons} 個)</p>
              <p class="caption">採用中のパッド「{confirm.activePad ?? 'なし'}」を置き換え、保存済みのパッド「{summary.pad.name}」を上書きします。</p>
            </>
          )
          : <p class="caption">OSC パッドは含まれていないので、採用中のパッドはそのままです。</p>}
        <p class="caption warn-text">
          読み込んでも Unity へは送りません。画面で確かめてから「Unity へ送る」で送ってください。それまでは Unity の再起動・再接続でも自動では送りません。ほかの端末の画面も読み込んだ内容に替わります。
        </p>
        <div class="dialog-actions">
          <button type="button" class="flat" onClick={() => store.cancelImport()}>やめる</button>
          <button type="button" class="danger" onClick={() => store.confirmImport()}>読み込む</button>
        </div>
      </div>
    </div>
  )
}

function SendDialog({ store }: { store: ProjectStore }) {
  return (
    <div class="backdrop" onClick={(event) => event.target === event.currentTarget && store.cancelSend()}>
      <div class="dialog" role="dialog" aria-label="保持値をすべての Unity の宛先へ送りますか?">
        <h3>保持値をすべての Unity の宛先へ送りますか?</h3>
        <p class="caption">読み込んだプロジェクトの値が Unity に入ります。以後は再起動・再接続のときにも自動で送ります。</p>
        <div class="dialog-actions">
          <button type="button" class="flat" onClick={() => store.cancelSend()}>やめる</button>
          <button type="button" class="warn" onClick={() => store.confirmSend()}>送る</button>
        </div>
      </div>
    </div>
  )
}
