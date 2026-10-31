using System;

namespace OscDesk.Receiver
{
    /// <summary>
    /// このメソッドを OscReceiver の対応表のどのアドレスの行に登録するかの宣言(D-100)。
    /// エディタの「定義から配線」(OscReceiverWiring)が、宣言したアドレスの行のうち型が引数と合う行へ永続リスナーとして登録する。
    /// 実行時には何もしない(振り分けは対応表の UnityEvent だけで行う)。
    /// メソッドは public のインスタンスメソッドで戻り値が void、引数は行の型に合わせる:
    /// Trigger は引数なし、Int は int、Float は float、String は string、Bool は bool、Record は OscRecord、Strings は string[]。
    /// 1 つのメソッドに複数のアドレスを宣言してよい。
    /// UnityEngine に依存しないよう中核のアセンブリに置く(利用側の実行時のスクリプトから参照できるようにするため)。
    /// </summary>
    [AttributeUsage(AttributeTargets.Method, AllowMultiple = true, Inherited = true)]
    public sealed class OscAddressAttribute : Attribute
    {
        public string Address { get; }

        public OscAddressAttribute(string address)
        {
            Address = address ?? string.Empty;
        }
    }
}
