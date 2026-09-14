using System.Runtime.InteropServices;
using DO.Windows.HotkeyProbe;

var passed = 0;
void Check(bool condition, string description)
{
    if (!condition) throw new Exception(description);
    Console.WriteLine($"PASS: {description}");
    passed++;
}

Check(InjectionGate.Evaluate(123, 123, true, 25) == GateResult.Wait, "Held modifiers defer insertion");
Check(InjectionGate.Evaluate(123, 123, false, 25) == GateResult.Send, "Same target after release permits insertion");
Check(InjectionGate.Evaluate(123, 456, false, 25) == GateResult.FocusChanged, "Changed foreground cancels insertion");
Check(InjectionGate.Evaluate(123, 456, true, 25) == GateResult.FocusChanged, "Focus change cancels even while keys are held");
Check(InjectionGate.Evaluate(0, 0, false, 25) == GateResult.FocusChanged, "Missing target cancels insertion");
Check(InjectionGate.Evaluate(123, 123, true, 2000) == GateResult.TimedOut, "Held key expires at two seconds");
Check(InjectionGate.Evaluate(123, 123, false, 2000) == GateResult.TimedOut, "Late release cannot send stale insertion");
Check(InjectionGate.Evaluate(123, 123, false, 1999) == GateResult.Send, "Release within deadline is accepted");
Check(Marshal.SizeOf<NativeMethods.Input>() == (IntPtr.Size == 8 ? 40 : 28), "INPUT matches Windows ABI including full union");
Check(Marshal.OffsetOf<NativeMethods.Input>(nameof(NativeMethods.Input.Data)).ToInt32() == (IntPtr.Size == 8 ? 8 : 4), "INPUT union has correct alignment");

const string text = "DO café ✓ 🎙";
var inputs = NativeMethods.UnicodeInputs(text);
Check(inputs.Length == text.Length * 2, "Every UTF-16 unit has down and up events");
for (var i = 0; i < text.Length; i++)
{
    var down = inputs[i * 2];
    var up = inputs[i * 2 + 1];
    if (down.Type != 1 || up.Type != 1 || down.Data.Keyboard.VirtualKey != 0 ||
        up.Data.Keyboard.VirtualKey != 0 || down.Data.Keyboard.Scan != text[i] ||
        up.Data.Keyboard.Scan != text[i] || down.Data.Keyboard.Flags != 4 || up.Data.Keyboard.Flags != 6)
        throw new Exception($"Incorrect Unicode pair at {i}");
}
Check(true, "Unicode characters and surrogate pairs retain exact order and key-up flags");
Check(NativeMethods.UnicodeInputs("").Length == 0, "Empty text emits no events");

List<ChordResult> Sequence(params (int key, bool down)[] events)
{
    var chord = new ModifierChord();
    var now = 0L;
    return events.Select(e => chord.Key(e.key, e.down, 123, now += 10)).ToList();
}
foreach (var win in new[] { 0x5B, 0x5C })
foreach (var alt in new[] { 0xA4, 0xA5 })
foreach (var altFirst in new[] { false, true })
foreach (var altUpFirst in new[] { false, true })
{
    var results = Sequence((altFirst ? alt : win, true), (altFirst ? win : alt, true),
        (altUpFirst ? alt : win, false), (altUpFirst ? win : alt, false));
    Check(results.SequenceEqual(new[] { ChordResult.None, ChordResult.Started, ChordResult.None, ChordResult.Triggered }),
        $"Win/Alt sides {win:X}/{alt:X}, press order {altFirst}, release order {altUpFirst}: fires once after both release");
}
Check(!Sequence((0x5B, true), (0x5B, false)).Contains(ChordResult.Triggered), "Win alone does not fire");
Check(!Sequence((0xA4, true), (0xA4, false)).Contains(ChordResult.Triggered), "Alt alone does not fire");
Check(!Sequence((0x5B, true), (0xA4, true), (0x52, true), (0x52, false), (0xA4, false), (0x5B, false))
    .Contains(ChordResult.Triggered), "Win + Alt + R never fires DO");
Check(!Sequence((0x5B, true), (0x52, true), (0x52, false), (0xA4, true), (0xA4, false), (0x5B, false))
    .Contains(ChordResult.Triggered), "Third key before chord prevents late trigger");
Check(!Sequence((0x5B, true), (0xA4, true), (0xA4, false), (0x52, true), (0x52, false), (0x5B, false))
    .Contains(ChordResult.Triggered), "Third key during partial release cancels chord");
Check(!Sequence((0xA2, true), (0xA5, true), (0x5B, true), (0x5B, false), (0xA5, false), (0xA2, false))
    .Contains(ChordResult.Triggered), "AltGr with synthesized Ctrl does not trigger DO");
Check(Sequence((0x5B, true), (0xA4, true), (0xA4, true), (0xA4, true), (0xA4, false), (0x5B, false))
    .Count(x => x == ChordResult.Triggered) == 1, "Keyboard repeat does not duplicate a trigger");

var state = new ModifierChord();
state.Key(0x5B, true, 123, 0);
state.Key(0xA4, true, 123, 10);
Check(state.Poll(456, 20) == ChordResult.Canceled, "Foreground change cancels held chord");
state.Key(0xA4, false, 123, 30);
Check(state.Key(0x5B, false, 123, 40) != ChordResult.Triggered, "Returning to original window cannot revive canceled chord");
state.Key(0x5B, true, 123, 50);
state.Key(0xA4, true, 123, 60);
state.Key(0xA4, false, 123, 70);
Check(state.Key(0x5B, false, 123, 80) == ChordResult.Triggered, "Fresh chord works after cancellation and full release");
state.Key(0x5B, true, 123, 100);
state.Key(0xA4, true, 123, 110);
Check(state.Poll(123, 2110) == ChordResult.Canceled, "Modifier chord expires at two seconds");
state.Key(0xA4, false, 123, 2120);
Check(state.Key(0x5B, false, 123, 2130) != ChordResult.Triggered, "Late modifier release does not insert");
state.Reset([0x5B]);
state.Key(0xA4, true, 123, 0);
state.Key(0xA4, false, 123, 10);
Check(state.Key(0x5B, false, 123, 20) != ChordResult.Triggered, "Keys held during enable cannot trigger");
state.Key(0x5B, true, 123, 30);
state.Key(0xA4, true, 123, 40);
state.Reset();
state.Key(0xA4, false, 123, 50);
Check(state.Key(0x5B, false, 123, 60) != ChordResult.Triggered, "Disable/reset clears pending chord");

Check(Marshal.SizeOf<NativeMethods.RawInputHeader>() == (IntPtr.Size == 8 ? 24 : 16), "Raw input header matches Windows ABI");
Check(Marshal.SizeOf<NativeMethods.RawInputDevice>() == (IntPtr.Size == 8 ? 16 : 12), "Raw input registration matches Windows ABI");
Check(Marshal.SizeOf<NativeMethods.RawKeyboard>() == 16, "Raw keyboard payload matches Windows ABI");
Check(NativeMethods.NormalizeKey(new NativeMethods.RawKeyboard { VirtualKey = 0x12 }) == 0xA4 &&
    NativeMethods.NormalizeKey(new NativeMethods.RawKeyboard { VirtualKey = 0x12, Flags = 2 }) == 0xA5,
    "Raw input distinguishes left/right Alt");
Check(NativeMethods.NormalizeKey(new NativeMethods.RawKeyboard { VirtualKey = 0x11, Flags = 2 }) == 0xA3 &&
    NativeMethods.NormalizeKey(new NativeMethods.RawKeyboard { VirtualKey = 0x10, MakeCode = 0x36 }) == 0xA1,
    "Raw input normalizes Ctrl/Shift for held-key tracking");
Console.WriteLine($"{passed} checks passed. These do not test actual Windows hotkeys or text insertion.");
