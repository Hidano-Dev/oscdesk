using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace OscSurfaceBridge.Staging
{
    public enum StagingValueKind
    {
        None,
        Int,
        Float,
        String
    }

    public readonly struct StagingValue : IEquatable<StagingValue>
    {
        public StagingValueKind Kind { get; }
        public int IntValue { get; }
        public float FloatValue { get; }
        public string StringValue { get; }

        public static StagingValue None => new StagingValue(StagingValueKind.None, 0, 0f, null);

        private StagingValue(StagingValueKind kind, int intValue, float floatValue, string stringValue)
        {
            Kind = kind;
            IntValue = intValue;
            FloatValue = floatValue;
            StringValue = stringValue;
        }

        public static StagingValue FromInt(int value)
        {
            return new StagingValue(StagingValueKind.Int, value, 0f, null);
        }

        public static StagingValue FromFloat(float value)
        {
            return new StagingValue(StagingValueKind.Float, 0, value, null);
        }

        public static StagingValue FromString(string value)
        {
            return new StagingValue(StagingValueKind.String, 0, 0f, value ?? string.Empty);
        }

        public bool IsTruthy
        {
            get
            {
                switch (Kind)
                {
                    case StagingValueKind.Int:
                        return IntValue != 0;
                    case StagingValueKind.Float:
                        return FloatValue != 0f;
                    case StagingValueKind.String:
                        return !string.IsNullOrEmpty(StringValue);
                    default:
                        return false;
                }
            }
        }

        public bool Equals(StagingValue other)
        {
            return Kind == other.Kind
                && IntValue == other.IntValue
                && FloatValue.Equals(other.FloatValue)
                && string.Equals(StringValue, other.StringValue, StringComparison.Ordinal);
        }

        public override bool Equals(object obj)
        {
            return obj is StagingValue && Equals((StagingValue)obj);
        }

        public override int GetHashCode()
        {
            unchecked
            {
                var hash = (int)Kind;
                hash = (hash * 397) ^ IntValue;
                hash = (hash * 397) ^ FloatValue.GetHashCode();
                hash = (hash * 397) ^ (StringValue == null ? 0 : StringValue.GetHashCode());
                return hash;
            }
        }

        public static bool operator ==(StagingValue left, StagingValue right)
        {
            return left.Equals(right);
        }

        public static bool operator !=(StagingValue left, StagingValue right)
        {
            return !left.Equals(right);
        }

        public string ToJsonLiteral()
        {
            switch (Kind)
            {
                case StagingValueKind.Int:
                    return IntValue.ToString(CultureInfo.InvariantCulture);
                case StagingValueKind.Float:
                    return FloatValue.ToString("R", CultureInfo.InvariantCulture);
                case StagingValueKind.String:
                    return Quote(StringValue);
                default:
                    throw new InvalidOperationException("A None staging value has no JSON literal.");
            }
        }

        private static string Quote(string value)
        {
            var builder = new StringBuilder(value.Length + 2);
            builder.Append('"');

            foreach (var character in value)
            {
                switch (character)
                {
                    case '"': builder.Append("\\\""); break;
                    case '\\': builder.Append("\\\\"); break;
                    case '\n': builder.Append("\\n"); break;
                    case '\r': builder.Append("\\r"); break;
                    case '\t': builder.Append("\\t"); break;
                    default:
                        if (character < ' ')
                        {
                            builder.Append("\\u")
                                .Append(((int)character).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else
                        {
                            builder.Append(character);
                        }
                        break;
                }
            }

            builder.Append('"');
            return builder.ToString();
        }
    }

    public enum StagingEntryType
    {
        Int,
        Float,
        String,
        Blob,
        Bool
    }

    public sealed class StagingEntryDeclaration
    {
        public string Address { get; }
        public StagingEntryType Type { get; }
        public bool IsButton { get; }
        public bool Staged { get; }
        public IReadOnlyList<string> AppliesTo { get; }
        public IReadOnlyList<string> ExpandsTo { get; }

        public StagingEntryDeclaration(
            string address,
            StagingEntryType type,
            bool isButton,
            bool staged,
            IReadOnlyList<string> appliesTo,
            IReadOnlyList<string> expandsTo)
        {
            Address = address;
            Type = type;
            IsButton = isButton;
            Staged = staged;
            AppliesTo = Copy(appliesTo);
            ExpandsTo = Copy(expandsTo);
        }

        private static IReadOnlyList<string> Copy(IReadOnlyList<string> values)
        {
            if (values == null || values.Count == 0)
            {
                return Array.Empty<string>();
            }

            var copy = new string[values.Count];
            for (var i = 0; i < values.Count; i++)
            {
                copy[i] = values[i];
            }

            return copy;
        }
    }

    public sealed class StagingDeclaration
    {
        public IReadOnlyList<StagingEntryDeclaration> Entries { get; }

        public StagingDeclaration(IReadOnlyList<StagingEntryDeclaration> entries)
        {
            Entries = entries ?? Array.Empty<StagingEntryDeclaration>();
        }
    }

    public sealed class StagingCompileError
    {
        public string Code { get; }
        public string Address { get; }
        public string Message { get; }

        public StagingCompileError(string code, string address, string message)
        {
            Code = code;
            Address = address ?? string.Empty;
            Message = message;
        }
    }
}
