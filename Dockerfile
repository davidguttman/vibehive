# Use Node.js 20
FROM node:20-bullseye-slim

# Set NODE_ENV via runtime flags (e.g., docker run -e NODE_ENV=...)
# ENV NODE_ENV=development # Or test, or leave unset

WORKDIR /app

# Install build/test/run dependencies (including python/pip/git/sudo AND libcurl4)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    python3-pip \
    tree \
    sudo \
    libcurl4 \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# Install python dependencies FIRST
COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

# Install node modules (including devDependencies needed for tests and potentially runtime) SECOND
COPY package.json package-lock.json ./
RUN npm ci

# Create users/groups and configure sudo BEFORE copying code 
# to leverage caching if users/sudo don't change
# --- User and Group Setup --- START ---
RUN groupadd -r appuser && useradd -r -g appuser -m -d /app -s /bin/bash appuser
RUN groupadd coders
RUN mkdir /repos
RUN for i in $(seq 1 5); do \
    useradd -r -g coders -m -d /repos/coder$i -s /bin/bash coder$i && \
    chown coder$i:coders /repos/coder$i && chmod 700 /repos/coder$i; \
    done
RUN chown root:root /repos && chmod 755 /repos
# --- User and Group Setup --- END ---
# --- Sudo Configuration --- START ---
RUN echo "# Allow appuser to run specific commands as coderX users" > /etc/sudoers.d/appuser-privs && \
    echo "appuser ALL=(coder1,coder2,coder3,coder4,coder5) NOPASSWD: /usr/bin/python3 /app/aider_wrapper.py *" >> /etc/sudoers.d/appuser-privs && \
    echo "appuser ALL=(coder1,coder2,coder3,coder4,coder5) NOPASSWD: /usr/bin/git *" >> /etc/sudoers.d/appuser-privs && \
    echo "appuser ALL=(coder1,coder2,coder3,coder4,coder5) NOPASSWD: /bin/rm *" >> /etc/sudoers.d/appuser-privs && \
    echo "appuser ALL=(coder1,coder2,coder3,coder4,coder5) NOPASSWD: /bin/mkdir *" >> /etc/sudoers.d/appuser-privs && \
    echo "appuser ALL=(coder1,coder2,coder3,coder4,coder5) NOPASSWD: /bin/chown *" >> /etc/sudoers.d/appuser-privs && \
    echo "appuser ALL=(coder1,coder2,coder3,coder4,coder5) NOPASSWD: /bin/chmod *" >> /etc/sudoers.d/appuser-privs && \
    echo "appuser ALL=(coder1,coder2,coder3,coder4,coder5) NOPASSWD: /bin/ls *" >> /etc/sudoers.d/appuser-privs && \
    echo "appuser ALL=(coder1,coder2,coder3,coder4,coder5) NOPASSWD: /usr/bin/tree *" >> /etc/sudoers.d/appuser-privs && \
    echo "" >> /etc/sudoers.d/appuser-privs && \
    echo "# Allow appuser to run specific commands directly (as root) for repo setup/cleanup" >> /etc/sudoers.d/appuser-privs && \
    echo "appuser ALL=(ALL) NOPASSWD: /bin/chown *" >> /etc/sudoers.d/appuser-privs && \
    echo "appuser ALL=(ALL) NOPASSWD: /bin/rm *" >> /etc/sudoers.d/appuser-privs

RUN chmod 0440 /etc/sudoers.d/appuser-privs
# --- Sudo Configuration --- END ---

# Copy all source code
# .dockerignore prevents copying unnecessary files like local node_modules/.git
COPY . .

# Set ownership and switch user (BEFORE CMD)
RUN chown -R appuser:appuser /app
USER appuser
RUN npm config set update-notifier false

# Define the command to run the application (for production)
CMD ["node", "index.js"] 