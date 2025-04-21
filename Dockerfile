# Use an official Node.js LTS image with Debian Bullseye (slim version)
FROM node:18-bullseye-slim

# Install system dependencies including Python 3, git, and sudo (for later)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    python3-pip \
    tree \
    sudo \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy package files and install Node.js production dependencies
# This allows Docker to cache the npm install layer if package files don't change
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Copy and install Python dependencies
COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
# Ensure a .dockerignore file exists in your project root to exclude 
# unnecessary files/dirs (like .git, node_modules, .env, etc.)
COPY . .

# (Optional) Expose port if needed later for other features
# EXPOSE 3000

# Define the command to run the application
CMD ["node", "index.js"] 