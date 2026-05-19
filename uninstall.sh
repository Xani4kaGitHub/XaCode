#!/bin/bash

echo "Stopping XaCode service..."
sudo systemctl stop xacode || true

echo "Disabling XaCode service..."
sudo systemctl disable xacode || true

echo "Removing systemd service file..."
sudo rm -f /etc/systemd/system/xacode.service
sudo systemctl daemon-reload

echo "Removing global CLI command..."
sudo rm -f /usr/local/bin/xacode

echo "XaCode has been successfully removed from the system."
echo "Note: The project files and .env configuration are still preserved in this directory."
echo "If you want to delete the files as well, you can run: cd .. && rm -rf XaCode"
