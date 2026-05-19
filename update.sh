#!/bin/bash
set -e

echo "Pulling latest changes from GitHub..."
git pull

echo "Installing missing dependencies..."
npm install

echo "Rebuilding project..."
npm run build

echo "Restarting XaCode service..."
sudo systemctl restart xacode

echo "Update complete! Checking status..."
sudo systemctl status xacode --no-pager | head -n 10
