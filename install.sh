#!/bin/bash
set -e

echo "=========================================="
echo '$$\   $$\            $$$$$$\                  $$\           '
echo '$$ |  $$ |          $$  __$$\                 $$ |          '
echo '\$$\ $$  | $$$$$$\  $$ /  \__| $$$$$$\   $$$$$$$ | $$$$$$\  '
echo ' \$$$$  /  \____$$\ $$ |      $$  __$$\ $$  __$$ |$$  __$$\ '
echo ' $$  $$<   $$$$$$$ |$$ |      $$ /  $$ |$$ /  $$ |$$$$$$$$ |'
echo '$$  /\$$\ $$  __$$ |$$ |  $$\ $$ |  $$ |$$ |  $$ |$$   ____|'
echo '$$ /  $$ |\$$$$$$$ |\$$$$$$  |\$$$$$$  |\$$$$$$$ |\$$$$$$$\ '
echo '\__|  \__| \_______| \______/  \______/  \_______| \_______|'
echo "                                                            "
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
