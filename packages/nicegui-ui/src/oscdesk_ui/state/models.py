"""状態が配る値オブジェクトと、状態の各部が共有する定数・小さな関数(HID-440 で state.py から分けた)。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Sequence

from ..surface_model import ControlSpec, RecordSpec, json_value


# 操作中のロック(HID-378)の延長の間隔。期限(2 秒)より十分短くし、1 回取りこぼしても切れないようにする。
# 部品(page)と Record の行(record_table)の両方が使う
LOCK_RENEW_INTERVAL_S = 0.5


# まとめ送り(アクション)のエコー待ち。LAN 内の往復に十分で、押した直後の失敗に気づける長さ
ACTION_ECHO_TIMEOUT_S = 2.0
# 受け取られていないプロジェクトの書き出し(D-090)を何件まで置いておくか
_MAX_PENDING_PROJECT_EXPORTS = 4


@dataclass(frozen=True)
class Notice:
    seq: int
    level: Literal["info", "warn", "error"]
    message: str


# エコー待ちの照合単位。パラメータはパラメータ id、レコードは (レコード id, キー)(D-064・HID-389)
EchoTarget = str | tuple[str, str]


@dataclass
class _ActionBatch:
    """1 回のアクション押下で送った内容と、まだエコーが届いていない対象。"""

    label: str
    total: int
    deadline: float
    # 照合単位 -> (期待する値, 値を問わず届けば確認とするか)。後続の押下が同じ対象を送ったら外す。
    # レコードの期待値はキーを除いたフィールドの値
    waiting: dict[EchoTarget, tuple[tuple[Any, ...], bool]]


def row_channel_key(record_id: str, key: str) -> str:
    """レコードの 1 行の表示キャッシュのキー。レコード id は NUL を含まず、行のキーも NUL を送れないので区切りに使えば衝突しない。"""
    return f"{record_id}\x00{key}"


@dataclass(frozen=True)
class RecordRow:
    """レコード表の 1 行。marked は「一覧に無い」の印(一覧が届いていて、そこに無いキー。D-064)。

    key は行を指す識別子(UI で管理する行では ID。D-087)で、name は表示する名前(それ以外の行では key と同じ)。
    """

    key: str
    listed: bool
    marked: bool
    name: str = ""

    @property
    def label(self) -> str:
        return self.name or self.key


@dataclass(frozen=True)
class SurfaceStatus:
    detail: str
    name: str | None = None
    revision: int | None = None
    parameter_count: int = 0


@dataclass(frozen=True)
class UnityLinkStatus:
    reachability: str = "unknown"
    last_rtt_ms: float | None = None
    consecutive_losses: int = 0
    last_pong_seq: int | None = None


@dataclass(frozen=True)
class UnityTargetLinkStatus:
    name: str
    primary: bool
    reachability: str = "unknown"
    last_rtt_ms: float | None = None
    consecutive_losses: int = 0


def _row_payload(record: RecordSpec, values: Sequence[Any]) -> dict[str, Any]:
    """行の値をフィールド id → JSON の値にする(setRow・batch の行。HID-389)。"""
    return {field.param_id: value for field, value in zip(record.fields, values, strict=True)}


def _json_value(spec: ControlSpec, value: Any) -> Any:
    """set フレームの値(HID-373)。型どおりの JSON の値に揃える(bool は true/false のまま。0/1 への直しはブリッジ)。"""
    return json_value(spec, value)
