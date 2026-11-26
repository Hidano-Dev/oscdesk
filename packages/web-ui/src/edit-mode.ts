// 編集モードの入り切り(D-151)。定義の切り替えと同じ重さの操作(プロジェクトの読み込みなど)を、編集モードの間だけ
// 出すために使う(D-049 / D-081。NiceGUI 版の画面上部の「編集モード」スイッチに当たる)。
// ページごとの表示の状態で、ブリッジには送らない(ほかの端末の編集モードは変わらない)
import { signal, type ReadonlySignal } from '@preact/signals'

export interface EditMode {
  readonly editing: ReadonlySignal<boolean>
  set(editing: boolean): void
}

export function createEditMode(initial = false): EditMode {
  const editing = signal(initial)
  return {
    editing,
    set(next) {
      editing.value = next
    },
  }
}
