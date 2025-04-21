# ---- Stage 1: Builder ----
FROM node:18-bullseye-slim AS builder
ENV NODE_ENV=test
WORKDIR /app

# Install build/test dependencies (including python/pip/git/sudo AND libcurl4)
# Same as production stage for now, could be optimized later if needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    python3-pip \
    tree \
    sudo \
    libcurl4 \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# Install node modules (including devDependencies)
COPY package.json package-lock.json ./
RUN npm ci

# Install python dependencies
COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy all source code and test files
# .dockerignore prevents copying unnecessary files like local node_modules/.git
COPY . .

# Run tests - This will fail the build if tests don't pass
RUN npm test

# ---- Stage 2: Production ----
FROM node:18-bullseye-slim
ENV NODE_ENV=production
WORKDIR /app

# Install production system dependencies (including libcurl4)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    python3-pip \
    tree \
    sudo \
    libcurl4 \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# Create users/groups and configure sudo (Copied from previous Dockerfile)
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
    echo "appuser ALL=(coder1,coder2,coder3,coder4,coder5) NOPASSWD: /usr/bin/tree *" >> /etc/sudoers.d/appuser-privs
RUN chmod 0440 /etc/sudoers.d/appuser-privs
# --- Sudo Configuration --- END ---

# Install production node modules ONLY
# Copy package files from builder stage just to be explicit, though not strictly needed if not changed
COPY --from=builder /app/package.json /app/package-lock.json ./
RUN npm ci --only=production

# Install production python dependencies
COPY --from=builder /app/requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy application code from builder stage
COPY --from=builder /app /app

# Set ownership and switch user
RUN chown -R appuser:appuser /app
USER appuser

# Define the command to run the application
CMD ["node", "index.js"] 