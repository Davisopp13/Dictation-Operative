# Windows compatibility prototype

This is a small native Windows test for the proposed DO companion. It checks
whether a normal user process can register a global shortcut and insert a fixed
Unicode sample into another app. It is not the full Windows dictation or Sync app.

## Run on your Windows laptop

1. Choose `DO-HotkeyProbe-win-x64.zip` for an Intel/AMD Windows laptop, or
   `DO-HotkeyProbe-win-arm64.zip` for a Windows ARM laptop. Extract the entire ZIP.
2. Open `DO.Windows.HotkeyProbe.exe` normally. There is no installer, separate
   .NET installation, or administrator-rights request. These prototype binaries
   are unsigned; company application controls may prevent execution. If blocked,
   record the message and use your IT approval process; do not change security settings.
3. Leave **Also insert the sample text** unchecked and choose **Enable hotkey**.
4. Open a blank Notepad document. Press and release **Win + Alt**.
   Release both keys within two seconds. Return to the probe: its report should
   say Windows delivered the shortcut. Either press order and either Windows/Alt
   key are supported; AltGr accompanied by Ctrl is treated as another combination.
5. Disable the hotkey. Check **Also insert the sample text**, then enable again.
   Click the blank editing area in Notepad, then press and release the shortcut.
6. Confirm this exact text appears once: **DO Windows test — café ✓**.
   The probe disables its shortcut after the insertion attempt.
7. Choose **Save test report…**. Note separately whether the text actually
   appeared and any missing/changed characters. Repeat in a disposable draft in
   each intended application, without sending the draft.

Win + Alt is the default. It triggers once after both keys are released. Adding
any other key cancels DO, so combinations such as Win + Alt + R pass through.
The prototype does not suppress Windows or foreground-app handling of these keys;
verify that menus/Start do not interfere on your device. If needed, choose a
Ctrl + Alt + F9/F10/F8 fallback. A fallback shortcut conflict does not imply an IT restriction. Close the app to release its shortcut. Delete the extracted
folder to remove the prototype; it creates no startup entry or settings store.

## What to verify

| Test | Expected result |
| --- | --- |
| Launch with normal user rights | Window opens; no elevation prompt |
| Detection while Notepad is focused | Report records a delivered hotkey |
| Insertion into blank Notepad | Exact sample appears once; shortcut turns off |
| Hold shortcut longer than two seconds | Insertion cancels |
| Switch windows while holding shortcut | Insertion cancels when a changed foreground is observed |
| Press shortcut after disabling/closing | Probe does nothing |
| Win + Alt + another key | DO does not trigger; existing shortcut still works |
| Win/Alt alone, either press/release order, left/right keys | Only the complete two-key chord triggers |
| Two copies register the same Ctrl + Alt + F-key fallback | Second copy reports failure; alternate shortcut can be chosen |
| 125–200% display scaling | Controls, status, and save report remain accessible |
| Intended work apps / remote desktops | Record actual result separately for each environment |

## Scope and limitations

- The manifest requests `asInvoker` and `uiAccess=false`. Launch normally to test
  standard-user behavior; it inherits elevation if explicitly launched elevated.
- Win + Alt uses `RegisterRawInputDevices` with `RIDEV_INPUTSINK`; it observes
  keyboard transitions while the probe runs, including when minimized. It keeps
  only current held-key state in memory, with no typed-text decoding, key-event
  history, keyboard hook, suppression, or key logging. F-key fallbacks use
  `RegisterHotKey`. Disable/close removes the registration. Unlike a registered
  F-key shortcut, raw input does not reserve Win + Alt exclusively; other apps
  may react too. Run one probe at a time.
- The modifier chord supports either press/release order and either side of the
  keyboard. It cancels for any additional key, observed focus change, or a hold
  of two seconds after the full chord is formed. Keys already held when enabling
  must be released before a fresh attempt.
- Insertion waits for Ctrl/Alt/Shift/Windows keys and the trigger key to be released,
  checks the foreground window/process, expires after two seconds, and makes one
  `SendInput` attempt. No automatic retry on partial insertion.
- Windows input injection is not atomic with focus changes. Test only in blank
  disposable documents. The fixed sample has no Enter or Tab; selected text can
  still be replaced. The probe does not activate another window itself.
- Input accepted by Windows is not proof the destination rendered it. Visually
  check the target. Higher-privilege apps, remote sessions, and endpoint controls
  can behave differently. A failure code cannot reliably identify UIPI blocking.
- No microphone, transcription, cloud requests, clipboard reads/writes, Sync,
  hold-to-talk dictation, installer, updater, or signing is included. Passing this
  probe does not validate those capabilities or imply organizational approval.
- Reports contain local times, OS/process architecture, elevation status, and
  test outcomes; no document text, window titles, or application names are read.

## Build and checks

Requires the .NET 10 SDK on the development machine. From the repository root:

```sh
dotnet run --project windows/HotkeyProbe.Tests -c Release
dotnet publish windows/HotkeyProbe -c Release -r win-x64 --self-contained true -o windows/dist/win-x64
dotnet publish windows/HotkeyProbe -c Release -r win-arm64 --self-contained true -o windows/dist/win-arm64
```

Distribute the entire published folder as a ZIP. It includes the runtime and
does not install it globally. The macOS/Linux SDK can cross-compile using
`EnableWindowsTargeting`; actual GUI, permissions, and insertion tests require
Windows. The dependency-free checks cover cancellation decisions, UTF-16 input
encoding, native struct layout, and modifier-chord sequences. CI builds both packages on Windows and uploads
artifacts; it does not claim interactive or Hapag-device acceptance.

API references: [RegisterHotKey](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey),
[SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput),
[KEYBDINPUT](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-keybdinput).

Modifier input reference: [Windows Raw Input](https://learn.microsoft.com/en-us/windows/win32/inputdev/using-raw-input).
