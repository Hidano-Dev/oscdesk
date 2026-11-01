using System.Runtime.CompilerServices;

// EditMode テストから、保存時・Play の開始時の口(OscTargetNameDeduplicator の OnSceneSaving / OnPlayModeStateChanged)を直接呼ぶ
[assembly: InternalsVisibleTo("OscDesk.Receiver.Tests")]
