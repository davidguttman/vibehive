# Tutorial 18: Initial Dockerfile Setup

This tutorial covers creating the initial `Dockerfile` for containerizing the application. This allows for consistent build, deployment, and execution environments.

**Goal:** Create a `Dockerfile` that sets up Node.js, Python, installs dependencies, and copies the application code.

## Steps:

1.  **Create `requirements.txt`:**
    -   The Python wrapper (`aider_wrapper.py`) depends on `aider-chat`.
    -   Create a file named `requirements.txt` in the project root.
    -   Add the following line to it:

    ```text
    # requirements.txt
    aider-chat
    ```
    *Note: You might want to pin the version later for more reproducible builds, e.g., `aider-chat==0.XX.Y`.*

2.  **Create `Dockerfile`:**
    -   Create a file named `Dockerfile` (no extension) in the project root.

3.  **Define Base Image:**
    -   Choose a suitable Node.js base image that includes Python 3. The official `node:<version>-bullseye` images are a good choice as they are based on Debian Bullseye and include Python 3.
    -   Start the `Dockerfile` with the `FROM` instruction. Let's use Node.js 18 LTS.

    ```dockerfile
    # Dockerfile
    # Use an official Node.js LTS image with Debian Bullseye
    FROM node:18-bullseye-slim
    ```
    *Self-correction: Using `-slim` version to keep the image size smaller.*

4.  **Install System Dependencies:**
    -   Install necessary OS packages using `apt-get`. We need `git`, `python3`, `python3-pip` (for installing Python packages), and `tree` (useful utility based on prompts). Add `sudo` for the next tutorial.
    -   Combine `apt-get update` and `apt-get install` in a single `RUN` command to reduce image layers. Clean up apt cache afterwards.

    ```dockerfile
    # Dockerfile
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
    ```

5.  **Set Up Working Directory:**
    -   Use `WORKDIR` to define the primary directory for subsequent commands.

    ```dockerfile
    # Dockerfile
    # ... (FROM, RUN apt-get install) ...

    WORKDIR /app
    ```

6.  **Install Node.js Dependencies:**
    -   Copy `package.json` and `package-lock.json` first.
    -   Run `npm ci --only=production` to install only production dependencies based on the lock file. This is faster and more reliable for CI/CD environments than `npm install`.

    ```dockerfile
    # Dockerfile
    # ... (FROM, RUN apt-get install, WORKDIR) ...

    # Copy package files and install Node.js production dependencies
    COPY package.json package-lock.json ./
    RUN npm ci --only=production
    ```

7.  **Install Python Dependencies:**
    -   Copy the `requirements.txt` file.
    -   Run `pip3 install` to install the Python packages.

    ```dockerfile
    # Dockerfile
    # ... (FROM, ..., RUN npm ci) ...

    # Copy and install Python dependencies
    COPY requirements.txt ./
    RUN pip3 install --no-cache-dir -r requirements.txt
    ```

8.  **Copy Application Code:**
    -   Use `COPY . .` to copy the rest of the application source code into the working directory (`/app`).
    -   *Consider creating a `.dockerignore` file in your project root to exclude files/directories like `.git`, `node_modules`, `.env`, etc., from being copied into the image.*

    ```dockerfile
    # Dockerfile
    # ... (FROM, ..., RUN pip3 install) ...

    # Copy the rest of the application code
    # Ensure a .dockerignore file exists to exclude unnecessary files
    COPY . .
    ```

9.  **Define Default Command:**
    -   Use `CMD` to specify the command to run when the container starts.

    ```dockerfile
    # Dockerfile
    # ... (FROM, ..., COPY . .) ...

    # Define the command to run the application
    CMD ["node", "index.js"]
    ```

10. **(Optional) Expose Port:**
    - While this bot doesn't listen on HTTP, you might expose a port if future functionality requires it. For now, it's not strictly needed.
    ```dockerfile
    # EXPOSE 3000 # Example if needed later
    ```

11. **Final `Dockerfile`:**

    ```dockerfile
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
    COPY package.json package-lock.json ./
    RUN npm ci --only=production

    # Copy and install Python dependencies
    COPY requirements.txt ./
    RUN pip3 install --no-cache-dir -r requirements.txt

    # Copy the rest of the application code
    # Ensure a .dockerignore file exists to exclude unnecessary files
    COPY . .

    # (Optional) Expose port if needed later
    # EXPOSE 3000

    # Define the command to run the application
    CMD ["node", "index.js"]
    ```

12. **Build the Image:**
    - Open your terminal in the project root directory.
    - Run the `docker build` command:

    ```bash
    docker build -t discord-aider-bot .
    ```
    - Verify that the build process completes without errors.

13. **(Manual) Basic Run Test:**
    - Run the container, providing the necessary environment variables. You'll need to replace `<YOUR_DISCORD_TOKEN>`, `<YOUR_MONGODB_URI>`, and `<YOUR_32_CHAR_ENCRYPTION_KEY>` with actual values.

    ```bash
    docker run --rm \
      -e DISCORD_TOKEN=<YOUR_DISCORD_TOKEN> \
      -e MONGODB_URI=<YOUR_MONGODB_URI> \
      -e ENCRYPTION_KEY=<YOUR_32_CHAR_ENCRYPTION_KEY> \
      discord-aider-bot
    ```
    - Check the container logs. You should see messages indicating the bot is starting, connecting to Discord, and attempting to connect to MongoDB. Full functionality isn't expected yet, but basic startup should work.
    - Stop the container (Ctrl+C).

This completes the creation of the initial `Dockerfile`. 