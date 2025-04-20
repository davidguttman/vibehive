# Tutorial 19: Dockerfile Users and Sudo Configuration

This tutorial builds upon the previous `Dockerfile` by introducing dedicated user management and `sudo` configuration. This enhances security by running the application as a non-root user (`appuser`) and setting up specific permissions for this user to execute commands (like `git` and the Python wrapper) as other designated users (`coderX`) within the container. This simulates a multi-user environment where different repositories might be handled under different user contexts.

**Goal:** Modify the `Dockerfile` to create an `appuser`, a `coders` group, `coderX` users, and configure passwordless `sudo` for `appuser` to run specific commands as `coderX` users.

## Steps:

1.  **Modify `Dockerfile` - Add User/Group Creation:**
    -   Open the `Dockerfile` created in the previous tutorial.
    -   After installing system dependencies (`RUN apt-get install ...`), add commands to:
        -   Create the `appuser` group and user, setting `/app` as the home directory.
        -   Create the `coders` group.
        -   Create the base `/repos` directory. *Ownership/permissions will be adjusted later.*
        -   Create `coder1` through `coder5` users belonging to the `coders` group, with home directories under `/repos`.
        -   Create the `/repos` directory *before* creating coder homes within it.

    ```dockerfile
    # Dockerfile
    # ... (FROM, RUN apt-get install ... including sudo) ...

    # --- User and Group Setup ---
    # Create a non-root user for the application
    RUN groupadd -r appuser && useradd -r -g appuser -m -d /app -s /bin/bash appuser

    # Create a group for coder users
    RUN groupadd coders

    # Create the base directory for repositories BEFORE creating user homes inside it
    RUN mkdir /repos

    # Create coder users (e.g., 1 through 5) with homes in /repos
    RUN for i in $(seq 1 5); do \
        useradd -r -g coders -m -d /repos/coder$i -s /bin/bash coder$i; \
        done

    # Set initial ownership/permissions for /repos (can be adjusted)
    # Allow appuser group to write here initially? Or keep root-owned?
    # Let's make it owned by root initially, appuser will use sudo later.
    RUN chown root:root /repos && chmod 755 /repos
    # Ensure coder home directories have correct ownership
    RUN for i in $(seq 1 5); do \
        chown coder$i:coders /repos/coder$i && chmod 700 /repos/coder$i; \
        done
    # --- End User and Group Setup ---

    # Set the working directory (can happen before or after user setup)
    WORKDIR /app

    # ... (Rest of the Dockerfile: COPY package.json, RUN npm ci, etc.) ...
    ```
    *Self-correction: Ensured `/repos` is created before coder homes. Set coder home directory permissions.*

2.  **Modify `Dockerfile` - Configure Sudo:**
    -   Still within the user/group setup section (before `WORKDIR /app` or copying app code), add commands to:
        -   Create a `sudoers` file specifically for `appuser`.
        -   Add rules allowing `appuser` to run `python3 /app/aider_wrapper.py`, `git`, `rm`, `mkdir`, `chown`, `chmod`, `ls`, `tree` as any of the `coderX` users without a password. *Verify the paths to executables like `python3`, `git` are correct within the container (use `which` command inside a test container if unsure).*
        -   Set the correct permissions (`0440`) on the sudoers file.

    ```dockerfile
    # Dockerfile
    # ... (FROM, RUN apt-get install, User/Group Setup) ...

    # --- Sudo Configuration ---
    # Create sudoers file for appuser
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
    # --- End Sudo Configuration ---

    WORKDIR /app

    # ... (Rest of the Dockerfile: COPY package.json, RUN npm ci, etc.) ...
    ```
    *Note: Using individual `echo` commands with `&&` is one way to create the sudoers file; alternatively, you could `COPY` a pre-written file.*

3.  **Modify `Dockerfile` - Switch User and Ownership:**
    -   *After* copying the application code (`COPY . .`) and installing dependencies, add commands to:
        -   Change the ownership of the entire `/app` directory to `appuser`.
        -   Switch the active user to `appuser`.

    ```dockerfile
    # Dockerfile
    # ... (User/Group/Sudo Setup, WORKDIR, Dependency Installs, COPY . .) ...

    # --- Final Permissions and User Switch ---
    # Change ownership of the app directory to the app user
    # Ensure this happens AFTER all code/dependencies are in place
    RUN chown -R appuser:appuser /app

    # Switch to the non-root user
    USER appuser
    # --- End Final Permissions and User Switch ---

    # Define the command to run the application (as appuser)
    CMD ["node", "index.js"]
    ```

4.  **Final `Dockerfile` (incorporating changes):**

    ```dockerfile
    # Use an official Node.js LTS image with Debian Bullseye
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

    # --- User and Group Setup ---
    RUN groupadd -r appuser && useradd -r -g appuser -m -d /app -s /bin/bash appuser
    RUN groupadd coders
    RUN mkdir /repos
    RUN for i in $(seq 1 5); do \
        useradd -r -g coders -m -d /repos/coder$i -s /bin/bash coder$i; \
        done
    RUN chown root:root /repos && chmod 755 /repos
    RUN for i in $(seq 1 5); do \
        chown coder$i:coders /repos/coder$i && chmod 700 /repos/coder$i; \
        done
    # --- End User and Group Setup ---

    # --- Sudo Configuration ---
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
    # --- End Sudo Configuration ---

    # Set the working directory (can be done earlier as well)
    WORKDIR /app

    # Copy package files and install Node.js production dependencies
    COPY package.json package-lock.json ./
    # Run npm ci as root *before* changing ownership/user
    RUN npm ci --only=production

    # Copy and install Python dependencies (as root)
    COPY requirements.txt ./
    RUN pip3 install --no-cache-dir -r requirements.txt

    # Copy the rest of the application code
    # Consider using a .dockerignore file
    COPY . .

    # --- Final Permissions and User Switch ---
    # Change ownership of the app directory AFTER code/deps are copied
    RUN chown -R appuser:appuser /app

    # Switch to the non-root user
    USER appuser
    # --- End Final Permissions and User Switch ---

    # Define the command to run the application (runs as appuser)
    CMD ["node", "index.js"]
    ```
    *Self-correction: Moved `npm ci` and `pip3 install` to run as root before the final `chown` and `USER appuser` switch. This is generally safer as installation steps might require root privileges.*

5.  **Rebuild the Image:**
    -   Build the image again using the same tag.

    ```bash
    docker build -t discord-aider-bot .
    ```
    -   Verify the build completes successfully.

6.  **Manual Testing (Sudo and Users):**
    -   Run the container interactively, specifying `appuser` to ensure you start as the correct user, and get a bash shell.

    ```bash
    docker run -it --rm --user=appuser discord-aider-bot /bin/bash
    # Note: You are already appuser because of USER appuser in Dockerfile,
    # but explicitly setting --user confirms behavior.
    ```
    -   **Inside the container:**
        -   Run `whoami`. It should output `appuser`.
        -   Run `id`. Verify UID/GID correspond to `appuser`.
        -   Run `ls -ld /app`. Verify ownership is `appuser appuser`.
        -   Run `ls -ld /repos`. Verify ownership is `root root` (or as set).
        -   Run `ls -l /repos`. Verify `coderX` directories exist with `coderX coders` ownership.
        -   Test `sudo` access:
            -   `sudo -u coder1 whoami` (Should output `coder1`)
            -   `sudo -u coder2 /usr/bin/git --version` (Should execute successfully)
            -   `sudo -u coder3 /bin/rm --version` (Should execute successfully)
            -   `sudo -u coder4 /usr/bin/python3 --version` (Should execute successfully)
            -   `sudo -u coder1 ls /repos/coder1` (Should work)
        -   Test a command *not* in sudoers:
            -   `sudo -u coder1 touch /tmp/test` (Should result in a "sorry, user appuser is not allowed to execute..." error)
        -   Exit the interactive container (`exit`).

This completes the setup of users and sudo within the Docker container, providing a more secure and structured environment for running the application and its associated processes. 