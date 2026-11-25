"""UI から見たサーフェスの状態(プロセス内の唯一の状態)。

呼び出し側はこれまでどおり ``from .state import SurfaceState`` で使う。中身は HID-440 で責務ごとに分けた:

- core: SurfaceState(状態の全属性・接続の状態・受信したフレームの振り分け・通知)
- models: 状態が配る値オブジェクト(RecordRow・SurfaceStatus など)と共有の定数
- surface / values / records / actions / requests / network / locks / catalog: 領域ごとの振る舞い(mixin)
- echo_match: エコーの値の照合
"""

from __future__ import annotations

from .core import SurfaceState
from .echo_match import _same_values
from .models import (
    ACTION_ECHO_TIMEOUT_S,
    LOCK_RENEW_INTERVAL_S,
    EchoTarget,
    Notice,
    RecordRow,
    SurfaceStatus,
    UnityLinkStatus,
    UnityTargetLinkStatus,
    row_channel_key,
)
from .network import describe_network_rejection

__all__ = [
    "ACTION_ECHO_TIMEOUT_S",
    "LOCK_RENEW_INTERVAL_S",
    "EchoTarget",
    "Notice",
    "RecordRow",
    "SurfaceState",
    "SurfaceStatus",
    "UnityLinkStatus",
    "UnityTargetLinkStatus",
    "_same_values",
    "describe_network_rejection",
    "row_channel_key",
]
