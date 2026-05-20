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
    VENV_DIR="$(pwd)/.venv"
    VENV_PIP="$VENV_DIR/bin/pip"
    VENV_PYTHON="$VENV_DIR/bin/python"

    # Create venv if it doesn't exist
    if [ ! -d "$VENV_DIR" ]; then
        echo "Creating Python virtual environment..."
        if ! python3 -m venv "$VENV_DIR" 2>/dev/null; then
            echo "python3-venv not installed. Installing..."
            apt-get update && apt-get install -y python3-venv python3-full
            python3 -m venv "$VENV_DIR"
        fi
    fi

    if ! "$VENV_PYTHON" -c "import faster_whisper" &> /dev/null; then
        echo "faster-whisper not found. Installing into venv..."
        "$VENV_PIP" install --upgrade pip
        "$VENV_PIP" install faster-whisper || echo "WARNING: Failed to install faster-whisper."
    else
        echo "faster-whisper is already installed in venv."
    fi
else
    echo "WARNING: python3 is not installed. Whisper transcription will not work."
fi


echo "Restarting XaCode service..."
sudo systemctl restart xacode

echo "Update complete! Checking status..."
sudo systemctl status xacode --no-pager | head -n 10
