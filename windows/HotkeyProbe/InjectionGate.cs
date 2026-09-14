namespace DO.Windows.HotkeyProbe;

internal enum GateResult { Wait, Send, FocusChanged, TimedOut }

internal static class InjectionGate
{
    // Never send while modifiers are held, after a focus change, or long after a trigger.
    internal static GateResult Evaluate(nint target, nint current, bool keysHeld, long elapsedMs)
    {
        if (target == 0 || current != target) return GateResult.FocusChanged;
        if (elapsedMs >= 2000) return GateResult.TimedOut;
        return keysHeld ? GateResult.Wait : GateResult.Send;
    }
}
