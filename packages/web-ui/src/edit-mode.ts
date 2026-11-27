// 編集モードの入り切り(D-151・D-156)。ページ全体で 1 つだけの切り替えで、画面上部の「編集モード」スイッチが入り切りする。
// 定義の編集(editor-store)と、定義の切り替えと同じ重さの操作(プロジェクトの読み込みなど。D-049 / D-081)は
// どちらもこの状態を見る。
// ページごとの表示の状態で、ブリッジには送らない(ほかの端末の編集モードは変わらない)
//
// 定義の編集の作業コピーを持つ editor-store を渡すと、入り切りをそちらに任せる。切るときに未保存の変更があれば editor-store が
// 確かめ(破棄の確認)、確かめている間は編集モードのまま。パネルごとに別の切り替えを持つと、片方だけが編集中になる
import { signal, type ReadonlySignal } from '@preact/signals'

export interface EditMode {
  readonly editing: ReadonlySignal<boolean>
  set(editing: boolean): void
}

/** 入り切りを任せる相手(editor-store)。 */
export interface EditModeController {
  readonly editing: ReadonlySignal<boolean>
  open(): void
  requestClose(): void
}

/** controller を渡せば入り切りをそれに任せる。真偽値は相手なしで持つときの初期値(定義の編集を使わないテスト)。 */
export function createEditMode(source: EditModeController | boolean = false): EditMode {
  if (typeof source !== 'boolean') {
    return {
      editing: source.editing,
      set(next) {
        if (next) source.open()
        else source.requestClose()
      },
    }
  }
  const editing = signal(source)
  return {
    editing,
    set(next) {
      editing.value = next
    },
  }
}
