#!/bin/bash
set -e

echo "Configuring git safe directory..."
git config --global --add safe.directory $(pwd)

echo "Pulling latest changes from GitHub..."
git pull

echo "Installing missing dependencies..."
npm install

echo "Rebuilding project..."
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

echo "Restarting XaCode service..."
sudo systemctl restart xacode

echo "Update complete! Checking status..."
sudo systemctl status xacode --no-pager | head -n 10
