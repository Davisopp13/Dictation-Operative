using System.Runtime.InteropServices;

namespace DO.Windows.HotkeyProbe;

internal static class NativeMethods
{
    internal const int WmHotkey = 0x0312;
    internal const int WmInput = 0x00FF;
    internal const uint ModAlt = 1, ModControl = 2, ModNoRepeat = 0x4000;

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool RegisterHotKey(nint window, int id, uint modifiers, uint key);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool UnregisterHotKey(nint window, int id);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool RegisterRawInputDevices([In] RawInputDevice[] devices, uint count, uint size);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetRawInputData(nint input, uint command, nint data, ref uint size, uint headerSize);

    internal static bool ObserveKeyboard(nint window, bool enable) => RegisterRawInputDevices(
        [new RawInputDevice { UsagePage = 1, Usage = 6, Flags = enable ? 0x100u : 1u,
            Target = enable ? window : 0 }], 1, (uint)Marshal.SizeOf<RawInputDevice>());

    internal static bool TryReadKeyboard(nint input, out RawKeyboard keyboard)
    {
        keyboard = default;
        uint size = 0;
        var headerSize = (uint)Marshal.SizeOf<RawInputHeader>();
        if (GetRawInputData(input, 0x10000003, 0, ref size, headerSize) == uint.MaxValue ||
            size < headerSize + Marshal.SizeOf<RawKeyboard>() || size > 4096) return false;
        var data = Marshal.AllocHGlobal((int)size);
        try
        {
            var read = GetRawInputData(input, 0x10000003, data, ref size, headerSize);
            if (read == uint.MaxValue || read < headerSize + Marshal.SizeOf<RawKeyboard>()) return false;
            var header = Marshal.PtrToStructure<RawInputHeader>(data);
            if (header.Type != 1 || header.Size > read) return false;
            keyboard = Marshal.PtrToStructure<RawKeyboard>(data + (int)headerSize);
            return keyboard.VirtualKey != 255 && keyboard.MakeCode != 0xFF;
        }
        finally { Marshal.FreeHGlobal(data); }
    }

    internal static int NormalizeKey(RawKeyboard keyboard) => keyboard.VirtualKey switch
    {
        0x12 => (keyboard.Flags & 2) != 0 ? 0xA5 : 0xA4,
        0x11 => (keyboard.Flags & 2) != 0 ? 0xA3 : 0xA2,
        0x10 => keyboard.MakeCode == 0x36 ? 0xA1 : 0xA0,
        _ => keyboard.VirtualKey
    };

    [StructLayout(LayoutKind.Sequential)]
    internal struct RawInputDevice { public ushort UsagePage, Usage; public uint Flags; public nint Target; }

    [StructLayout(LayoutKind.Sequential)]
    internal struct RawInputHeader { public uint Type, Size; public nint Device, WParam; }

    [StructLayout(LayoutKind.Sequential)]
    internal struct RawKeyboard
    {
        public ushort MakeCode, Flags, Reserved, VirtualKey;
        public uint Message, ExtraInformation;
    }

    [DllImport("user32.dll")]
    internal static extern nint GetForegroundWindow();

    [DllImport("user32.dll")]
    internal static extern uint GetWindowThreadProcessId(nint window, out uint processId);

    [DllImport("user32.dll")]
    internal static extern short GetAsyncKeyState(int key);

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern uint SendInput(uint count, [In] Input[] inputs, int size);

    internal static bool IsHeld(int key) => (GetAsyncKeyState(key) & 0x8000) != 0;

    internal static Input[] UnicodeInputs(string text)
    {
        var result = new Input[text.Length * 2];
        for (var i = 0; i < text.Length; i++)
        {
            // Windows expects UTF-16 units; surrogate pairs are intentionally preserved.
            result[i * 2] = new Input { Type = 1, Data = new InputUnion {
                Keyboard = new KeyboardInput { Scan = text[i], Flags = 0x0004 } } };
            result[i * 2 + 1] = new Input { Type = 1, Data = new InputUnion {
                Keyboard = new KeyboardInput { Scan = text[i], Flags = 0x0004 | 0x0002 } } };
        }
        return result;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct Input { public uint Type; public InputUnion Data; }

    // Include the full union: a keyboard-only union gives SendInput the wrong cbSize.
    [StructLayout(LayoutKind.Explicit)]
    internal struct InputUnion
    {
        [FieldOffset(0)] public MouseInput Mouse;
        [FieldOffset(0)] public KeyboardInput Keyboard;
        [FieldOffset(0)] public HardwareInput Hardware;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct KeyboardInput
    {
        public ushort VirtualKey, Scan;
        public uint Flags, Time;
        public nuint ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct MouseInput
    {
        public int X, Y;
        public uint MouseData, Flags, Time;
        public nuint ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct HardwareInput { public uint Message; public ushort ParamLow, ParamHigh; }
}
