using System;
using System.Diagnostics;
using System.Linq;
using System.Windows.Forms;
using CefSharp.WinForms;

namespace PerformanceBrowser
{
    public partial class Form1 : Form
    {
        private ChromiumWebBrowser browser;

        private TextBox urlTextBox;
        private Button goButton;

        private System.Windows.Forms.Timer systemMetricsTimer;
        private Process browserProcess;

        // Labels for browser-specific metrics
        private Label lblCpuUsage;
        private Label lblMemoryUsage;
        private Label lblThreadCount;
        private Label lblHandleCount;

        public Form1()
        {
            InitializeComponent();
            InitializeBrowser();
            InitializeMetricsDisplay();
            InitializeNavigation();
            InitializeBrowserSpecificMetrics();
        }

        private void InitializeBrowser()
        {
            browser = new ChromiumWebBrowser("https://mcctr.theviewhospital.com/")
            {
                Dock = DockStyle.Fill
            };
            browser.FrameLoadEnd += OnFrameLoadEnd;

            splitContainer1.Panel1.Controls.Add(browser);
        }

        private Label CreateMetricLabel(string initialText)
        {
            return new Label
            {
                Text = initialText,
                Width = 150, // Set a fixed width for uniformity
                Height = 30, // Set a fixed height for readability
                TextAlign = System.Drawing.ContentAlignment.MiddleLeft,
                Margin = new Padding(10, 10, 0, 0) // Add some spacing
            };
        }


        private void InitializeMetricsDisplay()
        {
            // Create a FlowLayoutPanel for displaying metrics
            var metricsPanel = new FlowLayoutPanel
            {
                Dock = DockStyle.Bottom,
                Height = 50,
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = true,
                AutoScroll = true,
                BackColor = System.Drawing.Color.LightGray
            };

            // Create labels for metrics
            lblCpuUsage = CreateMetricLabel("CPU Usage: --");
            lblMemoryUsage = CreateMetricLabel("Memory Usage: --");
            lblThreadCount = CreateMetricLabel("Thread Count: --");
            lblHandleCount = CreateMetricLabel("Handle Count: --");

            // Add labels to the metrics panel
            metricsPanel.Controls.Add(lblCpuUsage);
            metricsPanel.Controls.Add(lblMemoryUsage);
            metricsPanel.Controls.Add(lblThreadCount);
            metricsPanel.Controls.Add(lblHandleCount);

            // Add the panel to the form
            Controls.Add(metricsPanel);
        }

        private void InitializeNavigation()
        {
            var navPanel = new Panel
            {
                Dock = DockStyle.Top,
                Height = 50
            };

            urlTextBox = new TextBox
            {
                Dock = DockStyle.Fill,
                PlaceholderText = "Enter URL here..."
            };
            urlTextBox.KeyUp += (sender, e) =>
            {
                if (e.KeyCode == Keys.Enter)
                {
                    NavigateToUrl();
                }
            };

            goButton = new Button
            {
                Text = "Go",
                Dock = DockStyle.Right,
                Width = 50
            };
            goButton.Click += (sender, e) => NavigateToUrl();

            navPanel.Controls.Add(urlTextBox);
            navPanel.Controls.Add(goButton);

            splitContainer1.Panel1.Controls.Add(navPanel);
        }

        private void NavigateToUrl()
        {
            if (!string.IsNullOrWhiteSpace(urlTextBox.Text))
            {
                browser.Load(urlTextBox.Text);
            }
        }

        private void InitializeBrowserSpecificMetrics()
        {
            browserProcess = Process.GetProcessesByName("CefSharp.BrowserSubprocess")
                                    .FirstOrDefault(p => p.StartTime > Process.GetCurrentProcess().StartTime);

            if (browserProcess == null)
            {
                MessageBox.Show("Browser subprocess not found. Metrics will not be available.");
                return;
            }

            MessageBox.Show($"Browser Process Found: {browserProcess.ProcessName} (ID: {browserProcess.Id})");

            systemMetricsTimer = new System.Windows.Forms.Timer { Interval = 1000 };
            systemMetricsTimer.Tick += UpdateBrowserMetrics;
            systemMetricsTimer.Start();
        }

        private void UpdateBrowserMetrics(object sender, EventArgs e)
        {
            if (browserProcess == null || browserProcess.HasExited)
            {
                lblCpuUsage.Invoke((MethodInvoker)(() =>
                {
                    lblCpuUsage.Text = "CPU Usage: --";
                    lblMemoryUsage.Text = "Memory Usage: --";
                    lblThreadCount.Text = "Thread Count: --";
                    lblHandleCount.Text = "Handle Count: --";
                }));
                return;
            }

            float cpuUsage = GetCpuUsage(browserProcess);
            float memoryUsage = (float)(browserProcess.PrivateMemorySize64 / (1024 * 1024)); // Convert to MB
            int threadCount = browserProcess.Threads.Count;
            int handleCount = browserProcess.HandleCount;

            lblCpuUsage.Invoke((MethodInvoker)(() =>
            {
                lblCpuUsage.Text = $"CPU Usage: {cpuUsage:F2}%";
                lblMemoryUsage.Text = $"Memory Usage: {memoryUsage:F2} MB";
                lblThreadCount.Text = $"Thread Count: {threadCount}";
                lblHandleCount.Text = $"Handle Count: {handleCount}";
            }));
        }



        private float GetCpuUsage(Process process)
        {
            try
            {
                var startCpuTime = process.TotalProcessorTime;
                System.Threading.Thread.Sleep(100);
                var endCpuTime = process.TotalProcessorTime;

                var cpuUsedMs = (endCpuTime - startCpuTime).TotalMilliseconds;
                var totalMsPassed = 100 * Environment.ProcessorCount;

                var usage = (float)(cpuUsedMs / totalMsPassed * 100);
                Debug.WriteLine($"CPU Usage: {usage:F2}%");
                return usage;
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Error calculating CPU usage: {ex.Message}");
                return 0;
            }
        }


        private async void OnFrameLoadEnd(object sender, CefSharp.FrameLoadEndEventArgs e)
        {
            if (e.Frame.IsMain)
            {
                var script = @"
                (function() {
                    const timing = window.performance.timing;
                    const navigationStart = timing.navigationStart;

                    const pageMetrics = {
                        totalLoadTime: timing.loadEventEnd - navigationStart,
                        domProcessingTime: timing.domComplete - timing.domInteractive
                    };

                    const resources = window.performance.getEntriesByType('resource').map(resource => ({
                        name: resource.name,
                        type: resource.initiatorType,
                        duration: resource.duration,
                        transferSize: resource.transferSize || 0
                    }));

                    return { pageMetrics, resources };
                })();
                ";

                var result = await e.Frame.EvaluateScriptAsync(script);
                if (result.Success && result.Result != null)
                {
                    dynamic metrics = result.Result;

                    dynamic pageMetrics = metrics.pageMetrics;
                    string metricsText = $"Page Metrics:\n" +
                                         $"- Total Page Load Time: {pageMetrics.totalLoadTime} ms\n" +
                                         $"- DOM Processing Time: {pageMetrics.domProcessingTime} ms\n\n";

                    metricsText += "Filtered Resource Metrics:\n";
                    foreach (var resource in metrics.resources)
                    {
                        if (resource.transferSize > 100 * 1024 || resource.duration > 300)
                        {
                            metricsText += $"- {resource.name} ({resource.type}): {resource.duration:F2} ms, " +
                                           $"Size: {resource.transferSize} bytes\n";
                        }
                    }
                }
            }
        }

        private void InvokeOnUiThreadIfRequired(Action action)
        {
            if (InvokeRequired)
            {
                Invoke(action);
            }
            else
            {
                action();
            }
        }

        private void splitContainer1_Panel1_Paint(object sender, PaintEventArgs e)
        {

        }
    }
}
