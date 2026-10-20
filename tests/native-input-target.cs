using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;

// A dedicated input target. Never inject into the user's applications or save text.
internal static class InputTarget {
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
  [STAThread] static void Main() {
    SetProcessDPIAware();
    Application.EnableVisualStyles();
    using (var form = new Form()) using (var input = new TextBox()) {
      form.Text = "WebDesk · 输入回归测试";
      form.ClientSize = new Size(420, 110);
      form.StartPosition = FormStartPosition.Manual;
      var area = Screen.PrimaryScreen.WorkingArea;
      form.Location = new Point(area.Left + (area.Width - form.Width) / 2, area.Top + (area.Height - form.Height) / 2);
      form.TopMost = true;
      input.SetBounds(24, 35, 372, 30);
      input.ImeMode = ImeMode.Disable;
      form.Controls.Add(input);
      input.MouseDown += (sender, e) => Console.WriteLine("{\"click\":true}");
      input.MouseMove += (sender, e) => Console.WriteLine("{\"move\":true}");
      input.KeyDown += (sender, e) => Console.WriteLine("{\"keydown\":true}");
      input.KeyUp += (sender, e) => Console.WriteLine("{\"keyup\":true}");
      input.TextChanged += (sender, e) => {
        if (String.Equals(input.Text, "a", StringComparison.OrdinalIgnoreCase)) Console.WriteLine("{\"typed\":true}");
      };
      form.Shown += (sender, e) => {
        form.Activate(); input.Focus();
        Point cursor; GetCursorPos(out cursor);
        var target = input.PointToScreen(new Point(input.Width / 2, input.Height / 2));
        Console.WriteLine("{\"ready\":true,\"x\":" + target.X + ",\"y\":" + target.Y + ",\"originalX\":" + cursor.X + ",\"originalY\":" + cursor.Y + "}");
        Task.Run(() => { Console.ReadLine(); if (!form.IsDisposed) form.BeginInvoke(new Action(form.Close)); });
      };
      using (var timeout = new Timer()) {
        timeout.Interval = 20000;
        timeout.Tick += (sender, e) => form.Close();
        timeout.Start(); Application.Run(form);
      }
    }
  }
}
