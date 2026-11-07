#!/usr/bin/env bash
# One-time setup on a fresh EC2 instance (Amazon Linux 2023 or Ubuntu 24.04, arm64 t4g.small recommended).
# Run as ec2-user/ubuntu:  bash ec2-setup.sh
set -euo pipefail

if command -v dnf >/dev/null; then
  sudo dnf install -y docker git
  sudo mkdir -p /usr/local/lib/docker/cli-plugins
  ARCH=$(uname -m); [ "$ARCH" = "aarch64" ] || ARCH=x86_64
  sudo curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${ARCH}" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
else
  sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
fi
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"

# small swap file so builds don't OOM on 1–2 GB instances
if ! swapon --show | grep -q swapfile; then
  sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

echo
echo "Docker ready. Log out and back in (for the docker group), then:"
echo "  git clone <your repo> koro && cd koro"
echo "  cp server/.env.example server/.env && nano server/.env"
echo "  DOMAIN=api.<elastic-ip-with-dashes>.sslip.io docker compose -f server/deploy/docker-compose.yml up -d --build"
