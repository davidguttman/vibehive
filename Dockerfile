# Use an official Node.js LTS image with Debian Bullseye (slim version)
FROM node:18-bullseye-slim

# Install system dependencies including Python 3, git, and sudo
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    python3-pip \
    tree \
    sudo \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# --- User and Group Setup --- START ---
# Create a non-root group and user for the application
RUN groupadd -r appuser && useradd -r -g appuser -m -d /app -s /bin/bash appuser

# Create a group for coder users
RUN groupadd coders

# Create the base directory for repositories BEFORE creating user homes inside it
RUN mkdir /repos

# Create coder users (e.g., 1 through 5) with homes in /repos
# Ensure coder home directories have correct initial ownership and permissions
RUN for i in $(seq 1 5); do \
    useradd -r -g coders -m -d /repos/coder$i -s /bin/bash coder$i && \
    chown coder$i:coders /repos/coder$i && chmod 700 /repos/coder$i; \
    done

# Set initial ownership/permissions for /repos base directory (owned by root)
RUN chown root:root /repos && chmod 755 /repos
# --- User and Group Setup --- END ---

# --- Sudo Configuration --- START ---
# Create sudoers file for appuser, granting specific permissions
# Use fully qualified paths verified with `which` on a debian:bullseye-slim base
# (e.g., which python3 -> /usr/bin/python3, which git -> /usr/bin/git, etc.)
RUN echo "# Allow appuser to run specific commands as coderX users" > /etc/sudoers.d/appuser-privs && \
    echo "appuser ALL=(coder1,coder2,coder3,coder4,coder5) NOPASSWD: /usr/bin/python3 /app/aider_wrapper.py *" >> /etc/sudoers.d/appuser-privs && \
    echo "appuser ALL=(coder1,coder2,coder3,coder4,coder5) NOPASSWD: /usr/bin/git *" >> /etc/sudoers.d/appuser-privs && \
    echo "appuser ALL=(coder1,coder2,coder3,coder4,coder5) NOPASSWD: /bin/rm *" >> /etc/sudoers.d/appuser-privs && \
    echo "appuser ALL=(coder1,coder2,coder3,coder4,coder5) NOPASSWD: /bin/mkdir *" >> /etc/sudoers.d/appuser-privs && \
    echo "appuser ALL=(coder1,coder2,coder3,coder4,coder5) NOPASSWD: /bin/chown *" >> /etc/sudoers.d/appuser-privs && \
    echo "appuser ALL=(coder1,coder2,coder3,coder4,coder5) NOPASSWD: /bin/chmod *" >> /etc/sudoers.d/appuser-privs && \
    echo "appuser ALL=(coder1,coder2,coder3,coder4,coder5) NOPASSWD: /bin/ls *" >> /etc/sudoers.d/appuser-privs && \
    echo "appuser ALL=(coder1,coder2,coder3,coder4,coder5) NOPASSWD: /usr/bin/tree *" >> /etc/sudoers.d/appuser-privs

# Set correct permissions for the sudoers file
RUN chmod 0440 /etc/sudoers.d/appuser-privs
# --- Sudo Configuration --- END ---

# Set the working directory (can be done before or after user setup)
WORKDIR /app

# Copy package files and install Node.js production dependencies (as root)
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Copy and install Python dependencies (as root)
COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy the rest of the application code (as root)
# .dockerignore should exclude node_modules, .git, etc.
COPY . .

# --- Final Permissions and User Switch --- START ---
# Change ownership of the app directory AFTER code/deps are copied
RUN chown -R appuser:appuser /app

# Switch to the non-root user
USER appuser
# --- Final Permissions and User Switch --- END ---

# Define the command to run the application (runs as appuser)
CMD ["node", "index.js"] 