// プロジェクトファイル(D-090・D-175。版 3)の書き出し・読み込みの画面(D-150)。「同期」タブに置く。
// 状態は project-store の signal を読むだけ
import { useRef } from 'preact/hooks'

import type { ImportConfirm, ProjectStore } from './project-store'
import { Modal } from './widgets'

export function ProjectPanel({ store }: { store: ProjectStore }) {
  const connected = store.connected.value
  const input = useRef<HTMLInputElement>(null)
  return (
    <section class="panel card" aria-label="プロジェクト" data-mark="project">
      <header class="panel-head">
        <h2>プロジェクト</h2>
        <button type="button" class="flat" disabled={!connected || store.exporting.value} onClick={() => store.exportProject()}>
          {store.exporting.value ? '書き出し中…' : '書き出す'}
        </button>
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
            const file = target.files?.[0]
            // 同じファイルを続けて選び直せるように、受け口を空に戻す
            target.value = ''
            if (file !== undefined) void store.inspectFile(file)
          }}
        />
      </header>
      <p class="caption">採用中のパッド・その値・送り先を 1 つのファイルにまとめます。読み込んでも送り先へは送りません(送るのはこのタブの同期)。</p>
      <Modal>{store.confirm.value !== null && <ImportDialog store={store} confirm={store.confirm.value} />}</Modal>
    </section>
  )
}

function ImportDialog({ store, confirm }: { store: ProjectStore; confirm: ImportConfirm }) {
  const { summary } = confirm
  const dropped = summary.droppedSurface
  return (
    <div class="backdrop" onClick={(event) => event.target === event.currentTarget && store.cancelImport()}>
      <div class="dialog wide" role="dialog" aria-label="プロジェクトを読み込みますか?">
        <h3>プロジェクトを読み込みますか?</h3>
        <p>書き出した日時: {summary.exportedAt}</p>
        <p>パッド「{summary.pad.name}」(部品 {summary.pad.widgets} 個)と値(部品 {summary.values.widgets} 件・表のマス {summary.values.rows} 件)</p>
        <p class="caption">
          採用中のパッド「{confirm.activePad ?? 'なし'}」と値を置き換え、保存済みのパッド「{summary.pad.name}」を上書きします(直前の内容はブリッジの .backups に残ります)。
        </p>
        {summary.destinations > 0 && (
          <p class="caption">ファイルにある送り先 {summary.destinations} 件は読み込みません。送り先は送信先パネルで選んでください。</p>
        )}
        {dropped !== null && (
          <p class="caption warn-text" data-mark="dropped-surface">
            版 {summary.sourceVersion} のファイルです。サーフェス定義{dropped.name === null ? '' : `「${dropped.name}」`}とその値(値 {dropped.values} 件・行 {dropped.rows} 件)は撤去した機能なので読み込みません。
          </p>
        )}
        <p class="caption warn-text">
          読み込んでも送り先へは送りません。画面で確かめてから「同期」で送ってください(自動の再送を入れていれば、ターゲットの起動でも送ります)。ほかの端末の画面も読み込んだ内容に替わります。
        </p>
        <div class="dialog-actions">
          <button type="button" class="flat" onClick={() => store.cancelImport()}>やめる</button>
          <button type="button" class="danger" onClick={() => store.confirmImport()}>読み込む</button>
        </div>
      </div>
    </div>
  )
}
