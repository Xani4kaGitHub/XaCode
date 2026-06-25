#!/bin/sh
echo "Updating project from GitHub..."
git pull origin main

echo "Installing updates and building..."
npm install
npm run build

echo "Configuring .env for OpenModel.ai (Anthropic Format)..."
sed -i 's|DEEPSEEK_BASE_URL=.*|DEEPSEEK_BASE_URL=https://api.openmodel.ai/v1/messages|' .env
if ! grep -q "LLM_PROVIDER=" .env; then
  echo "LLM_PROVIDER=openmodel" >> .env
else
  sed -i 's|LLM_PROVIDER=.*|LLM_PROVIDER=openmodel|' .env
fi

echo "Restarting XaCode service..."
sudo systemctl restart xacode

echo "Done! Run 'xacode logs' to check if everything is working."
