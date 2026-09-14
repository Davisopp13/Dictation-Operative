using System.Diagnostics;
using System.Runtime.InteropServices;

namespace DO.Windows.HotkeyProbe;

internal sealed class ProbeForm : Form
{
    private const int HotkeyId = 1;
    private const string Sample = "DO Windows test — café ✓";
    private readonly ComboBox shortcut = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 190 };
    private readonly CheckBox insert = new() { Text = "Also insert the sample text (one test per enable)", AutoSize = true };
    private readonly Button toggle = new() { Text = "Enable hotkey", AutoSize = true };
    private readonly Label status = new() { Text = "Hotkey is off.", AutoSize = true, MaximumSize = new Size(620, 0) };
    private readonly TextBox report = new() { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill };
    private readonly System.Windows.Forms.Timer releaseTimer = new() { Interval = 25 };
    private readonly Stopwatch pendingTime = new();
    private readonly ModifierChord chord = new();
    private readonly System.Windows.Forms.Timer chordTimer = new() { Interval = 25 };
    private bool modifierMode;
    private nint target;
    private uint targetProcess;
    private int triggerKey;
    private bool registered;

    internal ProbeForm()
    {
        Text = "DO — Windows compatibility test";
        ClientSize = new Size(720, 780);
        MinimumSize = new Size(720, 780);
        AutoScaleMode = AutoScaleMode.Dpi;
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 10);

        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), ColumnCount = 1, RowCount = 9 };
        for (var i = 0; i < 8; i++) layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        Controls.Add(layout);
        Label TextBlock(string text, float size = 10) => new() {
            Text = text, AutoSize = true, MaximumSize = new Size(620, 0),
            Font = new Font("Segoe UI", size), Margin = new Padding(0, 0, 0, 14) };
        layout.Controls.Add(TextBlock("Test DO on your Windows laptop", 18));
        layout.Controls.Add(TextBlock("1. Enable a shortcut below.\n2. Open a blank Notepad document and click its editing area.\n3. Press and release the shortcut, then return here to see the result."));
        layout.Controls.Add(TextBlock("Start with hotkey detection only. To test insertion, check the box before enabling. Use a blank document: inserted text can replace a selection."));
        shortcut.Items.AddRange(["Win + Alt", "Ctrl + Alt + F9", "Ctrl + Alt + F10", "Ctrl + Alt + F8"]);
        shortcut.SelectedIndex = 0;
        var actions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 0, 0, 12) };
        actions.Controls.Add(shortcut);
        actions.Controls.Add(toggle);
        layout.Controls.Add(actions);
        layout.Controls.Add(insert);
        layout.Controls.Add(TextBlock($"Sample: {Sample}\nThe test sends no Enter/Tab keys and leaves your clipboard alone."));
        layout.Controls.Add(status);
        var save = new Button { Text = "Save test report…", AutoSize = true, Margin = new Padding(0, 12, 0, 12) };
        layout.Controls.Add(save);
        layout.Controls.Add(report);

        toggle.Click += (_, _) => { if (registered) Disable(); else Enable(); };
        save.Click += (_, _) => SaveReport();
        releaseTimer.Tick += (_, _) => TryInsert();
        chordTimer.Tick += (_, _) => HandleChordResult(chord.Poll(NativeMethods.GetForegroundWindow(), Environment.TickCount64));
        Log($"DO Hotkey Probe 0.2.0 | {RuntimeInformation.OSDescription} | {RuntimeInformation.ProcessArchitecture}");
        using var identity = System.Security.Principal.WindowsIdentity.GetCurrent();
        var elevated = new System.Security.Principal.WindowsPrincipal(identity)
            .IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);
        Log($"Running elevated: {elevated}. {(elevated ? "Relaunch normally to test standard-user behavior." : "Standard-user test context.")}");
        Log("Local test only. No microphone, network, clipboard access, startup entry, or keyboard hook. Run normally, without administrator rights.");
    }

    private void Enable()
    {
        modifierMode = shortcut.SelectedIndex == 0;
        triggerKey = shortcut.SelectedIndex switch { 0 => 0, 2 => 0x79, 3 => 0x77, _ => 0x78 };
        chord.Reset(Enumerable.Range(8, 248).Where(k => k is not (0x10 or 0x11 or 0x12) && NativeMethods.IsHeld(k)));
        var success = modifierMode ? NativeMethods.ObserveKeyboard(Handle, true) :
            NativeMethods.RegisterHotKey(Handle, HotkeyId,
                NativeMethods.ModAlt | NativeMethods.ModControl | NativeMethods.ModNoRepeat, (uint)triggerKey);
        if (!success)
        {
            var error = Marshal.GetLastWin32Error();
            Log($"Could not register shortcut (Windows error {error}). Try another shortcut; this alone does not establish an IT restriction.");
            return;
        }
        registered = true;
        shortcut.Enabled = insert.Enabled = false;
        toggle.Text = "Disable hotkey";
        Log($"Enabled {shortcut.SelectedItem}. Mode: {(insert.Checked ? "one insertion" : "detection only")}. Switch to blank Notepad now.");
        if (modifierMode) Log("Press Win + Alt in either order and release both within two seconds. Adding any other key cancels DO. Keyboard input passes through normally; no keys are recorded.");
    }

    private void Disable()
    {
        releaseTimer.Stop();
        chordTimer.Stop();
        chord.Reset();
        target = 0;
        if (registered && !(modifierMode ? NativeMethods.ObserveKeyboard(Handle, false) : NativeMethods.UnregisterHotKey(Handle, HotkeyId)))
        {
            Log($"Could not unregister shortcut (Windows error {Marshal.GetLastWin32Error()}). Close the test app to release it.");
            return;
        }
        registered = false;
        shortcut.Enabled = insert.Enabled = true;
        toggle.Text = "Enable hotkey";
        Log("Hotkey is off.");
    }

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == NativeMethods.WmInput && registered && modifierMode)
        {
            if (NativeMethods.TryReadKeyboard(message.LParam, out var keyboard))
                HandleChordResult(chord.Key(NativeMethods.NormalizeKey(keyboard), (keyboard.Flags & 1) == 0,
                    NativeMethods.GetForegroundWindow(), Environment.TickCount64));
            // Default processing is required for foreground raw-input cleanup.
        }
        if (message.Msg == NativeMethods.WmHotkey && message.WParam == HotkeyId && registered && !modifierMode)
        {
            Trigger(NativeMethods.GetForegroundWindow());
            return;
        }
        base.WndProc(ref message);
    }

    private void HandleChordResult(ChordResult result)
    {
        if (result == ChordResult.Started) chordTimer.Start();
        if (result == ChordResult.Canceled)
        {
            chordTimer.Stop();
            Log("Win + Alt canceled: another key, changed foreground, or two-second timeout. Release all keys before retrying.");
        }
        if (result == ChordResult.Triggered)
        {
            chordTimer.Stop();
            Trigger(chord.Target);
        }
    }

    private void Trigger(nint foreground)
    {
        if (releaseTimer.Enabled) return;
        Log("PASS: Windows delivered the shortcut.");
        if (!insert.Checked) return;
        target = foreground;
        NativeMethods.GetWindowThreadProcessId(target, out targetProcess);
        if (target == 0 || targetProcess == 0 || targetProcess == (uint)Environment.ProcessId)
        {
            Log("Nothing inserted. Switch to a blank document in another app and try again.");
            return;
        }
        pendingTime.Restart();
        releaseTimer.Start();
    }

    private void TryInsert()
    {
        var current = NativeMethods.GetForegroundWindow();
        NativeMethods.GetWindowThreadProcessId(current, out var currentProcess);
        var held = new[] { 0x10, 0x11, 0x12, 0x5B, 0x5C, triggerKey }.Where(k => k != 0).Any(NativeMethods.IsHeld);
        var decision = InjectionGate.Evaluate(target, currentProcess == targetProcess ? current : 0,
            held, pendingTime.ElapsedMilliseconds);
        if (decision == GateResult.Wait) return;
        releaseTimer.Stop();
        if (decision != GateResult.Send)
        {
            Disable();
            Log($"Canceled without insertion: {(decision == GateResult.FocusChanged ? "foreground window changed" : "shortcut keys were held too long")}. Enable to retry.");
            return;
        }
        var inputs = NativeMethods.UnicodeInputs(Sample);
        // Recheck immediately before SendInput; Windows provides no atomic target-bound injection.
        if (NativeMethods.GetForegroundWindow() != target)
        {
            Disable();
            Log("Canceled: foreground window changed before insertion.");
            return;
        }
        var sent = NativeMethods.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<NativeMethods.Input>());
        var error = Marshal.GetLastWin32Error();
        Disable(); // One attempt per enable, including failures; never retry a partial insertion.
        Log(sent == inputs.Length
            ? "Input events accepted by Windows. Check Notepad for the exact sample; this is not proof the target displayed it. Enable again for another test."
            : $"Insertion incomplete: {sent}/{inputs.Length} events accepted (Windows error {error}; may be zero for permission blocking). No retry. Check the document. Higher-privilege targets or security controls may block insertion.");
    }

    private void Log(string message)
    {
        status.Text = message;
        // Bound memory even if the tester leaves detection enabled for a long session.
        if (report.TextLength > 24000) report.Text = report.Text[^12000..];
        report.AppendText($"[{DateTimeOffset.Now:HH:mm:ss zzz}] {message}{Environment.NewLine}");
    }

    private void SaveReport()
    {
        using var dialog = new SaveFileDialog { Filter = "Text report (*.txt)|*.txt", FileName = "DO-Windows-test-report.txt" };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        try { File.WriteAllText(dialog.FileName, report.Text); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        { MessageBox.Show(this, "Could not save the report. Choose a writable folder.", "Save report"); }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        releaseTimer.Stop();
        releaseTimer.Dispose();
        chordTimer.Stop();
        chordTimer.Dispose();
        if (registered)
        {
            if (modifierMode) NativeMethods.ObserveKeyboard(Handle, false);
            else NativeMethods.UnregisterHotKey(Handle, HotkeyId);
        }
        base.OnFormClosed(e);
    }
}
