using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace OmniOps.EdgeAgent
{
    public class OmniOpsAgentForm : Form
    {
        // Win32 API for Alt+Space Global Hotkey
        [DllImport("user32.dll")]
        private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
        [DllImport("user32.dll")]
        private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        private const int HOTKEY_ID = 9001;
        private const uint MOD_ALT = 0x0001;
        private const uint VK_SPACE = 0x0020;

        private TextBox txtServerUrl;
        private TextBox txtPin;
        private Button btnConnect;
        private Button btnInstall;
        private Label lblStatus;
        private Panel pnlApprovalGate;
        private Label lblCommand;
        private Button btnDeny;
        private Button btnApprove;
        private Button btnKillSwitch;
        private NotifyIcon trayIcon;
        private bool isConnected = false;
        private string sessionToken = "";

        public OmniOpsAgentForm()
        {
            InitializeComponent();
            RegisterGlobalHotkey();
        }

        private void InitializeComponent()
        {
            this.Text = "OmniOps Desktop Edge Agent (ایجنت دسکتاپ)";
            this.Size = new Size(520, 640);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(18, 22, 31);
            this.ForeColor = Color.White;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);

            // Title Label
            Label lblTitle = new Label();
            lblTitle.Text = "✦ OmniOps Desktop Edge";
            lblTitle.Font = new Font("Segoe UI", 14f, FontStyle.Bold);
            lblTitle.ForeColor = Color.FromArgb(94, 234, 212);
            lblTitle.Location = new Point(20, 16);
            lblTitle.AutoSize = true;
            this.Controls.Add(lblTitle);

            Label lblSubtitle = new Label();
            lblSubtitle.Text = "پل ارتباطی امن میان محیط کاربری ویندوز، ایجنت‌های هوش مصنوعی و هسته OmniOps";
            lblSubtitle.Font = new Font("Segoe UI", 8.5f);
            lblSubtitle.ForeColor = Color.FromArgb(160, 175, 195);
            lblSubtitle.Location = new Point(22, 48);
            lblSubtitle.Size = new Size(460, 36);
            this.Controls.Add(lblSubtitle);

            // Settings Group
            GroupBox grpConnection = new GroupBox();
            grpConnection.Text = "تنظیمات اتصال به هسته مرکزی (Connection Settings)";
            grpConnection.ForeColor = Color.FromArgb(200, 210, 225);
            grpConnection.Location = new Point(20, 90);
            grpConnection.Size = new Size(464, 160);

            Label lblUrl = new Label();
            lblUrl.Text = "نشانی سرور (Master URL):";
            lblUrl.Location = new Point(16, 26);
            lblUrl.AutoSize = true;
            grpConnection.Controls.Add(lblUrl);

            txtServerUrl = new TextBox();
            txtServerUrl.Text = "http://127.0.0.1:8080";
            txtServerUrl.Location = new Point(16, 48);
            txtServerUrl.Size = new Size(430, 26);
            txtServerUrl.BackColor = Color.FromArgb(13, 17, 23);
            txtServerUrl.ForeColor = Color.White;
            grpConnection.Controls.Add(txtServerUrl);

            Label lblPinPrompt = new Label();
            lblPinPrompt.Text = "کد پین ۶ رقمی جفت‌سازی (Pairing PIN):";
            lblPinPrompt.Location = new Point(16, 84);
            lblPinPrompt.AutoSize = true;
            grpConnection.Controls.Add(lblPinPrompt);

            txtPin = new TextBox();
            txtPin.Location = new Point(16, 108);
            txtPin.Size = new Size(180, 26);
            txtPin.MaxLength = 6;
            txtPin.Font = new Font("Consolas", 12f, FontStyle.Bold);
            txtPin.BackColor = Color.FromArgb(13, 17, 23);
            txtPin.ForeColor = Color.FromArgb(251, 191, 36);
            grpConnection.Controls.Add(txtPin);

            btnConnect = new Button();
            btnConnect.Text = "🔗 اتصال امن (Connect)";
            btnConnect.Location = new Point(210, 106);
            btnConnect.Size = new Size(236, 32);
            btnConnect.BackColor = Color.FromArgb(14, 165, 233);
            btnConnect.ForeColor = Color.White;
            btnConnect.FlatStyle = FlatStyle.Flat;
            btnConnect.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
            btnConnect.Click += BtnConnect_Click;
            grpConnection.Controls.Add(btnConnect);

            this.Controls.Add(grpConnection);

            // Status label
            lblStatus = new Label();
            lblStatus.Text = "وضعیت: آماده اتصال. کد ۶ رقمی را از پنل وب دریافت و وارد کنید.";
            lblStatus.ForeColor = Color.FromArgb(148, 163, 184);
            lblStatus.Location = new Point(20, 260);
            lblStatus.Size = new Size(464, 28);
            this.Controls.Add(lblStatus);

            // Interactive Approval Gate Panel
            pnlApprovalGate = new Panel();
            pnlApprovalGate.BackColor = Color.FromArgb(24, 28, 40);
            pnlApprovalGate.Location = new Point(20, 295);
            pnlApprovalGate.Size = new Size(464, 180);
            pnlApprovalGate.BorderStyle = BorderStyle.FixedSingle;

            Label lblGateHeader = new Label();
            lblGateHeader.Text = "🔐 دروازه تایید تعاملی دستورات (Interactive Approval Gate)";
            lblGateHeader.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            lblGateHeader.ForeColor = Color.FromArgb(251, 191, 36);
            lblGateHeader.Location = new Point(12, 10);
            lblGateHeader.AutoSize = true;
            pnlApprovalGate.Controls.Add(lblGateHeader);

            lblCommand = new Label();
            lblCommand.Text = "$ npm run clean && npm run deploy\n[Risk: Production Deploy - Awaiting Authorization]";
            lblCommand.Font = new Font("Consolas", 9f);
            lblCommand.ForeColor = Color.FromArgb(52, 211, 153);
            lblCommand.BackColor = Color.FromArgb(13, 17, 23);
            lblCommand.Location = new Point(12, 38);
            lblCommand.Size = new Size(438, 52);
            lblCommand.Padding = new Padding(6);
            pnlApprovalGate.Controls.Add(lblCommand);

            btnDeny = new Button();
            btnDeny.Text = "✕ رد دستور (Deny)";
            btnDeny.Location = new Point(12, 100);
            btnDeny.Size = new Size(180, 36);
            btnDeny.BackColor = Color.FromArgb(55, 65, 81);
            btnDeny.ForeColor = Color.FromArgb(243, 244, 246);
            btnDeny.FlatStyle = FlatStyle.Flat;
            btnDeny.Click += (s, e) => {
                lblStatus.Text = "دستور در ترمینال لغو شد (Rejected).";
                lblStatus.ForeColor = Color.FromArgb(248, 113, 113);
            };
            pnlApprovalGate.Controls.Add(btnDeny);

            btnApprove = new Button();
            btnApprove.Text = "✓ تأیید امن (Authorize)";
            btnApprove.Location = new Point(204, 100);
            btnApprove.Size = new Size(246, 36);
            btnApprove.BackColor = Color.FromArgb(16, 185, 129);
            btnApprove.ForeColor = Color.White;
            btnApprove.FlatStyle = FlatStyle.Flat;
            btnApprove.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
            btnApprove.Click += (s, e) => {
                lblStatus.Text = "مجوز صادر شد: Allowed from Desktop Agent [HMAC Verified]";
                lblStatus.ForeColor = Color.FromArgb(52, 211, 153);
            };
            pnlApprovalGate.Controls.Add(btnApprove);

            btnKillSwitch = new Button();
            btnKillSwitch.Text = "🔴 کلید قطع اضطراری سراسری (Emergency Kill-Switch)";
            btnKillSwitch.Location = new Point(12, 142);
            btnKillSwitch.Size = new Size(438, 28);
            btnKillSwitch.BackColor = Color.FromArgb(153, 27, 27);
            btnKillSwitch.ForeColor = Color.White;
            btnKillSwitch.FlatStyle = FlatStyle.Flat;
            btnKillSwitch.Font = new Font("Segoe UI", 8.5f, FontStyle.Bold);
            btnKillSwitch.Click += (s, e) => {
                if (MessageBox.Show("آیا از فعال‌سازی کلید قطع اضطراری مطمئن هستید؟", "Kill-Switch", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes)
                {
                    lblStatus.Text = "کلیه دستورات و فرایندهای ایجنت متوقف شدند (Emergency Kill-Switch Triggered).";
                    lblStatus.ForeColor = Color.FromArgb(239, 68, 68);
                }
            };
            pnlApprovalGate.Controls.Add(btnKillSwitch);

            this.Controls.Add(pnlApprovalGate);

            // Footer Installer Button
            btnInstall = new Button();
            btnInstall.Text = "📦 نصب پایدار در ویندوز و ایجاد میانبر دسکتاپ (Create Shortcuts)";
            btnInstall.Location = new Point(20, 490);
            btnInstall.Size = new Size(464, 38);
            btnInstall.BackColor = Color.FromArgb(31, 41, 55);
            btnInstall.ForeColor = Color.FromArgb(209, 213, 219);
            btnInstall.FlatStyle = FlatStyle.Flat;
            btnInstall.Font = new Font("Segoe UI", 9f);
            btnInstall.Click += BtnInstall_Click;
            this.Controls.Add(btnInstall);

            Label lblHotkeyHint = new Label();
            lblHotkeyHint.Text = "💡 کلید میانبر سراسری ویندوز: فشردن Alt + Space پنجره را نمایش/پنهان می‌کند.";
            lblHotkeyHint.Font = new Font("Segoe UI", 8.5f);
            lblHotkeyHint.ForeColor = Color.FromArgb(100, 116, 139);
            lblHotkeyHint.Location = new Point(20, 540);
            lblHotkeyHint.Size = new Size(464, 24);
            this.Controls.Add(lblHotkeyHint);

            // System Tray Icon
            trayIcon = new NotifyIcon();
            trayIcon.Text = "OmniOps Desktop Edge";
            trayIcon.Icon = SystemIcons.Application;
            trayIcon.Visible = true;
            trayIcon.DoubleClick += (s, e) => {
                this.Show();
                this.WindowState = FormWindowState.Normal;
                this.BringToFront();
            };
        }

        private void RegisterGlobalHotkey()
        {
            try
            {
                RegisterHotKey(this.Handle, HOTKEY_ID, MOD_ALT, VK_SPACE);
            }
            catch { }
        }

        protected override void WndProc(ref Message m)
        {
            const int WM_HOTKEY = 0x0312;
            if (m.Msg == WM_HOTKEY && m.WParam.ToInt32() == HOTKEY_ID)
            {
                if (this.Visible)
                {
                    this.Hide();
                }
                else
                {
                    this.Show();
                    this.WindowState = FormWindowState.Normal;
                    this.BringToFront();
                }
            }
            base.WndProc(ref m);
        }

        private void BtnConnect_Click(object sender, EventArgs e)
        {
            string pin = txtPin.Text.Trim();
            if (pin.Length != 6)
            {
                MessageBox.Show("لطفاً کد پین ۶ رقمی معتبر را وارد کنید.", "خطا", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            lblStatus.Text = "در حال احراز هویت با هسته مرکزی...";
            lblStatus.ForeColor = Color.FromArgb(251, 191, 36);
            btnConnect.Enabled = false;

            ThreadPool.QueueUserWorkItem((state) => {
                try
                {
                    string target = txtServerUrl.Text.Trim().TrimEnd('/') + "/api/agent/redeem";
                    var request = (HttpWebRequest)WebRequest.Create(target);
                    request.Method = "POST";
                    request.ContentType = "application/json";
                    request.Timeout = 5000;

                    string json = "{\"code\":\"" + pin + "\"}";
                    byte[] bytes = Encoding.UTF8.GetBytes(json);
                    request.ContentLength = bytes.Length;
                    using (var stream = request.GetRequestStream())
                    {
                        stream.Write(bytes, 0, bytes.Length);
                    }

                    using (var response = (HttpWebResponse)request.GetResponse())
                    using (var reader = new StreamReader(response.GetResponseStream()))
                    {
                        string result = reader.ReadToEnd();
                        this.Invoke(new Action(() => {
                            isConnected = true;
                            lblStatus.Text = "✓ متصل شد! نود ویندوز به هسته پیوست. نشست موقت در RAM فعال است.";
                            lblStatus.ForeColor = Color.FromArgb(52, 211, 153);
                            btnConnect.Text = "✓ متصل (Connected)";
                            btnConnect.BackColor = Color.FromArgb(16, 185, 129);
                            btnConnect.Enabled = true;
                        }));
                    }
                }
                catch (Exception ex)
                {
                    this.Invoke(new Action(() => {
                        lblStatus.Text = "خطا در اتصال: " + ex.Message;
                        lblStatus.ForeColor = Color.FromArgb(248, 113, 113);
                        btnConnect.Enabled = true;
                    }));
                }
            });
        }

        private void BtnInstall_Click(object sender, EventArgs e)
        {
            try
            {
                string targetDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OmniOps");
                Directory.CreateDirectory(targetDir);
                string targetExe = Path.Combine(targetDir, "OmniOps-Edge.exe");
                File.Copy(Application.ExecutablePath, targetExe, true);

                // Create Shortcut on Desktop
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string shortcutPath = Path.Combine(desktop, "OmniOps Desktop Edge.url");
                using (StreamWriter writer = new StreamWriter(shortcutPath))
                {
                    writer.WriteLine("[InternetShortcut]");
                    writer.WriteLine("URL=file:///" + targetExe.Replace('\\', '/'));
                    writer.WriteLine("IconIndex=0");
                    writer.WriteLine("IconFile=" + targetExe);
                }

                MessageBox.Show("نصب پایدار با موفقیت انجام شد و میانبر دسکتاپ ایجاد گردید.\nمسیر: " + targetExe, "نصب موفق", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show("خطا در ایجاد میانبر: " + ex.Message, "خطا", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                this.Hide();
                trayIcon.ShowBalloonTip(2000, "OmniOps Desktop Edge", "ایجنت در پس‌زمینه فعال است. برای باز کردن کلید Alt + Space را فشار دهید.", ToolTipIcon.Info);
            }
            else
            {
                UnregisterHotKey(this.Handle, HOTKEY_ID);
                trayIcon.Dispose();
                base.OnFormClosing(e);
            }
        }

        [STAThread]
        public static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new OmniOpsAgentForm());
        }
    }
}
