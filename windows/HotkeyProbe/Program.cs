namespace DO.Windows.HotkeyProbe;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new ProbeForm());
    }
}
