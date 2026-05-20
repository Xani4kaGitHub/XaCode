#!/bin/bash
set -e

echo "=========================================="
printf "\x1b[38;2;251;194;235m%s\x1b[0m\n" '$$\   $$\            $$$$$$\                  $$\           '
printf "\x1b[38;2;239;194;235m%s\x1b[0m\n" '$$ |  $$ |          $$  __$$\                 $$ |          '
printf "\x1b[38;2;227;194;236m%s\x1b[0m\n" '\$$\ $$  | $$$$$$\  $$ /  \__| $$$$$$\   $$$$$$$ | $$$$$$\  '
printf "\x1b[38;2;215;194;236m%s\x1b[0m\n" ' \$$$$  /  \____$$\ $$ |      $$  __$$\ $$  __$$ |$$  __$$\ '
printf "\x1b[38;2;202;194;237m%s\x1b[0m\n" ' $$  $$<   $$$$$$$ |$$ |      $$ /  $$ |$$ /  $$ |$$$$$$$$ |'
printf "\x1b[38;2;190;193;237m%s\x1b[0m\n" '$$  /\$$\ $$  __$$ |$$ |  $$\ $$ |  $$ |$$ |  $$ |$$   ____|'
printf "\x1b[38;2;178;193;238m%s\x1b[0m\n" '$$ /  $$ |\$$$$$$$ |\$$$$$$  |\$$$$$$  |\$$$$$$$ |\$$$$$$$\ '
printf "\x1b[38;2;166;193;238m%s\x1b[0m\n" '\__|  \__| \_______| \______/  \______/  \_______| \_______|'
echo ""
echo "      XaCode Enterprise Installer (Linux/systemd)           "
echo "=========================================="

# Check for Node.js
if ! command -v node &> /dev/null
then
    echo "Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

echo "Installing dependencies..."
npm install

echo "Building project..."
npm run build

echo "Checking Python & faster-whisper dependencies..."
if command -v python3 &> /dev/null; then
    if ! python3 -c "import faster_whisper" &> /dev/null; then
        echo "faster-whisper not found. Installing..."
        if ! command -v pip3 &> /dev/null && ! command -v pip &> /dev/null; then
            echo "pip not found. Installing python3-pip..."
            sudo apt-get update && sudo apt-get install -y python3-pip
        fi
        pip3 install --break-system-packages faster-whisper || pip3 install faster-whisper || python3 -m pip install faster-whisper || echo "WARNING: Failed to install faster-whisper automatically."
    else
        echo "faster-whisper is already installed."
    fi
else
    echo "WARNING: python3 is not installed. Whisper transcription will not work."
fi

# Prompt for configuration
if [ ! -f .env ]; then
    echo "Creating .env file..."
    read -p "Enter Telegram Bot Token: " bot_token
    read -p "Enter DeepSeek API Key: " api_key
    read -p "Enter Allowed Telegram User IDs (comma-separated): " allowed_ids

    cat <<EOF > .env
TELEGRAM_BOT_TOKEN=$bot_token
DEEPSEEK_API_KEY=$api_key
ALLOWED_USER_IDS=$allowed_ids
SANDBOX_DIR=$(pwd)/sandbox
MAX_EXECUTION_TIMEOUT_MS=30000
EOF
    echo ".env file created."
else
    echo ".env file already exists, skipping configuration."
fi

# Create sandbox dir
mkdir -p sandbox

echo "Setting up global CLI command (xacode)..."
chmod +x dist/cli.js
sudo ln -sf $(pwd)/dist/cli.js /usr/local/bin/xacode

echo "Setting up systemd service..."
SERVICE_FILE=/etc/systemd/system/xacode.service

cat <<EOF | sudo tee $SERVICE_FILE > /dev/null
[Unit]
Description=XaCode Telegram AI Agent
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
ExecStart=$(which node) $(pwd)/dist/index.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable xacode
sudo systemctl start xacode

echo "=========================================="
echo "Installation complete!"
echo "Service 'xacode' is now running."
echo "View logs: sudo journalctl -u xacode -f"
echo "=========================================="
