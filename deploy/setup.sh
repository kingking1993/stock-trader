#!/usr/bin/env bash
# Oracle Ubuntu VM 최초 세팅 — Docker 설치 + 방화벽 개방
# 사용: sudo bash setup.sh
set -e

echo "== Docker 설치 =="
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  usermod -aG docker "${SUDO_USER:-ubuntu}" || true
fi

echo "== 방화벽 (Ubuntu iptables) 80/443 개방 =="
# Oracle Ubuntu 이미지는 기본 iptables에서 대부분 막혀 있음
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT || true
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT || true
netfilter-persistent save || iptables-save > /etc/iptables/rules.v4 || true

echo "== 완료. deploy/ 에서 아래 실행 =="
echo "   DOMAIN=<내도메인.duckdns.org> docker compose up -d --build"
