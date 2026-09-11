namespace DO.Windows.HotkeyProbe;

internal enum ChordResult { None, Started, Triggered, Canceled }

// State only: no text translation, key history, or OS calls. Raw keyboard events
// remain available to Windows and the foreground application.
internal sealed class ModifierChord
{
    private readonly HashSet<int> held = [];
    private bool blocked;
    private bool candidate;
    private long startedAt;
    internal nint Target { get; private set; }

    internal void Reset(IEnumerable<int>? initiallyHeld = null)
    {
        held.Clear();
        if (initiallyHeld is not null) held.UnionWith(initiallyHeld);
        blocked = held.Count > 0; // Keys held when enabling never form a fresh chord.
        candidate = false;
        Target = 0;
    }

    internal ChordResult Poll(nint foreground, long now)
    {
        if (!candidate || (foreground == Target && now - startedAt < 2000)) return ChordResult.None;
        candidate = false;
        blocked = true;
        return ChordResult.Canceled;
    }

    internal ChordResult Key(int key, bool down, nint foreground, long now)
    {
        var result = Poll(foreground, now);
        if (down)
        {
            if (!held.Add(key)) return result; // Ignore keyboard repeat.
            if (!IsChordKey(key))
            {
                if (candidate) result = ChordResult.Canceled;
                blocked = true;
                candidate = false;
            }
            if (!blocked && !candidate && foreground != 0 &&
                held.Any(IsWin) && held.Any(IsAlt))
            {
                candidate = true;
                Target = foreground;
                startedAt = now;
                return ChordResult.Started;
            }
        }
        else
        {
            held.Remove(key);
            if (held.Count == 0)
            {
                var fire = candidate && !blocked;
                candidate = false;
                blocked = false;
                if (fire) return ChordResult.Triggered;
            }
        }
        return result;
    }

    private static bool IsWin(int key) => key is 0x5B or 0x5C;
    private static bool IsAlt(int key) => key is 0xA4 or 0xA5;
    private static bool IsChordKey(int key) => IsWin(key) || IsAlt(key);
}
