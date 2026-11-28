// 単一 UDP データグラムに収める OSC バッチのサイズ上限を共有する。
export const OSC_BATCH = {
  MAX_MESSAGES: 512,
  PRACTICAL_LIMIT_BYTES: 60 * 1024,
} as const

// 送信ログ(D-067)の上限。ブリッジの保持件数・1 フレームの件数・記録 1 件の引数の切り詰めを決める。
// 1 件は引数を切り詰めて数 KB 以内に収まるので、100 件ずつ送れば 1 フレームは数百 KB に収まる(撤去した NiceGUI 版の
// クライアントの受信上限 1 MiB に合わせて決めた。ブラウザの WebSocket でも 1 フレームを小さく保つほうが描き直しが軽い)
export const SENT_LOG = {
  CAPACITY: 1000,
  MAX_RECORDS_PER_FRAME: 100,
  FLUSH_INTERVAL_MS: 250,
  COALESCE_WINDOW_MS: 1000,
  MAX_ARGS: 16,
  MAX_STRING_CHARS: 120,
  MAX_BLOB_BYTES: 32,
} as const

// 宛先タブ(D-078)の上限。この PC のネットワークはインタフェースの数で打ち切る(「全てのデバイス」のブロードキャストの宛先の数を抑える)
export const DESTINATIONS = {
  MAX_SELECTED_HOSTS: 256,
  MAX_SCAN_INTERFACES: 4,
  // 端末の別名(D-092)。1 件の文字数と、ブリッジが覚える件数の上限。UI は認証なしで誰でも送れるので、
  // 件数を縛らないと別名のファイルと destinations フレームをいくらでも膨らませられる
  MAX_ALIAS_CHARS: 64,
  // 上りの destinationsAlias で受ける長さ。別名の上限より広く取り、前後の空白込みで少し長い入力もフレームとしては受けて、
  // ブリッジが理由つきで断る(フレームの検査で落とすと UI に何も返らない)。それでも際限なくは受けない
  MAX_ALIAS_INPUT_CHARS: 256,
  MAX_DEVICE_ALIASES: 512,
} as const

// ネットワークの設定(D-113)。UI は認証なしで誰でも送れるので、リストの件数と 1 件の長さを縛る。
// MAX_CIDR_CHARS は IPv6 の CIDR(最長 39 文字 + "/128")が収まる長さ。MAX_REQUESTER_CHARS は接続の送信元のアドレス(hello.peer)の長さ
export const NETWORK_SETTINGS = {
  MAX_TARGET_RANGES: 8,
  MAX_ALLOWED_BROWSERS: 32,
  MAX_CIDR_CHARS: 49,
  MAX_REQUESTER_CHARS: 64,
} as const
