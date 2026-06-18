using System;
using System.Windows.Forms;
using CefSharp;
using CefSharp.WinForms;

namespace PerformanceBrowser
{
    internal static class Program
    {
        [STAThread]
        static void Main()
        {
            // Initialize CefSharp
            Cef.Initialize(new CefSettings());

            // Run the main form
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new Form1());
        }
    }
}
