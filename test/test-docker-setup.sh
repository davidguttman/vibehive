#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

IMAGE_NAME="discord-aider-bot"
CONTAINER_NAME="test-discord-aider-setup"

echo "--- Starting Docker Setup Verification ---"

# Ensure the image exists (optional, build if needed)
if ! docker image inspect "$IMAGE_NAME" > /dev/null 2>&1; then
  echo "Image '$IMAGE_NAME' not found. Building..."
  docker build -t "$IMAGE_NAME" .
fi

# Run tests inside a temporary container
echo "Running tests inside container: $CONTAINER_NAME"

docker run --rm --name "$CONTAINER_NAME" --user=appuser "$IMAGE_NAME" /bin/bash -c \
'set -e # Ensure script inside container also exits on error

echo "[Container] Running checks as: $(whoami)"

# Check user and group
whoami | grep -q "^appuser$" && echo "[Container] PASSED: whoami is appuser"

id | grep -q "uid=[0-9]*(appuser)" && echo "[Container] PASSED: id shows appuser UID"
id | grep -q "gid=[0-9]*(appuser)" && echo "[Container] PASSED: id shows appuser GID"

# Check /app ownership
ls -ld /app | grep -q "appuser appuser" && echo "[Container] PASSED: /app owned by appuser:appuser"

# Check /repos structure and ownership
ls -ld /repos | grep -q "root root" && echo "[Container] PASSED: /repos owned by root:root"

for i in $(seq 1 5); do \
  ls -ld /repos/coder$i | grep -q "coder$i coders" && echo "[Container] PASSED: /repos/coder$i owned by coder$i:coders"; \
done

# Check sudo permissions (allowed commands)
echo "[Container] Testing sudo commands..."
sudo -u coder1 whoami | grep -q "^coder1$" && echo "[Container] PASSED: sudo -u coder1 whoami -> coder1"
sudo -u coder2 /usr/bin/git --version > /dev/null && echo "[Container] PASSED: sudo git allowed"
sudo -u coder3 /bin/rm --version > /dev/null && echo "[Container] PASSED: sudo rm allowed"
sudo -u coder4 /usr/bin/python3 --version > /dev/null && echo "[Container] PASSED: sudo python3 allowed"
sudo -u coder5 /bin/ls /repos/coder5 > /dev/null && echo "[Container] PASSED: sudo ls allowed"

# Check sudo permissions (disallowed command)
echo "[Container] Testing disallowed sudo command (expect failure)..."
if sudo -u coder1 touch /tmp/test_sudo_fail > /dev/null 2>&1; then \
  echo "[Container] FAILED: sudo touch unexpectedly allowed!" && exit 1; \
else \
  echo "[Container] PASSED: sudo touch correctly disallowed"; \
fi

echo "[Container] All checks passed!"
' # End of commands passed to container

echo
echo "--- Docker Setup Verification Complete --- " 